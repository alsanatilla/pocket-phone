package org.textphone.launcher;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.util.AtomicFile;
import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Chats save in a private SQLite database first, then portable records sync to the signed-in account.
 * Writes happen on one worker in revision order; a paid request waits until its user turn is on disk.
 */
final class ChatStore {
    interface Failure { void failed(long revision); }

    /** One chat as written; turns are complete, immutable copies. */
    static final class Record {
        final String id, title, draft, error, model, draftContext;
        final ChatProvider.Config provider;
        final ClaudeChatClient.Usage usage;
        final List<ClaudeChatRepository.Turn> turns;
        final long created, updated, revision;
        final boolean deleted, interrupted;
        Record(String id, String title, String draft, String error, String model, ChatProvider.Config provider,
               ClaudeChatClient.Usage usage, List<ClaudeChatRepository.Turn> turns, long created, long updated,
               long revision, boolean deleted, boolean interrupted) {
            this(id,title,draft,error,model,provider,usage,turns,created,updated,revision,deleted,interrupted,"[]");
        }
        Record(String id, String title, String draft, String error, String model, ChatProvider.Config provider,
               ClaudeChatClient.Usage usage, List<ClaudeChatRepository.Turn> turns, long created, long updated,
               long revision, boolean deleted, boolean interrupted, String draftContext) {
            this.id = id; this.title = title; this.draft = draft; this.error = error; this.model = model;
            this.provider = provider; this.usage = usage; this.turns = Collections.unmodifiableList(new ArrayList<>(turns));
            this.created = created; this.updated = updated; this.revision = revision; this.deleted = deleted; this.interrupted = interrupted;
            this.draftContext=draftContext;
        }
        static Record deletion(String id, long revision) {
            return new Record(id, "", "", "", ClaudeChatRepository.MODEL, null, ClaudeChatClient.Usage.EMPTY,
                    Collections.emptyList(), 0, System.currentTimeMillis(), revision, true, false);
        }
    }

    /** A row in the chat list. */
    static final class Summary {
        final String id, title; final long updated; final int replies;
        Summary(String id, String title, long updated, int replies) { this.id = id; this.title = title; this.updated = updated; this.replies = replies; }
    }

    private static final class Helper extends SQLiteOpenHelper {
        Helper(Context context) { super(context, new File(context.getNoBackupFilesDir(), "pocket-chats.db").getPath(), null, 5); }
        @Override public void onConfigure(SQLiteDatabase db) { db.setForeignKeyConstraintsEnabled(true); }
        @Override public void onCreate(SQLiteDatabase db) {
            db.execSQL("CREATE TABLE chats (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, "
                    + "updated INTEGER NOT NULL, draft TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', model TEXT NOT NULL, "
                    + "provider TEXT, provider_model TEXT, base_url TEXT, identity TEXT, input INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0, "
                    + "cache_read INTEGER NOT NULL DEFAULT 0, cache_write INTEGER NOT NULL DEFAULT 0, draft_context TEXT NOT NULL DEFAULT '[]')");
            db.execSQL("CREATE TABLE turns (id TEXT PRIMARY KEY, chat TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, "
                    + "position INTEGER NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, state TEXT NOT NULL, "
                    + "reasoning TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, context TEXT NOT NULL DEFAULT '[]', activity TEXT NOT NULL DEFAULT '[]')");
            db.execSQL("CREATE INDEX turns_by_chat ON turns(chat, position)");
            db.execSQL("CREATE INDEX chats_by_update ON chats(updated)");
            db.execSQL("CREATE TABLE cloud_chats (id TEXT PRIMARY KEY, payload TEXT NOT NULL, dirty INTEGER NOT NULL DEFAULT 1)");
        }
        @Override public void onUpgrade(SQLiteDatabase db, int from, int to) {
            if (from < 2) db.execSQL("ALTER TABLE chats ADD COLUMN provider_model TEXT");
            if(from<3){db.execSQL("ALTER TABLE chats ADD COLUMN draft_context TEXT NOT NULL DEFAULT '[]'");db.execSQL("ALTER TABLE turns ADD COLUMN context TEXT NOT NULL DEFAULT '[]'");}
            if (from < 4) db.execSQL("ALTER TABLE turns ADD COLUMN activity TEXT NOT NULL DEFAULT '[]'");
            if (from < 5) db.execSQL("CREATE TABLE cloud_chats (id TEXT PRIMARY KEY, payload TEXT NOT NULL, dirty INTEGER NOT NULL DEFAULT 1)");
        }
    }

