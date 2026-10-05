package org.textphone.launcher;

import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;
import java.util.Collections;

/** Local organizer; optional cloud sync uses separate portable ids and edit timestamps. */
final class PlannerStore {
    static final int TASK_LIMIT = 500;
    static final int NOTE_LIMIT = 8000;
    static final int STEPS_TEXT_LIMIT = 6000;
    private static final int ENTRY_LIMIT = 250;
    private final SharedPreferences prefs;
    static final Object WRITE_LOCK = new Object();

    static final class Entry {
        final long id, created;
        final String kind, text;
        final boolean done;
        final String due;
        final boolean important;
        final List<Step> steps;
        final TaskSource source;
        Entry(long id, String kind, String text, boolean done, long created) {
            this(id, kind, text, done, created, "", false, Collections.emptyList());
        }
        Entry(long id, String kind, String text, boolean done, long created,
              String due, boolean important, List<Step> steps) {
            this(id,kind,text,done,created,due,important,steps,null);
        }
        Entry(long id,String kind,String text,boolean done,long created,String due,boolean important,List<Step> steps,TaskSource source){
            this.id = id; this.kind = kind; this.text = text; this.done = done; this.created = created;
            this.due = due; this.important = important;
            this.steps = Collections.unmodifiableList(new ArrayList<>(steps));
            this.source=source;
        }
        int completedSteps() { int count = 0; for (Step step : steps) if (step.done) count++; return count; }
        Entry withDone(boolean value) { return new Entry(id, kind, text, value, created, due, important, steps,source); }
    }

    static final class Step {
        final String text;
        final boolean done;
        Step(String text, boolean done) { this.text = text; this.done = done; }
    }

    static final class TaskDraft {
        final String due, steps;
        final boolean important;
        TaskDraft(String due, boolean important, String steps) {
            this.due = due; this.important = important; this.steps = steps;
        }
    }

    PlannerStore(SharedPreferences prefs) { this.prefs = prefs; }

    List<Entry> entries() {
        List<Entry> result = new ArrayList<>();
        try {
            JSONArray array = new JSONArray(prefs.getString("entries", "[]"));
            for (int i = 0; i < array.length(); i++) {
                JSONObject object = array.getJSONObject(i);
                result.add(new Entry(object.getLong("id"), object.getString("kind"),
                        object.getString("text"), object.optBoolean("done"), object.getLong("created"),
                        object.optString("due", ""), object.optBoolean("important"),
                        readSteps(object.optJSONArray("steps")),TaskSource.read(object.optJSONObject("source"))));
            }
        } catch (JSONException error) {
            throw new IllegalStateException("Organizer data could not be read.", error);
        }
        return result;
    }

    private void write(List<Entry> values) {
        JSONArray array = new JSONArray();
        long nextId = prefs.getLong("next_id", 1);
        try {
            for (Entry entry : values) {
                JSONObject object = new JSONObject();
                object.put("id", entry.id); object.put("kind", entry.kind); object.put("text", entry.text);
                object.put("done", entry.done); object.put("created", entry.created);
                object.put("due", entry.due); object.put("important", entry.important);
                JSONArray steps = new JSONArray();
                for (Step step : entry.steps) steps.put(new JSONObject().put("text", step.text).put("done", step.done));
                object.put("steps", steps); array.put(object);
                if(entry.source!=null)object.put("source",entry.source.json());
                nextId = Math.max(nextId, entry.id + 1);
            }
        } catch (JSONException error) { throw new IllegalStateException(error); }
        if (!prefs.edit().putString("entries", array.toString()).putLong("next_id", nextId).commit())
            throw new IllegalStateException("Organizer data could not be saved.");
    }

    long save(long id, String kind, String text) {
        synchronized (WRITE_LOCK) {
        Entry old = id == 0 ? null : find(id);
        return saveEntry(id, kind, text, old == null ? "" : old.due,
                old != null && old.important, old == null ? Collections.emptyList() : old.steps);
        }
    }

    long saveTask(long id, String text, String due, boolean important, String steps) {
        PlannerDates.validate(due);
        return saveEntry(id, "task", text, due, important, parseSteps(steps));
    }

