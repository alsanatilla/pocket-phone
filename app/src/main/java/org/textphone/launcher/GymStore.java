package org.textphone.launcher;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Strength workouts. Cloud document: {"v":1,"workouts":[{id, started, ended, updated, deleted, entries:[{exercise, sets:[{kg, reps, at}]}]}]}.
 * Per workout the later edit wins; deleted workouts stay as markers. Mirrors docs/js/store.js.
 */
final class GymStore {
    static final String[] STARTERS = {"Squat", "Bench press", "Deadlift", "Overhead press", "Barbell row", "Pull-up"};
    private static final long WEEK = 7L * 24 * 3_600_000L;
    private static final Object LOCK = new Object();
    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("pocket_gym", 0); }

    /** One logged set. */
    static final class Set {
        final double kg; final int reps; final long at;
        Set(double kg, int reps, long at) { this.kg = kg; this.reps = reps; this.at = at; }
        double oneRep() { return e1rm(kg, reps); }
    }
    /** An exercise's best estimated single on one day. */
    static final class Point {
        final long at; final double e1rm; final Set best;
        Point(long at, double e1rm, Set best) { this.at = at; this.e1rm = e1rm; this.best = best; }
    }
    /** Epley's estimate; a single is itself. */
    static double e1rm(double kg, int reps) { return reps <= 1 ? kg : kg * (1 + reps / 30.0); }
    static String kg(double value) { return Math.abs(value - Math.round(value)) < .05 ? String.valueOf(Math.round(value)) : String.format(Locale.ROOT, "%.1f", value); }

    static List<JSONObject> all(Context c) {
        List<JSONObject> out = new ArrayList<>();
        synchronized (LOCK) {
            try { JSONArray array = new JSONArray(prefs(c).getString("workouts", "[]")); for (int i = 0; i < array.length(); i++) out.add(array.getJSONObject(i)); }
            catch (JSONException ignored) { /* A damaged list reads as empty. */ }
        }
        return out;
    }
    /** Newest first, without deleted workouts. */
    static List<JSONObject> workouts(Context c) {
        List<JSONObject> out = new ArrayList<>(); for (JSONObject w : all(c)) if (!w.optBoolean("deleted")) out.add(w);
        Collections.sort(out, (a, b) -> Long.compare(b.optLong("started"), a.optLong("started"))); return out;
    }
    static JSONObject find(Context c, String id) { for (JSONObject w : all(c)) if (id != null && id.equals(w.optString("id")) && !w.optBoolean("deleted")) return w; return null; }
    /** The workout still in progress, if any. */
    static JSONObject active(Context c) { for (JSONObject w : workouts(c)) if (w.optLong("ended") == 0) return w; return null; }

    interface Change { void apply(JSONObject workout) throws JSONException; }
    static JSONObject update(Context c, String id, Change change) {
        synchronized (LOCK) {
            List<JSONObject> list = all(c);
            for (JSONObject w : list) if (id.equals(w.optString("id"))) {
                try { change.apply(w); w.put("updated", System.currentTimeMillis()); } catch (JSONException e) { throw new IllegalStateException(e); }
                write(c, list); CloudSync.changed(c); return w;
            }
            throw new IllegalStateException("This workout was removed.");
        }
    }
    static JSONObject start(Context c) {
        JSONObject open = active(c); if (open != null) return open;
        long now = System.currentTimeMillis();
        synchronized (LOCK) {
            List<JSONObject> list = all(c); JSONObject w;
            try { w = new JSONObject().put("id", UUID.randomUUID().toString()).put("started", now).put("ended", 0).put("updated", now).put("entries", new JSONArray()); }
            catch (JSONException e) { throw new IllegalStateException(e); }
            list.add(w); write(c, list); CloudSync.changed(c); return w;
        }
    }
    static JSONObject addSet(Context c, String id, String exercise, double kg, int reps) {
        if (exercise == null || exercise.trim().isEmpty()) throw new IllegalArgumentException("Choose an exercise.");
        if (reps < 1 || reps > 100 || kg < 0 || kg > 1000) throw new IllegalArgumentException("Use 1–100 reps and up to 1000 kg.");
        return update(c, id, w -> entry(w, exercise.trim()).getJSONArray("sets").put(new JSONObject().put("kg", Math.round(kg * 100) / 100.0).put("reps", reps).put("at", System.currentTimeMillis())));
    }
    /** Adds an exercise to the workout without a set yet, so it shows while the first set is prepared. */
    static void addExercise(Context c, String id, String exercise) { update(c, id, w -> entry(w, exercise.trim())); }
    static void undoSet(Context c, String id, String exercise) {
        update(c, id, w -> { JSONArray sets = entry(w, exercise).getJSONArray("sets"); if (sets.length() > 0) sets.remove(sets.length() - 1); });
    }
    static void finish(Context c, String id) {
        update(c, id, w -> { w.put("ended", System.currentTimeMillis());
            JSONArray entries = w.getJSONArray("entries"), kept = new JSONArray();
            for (int i = 0; i < entries.length(); i++) if (entries.getJSONObject(i).getJSONArray("sets").length() > 0) kept.put(entries.getJSONObject(i));
            w.put("entries", kept);
            if (kept.length() == 0) w.put("deleted", true); });
    }
    static void delete(Context c, String id) { update(c, id, w -> { w.put("deleted", true); w.put("entries", new JSONArray()); }); }
    private static JSONObject entry(JSONObject w, String exercise) throws JSONException {
        JSONArray entries = w.optJSONArray("entries"); if (entries == null) { entries = new JSONArray(); w.put("entries", entries); }
        for (int i = 0; i < entries.length(); i++) { JSONObject e = entries.getJSONObject(i); if (e.optString("exercise").equalsIgnoreCase(exercise)) return e; }
        JSONObject e = new JSONObject().put("exercise", exercise).put("sets", new JSONArray()); entries.put(e); return e;
    }
    private static void write(Context c, List<JSONObject> list) {
        JSONArray array = new JSONArray(); for (JSONObject w : list) array.put(w);
        if (!prefs(c).edit().putString("workouts", array.toString()).commit()) throw new IllegalStateException("Could not save the workout.");
    }

    static List<String> exerciseNames(JSONObject workout) {
        List<String> out = new ArrayList<>(); JSONArray entries = workout.optJSONArray("entries");
        if (entries != null) for (int i = 0; i < entries.length(); i++) out.add(entries.optJSONObject(i).optString("exercise"));
        return out;
    }
    static List<Set> sets(JSONObject workout, String exercise) {
        List<Set> out = new ArrayList<>(); JSONArray entries = workout.optJSONArray("entries"); if (entries == null) return out;
        for (int i = 0; i < entries.length(); i++) {
            JSONObject e = entries.optJSONObject(i); if (e == null || !e.optString("exercise").equalsIgnoreCase(exercise)) continue;
            JSONArray sets = e.optJSONArray("sets"); if (sets != null) for (int k = 0; k < sets.length(); k++) { JSONObject s = sets.optJSONObject(k); out.add(new Set(s.optDouble("kg"), s.optInt("reps"), s.optLong("at"))); }
        }
        return out;
    }
    static int setCount(JSONObject workout) { int n = 0; for (String name : exerciseNames(workout)) n += sets(workout, name).size(); return n; }
    static double volume(JSONObject workout) { double kg = 0; for (String name : exerciseNames(workout)) for (Set s : sets(workout, name)) kg += s.kg * s.reps; return kg; }
    /** Every exercise ever logged, most recently used first; the starters when nothing is logged yet. */
    static List<String> exercises(Context c) {
        Map<String, String> seen = new LinkedHashMap<>();
        for (JSONObject w : workouts(c)) for (String name : exerciseNames(w)) if (!sets(w, name).isEmpty()) seen.putIfAbsent(name.toLowerCase(Locale.ROOT), name);
        for (String name : STARTERS) seen.putIfAbsent(name.toLowerCase(Locale.ROOT), name);
        return new ArrayList<>(seen.values());
    }
    /** Exercises with logged sets, most recent first. */
    static List<String> trained(Context c) {
        Map<String, String> seen = new LinkedHashMap<>();
        for (JSONObject w : workouts(c)) for (String name : exerciseNames(w)) if (!sets(w, name).isEmpty()) seen.putIfAbsent(name.toLowerCase(Locale.ROOT), name);
        return new ArrayList<>(seen.values());
    }
    /** The sets from the latest earlier workout with this exercise. */
    static List<Set> previous(Context c, String exercise, String exceptId) {
        for (JSONObject w : workouts(c)) { if (w.optString("id").equals(exceptId)) continue; List<Set> sets = sets(w, exercise); if (!sets.isEmpty()) return sets; }
        return new ArrayList<>();
    }
    /** One point per workout: the best estimated single, oldest first. */
    static List<Point> history(Context c, String exercise) {
        List<Point> out = new ArrayList<>();
        for (JSONObject w : workouts(c)) {
            Set best = null; for (Set s : sets(w, exercise)) if (best == null || s.oneRep() > best.oneRep()) best = s;
            if (best != null) out.add(new Point(w.optLong("started"), best.oneRep(), best));
        }
        Collections.reverse(out); return out;
    }
    static Point record(List<Point> history) { Point best = null; for (Point p : history) if (best == null || p.e1rm > best.e1rm) best = p; return best; }
    /** Lifted kilograms per week, oldest first, ending with this week. */
    static double[] weeklyVolume(Context c, int weeks) {
        double[] out = new double[weeks]; long now = System.currentTimeMillis(), start = weekStart(now);
        for (JSONObject w : workouts(c)) { long at = w.optLong("started"); int ago = (int) Math.floor((start - weekStart(at)) / (double) WEEK + .5);
            if (ago >= 0 && ago < weeks) out[weeks - 1 - ago] += volume(w); }
        return out;
    }
    static int sessionsSince(Context c, long since) { int n = 0; for (JSONObject w : workouts(c)) if (w.optLong("started") >= since) n++; return n; }
    static long weekStart(long at) {
        java.util.Calendar day = java.util.Calendar.getInstance(); day.setTimeInMillis(at); day.setFirstDayOfWeek(java.util.Calendar.MONDAY);
        day.set(java.util.Calendar.HOUR_OF_DAY, 0); day.set(java.util.Calendar.MINUTE, 0); day.set(java.util.Calendar.SECOND, 0); day.set(java.util.Calendar.MILLISECOND, 0);
        while (day.get(java.util.Calendar.DAY_OF_WEEK) != java.util.Calendar.MONDAY) day.add(java.util.Calendar.DAY_OF_MONTH, -1);
        return day.getTimeInMillis();
    }

    static JSONObject merge(Context c, JSONObject remote) throws JSONException {
        synchronized (LOCK) {
            JSONArray local = new JSONArray(prefs(c).getString("workouts", "[]"));
            JSONArray merged = SyncMerge.byId(local, remote == null ? null : remote.optJSONArray("workouts"), "id", "updated");
            List<JSONObject> kept = new ArrayList<>(); for (int i = 0; i < merged.length(); i++) kept.add(merged.getJSONObject(i));
            write(c, kept);
            return new JSONObject().put("v", 1).put("workouts", merged);
        }
    }
    private GymStore() { }
}
