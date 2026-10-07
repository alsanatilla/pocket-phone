package org.textphone.launcher;

import android.content.Context;
import android.content.SharedPreferences;
import java.time.ZoneId;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Read-only adapters. A brief never creates ids, refreshes COROS, or changes its sources. */
final class DailyBriefLocal {
    static boolean enabled(Context c) {
        Object value = WorkspaceExtras.preference(c, "daily-brief");
        return !(value instanceof JSONObject) || ((JSONObject) value).optBoolean("enabled", true);
    }

    static void enabled(Context c, boolean enabled) {
        try { WorkspaceExtras.preference(c, "daily-brief", new JSONObject().put("enabled", enabled)); }
        catch (JSONException impossible) { throw new IllegalStateException("Could not save the brief setting.", impossible); }
    }

    /** Includes time so crossing midnight, a review time, or an appointment boundary refreshes a visible brief. */
    static String signature(Context c, long now) {
        StringBuilder out = new StringBuilder(ZoneId.systemDefault().getId()).append(':').append(now / 60_000).append(':').append(enabled(c));
        for (String[] source : new String[][]{{"pocket_planner", "entries"}, {"pocket_agenda", "events"}, {"pocket_parking", "items"}, {"pocket_gym", "workouts"}, {"pocket_movement", "snapshot"}})
            out.append(':').append(c.getSharedPreferences(source[0], 0).getString(source[1], "").hashCode());
        SharedPreferences planner = c.getSharedPreferences("pocket_planner", 0);
        return out.append(':').append(planner.getLong("next_task", 0)).append(':').append(planner.getLong("tasks_rev", 0)).append(':').append(planner.getLong("notes_rev", 0)).toString();
    }

    static DailyBrief.Result read(Context c, long now) {
        try { return DailyBrief.build(input(c, now), now, ZoneId.systemDefault()); }
        catch (JSONException error) { throw new IllegalStateException("Could not read the brief.", error); }
    }

    static JSONObject input(Context c, long now) throws JSONException {
        JSONObject input = new JSONObject(); List<String> unavailable = new ArrayList<>();
        PlannerStore planner = new PlannerStore(c.getSharedPreferences("pocket_planner", 0));
        JSONArray tasks = new JSONArray(), notes = new JSONArray(); String next = "";
        try {
            long chosen = planner.preferences().getLong("next_task", 0);
            for (PlannerStore.Entry e : planner.entries()) {
                if ("task".equals(e.kind)) {
                    String uid = taskUid(planner, e);
                    tasks.put(new JSONObject().put("uid", uid).put("text", e.text).put("done", e.done).put("due", e.due)
                            .put("important", e.important).put("created", e.created).put("updated", planner.taskUpdated(e)));
                    if (chosen == e.id && !e.done) next = uid;
                } else if ("note".equals(e.kind)) notes.put(new JSONObject().put("uid", noteUid(planner, e)).put("text", e.text).put("updated", planner.noteUpdated(e)));
            }
        } catch (RuntimeException error) { unavailable.add("tasks and notes"); tasks = new JSONArray(); notes = new JSONArray(); }
        input.put("tasks", tasks).put("notes", notes).put("nextTaskUid", next);
        JSONArray agenda = new JSONArray();
        try { for (AgendaStore.Event e : AgendaStore.list(c)) agenda.put(new JSONObject().put("uid", agendaUid(e)).put("title", e.title).put("when", e.when).put("minutes", e.minutes)); }
        catch (RuntimeException error) { unavailable.add("agenda"); }
        input.put("agenda", agenda);
        JSONArray thoughts = rows(c, "pocket_parking", "items", "thoughts", unavailable);
        input.put("thoughts", thoughts);
        JSONArray workouts = rows(c, "pocket_gym", "workouts", "gym", unavailable);
        input.put("workouts", workouts);
        try { JSONObject recovery = recovery(c, now); if (recovery != null) input.put("coros", recovery); }
        catch (RuntimeException | JSONException error) { unavailable.add("movement"); }
        input.put("unavailable", new JSONArray(unavailable));
        return input;
    }

    /** A malformed row cannot hide healthy records after it, or turn a damaged collection into a quiet empty day. */
    private static JSONArray rows(Context c, String name, String key, String source, List<String> unavailable) {
        JSONArray out = new JSONArray();
        try {
            JSONArray saved = new JSONArray(c.getSharedPreferences(name, 0).getString(key, "[]"));
            for (int i = 0; i < saved.length(); i++) {
                JSONObject value = saved.optJSONObject(i);
                if (value == null) { if (!unavailable.contains(source)) unavailable.add(source); } else out.put(value);
            }
        } catch (RuntimeException | JSONException error) { if (!unavailable.contains(source)) unavailable.add(source); }
        return out;
    }

    private static JSONObject recovery(Context c, long now) throws JSONException {
        SharedPreferences prefs = c.getSharedPreferences("pocket_movement", 0); String saved = prefs.getString("snapshot", null);
        if (saved == null) return null;
        JSONObject raw = new JSONObject(saved); CorosRepository.Snapshot cached = new CorosRepository.Snapshot(raw);
        ZoneId zone = ZoneId.systemDefault(); LocalDate today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate();
        TreeSet<LocalDate> dates = new TreeSet<>(java.util.Collections.reverseOrder());
        for (CorosData.Hrv night : cached.hrv) if (night.avg >= 0 && night.baseline > 0 && !night.date.isAfter(today)) dates.add(night.date);
        for (java.util.Map.Entry<LocalDate, Integer> rest : cached.resting.entrySet()) if (rest.getValue() > 0 && !rest.getKey().isAfter(today)) dates.add(rest.getKey());
        String profile = raw.optString("profile");
        // Search the dated assessments, never the network fetch time. Partial refreshes keep their original date.
        for (LocalDate day : dates) {
            Scores.Recovery recovery = Scores.compute(day, zone, cached.activities, cached.hrv, cached.resting, cached.daily, CorosData.age(profile), CorosData.female(profile)).recovery;
            if (recovery != null) return new JSONObject().put("recovery", recovery.score).put("at", 0).put("date", day.toString()).put("source", "Pocket");
        }
        return null;
    }

    private static String taskUid(PlannerStore planner, PlannerStore.Entry e) { return planner.preferences().getString("task_uid_" + e.id, "local-" + e.id); }
    private static String noteUid(PlannerStore planner, PlannerStore.Entry e) { return planner.preferences().getString("note_uid_" + e.id, "local-" + e.id); }
    private static String agendaUid(AgendaStore.Event e) { return e.uid.isEmpty() ? "local-" + e.id : e.uid; }
    static PlannerStore.Entry task(Context c, String uid) {
        PlannerStore planner = new PlannerStore(c.getSharedPreferences("pocket_planner", 0));
        for (PlannerStore.Entry e : planner.entries()) if ("task".equals(e.kind) && uid.equals(taskUid(planner, e))) return e;
        return null;
    }
    static PlannerStore.Entry note(Context c, String uid) {
        PlannerStore planner = new PlannerStore(c.getSharedPreferences("pocket_planner", 0));
        for (PlannerStore.Entry e : planner.entries()) if ("note".equals(e.kind) && uid.equals(noteUid(planner, e))) return e;
        return null;
    }
    static AgendaStore.Event appointment(Context c, String uid) { for (AgendaStore.Event e : AgendaStore.list(c)) if (uid.equals(agendaUid(e))) return e; return null; }
    private DailyBriefLocal() { }
}