    private long saveEntry(long id, String kind, String text, String due, boolean important, List<Step> steps) {
        return saveEntry(id,kind,text,due,important,steps,null);
    }
    long captureTask(String text,TaskSource source){synchronized(WRITE_LOCK){if(source!=null&&!source.token.isEmpty())for(Entry e:entries())if(e.source!=null&&source.token.equals(e.source.token))return e.id;
        return saveEntry(0,"task",text,"",false,Collections.emptyList(),source);}}
    private long saveEntry(long id, String kind, String text, String due, boolean important, List<Step> steps,TaskSource source) {
        synchronized (WRITE_LOCK) {
        if (!"task".equals(kind) && !"note".equals(kind)) throw new IllegalArgumentException("Unknown entry type.");
        if ("task".equals(kind)) text = text.trim();
        if (text.trim().isEmpty()) throw new IllegalArgumentException("Enter some text.");
        int limit = "task".equals(kind) ? TASK_LIMIT : NOTE_LIMIT;
        if (text.length() > limit) throw new IllegalArgumentException("Text is too long.");
        List<Entry> values = entries();
        if (id != 0) {
            for (int i = 0; i < values.size(); i++) {
                Entry old = values.get(i);
                if (old.id == id) {
                    if (!old.kind.equals(kind)) throw new IllegalArgumentException("Entry type cannot change.");
                    values.set(i, new Entry(id, old.kind, text, old.done, old.created, due, important, steps,source==null?old.source:source));
                    write(values); if ("note".equals(kind)) touchNote(id); else touchTask(id); return id;
                }
            }
            throw new IllegalArgumentException("This entry was removed.");
        }
        if (values.size() >= ENTRY_LIMIT) throw new IllegalArgumentException("Organizer is full. Remove an old entry.");
        long next = prefs.getLong("next_id", 1);
        for (Entry entry : values) next = Math.max(next, entry.id + 1);
        Entry added = new Entry(next, kind, text, false, System.currentTimeMillis(), due, important, steps,source);
        if ("note".equals(kind)) values.add(0, added); else values.add(added);
        write(values); if ("note".equals(kind)) touchNote(next); else touchTask(next); return next;
        }
    }

    void toggle(long id) {
        synchronized (WRITE_LOCK) {
        List<Entry> values = entries();
        for (int i = 0; i < values.size(); i++) {
            Entry entry = values.get(i);
            if (entry.id == id && "task".equals(entry.kind)) {
                values.set(i, entry.withDone(!entry.done)); write(values); touchTask(id); return;
            }
        }
        throw new IllegalArgumentException("This task was removed.");
        }
    }

    void makeNext(long id) {
        synchronized (WRITE_LOCK) {
        List<Entry> values = entries();
        Entry selected = id == 0 ? null : find(id);
        if (id != 0 && (selected == null || !"task".equals(selected.kind) || selected.done))
            throw new IllegalArgumentException("This task is completed or removed.");
        for (int i = 0; i < values.size(); i++) {
            Entry entry = values.get(i);
            if (entry.id == id && "task".equals(entry.kind) && !entry.done) {
                values.remove(i); values.add(0, entry); break;
            }
        }
        write(values);
        if (!prefs.edit().putLong("next_task", id).putLong("task_next_updated", Math.max(System.currentTimeMillis(), prefs.getLong("task_next_updated", 0) + 1))
                .putLong("tasks_rev", tasksRevision() + 1).commit()) throw new IllegalStateException("Task order could not be saved.");
        }
    }

    void delete(long id) {
        synchronized (WRITE_LOCK) {
        List<Entry> values = entries();
        Entry removed = find(id);
        String uid = prefs.getString("note_uid_" + id, null);
        for (int i = values.size() - 1; i >= 0; i--) if (values.get(i).id == id) values.remove(i);
        write(values);
        SharedPreferences.Editor edit = prefs.edit().remove("note_pin_"+id).remove("note_updated_" + id).remove("note_uid_" + id);
        // A synced note leaves a deletion marker so the cloud copy cannot bring it back.
        if (uid != null) {
            try { edit.putString("note_tombstones", new JSONObject(prefs.getString("note_tombstones", "{}")).put(uid, System.currentTimeMillis()).toString()); }
            catch (JSONException damaged) { edit.putString("note_tombstones", "{}"); }
            edit.putLong("notes_rev", prefs.getLong("notes_rev", 0) + 1);
        }
        if (removed != null && "task".equals(removed.kind)) {
            String taskUid = TaskSync.uid(this, id);
            long deleted = Math.max(System.currentTimeMillis(), taskUpdated(removed) + 1);
            try { edit.putString("task_tombstones", new JSONObject(prefs.getString("task_tombstones", "{}")).put(taskUid, deleted).toString()); }
            catch (JSONException damaged) { throw new IllegalStateException("Task deletion markers could not be saved.", damaged); }
            edit.remove("task_uid_" + id).remove("task_updated_" + id).putLong("tasks_rev", tasksRevision() + 1);
        }
        edit.apply();
        }
    }

