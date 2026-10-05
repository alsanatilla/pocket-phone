package org.textphone.launcher;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Notes in the cloud document {"v":1,"notes":[{"uid","text","pinned","created","updated","deleted"}]}.
 * Local ids are small counters shared with tasks, so synced notes are matched by a random uid instead.
 * Tasks have their own portable document in TaskSync.
 */
final class NoteSync {
    private static final long KEEP_DELETED = 30L * 24 * 3_600_000L;
    private static final Object LOCK = new Object();

    static JSONObject merge(Context c, JSONObject remote) throws JSONException {
        synchronized (LOCK) { synchronized (PlannerStore.WRITE_LOCK) {
            PlannerStore store = new PlannerStore(c.getSharedPreferences("pocket_planner", 0));
            SharedPreferences p = store.preferences();
            JSONArray merged = SyncMerge.byId(local(store), remote == null ? null : remote.optJSONArray("notes"), "uid", "updated");
            Map<String, PlannerStore.Entry> byUid = notesByUid(store);
            for (int i = 0; i < merged.length(); i++) {
                JSONObject note = merged.getJSONObject(i); String uid = note.optString("uid"); if (uid.isEmpty()) continue;
                PlannerStore.Entry mine = byUid.get(uid); long updated = note.optLong("updated");
                if (note.optBoolean("deleted")) { if (mine != null) store.delete(mine.id); tombstone(p, uid, updated); continue; }
                String text = note.optString("text", "");
                if (text.trim().isEmpty() || text.length() > PlannerStore.NOTE_LIMIT) continue;
                try {
                    if (mine == null) {
                        long id = store.save(0, "note", text);
                        p.edit().putString("note_uid_" + id, uid).apply();
                        apply(store, p, id, note, updated);
                    } else if (updated > store.noteUpdated(mine)) {
                        if (!text.equals(mine.text)) store.save(mine.id, "note", text);
                        apply(store, p, mine.id, note, updated);
                    }
                } catch (IllegalArgumentException full) { /* Organizer full or note removed meanwhile: the next sync tries again. */ }
            }
            return new JSONObject().put("v", 1).put("notes", local(store));
        } }
    }
    private static void apply(PlannerStore store, SharedPreferences p, long id, JSONObject note, long updated) {
        if (store.notePinned(id) != note.optBoolean("pinned")) store.pinNote(id, note.optBoolean("pinned"));
        p.edit().putLong("note_updated_" + id, updated).apply();
    }

    /** The phone's notes as the cloud sees them, plus recent deletion markers. */
    private static JSONArray local(PlannerStore store) throws JSONException {
        SharedPreferences p = store.preferences(); JSONArray out = new JSONArray();
        for (PlannerStore.Entry e : store.entries()) {
            if (!"note".equals(e.kind)) continue;
            String uid = p.getString("note_uid_" + e.id, null);
            if (uid == null) { uid = UUID.randomUUID().toString(); p.edit().putString("note_uid_" + e.id, uid).apply(); }
            out.put(new JSONObject().put("uid", uid).put("text", e.text).put("pinned", store.notePinned(e.id))
                    .put("created", e.created).put("updated", store.noteUpdated(e)).put("deleted", false));
        }
        JSONObject tombstones = new JSONObject(p.getString("note_tombstones", "{}")), kept = new JSONObject(); long now = System.currentTimeMillis();
        for (Iterator<String> it = tombstones.keys(); it.hasNext(); ) {
            String uid = it.next(); long when = tombstones.optLong(uid);
            if (now - when > KEEP_DELETED) continue;
            kept.put(uid, when); out.put(new JSONObject().put("uid", uid).put("text", "").put("deleted", true).put("updated", when));
        }
        p.edit().putString("note_tombstones", kept.toString()).apply();
        return out;
    }
    /** The note's sync uid, created on first use so thoughts can point at it before the first sync. */
    static String uid(PlannerStore store, long id) {
        SharedPreferences p = store.preferences(); String uid = p.getString("note_uid_" + id, null);
        if (uid == null) { uid = UUID.randomUUID().toString(); p.edit().putString("note_uid_" + id, uid).apply(); }
        return uid;
    }
    static String existingUid(PlannerStore store, long id) { return store.preferences().getString("note_uid_" + id, null); }
    static PlannerStore.Entry byUid(PlannerStore store, String uid) { return uid == null || uid.isEmpty() ? null : notesByUid(store).get(uid); }
    private static Map<String, PlannerStore.Entry> notesByUid(PlannerStore store) {
        Map<String, PlannerStore.Entry> map = new HashMap<>();
        for (PlannerStore.Entry e : store.entries()) { String uid = store.preferences().getString("note_uid_" + e.id, null); if ("note".equals(e.kind) && uid != null) map.put(uid, e); }
        return map;
    }
    private static void tombstone(SharedPreferences p, String uid, long when) {
        try { p.edit().putString("note_tombstones", new JSONObject(p.getString("note_tombstones", "{}")).put(uid, Math.max(when, 1)).toString()).apply(); }
        catch (JSONException damaged) { p.edit().putString("note_tombstones", "{}").apply(); }
    }
    private NoteSync() { }
}
