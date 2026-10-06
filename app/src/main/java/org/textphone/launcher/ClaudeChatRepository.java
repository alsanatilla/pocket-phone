package org.textphone.launcher;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * Application-owned chat state for pip, Pocket's assistant. Activity recreation never starts a second request.
 * Each reply keeps two things apart: the answer, which later requests send back as history, and a reasoning trail
 * (the model's reasoning, what it said before looking something up, and each lookup), which stays on the phone.
 * This keeps earlier lookup remarks from being replayed as part of an answer on later turns.
 */
final class ClaudeChatRepository {
    static final String MODEL = JournalReader.MODEL, NAME = "pip", PREFS = "pocket_chat_state";
    static final int MAX_INPUT_CHARS = 12_000, MAX_OUTPUT_CHARS = 64_000, MAX_REASONING_CHARS = 24_000;
    static final int MAX_TURNS = 40, MAX_HISTORY_CHARS = 180_000;
    /** Marks a lookup line inside a reasoning trail. */
    static final String STEP = "› ";
    private static ClaudeChatRepository instance;

    interface Observer { void changed(); }
    interface RequestFactory {
        ClaudeChatClient.Request create(Context context, ChatProvider.Config config, String chatId,
                List<ClaudeChatClient.Message> history, int limit, ClaudeChatClient.Listener listener);
    }

    static final class Turn {
        final String id, role, text, state, reasoning, context, activity;
        final long created;
        Turn(String id, String role, String text, String state) { this(id, role, text, state, "", System.currentTimeMillis()); }
        Turn(String id, String role, String text, String state, String reasoning, long created) {
            this(id,role,text,state,reasoning,created,"[]");
        }
        Turn(String id, String role, String text, String state, String reasoning, long created, String context) {
            this(id, role, text, state, reasoning, created, context, "[]");
        }
        Turn(String id, String role, String text, String state, String reasoning, long created, String context, String activity) {
            this.id = id; this.role = role; this.text = text; this.state = state;
            this.reasoning = reasoning == null ? "" : reasoning; this.created = created; this.context=context;
            this.activity = activity;
        }
        Turn text(String value, String nextState) { return new Turn(id, role, value, nextState, reasoning, created, context,
                "pending".equals(nextState) ? activity : ChatActivity.settle(activity, "stopped".equals(nextState) ? "stopped" : "failed")); }
        Turn reasoning(String value) { return new Turn(id, role, text, state, value, created, context, activity); }
        Turn activity(String value) { return new Turn(id, role, text, state, reasoning, created, context, ChatActivity.normalize(value)); }
        int lookups() { int count = 0; for (String line : reasoning.split("\n")) if (line.startsWith(STEP)) count++; return count; }
    }

    static final class Snapshot {
        final String chatId, title;
        final List<Turn> turns;
        final boolean running, busyElsewhere;
        final String error, model, status;
        final String provider;
        final long startedAt;
        final long inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens;
        Snapshot(Chat chat, boolean running, boolean busyElsewhere, String model, String provider, String status, long startedAt) {
            chatId = chat.id; title = chat.title; turns = Collections.unmodifiableList(new ArrayList<>(chat.turns));
            this.running = running; this.busyElsewhere = busyElsewhere; error = chat.error; this.model = model;
            this.provider = provider; this.status = status; this.startedAt = startedAt;
            inputTokens = chat.usage.inputTokens; outputTokens = chat.usage.outputTokens;
            cacheReadTokens = chat.usage.cacheReadTokens; cacheWriteTokens = chat.usage.cacheWriteTokens;
        }
    }

    /** One conversation held in memory. */
    private static final class Chat {
        final String id; final long created; long updated, draftRevision;
        String title = "", draft = "", draftContext = "[]", error = "", model = MODEL;
        ChatProvider.Config provider;
        ClaudeChatClient.Usage usage = ClaudeChatClient.Usage.EMPTY;
        final List<Turn> turns = new ArrayList<>();
        Chat(String id, long created) { this.id = id; this.created = created; this.updated = created; }
        static Chat of(ChatStore.Record record) {
            Chat chat = new Chat(record.id, record.created); chat.updated = record.updated; chat.title = record.title;
            chat.draft = record.draft; chat.draftContext=record.draftContext; chat.error = record.error; chat.model = record.model; chat.provider = record.provider;
            chat.usage = record.usage; chat.turns.addAll(record.turns); return chat;
        }
        int characters() { int count = 0; for (Turn turn : turns) count += "user".equals(turn.role)?ChatContext.prompt(turn).length():turn.text.length(); return count; }
    }

    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Set<Observer> observers = new LinkedHashSet<>();
    private final ExecutorService network = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "Pocket pip reply"); thread.setDaemon(true); return thread;
    });
    private final ChatStore store;
    private final RequestFactory requests;
    private Chat chat, busy;
    private String status = "";
    private boolean notificationQueued, replaceOnDelta;
    private long generation, writeRevision, lastStreamSave, startedAt;
    private ClaudeChatClient.Request active;
    private Future<?> activeTask;

    static synchronized ClaudeChatRepository get(Context context) {
        if (instance == null) instance = new ClaudeChatRepository(context.getApplicationContext());
        return instance;
    }

    private ClaudeChatRepository(Context context) {
        this(context, ClaudeChatClient.Call::new);
    }

    ClaudeChatRepository(Context context, RequestFactory requests) {
        this.context = context;
        this.requests = requests;
        store = new ChatStore(context, revision -> main.post(() -> storageFailed(revision)));
        ChatStore.Record saved = store.read(context.getSharedPreferences(PREFS, 0).getString("current", null));
        if (saved == null) { List<ChatStore.Summary> recent = store.list(); if (!recent.isEmpty()) saved = store.read(recent.get(0).id); }
        chat = saved == null ? fresh() : Chat.of(saved);
        remember();
        if (saved != null && saved.interrupted) persist(chat);
    }

    private static Chat fresh() { return new Chat(UUID.randomUUID().toString(), System.currentTimeMillis()); }

    /** The first line of the first message, short enough for one row of the chat list. */
    static String title(String message) {
        String line = message.trim().split("\n", 2)[0].trim().replaceAll("\\s+", " ");
        return line.length() <= 48 ? line : line.substring(0, 47).trim() + "…";
    }

    synchronized void observe(Observer observer) {
        if (observer == null) return;
        observers.add(observer);
        changed();
    }

    synchronized void removeObserver(Observer observer) { observers.remove(observer); }

    synchronized Snapshot snapshot() {
        ChatProvider.Config configured = chat.provider == null ? ChatProvider.get(context) : chat.provider;
        boolean running = busy == chat;
        return new Snapshot(chat, running, busy != null && !running, chat.turns.isEmpty() ? configured.model : chat.model,
                configured.provider, running ? status : "", running ? startedAt : 0);
    }

    // ── Chats ──

    synchronized List<ChatStore.Summary> chats() {
        List<ChatStore.Summary> saved = new ArrayList<>();
        // The database is written in the background; the open and replying chats are always current in memory.
        for (ChatStore.Summary summary : store.list()) if (!deleted.contains(summary.id) && !summary.id.equals(chat.id) && (busy == null || !summary.id.equals(busy.id))) saved.add(summary);
        for (Chat live : busy == null || busy == chat ? new Chat[]{chat} : new Chat[]{chat, busy})
            if (!live.turns.isEmpty() || !live.draft.isEmpty() || !"[]".equals(live.draftContext)) saved.add(new ChatStore.Summary(live.id,
                    ChatStore.caption(live.title, live.draft), live.updated, live.turns.size() / 2));
        Collections.sort(saved, (a, b) -> Long.compare(b.updated, a.updated));
        return saved;
    }
    private final Set<String> deleted = new java.util.HashSet<>();

    synchronized String currentId() { return chat.id; }
    boolean removed(String id) {
        synchronized(this){if(deleted.contains(id))return true;}
        org.json.JSONObject copy=store.cloudValue(id);return copy!=null&&copy.optBoolean("deleted");
    }
    List<ChatStore.Summary> search(String[] words) {
        List<ChatStore.Summary> matches = store.search(words);
        synchronized (this) {
            matches.removeIf(summary -> deleted.contains(summary.id) || summary.id.equals(chat.id) || busy != null && summary.id.equals(busy.id));
            for (Chat live : busy == null || busy == chat ? new Chat[]{chat} : new Chat[]{chat,busy}) {
                StringBuilder text = new StringBuilder(live.title).append('\n').append(live.draft);
                for (Turn turn : live.turns) text.append('\n').append(turn.text);
                if ((!live.turns.isEmpty() || !live.draft.isEmpty()) && PocketSearch.matches(text.toString(), words)) matches.add(new ChatStore.Summary(live.id, ChatStore.caption(live.title,live.draft),live.updated,0));
            }
        }
        matches.sort((a,b)->Long.compare(b.updated,a.updated)); return matches;
    }
    synchronized void openReplyingChat() { if (busy != null) open(busy.id); }
    synchronized boolean acceptsProvider(ChatProvider.Config provider) { return chat.provider == null || chat.provider.identity.equals(provider.identity); }

    synchronized void open(String id) {
        if (id == null || deleted.contains(id) || id.equals(chat.id)) return;
        Chat next = busy != null && busy.id.equals(id) ? busy : null;
        if (next == null) {
            ChatStore.Record record = store.read(id);
            if (record == null) { chat.error = "That chat could not be read."; changed(); return; }
            next = Chat.of(record);
            if (record.interrupted) persist(next);
        }
        chat = next;
        remember();
        changed();
    }

    /** Start an empty chat; the one before stays in the list. An empty chat is reused rather than piled up. */
    synchronized void newChat() {
        if (chat.turns.isEmpty() && chat.draft.isEmpty() && "[]".equals(chat.draftContext)) { chat.error = ""; changed(); return; }
        Chat next = fresh(); next.draft = "";
        chat = next;
        remember();
        changed();
    }

    synchronized void rename(String id, String title) {
        String value = title == null ? "" : title.trim().replaceAll("\\s+", " ");
        if (value.isEmpty() || value.length() > 80) throw new IllegalArgumentException("Use a name of up to 80 characters.");
        Chat target = id.equals(chat.id) ? chat : busy != null && busy.id.equals(id) ? busy : null;
        if (deleted.contains(id)) return;
        if (target == null) { ChatStore.Record record = store.read(id); if (record == null) return; target = Chat.of(record); }
        target.title = value;
        persist(target);
        changed();
    }

    synchronized void delete(String id) {
        if (busy != null && busy.id.equals(id)) stopRunning();
        deleted.add(id); store.save(ChatStore.Record.deletion(id, ++writeRevision));
        if (chat.id.equals(id)) {
            List<ChatStore.Summary> left = store.list(); ChatStore.Record next = null;
            for (ChatStore.Summary summary : left) if (!deleted.contains(summary.id)) { next = store.read(summary.id); if (next != null) break; }
            chat = next == null ? fresh() : busy != null && busy.id.equals(next.id) ? busy : Chat.of(next);
            remember();
        }
        changed();
    }

    private void remember() { context.getSharedPreferences(PREFS, 0).edit().putString("current", chat.id).apply(); }

    // ── Composer ──

    synchronized String draft() { return chat.draft; }
    synchronized List<ChatContext> context() { return ChatContext.read(chat.draftContext); }
    synchronized void attach(ChatContext source) {
        List<ChatContext> items=context();for(ChatContext item:items)if(item.kind.equals(source.kind)&&item.uid.equals(source.uid))return;
        if(items.size()>=3)throw new IllegalArgumentException("Attach up to three sources.");
        items.add(source);chat.draftContext=ChatContext.write(items);chat.draftRevision++;persist(chat);changed();
    }
    synchronized void removeContext(int index) { List<ChatContext> items=context();items.remove(index);chat.draftContext=ChatContext.write(items);chat.draftRevision++;persist(chat);changed(); }

    synchronized void draft(String text) {
        String value = text == null ? "" : text;
        if (value.length() > MAX_INPUT_CHARS) throw new IllegalArgumentException("Messages can contain up to 12,000 characters.");
        if (chat.draft.equals(value)) return;
        chat.draft = value;
        chat.draftRevision++;
        chat.updated = System.currentTimeMillis();
        persist(chat);
        changed();
    }

    synchronized void send(String text) {
        String value = text == null ? "" : text;
        if (busy == chat) { reject("Wait for this reply or tap stop first.", value); return; }
        if (busy != null) { reject("pip is still replying in another chat. Open it to stop that reply first.", value); return; }
        if (value.trim().isEmpty()) { reject("Write a message first.", value); return; }
        if (value.length() > MAX_INPUT_CHARS) { reject("Messages can contain up to 12,000 characters.", ""); return; }
        if (chat.turns.size() + 2 > MAX_TURNS || chat.characters() + value.length() + chat.draftContext.length() >= MAX_HISTORY_CHARS) {
            reject("This chat is full. Start a new chat in chats.", value);
            return;
        }
        ChatProvider.Config selected = ChatProvider.get(context);
        if (!validProvider(selected, value)) return;
        if (!matchesProvider(selected, value)) return;
        if (chat.provider == null) chat.provider = selected;
        chat.model = selected.model;
        if (chat.title.isEmpty()) chat.title = title(value);
        long now = System.currentTimeMillis();
        chat.turns.add(new Turn(UUID.randomUUID().toString(), "user", value, "complete", "", now, chat.draftContext));
        chat.turns.add(new Turn(UUID.randomUUID().toString(), "assistant", "", "pending", "", now));
        start(value, false, selected);
    }

    synchronized void retry() {
        if (busy != null) return;
        if (chat.turns.size() < 2) { reject("There is no reply to retry.", ""); return; }
        Turn reply = chat.turns.get(chat.turns.size() - 1);
        if (!("failed".equals(reply.state) || "stopped".equals(reply.state))) return;
        ChatProvider.Config selected = ChatProvider.get(context);
        if (!validProvider(selected, "")) return;
        if (!matchesProvider(selected, "")) return;
        Turn user = chat.turns.get(chat.turns.size() - 2);
        // Keep an earlier partial answer until the retried request actually produces replacement text.
        chat.turns.set(chat.turns.size() - 1, new Turn(reply.id, "assistant", reply.text, "pending", "", System.currentTimeMillis()));
        start(user.text, true, selected);
    }

    synchronized void stop() { if (busy == chat) stopRunning(); }
    synchronized void stopAll() { stopRunning(); }

    private void stopRunning() {
        Chat target = busy;
        if (target == null) return;
        generation++;
        cancel();
        busy = null;
        status = "";
        Turn reply = target.turns.get(target.turns.size() - 1);
        target.turns.set(target.turns.size() - 1, reply.text(reply.text, "stopped"));
        target.error = "";
        persist(target);
        changed();
    }

    /** Older name for starting over; the conversation itself is kept in the chat list. */
    synchronized void clear() { newChat(); }

    private void start(String original, boolean replacing, ChatProvider.Config selected) {
        final Chat target = chat;
        final long request = ++generation;
        final String replyId = target.turns.get(target.turns.size() - 1).id;
        if(!replacing)target.draftContext="[]";
        replaceOnDelta = replacing;
        if (target.draft.equals(original)) { target.draft = ""; target.draftRevision++; }
        final long composerRevision = target.draftRevision;
        busy = target;
        status = "requesting";
        startedAt = SystemClock.elapsedRealtime();
        target.error = "";
        target.usage = ClaudeChatClient.Usage.EMPTY;
        target.updated = System.currentTimeMillis();
        List<ClaudeChatClient.Message> messages = new ArrayList<>();
        // Only completed answers are history. Reasoning, lookups and pre-lookup remarks stay on the phone.
        for (int index = 0; index + 1 < target.turns.size() - 1; index += 2) {
            Turn user = target.turns.get(index), reply = target.turns.get(index + 1);
            if ("complete".equals(reply.state) && !reply.text.trim().isEmpty()) {
                messages.add(new ClaudeChatClient.Message("user", ChatContext.prompt(user)));
                messages.add(new ClaudeChatClient.Message("assistant", reply.text));
            }
        }
        messages.add(new ClaudeChatClient.Message("user", ChatContext.prompt(target.turns.get(target.turns.size()-2))));
        int oldReplyLength = replacing ? target.turns.get(target.turns.size() - 1).text.length() : 0;
        int replyLimit = Math.min(MAX_OUTPUT_CHARS, MAX_HISTORY_CHARS - target.characters() + oldReplyLength);
        ClaudeChatClient.Listener listener = new ClaudeChatClient.Listener() {
            public boolean text(String delta) { return append(request, replyId, delta); }
            public void reasoning(String delta) { trail(request, replyId, delta, false); }
            public void step(String label) { trail(request, replyId, label, true); }
            public void activity(String value) { toolActivity(request, replyId, value); }
            public void interim() { aside(request, replyId); }
            public void status(String value) { progress(request, replyId, value, null); }
            public void usage(ClaudeChatClient.Usage tokens) { progress(request, replyId, null, tokens); }
            public void done(String actualModel, ClaudeChatClient.Usage tokens) {
                finish(request, replyId, original, composerRevision, actualModel, "", tokens);
            }
            public void failed(String reason) { finish(request, replyId, original, composerRevision, "", reason, null); }
        };
        ClaudeChatClient.Request call = requests.create(context, selected, target.id, messages, replyLimit, listener);
        active = call;
        long revision = persist(target);
        lastStreamSave = SystemClock.elapsedRealtime();
        changed();
        activeTask = network.submit(() -> {
            try {
                if (!store.awaitSaved(target.id, revision)) {
                    if (!call.cancelled()) listener.failed("Could not save this chat on the phone. Free some space, then retry.");
                    return;
                }
                if (!call.cancelled()) call.run();
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
        });
    }

    private synchronized void progress(long request, String replyId, String value, ClaudeChatClient.Usage tokens) {
        if (!current(request, replyId)) return;
        if (value != null) status = value;
        if (tokens != null) busy.usage = tokens;
        changed();
    }

    private Turn reply() { return busy.turns.get(busy.turns.size() - 1); }

    private synchronized void toolActivity(long request, String replyId, String value) {
        if (!current(request, replyId)) return;
        busy.turns.set(busy.turns.size() - 1, reply().activity(value)); saveStream(); changed();
    }

    private synchronized boolean append(long request, String replyId, String delta) {
        if (!current(request, replyId)) return false;
        Turn reply = reply();
        String before = replaceOnDelta ? "" : reply.text;
        int total = busy.characters() - (replaceOnDelta ? reply.text.length() : 0);
        if (before.length() + delta.length() > MAX_OUTPUT_CHARS || total + delta.length() > MAX_HISTORY_CHARS) return false;
        busy.turns.set(busy.turns.size() - 1, reply.text(before + delta, "pending"));
        replaceOnDelta = false;
        if (!"writing".equals(status)) status = "writing";
        saveStream();
        changed();
        return true;
    }

    /** Reasoning text streams in; a lookup arrives as its own line. The trail is bounded; extra reasoning is dropped. */
    private synchronized void trail(long request, String replyId, String text, boolean lookup) {
        if (!current(request, replyId) || text.isEmpty()) return;
        Turn reply = reply();
        String value = reply.reasoning;
        if (lookup) value = value + (value.isEmpty() || value.endsWith("\n") ? "" : "\n") + STEP + text.trim() + "\n";
        else value = value + text;
        if (value.length() > MAX_REASONING_CHARS) return;
        busy.turns.set(busy.turns.size() - 1, reply.reasoning(value));
        saveStream();
        changed();
    }

    /** What the model wrote before looking something up is a remark, not the answer: it joins the trail. */
    private synchronized void aside(long request, String replyId) {
        if (!current(request, replyId)) return;
        Turn reply = reply();
        if (replaceOnDelta || reply.text.trim().isEmpty()) return;
        String value = reply.reasoning + (reply.reasoning.isEmpty() || reply.reasoning.endsWith("\n\n") ? "" : reply.reasoning.endsWith("\n") ? "\n" : "\n\n") + reply.text.trim() + "\n\n";
        busy.turns.set(busy.turns.size() - 1, new Turn(reply.id, reply.role, "", "pending",
                value.length() > MAX_REASONING_CHARS ? reply.reasoning : value, reply.created, reply.context, reply.activity));
        persist(busy);
        changed();
    }

    private void saveStream() {
        long now = SystemClock.elapsedRealtime();
        if (now - lastStreamSave >= 500) { persist(busy); lastStreamSave = now; }
    }

    private synchronized void finish(long request, String replyId, String original, long composerRevision,
            String actualModel, String reason, ClaudeChatClient.Usage tokens) {
        if (!current(request, replyId)) return;
        Chat target = busy;
        Turn reply = reply();
        boolean failed = !reason.isEmpty();
        target.turns.set(target.turns.size() - 1, reply.text(reply.text, failed ? "failed" : "complete"));
        busy = null;
        status = "";
        active = null;
        activeTask = null;
        target.error = reason;
        target.updated = System.currentTimeMillis();
        if (!actualModel.isEmpty()) target.model = actualModel;
        if (tokens != null) target.usage = tokens;
        if (failed && target.draft.isEmpty() && target.draftRevision == composerRevision) { target.draft = original; target.draftRevision++; }
        persist(target);
        changed();
    }

    private boolean current(long request, String replyId) {
        return busy != null && request == generation && !busy.turns.isEmpty() && replyId.equals(reply().id);
    }

    private void cancel() {
        if (active != null) active.cancel();
        if (activeTask != null) activeTask.cancel(true);
        active = null;
        activeTask = null;
    }

    /** A chat keeps its provider: its history was sent there, so it is never quietly continued somewhere else. */
    private boolean matchesProvider(ChatProvider.Config selected, String original) {
        if (acceptsProvider(selected)) return true;
        reject("This chat used " + chat.provider.name() + " · " + chat.provider.model + ". Start a new chat in chats to use the new settings.", original);
        return false;
    }

    private boolean validProvider(ChatProvider.Config selected, String original) {
        try { selected.validate(); return true; }
        catch (IllegalArgumentException invalid) { reject(invalid.getMessage(), original); return false; }
    }

    private void reject(String reason, String original) {
        chat.error = reason;
        if (chat.draft.isEmpty() && !original.isEmpty() && original.length() <= MAX_INPUT_CHARS) { chat.draft = original; chat.draftRevision++; }
        persist(chat);
        changed();
    }

    private long persist(Chat target) {
        target.updated = Math.max(System.currentTimeMillis(), target.updated + 1);
        long revision = ++writeRevision;
        store.save(new ChatStore.Record(target.id, target.title, target.draft, target.error, target.model, target.provider,
                target.usage, target.turns, target.created, target.updated, revision, false, false,target.draftContext));
        return revision;
    }
    void syncCloud() throws java.io.IOException {
        for (org.json.JSONObject local : store.cloudPending()) {
            org.json.JSONObject response;
            try { response=PocketCloud.api(context,"POST","/api/objects/chats",new org.json.JSONObject().put("value",local)); acceptCloud(response.getJSONObject("value")); }
            catch(org.json.JSONException invalid){throw new java.io.IOException("Pocket returned unreadable chat data.",invalid);}
        }
        android.content.SharedPreferences prefs=context.getSharedPreferences("pocket_chat_cloud",0);
        boolean more=true;
        while(more){
            org.json.JSONObject response=PocketCloud.api(context,"GET","/api/objects/chats?after="+prefs.getLong("cursor",0),null);
            try{org.json.JSONArray values=response.getJSONArray("items");for(int i=0;i<values.length();i++)acceptCloud(values.getJSONObject(i));
                if(!prefs.edit().putLong("cursor",response.getLong("cursor")).commit())throw new java.io.IOException("Could not save the chat sync cursor.");more=response.optBoolean("more");
            }catch(org.json.JSONException invalid){throw new java.io.IOException("Pocket returned unreadable chat data.",invalid);}
        }
    }
    private synchronized void acceptCloud(org.json.JSONObject value) throws java.io.IOException {
        org.json.JSONObject merged=store.acceptCloud(value);String id=merged.optString("uid");
        if(merged.optBoolean("deleted")){
            if(busy!=null&&busy.id.equals(id))stopRunning();deleted.add(id);
            if(chat.id.equals(id)){chat=fresh();remember();}
        }else if(chat.id.equals(id)&&busy!=chat){ChatStore.Record saved=store.read(id);if(saved!=null){chat=Chat.of(saved);remember();}}
        changed();
    }

    private synchronized void storageFailed(long revision) {
        if (revision != writeRevision) return;
        chat.error = "Could not save this chat on the phone. Free some space, then retry.";
        changed();
    }

    /** Coalesce stream updates; observers always run on the main thread. */
    private void changed() {
        if (notificationQueued) return;
        notificationQueued = true;
        main.postDelayed(() -> {
            List<Observer> ready;
            synchronized (ClaudeChatRepository.this) { notificationQueued = false; ready = new ArrayList<>(observers); }
            for (Observer observer : ready) {
                synchronized (ClaudeChatRepository.this) { if (!observers.contains(observer)) continue; }
                observer.changed();
            }
        }, 40);
    }
}