    /** Sync metadata: when a note last changed and a counter the dashboard checks before asking for a sync. */
    private void touchNote(long id) {
        prefs.edit().putLong("note_updated_" + id, System.currentTimeMillis()).putLong("notes_rev", prefs.getLong("notes_rev", 0) + 1).apply();
    }
    long noteUpdated(Entry note) { return prefs.getLong("note_updated_" + note.id, note.created); }
    long notesRevision() { return prefs.getLong("notes_rev", 0); }
    private void touchTask(long id) {
        TaskSync.uid(this, id);
        prefs.edit().putLong("task_updated_" + id, Math.max(System.currentTimeMillis(), prefs.getLong("task_updated_" + id, 0) + 1))
                .putLong("tasks_rev", tasksRevision() + 1).apply();
    }
    long taskUpdated(Entry task) { return prefs.getLong("task_updated_" + task.id, task.created); }
    long tasksRevision() { return prefs.getLong("tasks_rev", 0); }

    /** Called under WRITE_LOCK by TaskSync, retaining local source links and draft keys. */
    long applySyncedTask(Entry old, String uid, String text, boolean done, long created, String due,
                         boolean important, List<Step> steps, TaskSource source, long updated) {
        synchronized (WRITE_LOCK) {
            List<Entry> values = entries();
            long id = old == null ? prefs.getLong("next_id", 1) : old.id;
            if (old == null) {
                if (values.size() >= ENTRY_LIMIT) throw new IllegalStateException("Organizer is full. Remove an old entry, then sync again.");
                for (Entry value : values) id = Math.max(id, value.id + 1);
            }
            Entry task = new Entry(id, "task", text, done, old == null ? created : old.created, due, important, steps,
                    old != null && old.source != null ? old.source : source);
            if (old == null) values.add(task);
            else for (int i = 0; i < values.size(); i++) if (values.get(i).id == id) values.set(i, task);
            write(values);
            prefs.edit().putString("task_uid_" + id, uid).putLong("task_updated_" + id, updated)
                    .putLong("tasks_rev", tasksRevision() + 1).apply();
            return id;
        }
    }
    SharedPreferences preferences() { return prefs; }

    boolean notePinned(long id){return prefs.getBoolean("note_pin_"+id,false);}
    void pinNote(long id,boolean value){synchronized(WRITE_LOCK){Entry note=find(id);if(note==null||!"note".equals(note.kind))throw new IllegalArgumentException("This note was removed.");if(!prefs.edit().putBoolean("note_pin_"+id,value).commit())throw new IllegalStateException("Could not pin the note.");touchNote(id);}}

    Entry nextTask() {
        return nextTask(entries());
    }

    Entry nextTask(List<Entry> values) {
        Entry best = null;
        long pinned = prefs.getLong("next_task", 0);
        for (Entry entry : values) if ("task".equals(entry.kind) && !entry.done) {
            if (entry.id == pinned) return entry;
            if (best == null || compareTasks(entry, best) < 0) best = entry;
        }
        return best;
    }

    static int compareTasks(Entry a, Entry b) {
        String left = a.due.isEmpty() ? "9999-99-99" : a.due;
        String right = b.due.isEmpty() ? "9999-99-99" : b.due;
        int date = left.compareTo(right);
        return date != 0 ? date : Boolean.compare(b.important, a.important);
    }

    Entry find(long id) { for (Entry entry : entries()) if (entry.id == id) return entry; return null; }

    void setDue(long id, String due) {
        synchronized (WRITE_LOCK) {
            PlannerDates.validate(due);Entry task = requireTask(id); saveEntry(id, "task", task.text, due, task.important, task.steps);
        }
    }
    void toggleImportant(long id) {
        synchronized (WRITE_LOCK) {
            Entry task = requireTask(id); saveEntry(id, "task", task.text, task.due, !task.important, task.steps);
        }
    }
    void addStep(long id, String text) {
        synchronized (WRITE_LOCK) {
            Entry task = requireTask(id);
            String value = text.trim();
            if (value.isEmpty() || value.contains("\n") || value.length() > 160) throw new IllegalArgumentException("Enter one step, up to 160 characters.");
            if (task.steps.size() >= 32) throw new IllegalArgumentException("Use up to 32 steps.");
            List<Step> steps = new ArrayList<>(task.steps); steps.add(new Step(value, false));
            saveEntry(id, "task", task.text, task.due, task.important, steps);
        }
    }
    private Entry requireTask(long id) {
        Entry task = find(id); if (task == null || !"task".equals(task.kind)) throw new IllegalArgumentException("This task was removed."); return task;
    }

