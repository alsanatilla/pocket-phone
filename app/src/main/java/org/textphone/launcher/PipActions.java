package org.textphone.launcher;

import android.content.Context;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Called only after the user reviews and saves a proposal. Stable portable ids make saves idempotent. */
final class PipActions {
    static String id(String chat, String userTurn, String event) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest((chat + "\n" + userTurn + "\n" + event).getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder("pip-"); for (int i = 0; i < 16; i++) hex.append(String.format(java.util.Locale.ROOT, "%02x", digest[i] & 255)); return hex.toString();
        } catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
    static synchronized String apply(Context c, String chat, String userTurn, String event, JSONObject proposal) throws JSONException {
        if (!(proposal.opt("kind") instanceof String) || !(proposal.opt("title") instanceof String) || !(proposal.opt("text") instanceof String)) throw new IllegalArgumentException("Check the title and text.");
        String uid = id(chat, userTurn, event), kind = proposal.optString("kind"), title = proposal.optString("title").trim(), text = proposal.optString("text");
        if (title.isEmpty() || title.length() > 200 || text.length() > 6000) throw new IllegalArgumentException("Check the title and text.");
        long now = System.currentTimeMillis();
        PlannerStore planner = new PlannerStore(c.getSharedPreferences("pocket_planner", 0));
        if ("appointment".equals(kind)) {
            for (AgendaStore.Event old : AgendaStore.list(c)) if (uid.equals(old.uid)) return "/calendar/" + uid;
            if (new JSONObject(c.getSharedPreferences("pocket_agenda", 0).getString("cloud_deleted", "{}")).has(uid)) throw new IllegalArgumentException("This proposal was already saved and removed.");
            AgendaStore.Event appointment = new AgendaStore.Event(); appointment.uid = uid; appointment.title = title;
            Object suppliedWhen = proposal.opt("when");
            if (!(suppliedWhen instanceof String) || !((String) suppliedWhen).matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d{1,3})?)?(?:Z|[+-]\\d{2}:\\d{2})")) throw new IllegalArgumentException("Choose a date and time.");
            try { appointment.when = java.time.OffsetDateTime.parse((String) suppliedWhen).toInstant().toEpochMilli(); } catch (RuntimeException invalid) { throw new IllegalArgumentException("Choose a date and time."); }
            Object duration = proposal.has("minutes") ? proposal.opt("minutes") : 60;
            if (!(duration instanceof Number) || ((Number) duration).doubleValue() != ((Number) duration).intValue()) throw new IllegalArgumentException("Use 15 to 480 minutes.");
            appointment.minutes = ((Number) duration).intValue();
            if (appointment.minutes < 15 || appointment.minutes > 480) throw new IllegalArgumentException("Use 15 to 480 minutes.");
            AgendaStore.save(c, appointment); return "/calendar/" + uid;
        }
        if (!("note".equals(kind) || "task".equals(kind))) throw new IllegalArgumentException("Choose a note, task or appointment.");
        PlannerStore.Entry old = "note".equals(kind) ? NoteSync.byUid(planner, uid) : TaskSync.byUid(planner, uid);
        if (old != null) return "/" + ("note".equals(kind) ? "notes" : "tasks") + "/" + uid;
        if (new JSONObject(planner.preferences().getString("note".equals(kind) ? "note_tombstones" : "task_tombstones", "{}")).has(uid)) throw new IllegalArgumentException("This proposal was already saved and removed.");
        JSONObject record = new JSONObject().put("uid", uid).put("created", now).put("updated", now).put("deleted", false);
        if ("note".equals(kind)) {
            record.put("text", "# " + title + (text.trim().isEmpty() ? "" : "\n\n" + text)).put("pinned", false);
            NoteSync.merge(c, new JSONObject().put("v", 1).put("notes", new JSONArray().put(record)));
        } else {
            if (proposal.has("due") && !(proposal.opt("due") instanceof String)) throw new IllegalArgumentException("Choose a valid due date.");
            String due = proposal.optString("due"); PlannerDates.validate(due);
            JSONArray supplied = proposal.optJSONArray("steps"), steps = new JSONArray();
            if (proposal.has("steps") && supplied == null) throw new IllegalArgumentException("Use up to 12 steps.");
            if (supplied != null) { if (supplied.length() > 12) throw new IllegalArgumentException("Use up to 12 steps.");
                for (int i = 0; i < supplied.length(); i++) { if (!(supplied.opt(i) instanceof String)) throw new IllegalArgumentException("Check the steps."); String step = supplied.getString(i).trim(); if (step.isEmpty() || step.length() > 160 || step.contains("\n") || step.contains("\r")) throw new IllegalArgumentException("Keep each step on one line within 160 characters."); steps.put(new JSONObject().put("text", step).put("done", false)); }
            }
            record.put("text", title).put("done", false).put("important", false).put("due", due).put("steps", steps)
                    .put("source", TaskSource.shared("Pip", text).token(uid).json());
            TaskSync.merge(c, new JSONObject().put("v", 1).put("tasks", new JSONArray().put(record)));
        }
        CloudSync.changed(c); return "/" + ("note".equals(kind) ? "notes" : "tasks") + "/" + uid;
    }

    /**
     * Applies a reviewed change to an existing record. Each change is idempotent, so applying it again on this or another device
     * leaves the same result: a task stays done, steps are added once, text is appended once, an appointment keeps its new time.
     */
    static synchronized String applyChange(Context c, JSONObject change) throws JSONException {
        if (!(change.opt("change") instanceof String) || !(change.opt("id") instanceof String)) throw new IllegalArgumentException("This change is incomplete.");
        String kind = change.getString("change"), id = change.getString("id");
        PlannerStore planner = new PlannerStore(c.getSharedPreferences("pocket_planner", 0));
        if ("complete_task".equals(kind) || "update_task".equals(kind)) {
            PlannerStore.Entry task = entry(c, planner, "task", id);
            if (task == null) throw new IllegalArgumentException("That task is no longer available.");
            String href = "/tasks/" + portable(c, task);
            if ("complete_task".equals(kind)) { if (!task.done) TaskReminders.toggle(c, task.id); CloudSync.changed(c); return href; }
            String title = change.has("title") ? change.optString("title").trim() : null, due = change.has("due") ? change.optString("due") : null;
            JSONArray supplied = change.optJSONArray("add_steps"); java.util.List<String> add = new java.util.ArrayList<>();
            if (supplied != null) for (int i = 0; i < supplied.length(); i++) {
                String step = supplied.optString(i).trim();
                if (step.isEmpty() || step.length() > 160 || step.contains("\n") || step.contains("\r")) throw new IllegalArgumentException("Check the title, due date and steps.");
                boolean known = false; for (PlannerStore.Step old : task.steps) if (old.text.equals(step)) known = true;
                if (!known && !add.contains(step)) add.add(step);
            }
            if (title != null && (title.isEmpty() || title.length() > 500)) throw new IllegalArgumentException("Check the title, due date and steps.");
            if (due != null) PlannerDates.validate(due);
            if (task.steps.size() + add.size() > 12) throw new IllegalArgumentException("A task keeps at most 12 steps.");
            if (title != null && !title.equals(task.text)) planner.save(task.id, "task", title);
            if (due != null && !due.equals(task.due)) planner.setDue(task.id, due);
            for (String step : add) planner.addStep(task.id, step);
            CloudSync.changed(c); return href;
        }
        if ("append_note".equals(kind)) {
            PlannerStore.Entry note = entry(c, planner, "note", id);
            if (note == null) throw new IllegalArgumentException("That saved note is no longer available.");
            String text = change.optString("text").trim(), current = note.text.replaceAll("\\s+$", "");
            if (text.isEmpty()) throw new IllegalArgumentException("Write the text to add.");
            if (!current.endsWith(text)) {
                if (current.length() + text.length() + 2 > 8000) throw new IllegalArgumentException("The note would exceed its length limit.");
                planner.save(note.id, "note", current + "\n\n" + text); CloudSync.changed(c);
            }
            return "/notes/" + portable(c, note);
        }
        if ("move_appointment".equals(kind)) {
            AgendaStore.Event event = null;
            for (AgendaStore.Event candidate : AgendaStore.list(c)) if (id.equals(candidate.uid) || id.equals(Long.toString(candidate.id))) event = candidate;
            if (event == null) throw new IllegalArgumentException("That appointment is no longer available.");
            String when = change.optString("when");
            if (!when.matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d{1,3})?)?(?:Z|[+-]\\d{2}:\\d{2})")) throw new IllegalArgumentException("Choose a date and time.");
            long instant; try { instant = java.time.OffsetDateTime.parse(when).toInstant().toEpochMilli(); } catch (RuntimeException invalid) { throw new IllegalArgumentException("Choose a date and time."); }
            int minutes = change.has("minutes") ? change.optInt("minutes", -1) : event.minutes;
            if (minutes < 15 || minutes > 480) throw new IllegalArgumentException("Use 15 to 480 minutes.");
            // The reminder keeps its distance to the appointment, as on the web.
            if (event.alarm != 0 && event.when != instant) { ClockStore.Entry alarm = ClockStore.find(c, event.alarm); if (alarm != null) { alarm.due += instant - event.when; AlarmScheduler.saveAndArm(c, alarm); } }
            event.when = instant; event.minutes = minutes; AgendaStore.save(c, event);
            return "/calendar/" + (event.uid.isEmpty() ? Long.toString(event.id) : event.uid);
        }
        throw new IllegalArgumentException("Choose a supported change.");
    }
    /** Records keep a local numeric id and, once synced, a portable uid; proposals may name either. */
    private static PlannerStore.Entry entry(Context c, PlannerStore planner, String kind, String id) {
        for (PlannerStore.Entry entry : planner.entries()) if (kind.equals(entry.kind) && (Long.toString(entry.id).equals(id) || portable(c, entry).equals(id))) return entry;
        return null;
    }
    private static String portable(Context c, PlannerStore.Entry entry) {
        String uid = c.getSharedPreferences("pocket_planner", 0).getString(entry.kind + "_uid_" + entry.id, "");
        return uid == null || uid.isEmpty() ? Long.toString(entry.id) : uid;
    }
}