    private final Helper helper;
    private final Context context;
    private final Failure failure;
    private final ExecutorService writer = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "Pocket chat save"); thread.setDaemon(true); return thread;
    });
    private final Map<String, Record> queued = new LinkedHashMap<>();
    // Keep queued and in-flight writes readable: switching chats must never reload an older disk snapshot.
    private final Map<String, Record> latest = new LinkedHashMap<>();
    private final Map<String, Long> written = new LinkedHashMap<>(), failed = new LinkedHashMap<>();
    private boolean writing;

    ChatStore(Context context, Failure failure) {
        this.context = context.getApplicationContext();
        helper = new Helper(context.getApplicationContext());
        this.failure = failure;
        importLegacy(context);
    }

    /** Chats and unsent drafts, most recent first. Nothing is automatically deleted. */
    List<Summary> list() {
        Map<String, Summary> chats = new LinkedHashMap<>();
        try (Cursor rows = helper.getReadableDatabase().rawQuery("SELECT c.id, c.title, c.updated, "
                + "(SELECT COUNT(*) FROM turns t WHERE t.chat = c.id AND t.role = 'assistant'), c.draft FROM chats c "
                + "WHERE c.draft != '' OR c.draft_context != '[]' OR EXISTS (SELECT 1 FROM turns t WHERE t.chat = c.id) ORDER BY c.updated DESC", null)) {
            while (rows.moveToNext()) chats.put(rows.getString(0), new Summary(rows.getString(0),
                    caption(rows.getString(1), rows.getString(4)), rows.getLong(2), rows.getInt(3)));
        } catch (RuntimeException unavailable) { /* An unreadable database lists nothing; the open chat stays usable. */ }
        synchronized (this) {
            for (Record record : latest.values()) {
                chats.remove(record.id);
                if (!record.deleted && (!record.turns.isEmpty() || !record.draft.isEmpty() || !"[]".equals(record.draftContext)))
                    chats.put(record.id, new Summary(record.id, caption(record.title, record.draft), record.updated, record.turns.size() / 2));
            }
        }
        List<Summary> result = new ArrayList<>(chats.values());
        Collections.sort(result, (a, b) -> Long.compare(b.updated, a.updated));
        return result;
    }

    static String caption(String title, String draft) {
        return !title.isEmpty() ? title : draft.trim().isEmpty() ? "new chat" : ClaudeChatRepository.title(draft);
    }

    /** A chat, validated like any untrusted file; null when missing or damaged. An unfinished reply reads as interrupted. */
    Record read(String id) {
        if (id == null) return null;
        synchronized (this) {
            Record pending = latest.get(id);
            if (pending != null) return pending.deleted ? null : pending;
        }
        SQLiteDatabase db = null; boolean transaction = false;
        try {
            db = helper.getReadableDatabase();
            db.beginTransactionNonExclusive(); transaction = true;
            String title, draft, error, model, draftContext; ChatProvider.Config provider = null; ClaudeChatClient.Usage usage; long created, updated;
            try (Cursor chat = db.rawQuery("SELECT title, draft, error, model, provider, base_url, identity, input, output, "
                    + "cache_read, cache_write, created, updated, provider_model, draft_context FROM chats WHERE id = ?", new String[]{id})) {
                if (!chat.moveToFirst()) return null;
                title = chat.getString(0); draft = chat.getString(1); error = chat.getString(2); model = chat.getString(3);
                if (!chat.isNull(4)) {
                    String identity = chat.getString(6);
                    String requestedModel = chat.isNull(13) ? identity.substring(identity.lastIndexOf('|') + 1) : chat.getString(13);
                    provider = new ChatProvider.Config(chat.getString(4), requestedModel, chat.getString(5), 2048, true);
                    if (!provider.identity.equals(identity)) return null;
                    provider.validate();
                }
                usage = new ClaudeChatClient.Usage(chat.getLong(7), chat.getLong(8), chat.getLong(9), chat.getLong(10));
                created = chat.getLong(11); updated = chat.getLong(12);
                draftContext=chat.getString(14);ChatContext.read(draftContext);
            }
            org.json.JSONObject portable = cloudValue(id);
            if (portable != null && !portable.optBoolean("deleted")) try { provider = ChatCloudCodec.provider(portable); } catch (org.json.JSONException | IllegalArgumentException ignored) { }
            if (draft.length() > ClaudeChatRepository.MAX_INPUT_CHARS) draft = "";
            if (!ClaudeChatClient.safeModel(model)) model = ClaudeChatRepository.MODEL;
            if (error.length() > 300) error = "";
            List<ClaudeChatRepository.Turn> turns = new ArrayList<>(); boolean interrupted = false; int total = 0;
            try (Cursor rows = db.rawQuery("SELECT id, role, text, state, reasoning, created, context, activity FROM turns WHERE chat = ? ORDER BY position", new String[]{id})) {
                while (rows.moveToNext()) {
                    String turnId = rows.getString(0), role = rows.getString(1), text = rows.getString(2), state = rows.getString(3), reasoning = rows.getString(4);
                    boolean user = turns.size() % 2 == 0;
                    if (!(user ? "user" : "assistant").equals(role)
                            || text.length() > (user ? ClaudeChatRepository.MAX_INPUT_CHARS : ClaudeChatRepository.MAX_OUTPUT_CHARS)
                            || reasoning.length() > ClaudeChatRepository.MAX_REASONING_CHARS
                            || (user && (!"complete".equals(state) || text.trim().isEmpty()))
                            || !("complete".equals(state) || "pending".equals(state) || "failed".equals(state) || "stopped".equals(state)))
                        return null;
                    if ("pending".equals(state)) {
                        state = "failed"; boolean remote = false;
                        org.json.JSONArray pairs = portable == null ? null : portable.optJSONArray("turns");
                        if (pairs != null) for (int n=0;n<pairs.length();n++) {
                            org.json.JSONObject pair=pairs.optJSONObject(n); if(pair!=null && pair.optString("assistantUid",java.util.UUID.nameUUIDFromBytes((pair.optString("uid")+":assistant").getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString()).equals(turnId))
                                remote="streaming".equals(pair.optString("status"))&&!ChatCloudCodec.device(context).equals(pair.optString("owner"));
                        }
                        interrupted |= !remote;
                    }
                    String attached=rows.getString(6);ChatContext.read(attached);
                    String activity = "pending".equals(rows.getString(3)) ? ChatActivity.settle(rows.getString(7), "failed") : ChatActivity.normalize(rows.getString(7));
                    ClaudeChatRepository.Turn saved=new ClaudeChatRepository.Turn(turnId, role, text, state, reasoning, rows.getLong(5),attached,activity);
                    total += user?ChatContext.prompt(saved).length():text.length();
                    if (total > ClaudeChatRepository.MAX_HISTORY_CHARS || turns.size() >= ClaudeChatRepository.MAX_TURNS) return null;
                    turns.add(saved);
                }
            }
            if (turns.size() % 2 != 0) return null;
            if (!turns.isEmpty() && provider == null) return null;
            if (interrupted) {
                error = "The last reply was interrupted. Tap retry to try again.";
                if (draft.isEmpty() && turns.size() >= 2) draft = turns.get(turns.size() - 2).text;
            }
            // A save can arrive while disk is being read. The newest in-memory snapshot wins.
            synchronized (this) {
                Record pending = latest.get(id);
                if (pending != null) return pending.deleted ? null : pending;
            }
            return new Record(id, title.length() > 80 ? title.substring(0, 80) : title, draft, error, model,
                    turns.isEmpty() ? null : provider, usage, turns, created, updated, 0, false, interrupted,draftContext);
        } catch (RuntimeException damaged) { return null; }
        finally { if (transaction) try { db.endTransaction(); } catch (RuntimeException ignored) { } }
    }

    /** Coalesce frequent stream and draft updates per chat, keeping revision order across the whole batch. */
    synchronized void save(Record record) {
        latest.put(record.id, record);
        queued.remove(record.id); queued.put(record.id, record);
        if (writing) return;
        writing = true;
        writer.execute(this::drain);
    }

    /** A paid request starts only after its user turn is on disk. Never call on the UI thread. */
    synchronized boolean awaitSaved(String id, long revision) throws InterruptedException {
        while (written.getOrDefault(id, 0L) < revision && failed.getOrDefault(id, 0L) < revision) wait();
        return written.getOrDefault(id, 0L) >= revision;
    }

    private void drain() {
        while (true) {
            List<Record> batch;
            synchronized (this) {
                if (queued.isEmpty()) { writing = false; return; }
                batch = new ArrayList<>(queued.values()); queued.clear();
            }
            boolean saved = write(batch);
            synchronized (this) {
                for (Record record : batch) {
                    (saved ? written : failed).put(record.id, record.revision);
                    if (saved && latest.get(record.id) == record) latest.remove(record.id);
                }
                notifyAll();
            }
            if (!saved) for (Record record : batch) failure.failed(record.revision);
            else CloudSync.changed(context);
        }
    }

    private boolean write(List<Record> batch) {
        return write(batch, true);
    }
    private boolean write(List<Record> batch, boolean markDirty) {
        SQLiteDatabase db;
        try { db = helper.getWritableDatabase(); } catch (RuntimeException unavailable) { return false; }
        boolean transaction = false;
        try {
            db.beginTransaction(); transaction = true;
            for (Record record : batch) {
                if (markDirty) {
                    org.json.JSONObject portable = ChatCloudCodec.encode(context, record, cloudValue(record.id));
                    ContentValues value = new ContentValues(); value.put("id",record.id); value.put("payload",portable.toString()); value.put("dirty",1);
                    db.insertWithOnConflict("cloud_chats",null,value,SQLiteDatabase.CONFLICT_REPLACE);
                    if(portable.optBoolean("deleted")){db.delete("chats","id = ?",new String[]{record.id});continue;}
                }
                if (record.deleted) { db.delete("chats", "id = ?", new String[]{record.id}); continue; }
                ContentValues chat = new ContentValues();
                chat.put("id", record.id); chat.put("title", record.title); chat.put("created", record.created); chat.put("updated", record.updated);
                chat.put("draft", record.draft); chat.put("error", record.error); chat.put("model", record.model);
                chat.put("draft_context",record.draftContext);
                if (record.provider != null) {
                    chat.put("provider", record.provider.provider); chat.put("provider_model", record.provider.model);
                    chat.put("base_url", record.provider.baseUrl); chat.put("identity", record.provider.identity);
                } else { chat.putNull("provider"); chat.putNull("provider_model"); chat.putNull("base_url"); chat.putNull("identity"); }
                chat.put("input", record.usage.inputTokens); chat.put("output", record.usage.outputTokens);
                chat.put("cache_read", record.usage.cacheReadTokens); chat.put("cache_write", record.usage.cacheWriteTokens);
                if (db.update("chats", chat, "id = ?", new String[]{record.id}) == 0 && db.insert("chats", null, chat) == -1) return false;
                db.delete("turns", "chat = ?", new String[]{record.id});
                for (int position = 0; position < record.turns.size(); position++) {
                    ClaudeChatRepository.Turn turn = record.turns.get(position);
                    ContentValues row = new ContentValues();
                    row.put("id", turn.id); row.put("chat", record.id); row.put("position", position); row.put("role", turn.role);
                    row.put("text", turn.text); row.put("state", turn.state); row.put("reasoning", turn.reasoning); row.put("created", turn.created);row.put("context",turn.context);row.put("activity",turn.activity);
                    if (db.insert("turns", null, row) == -1) return false;
                }
            }
            db.setTransactionSuccessful();
            db.endTransaction(); transaction = false;
            return true;
        } catch (RuntimeException | org.json.JSONException unavailable) {
            return false;
        } finally {
            if (transaction) try { db.endTransaction(); } catch (RuntimeException ignored) { }
        }
    }
    private org.json.JSONObject cloudValue(String id) {
        try (Cursor rows=helper.getReadableDatabase().rawQuery("SELECT payload FROM cloud_chats WHERE id = ?",new String[]{id})) {
            return rows.moveToFirst()?new org.json.JSONObject(rows.getString(0)):null;
        } catch(org.json.JSONException invalid){throw new IllegalStateException("Saved chat sync data could not be read.",invalid);}
    }
    List<org.json.JSONObject> cloudPending() throws java.io.IOException {
        try { return writer.submit(() -> {
            for(Summary summary:list())if(cloudValue(summary.id)==null){Record record=read(summary.id);if(record!=null&&!write(Collections.singletonList(record)))throw new java.io.IOException("Could not prepare chat sync.");}
            List<org.json.JSONObject> result=new ArrayList<>();
            try(Cursor rows=helper.getReadableDatabase().rawQuery("SELECT payload FROM cloud_chats WHERE dirty = 1",null)){while(rows.moveToNext())result.add(new org.json.JSONObject(rows.getString(0)));}
            return result;
        }).get(); } catch(InterruptedException interrupted){Thread.currentThread().interrupt();throw new java.io.IOException("Chat sync interrupted.",interrupted);}catch(java.util.concurrent.ExecutionException failed){throw new java.io.IOException("Chat sync could not read local data.",failed.getCause());}
    }
    org.json.JSONObject acceptCloud(org.json.JSONObject incoming) throws java.io.IOException {
        try { return writer.submit(() -> {
            String id=incoming.getString("uid");org.json.JSONObject merged=ChatCloudCodec.merge(cloudValue(id),incoming);
            Record record=ChatCloudCodec.decode(merged);
            SQLiteDatabase db=helper.getWritableDatabase();db.beginTransaction();
            try{
                if(!write(Collections.singletonList(record),false))throw new java.io.IOException("Could not save a synced chat.");
                ContentValues value=new ContentValues();value.put("id",id);value.put("payload",merged.toString());value.put("dirty",ChatCloudCodec.canonical(merged).equals(ChatCloudCodec.canonical(incoming))?0:1);
                db.insertWithOnConflict("cloud_chats",null,value,SQLiteDatabase.CONFLICT_REPLACE);db.setTransactionSuccessful();
            }finally{db.endTransaction();}
            return merged;
        }).get(); }catch(InterruptedException interrupted){Thread.currentThread().interrupt();throw new java.io.IOException("Chat sync interrupted.",interrupted);}catch(java.util.concurrent.ExecutionException failed){throw new java.io.IOException("Chat sync could not save local data.",failed.getCause());}
    }

    /** Import with the old format's validation; retain the original until the database copy is verified. */
    private void importLegacy(Context context) {
        File base = new File(context.getNoBackupFilesDir(), "claude-chat.json");
        if (!base.exists() && !new File(base.getPath() + ".bak").exists()) return;
        AtomicFile file = new AtomicFile(base);
        try {
            ClaudeChatStore.State old = new ClaudeChatStore(context, revision -> { }).load();
            if (old.error.startsWith("The saved chat could not be read.")) return;
            // An earlier import may have succeeded before the old file could be removed.
            if (read(old.conversation) == null) {
                long now = System.currentTimeMillis();
                String title = old.turns.isEmpty() ? "" : ClaudeChatRepository.title(old.turns.get(0).text);
                Record imported = new Record(old.conversation, title, old.draft, old.error, old.model, old.provider,
                        old.usage, old.turns, now, now, 0, false, old.interrupted);
                if (!write(Collections.singletonList(imported)) || read(old.conversation) == null) return;
                context.getSharedPreferences(ClaudeChatRepository.PREFS, 0).edit().putString("current", old.conversation).apply();
            }
            file.delete();
        } catch (RuntimeException unavailable) { /* Keep the old file for recovery or a later import. */ }
    }
}