    void toggleStep(long id, int index) {
        synchronized (WRITE_LOCK) {
        List<Entry> values = entries();
        for (int i = 0; i < values.size(); i++) {
            Entry old = values.get(i);
            if (old.id != id || !"task".equals(old.kind)) continue;
            if (index < 0 || index >= old.steps.size()) throw new IllegalArgumentException("Step was removed.");
            List<Step> steps = new ArrayList<>(old.steps);
            Step step = steps.get(index); steps.set(index, new Step(step.text, !step.done));
            values.set(i, new Entry(old.id, old.kind, old.text, old.done, old.created, old.due, old.important, steps,old.source));
            write(values); touchTask(id); return;
        }
        throw new IllegalArgumentException("Task was removed.");
        }
    }

    private static List<Step> readSteps(JSONArray array) throws JSONException {
        List<Step> steps = new ArrayList<>();
        if (array != null) for (int i = 0; i < array.length(); i++) {
            JSONObject item = array.getJSONObject(i); steps.add(new Step(item.getString("text"), item.optBoolean("done")));
        }
        return steps;
    }

    static List<Step> parseSteps(String value) {
        if (value.length() > STEPS_TEXT_LIMIT) throw new IllegalArgumentException("Steps are too long.");
        List<Step> result = new ArrayList<>();
        for (String line : value.split("\n")) {
            String text = line.trim(); if (text.isEmpty()) continue;
            boolean done = text.matches("^[-*]?\\s*\\[[xX]\\].*");
            text = text.replaceFirst("^[-*]?\\s*\\[[ xX]\\]\\s*", "").replaceFirst("^[-*]\\s+", "").trim();
            if (text.isEmpty()) continue;
            if (text.length() > 160 || result.size() >= 32) throw new IllegalArgumentException("Use up to 32 steps, 160 characters each.");
            result.add(new Step(text, done));
        }
        return result;
    }

    static String stepsText(List<Step> steps) {
        StringBuilder value = new StringBuilder();
        for (Step step : steps) { if (value.length() > 0) value.append('\n'); value.append(step.done ? "- [x] " : "- [ ] ").append(step.text); }
        return value.toString();
    }

    int openTasks() {
        int count = 0;
        for (Entry entry : entries()) if ("task".equals(entry.kind) && !entry.done) count++;
        return count;
    }

    String exportText() {
        StringBuilder result = new StringBuilder();
        for (Entry entry : entries()) {
            if ("task".equals(entry.kind)) result.append(entry.done ? "- [x] " : "- [ ] ");
            result.append(entry.text).append('\n');
            if ("task".equals(entry.kind)) {
                if (entry.important) result.append("  Important\n");
                if (!entry.due.isEmpty()) result.append("  Due: ").append(entry.due).append('\n');
                for (Step step : entry.steps) result.append(step.done ? "  - [x] " : "  - [ ] ").append(step.text).append('\n');
                if(entry.source!=null){result.append("  Source: ").append(entry.source.name).append('\n');for(String line:entry.source.text.split("\n",-1))result.append("  > ").append(line).append('\n');}
            }
            result.append('\n');
        }
        return result.toString();
    }

    String draft(String kind, long id) { return prefs.getString("draft_" + kind + "_" + id, ""); }
    boolean hasDraft(String kind, long id) { return prefs.contains("draft_" + kind + "_" + id); }
    void draft(String kind, long id, String text) { prefs.edit().putString("draft_" + kind + "_" + id, text).apply(); }
    void draft(long id, String text, String due, boolean important, String steps) {
        try { prefs.edit().putString("draft_task_" + id, text).putString("draft_meta_" + id,
                new JSONObject().put("due", due).put("important", important).put("steps", steps).toString()).apply(); }
        catch (JSONException error) { throw new IllegalStateException("Task draft could not be saved.", error); }
    }
    void clearDraft(String kind, long id) {
        SharedPreferences.Editor edit = prefs.edit().remove("draft_" + kind + "_" + id);
        if ("task".equals(kind)) edit.remove("draft_meta_" + id);
        edit.apply();
    }
    TaskDraft taskDraft(long id, Entry fallback) {
        String value = prefs.getString("draft_meta_" + id, "");
        if (!value.isEmpty()) try {
            JSONObject object = new JSONObject(value);
            return new TaskDraft(object.optString("due", ""), object.optBoolean("important"), object.optString("steps", ""));
        } catch (JSONException error) { throw new IllegalStateException("Task draft could not be read.", error); }
        return new TaskDraft(fallback == null ? "" : fallback.due, fallback != null && fallback.important,
                fallback == null ? "" : stepsText(fallback.steps));
    }
    void draftTask(long id, String due, boolean important, String steps) {
        try { prefs.edit().putString("draft_meta_" + id, new JSONObject().put("due", due).put("important", important).put("steps", steps).toString()).apply(); }
        catch (JSONException error) { throw new IllegalStateException(error); }
    }
}
