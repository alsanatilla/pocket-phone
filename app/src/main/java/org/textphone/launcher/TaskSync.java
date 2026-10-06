package org.textphone.launcher;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Portable tasks in Drive. Alarm ids, notification handles and editor drafts remain local. */
final class TaskSync {
    private static final long KEEP_DELETED = 30L * 24 * 3_600_000L;
    static PlannerStore.Entry byUid(PlannerStore store, String uid) { return uid == null || uid.isEmpty() ? null : tasksByUid(store).get(uid); }

    static String uid(PlannerStore store, long id) {
        synchronized (PlannerStore.WRITE_LOCK) {
            SharedPreferences p = store.preferences(); String uid = p.getString("task_uid_" + id, null);
            if (uid == null) { uid = UUID.randomUUID().toString(); p.edit().putString("task_uid_" + id, uid).apply(); }
            return uid;
        }
    }

    static JSONObject merge(Context c, JSONObject remote) throws JSONException {
        // Same lock order as task completion: a downloaded completion also cancels local reminders.
        synchronized (AgendaStore.class) { synchronized (ClockStore.class) { synchronized (PlannerStore.WRITE_LOCK) {
            PlannerStore store = new PlannerStore(c.getSharedPreferences("pocket_planner", 0));
            SharedPreferences p = store.preferences();
            if (!p.contains("task_next_updated") && p.getLong("next_task", 0) != 0)
                p.edit().putLong("task_next_updated", System.currentTimeMillis()).apply();
            JSONArray merged = SyncMerge.byId(local(store), remote == null ? null : remote.optJSONArray("tasks"), "uid", "updated");
            // Reject a malformed download before changing any local task.
            for (int i = 0; i < merged.length(); i++) validate(merged.getJSONObject(i));
            Map<String, PlannerStore.Entry> byUid = tasksByUid(store);
            for (int i = 0; i < merged.length(); i++) {
                JSONObject task = merged.getJSONObject(i); String uid = task.getString("uid"); long updated = task.getLong("updated");
                PlannerStore.Entry mine = byUid.get(uid);
                if (task.optBoolean("deleted")) {
                    if (mine != null) TaskReminders.delete(c, mine.id);
                    JSONObject markers = new JSONObject(p.getString("task_tombstones", "{}"));
                    p.edit().putString("task_tombstones", markers.put(uid, updated).toString()).apply();
                } else if (mine == null || updated > store.taskUpdated(mine)) {
                    if (mine != null && task.optBoolean("done")) TaskReminders.cancel(c, mine.id);
                    long id = store.applySyncedTask(mine, uid, task.getString("text"), task.optBoolean("done"),
                            task.optLong("created", updated), task.optString("due"), task.optBoolean("important"),
                            steps(task.optJSONArray("steps")), source(store, task.optJSONObject("source")), updated);
                    TaskReminders.rename(c, id, task.getString("text"));
                    JSONObject markers = new JSONObject(p.getString("task_tombstones", "{}")); markers.remove(uid);
                    p.edit().putString("task_tombstones", markers.toString()).apply();
                }
            }
            JSONObject next = remote == null ? null : remote.optJSONObject("next");
            if (next != null && next.optLong("updated") > p.getLong("task_next_updated", 0)) {
                PlannerStore.Entry chosen = tasksByUid(store).get(next.optString("uid"));
                p.edit().putLong("next_task", chosen == null ? 0 : chosen.id).putLong("task_next_updated", next.optLong("updated"))
                        .putLong("tasks_rev", store.tasksRevision() + 1).apply();
            }
            PlannerStore.Entry chosen = store.find(p.getLong("next_task", 0));
            return new JSONObject().put("v", 1).put("tasks", local(store)).put("next", new JSONObject()
                    .put("uid", chosen == null || !"task".equals(chosen.kind) ? "" : uid(store, chosen.id))
                    .put("updated", p.getLong("task_next_updated", 0)));
        } } }
    }

    private static JSONArray local(PlannerStore store) throws JSONException {
        SharedPreferences p = store.preferences(); JSONArray out = new JSONArray();
        for (PlannerStore.Entry e : store.entries()) if ("task".equals(e.kind)) {
            JSONArray steps = new JSONArray(); for (PlannerStore.Step s : e.steps) steps.put(new JSONObject().put("text", s.text).put("done", s.done));
            JSONObject task = new JSONObject().put("uid", uid(store, e.id)).put("text", e.text).put("done", e.done)
                    .put("due", e.due).put("important", e.important).put("steps", steps).put("created", e.created)
                    .put("updated", store.taskUpdated(e)).put("deleted", false);
            if (e.source != null) {
                JSONObject source = new JSONObject().put("kind", e.source.kind).put("name", e.source.name).put("text", e.source.text);
                PlannerStore.Entry note = store.find(e.source.note);
                if ("note".equals(e.source.kind) && note != null && "note".equals(note.kind)) source.put("note_uid", NoteSync.uid(store, note.id));
                source.put("token",e.source.token); task.put("source", source);
            }
            out.put(task);
        }
        JSONObject markers = new JSONObject(p.getString("task_tombstones", "{}")), kept = new JSONObject(); long now = System.currentTimeMillis();
        for (Iterator<String> it = markers.keys(); it.hasNext();) {
            String uid = it.next(); long updated = markers.getLong(uid);
            kept.put(uid, updated); out.put(new JSONObject().put("uid", uid).put("updated", updated).put("deleted", true));
        }
        p.edit().putString("task_tombstones", kept.toString()).apply(); return out;
    }

    private static Map<String, PlannerStore.Entry> tasksByUid(PlannerStore store) {
        Map<String, PlannerStore.Entry> result = new HashMap<>();
        for (PlannerStore.Entry e : store.entries()) if ("task".equals(e.kind)) result.put(uid(store, e.id), e);
        return result;
    }

    private static void validate(JSONObject task) throws JSONException {
        String uid = task.getString("uid"); if (uid.isEmpty() || uid.length() > 80 || task.getLong("updated") <= 0) throw new JSONException("Invalid task id or timestamp.");
        if (task.optBoolean("deleted")) return;
        String title = task.getString("text"); if (title.trim().isEmpty() || title.length() > PlannerStore.TASK_LIMIT) throw new JSONException("Invalid task title.");
        try { PlannerDates.validate(task.optString("due")); } catch (IllegalArgumentException invalid) { throw new JSONException(invalid.getMessage()); }
        steps(task.optJSONArray("steps"));
    }
    private static List<PlannerStore.Step> steps(JSONArray array) throws JSONException {
        List<PlannerStore.Step> result = new ArrayList<>(); if (array == null) return result;
        if (array.length() > 32) throw new JSONException("Too many task steps.");
        for (int i = 0; i < array.length(); i++) {
            JSONObject step = array.getJSONObject(i); String text = step.getString("text");
            if (text.trim().isEmpty() || text.length() > 160 || text.contains("\n")) throw new JSONException("Invalid task step.");
            result.add(new PlannerStore.Step(text, step.optBoolean("done")));
        }
        return result;
    }
    private static TaskSource source(PlannerStore store, JSONObject value) throws JSONException {
        if (value == null) return null;
        PlannerStore.Entry note = NoteSync.byUid(store, value.optString("note_uid"));
        return TaskSource.read(new JSONObject().put("kind", value.optString("kind")).put("name", value.optString("name"))
                .put("text", value.optString("text")).put("token",value.optString("token")).put("note", note == null ? 0 : note.id));
    }
    private TaskSync() { }
}
