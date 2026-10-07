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
}
