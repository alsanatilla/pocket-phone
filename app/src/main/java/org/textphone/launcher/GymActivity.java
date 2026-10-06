package org.textphone.launcher;

import android.app.AlertDialog;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import org.json.JSONObject;

/** Strength log: start a workout, log sets with steppers, and see each lift's estimated best over time. */
public final class GymActivity extends PocketActivity {
    private static final String HOME = "home", LOG = "log", LIFT = "lift", WORKOUT = "workout";
    private String page = HOME, exercise = "", workoutId = "";
    private double kg = 20; private int reps = 8;
    private TextView rest;
    private final Runnable tick = this::tickRest;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (state != null) { page = state.getString("page", HOME); exercise = state.getString("exercise", ""); workoutId = state.getString("workout", ""); kg = state.getDouble("kg", 20); reps = state.getInt("reps", 8); }
        render();
    }
    @Override protected void onSaveInstanceState(Bundle state) {
        state.putString("page", page); state.putString("exercise", exercise); state.putString("workout", workoutId); state.putDouble("kg", kg); state.putInt("reps", reps); super.onSaveInstanceState(state);
    }
    @Override protected String scene() { return PixelBackdrop.IRON; }
    @Override protected boolean hasInternalBack() { return !HOME.equals(page); }
    @Override protected String backPageKey(String rootPage) { return "gym"; }
    @Override public void onBackPressed() { if (hasInternalBack()) back(() -> { page = HOME; render(); }); else super.onBackPressed(); }
    @Override protected void onCloudSynced() { render(); }
    @Override protected void onResume() { super.onResume(); if (LOG.equals(page)) tickRest(); }
    @Override protected void onPause() { ui.removeCallbacks(tick); super.onPause(); }

    private void render() {
        ui.removeCallbacks(tick); rest = null;
        if (LOG.equals(page) && GymStore.active(this) != null) renderLog();
        else if (LIFT.equals(page)) renderLift();
        else if (WORKOUT.equals(page) && GymStore.find(this, workoutId) != null) renderWorkout();
        else { page = HOME; renderHome(); }
    }

    // ── Home: the workout in progress, then progress per lift, then history. ──
    private void renderHome() {
        screen("gym", "gym");
        JSONObject now = GymStore.active(this);
        if (now != null) {
            section("now · " + minutes(System.currentTimeMillis() - now.optLong("started")));
            List<String> names = GymStore.exerciseNames(now);
            for (int i = 0; i < names.size(); i++) { String name = names.get(i); List<GymStore.Set> sets = GymStore.sets(now, name);
                row(name, sets.isEmpty() ? "no sets yet" : line(sets), "gym_now_" + i, () -> openLog(name)); }
        }
        List<String> lifts = GymStore.trained(this);
        double[] weeks = GymStore.weeklyVolume(this, 8);
        if (!lifts.isEmpty()) {
            section("volume · 8 weeks");
            body.addView(new Chart(this, weeks, false), new LinearLayout.LayoutParams(-1, dp(72)));
            body.addView(label("this week " + tonnes(weeks[7]) + " · " + GymStore.sessionsSince(this, GymStore.weekStart(System.currentTimeMillis())) + " sessions", PocketDesign.SMALL, GRAY));
            section("progress");
            for (int i = 0; i < lifts.size(); i++) { String name = lifts.get(i); List<GymStore.Point> history = GymStore.history(this, name);
                row(name, "best " + GymStore.kg(GymStore.record(history).e1rm) + " kg" + trend(history), "gym_lift_" + i, () -> { exercise = name; page = LIFT; render(); }); }
        }
        List<JSONObject> past = new ArrayList<>(); for (JSONObject w : GymStore.workouts(this)) if (w.optLong("ended") > 0 && past.size() < 12) past.add(w);
        if (!past.isEmpty()) {
            section("history");
            for (JSONObject w : past) row(day(w.optLong("started")) + " · " + minutes(w.optLong("ended") - w.optLong("started")),
                    String.join(", ", GymStore.exerciseNames(w)) + " · " + GymStore.setCount(w) + " sets · " + tonnes(GymStore.volume(w)), "gym_workout_" + w.optString("id"),
                    () -> { workoutId = w.optString("id"); page = WORKOUT; render(); });
        }
        if (now == null && lifts.isEmpty() && past.isEmpty()) body.addView(label("No workouts yet.", PocketDesign.BODY, GRAY));
        if (now == null) softKeys(new String[]{"start workout"}, 0, () -> { GymStore.start(this); chooseExercise(); render(); });
        else softKeys(new String[]{"+ exercise", "finish"}, 1, this::chooseExercise, () -> confirm("Finish this workout?", () -> { GymStore.finish(this, now.optString("id")); render(); }));
    }

    // ── Log: one exercise of the workout in progress. ──
    private void openLog(String name) {
        JSONObject now = GymStore.active(this); if (now == null) return;
        exercise = name; List<GymStore.Set> today = GymStore.sets(now, name), before = GymStore.previous(this, name, now.optString("id"));
        GymStore.Set seed = !today.isEmpty() ? today.get(today.size() - 1) : !before.isEmpty() ? before.get(0) : null;
        kg = seed != null ? seed.kg : name.toLowerCase(Locale.ROOT).contains("pull") || name.toLowerCase(Locale.ROOT).contains("dip") ? 0 : 20; reps = seed != null ? seed.reps : 8;
        page = LOG; render();
    }
    private void renderLog() {
        JSONObject now = GymStore.active(this);
        screen(exercise.toLowerCase(Locale.getDefault()), "gym-log");
        keys(new String[]{"+ exercise"}, this::chooseExercise);
        TextView display = label(GymStore.kg(kg) + " kg × " + reps, 40, WHITE); display.setTypeface(PocketFonts.pixel(this)); display.setGravity(Gravity.CENTER);
        display.setMinHeight(dp(88)); display.setTag("gym_display"); display.setContentDescription(GymStore.kg(kg) + " kilograms, " + reps + " reps. Type values.");
        display.setFocusable(true); display.setOnClickListener(v -> typeValues()); PocketDesign.list(display); body.addView(display, new LinearLayout.LayoutParams(-1, -2));
        keys(new String[]{"− 2.5 kg", "+ 2.5 kg"}, () -> step(-2.5, 0), () -> step(2.5, 0));
        keys(new String[]{"− 1 rep", "+ 1 rep"}, () -> step(0, -1), () -> step(0, 1));
        List<GymStore.Set> today = GymStore.sets(now, exercise);
        rest = label("", PocketDesign.SMALL, PocketDesign.accent(this)); rest.setTag("gym_rest"); rest.setGravity(Gravity.CENTER); body.addView(rest, new LinearLayout.LayoutParams(-1, -2));
        if (!today.isEmpty()) { section("today"); for (int i = 0; i < today.size(); i++) body.addView(label((i + 1) + "   " + set(today.get(i)), PocketDesign.BODY, WHITE)); }
        List<GymStore.Set> before = GymStore.previous(this, exercise, now.optString("id"));
        if (!before.isEmpty()) { section("last time · " + day(before.get(0).at)); body.addView(label(line(before), PocketDesign.BODY, GRAY)); }
        GymStore.Point best = GymStore.record(GymStore.history(this, exercise));
        if (best != null) { section("best"); body.addView(label(GymStore.kg(best.e1rm) + " kg e1RM · " + set(best.best) + " · " + day(best.at), PocketDesign.BODY, GRAY)); }
        softKeys(new String[]{"undo", "log set"}, 1, () -> { if (today.isEmpty()) return; GymStore.undoSet(this, now.optString("id"), exercise); render(); },
                () -> { GymStore.Point before1 = GymStore.record(GymStore.history(this, exercise));
                    GymStore.addSet(this, now.optString("id"), exercise, kg, reps); render();
                    if (before1 != null && GymStore.e1rm(kg, reps) > before1.e1rm + .05) message("New best: " + GymStore.kg(GymStore.e1rm(kg, reps)) + " kg e1RM"); });
        tickRest();
    }
    private void step(double kilos, int count) { kg = Math.max(0, Math.min(1000, kg + kilos)); reps = Math.max(1, Math.min(100, reps + count)); render(); }
    private void typeValues() {
        LinearLayout form = new LinearLayout(this); form.setOrientation(LinearLayout.VERTICAL); form.setPadding(dp(20), dp(8), dp(20), 0);
        EditText weight = field(form, "kg", GymStore.kg(kg), InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL), count = field(form, "reps", String.valueOf(reps), InputType.TYPE_CLASS_NUMBER);
        new AlertDialog.Builder(this).setTitle(exercise).setView(form).setNegativeButton("Cancel", null).setPositiveButton("Set", (d, w) -> {
            try { kg = Math.max(0, Math.min(1000, Double.parseDouble(weight.getText().toString().replace(',', '.')))); reps = Math.max(1, Math.min(100, Integer.parseInt(count.getText().toString().trim()))); }
            catch (NumberFormatException wrong) { message("Use numbers for kg and reps."); }
            render(); }).show();
    }
    private EditText field(LinearLayout form, String hint, String value, int type) {
        EditText view = new EditText(this); view.setHint(hint); view.setText(value); view.setInputType(type); view.setSelectAllOnFocus(true); PocketDesign.input(view); form.addView(view, new LinearLayout.LayoutParams(-1, -2)); return view;
    }
    private void tickRest() {
        ui.removeCallbacks(tick); JSONObject now = GymStore.active(this);
        if (rest == null || now == null || !LOG.equals(page)) return;
        long last = 0; for (String name : GymStore.exerciseNames(now)) for (GymStore.Set s : GymStore.sets(now, name)) last = Math.max(last, s.at);
        if (last == 0) { rest.setText(""); return; }
        long seconds = Math.max(0, (System.currentTimeMillis() - last) / 1000);
        rest.setText(seconds >= 3600 ? "" : String.format(Locale.ROOT, "rest %d:%02d", seconds / 60, seconds % 60));
        if (seconds < 3600) ui.postDelayed(tick, 1000 - System.currentTimeMillis() % 1000);
    }
    private void chooseExercise() {
        JSONObject now = GymStore.active(this); if (now == null) return;
        List<String> names = new ArrayList<>(GymStore.exerciseNames(now));
        for (String candidate : GymStore.exercises(this)) if (names.stream().noneMatch(name -> name.equalsIgnoreCase(candidate))) names.add(candidate);
        List<String> options = new ArrayList<>(names); options.add("new exercise…");
        new AlertDialog.Builder(this).setTitle("Exercise").setItems(options.toArray(new String[0]), (d, which) -> {
            if (which < names.size()) { String name=names.get(which); if (GymStore.exerciseNames(now).stream().noneMatch(existing -> existing.equalsIgnoreCase(name))) GymStore.addExercise(this, now.optString("id"), name); openLog(name); return; }
            EditText name = new EditText(this); name.setSingleLine(true); name.setHint("Exercise"); PocketDesign.input(name);
            LinearLayout box = new LinearLayout(this); box.setPadding(dp(20), dp(8), dp(20), 0); box.addView(name, new LinearLayout.LayoutParams(-1, -2));
            new AlertDialog.Builder(this).setTitle("New exercise").setView(box).setNegativeButton("Cancel", null).setPositiveButton("Add", (d2, w2) -> {
                String value = name.getText().toString().trim(); if (value.isEmpty() || value.length() > 60) { message("Name the exercise in up to 60 characters."); return; }
                GymStore.addExercise(this, now.optString("id"), value); openLog(value); }).show();
        }).setNegativeButton("Cancel", null).show();
    }

    // ── One lift over time. ──
    private void renderLift() {
        List<GymStore.Point> history = GymStore.history(this, exercise);
        screen(exercise.toLowerCase(Locale.getDefault()), "gym-lift");
        GymStore.Point best = GymStore.record(history);
        if (best == null) { body.addView(label("No sets yet.", PocketDesign.BODY, GRAY)); return; }
        TextView number = label(GymStore.kg(best.e1rm) + " kg", 40, WHITE); number.setTypeface(PocketFonts.pixel(this)); body.addView(number);
        body.addView(label("best e1RM · " + set(best.best) + " · " + day(best.at) + trend(history), PocketDesign.SMALL, GRAY));
        double[] values = new double[history.size()]; for (int i = 0; i < values.length; i++) values[i] = history.get(i).e1rm;
        if (values.length > 1) { section("e1RM"); body.addView(new Chart(this, values, true), new LinearLayout.LayoutParams(-1, dp(96))); }
        section("sessions");
        for (int i = history.size() - 1; i >= 0; i--) { GymStore.Point p = history.get(i);
            body.addView(ReadableRows.item(this, day(p.at) + " · " + set(p.best), "e1RM " + GymStore.kg(p.e1rm) + " kg", GRAY, "gym_session_" + i, null)); }
    }

    // ── A finished workout. ──
    private void renderWorkout() {
        JSONObject w = GymStore.find(this, workoutId);
        screen(day(w.optLong("started")).toLowerCase(Locale.getDefault()), "gym-workout");
        body.addView(label(minutes(w.optLong("ended") - w.optLong("started")) + " · " + GymStore.setCount(w) + " sets · " + tonnes(GymStore.volume(w)), PocketDesign.SMALL, GRAY));
        for (String name : GymStore.exerciseNames(w)) { section(name); for (GymStore.Set s : GymStore.sets(w, name)) body.addView(label(set(s), PocketDesign.BODY, WHITE)); }
        softKeys(new String[]{"delete"}, -1, () -> confirm("Delete this workout on all devices?", () -> { GymStore.delete(this, workoutId); page = HOME; render(); }));
    }

    private void row(String title, String detail, String tag, Runnable open) { body.addView(ReadableRows.item(this, title, detail, GRAY, tag, open), new LinearLayout.LayoutParams(-1, -2)); }
    private static String set(GymStore.Set s) { return GymStore.kg(s.kg) + " × " + s.reps; }
    private static String line(List<GymStore.Set> sets) { List<String> out = new ArrayList<>(); for (GymStore.Set s : sets) out.add(set(s)); return String.join(" · ", out); }
    private static String minutes(long ms) { long m = Math.max(0, ms / 60_000); return m >= 60 ? m / 60 + "h " + String.format(Locale.ROOT, "%02d", m % 60) + "m" : m + " min"; }
    private static String tonnes(double kilos) { return kilos >= 1000 ? String.format(Locale.ROOT, "%.1f t", kilos / 1000) : Math.round(kilos) + " kg"; }
    private static String day(long at) { return new SimpleDateFormat("EEE d MMM", Locale.getDefault()).format(new Date(at)); }
    /** Change of the best estimate over the last four weeks, when there is an earlier reading to compare. */
    private static String trend(List<GymStore.Point> history) {
        if (history.size() < 2) return "";
        long since = System.currentTimeMillis() - 28L * 24 * 3_600_000L; double before = 0, recent = 0;
        for (GymStore.Point p : history) if (p.at < since) before = Math.max(before, p.e1rm); else recent = Math.max(recent, p.e1rm);
        if (before == 0) { before = history.get(0).e1rm; recent = 0; for (int i = 1; i < history.size(); i++) recent = Math.max(recent, history.get(i).e1rm); }
        if (recent == 0) return "";
        double change = recent - before; return Math.abs(change) < .05 ? " · steady" : " · " + (change > 0 ? "+" : "−") + GymStore.kg(Math.abs(change)) + " kg";
    }

    /** Pixel bars or a stepped line in the accent colour; the latest value is the brightest. */
    private static final class Chart extends View {
        private final double[] values; private final boolean line; private final Paint paint = new Paint(); private final int accent, cell;
        Chart(Context c, double[] values, boolean line) {
            super(c); this.values = values; this.line = line; accent = PocketDesign.accent(c); cell = Math.max(2, PocketDesign.dp(c, 3));
            paint.setAntiAlias(false); setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
        }
        @Override protected void onDraw(Canvas canvas) {
            int n = values.length; if (n == 0) return; double max = 0, min = Double.MAX_VALUE; for (double v : values) { max = Math.max(max, v); min = Math.min(min, v); }
            if (max <= 0) { paint.setColor(PocketDesign.LINE); canvas.drawRect(0, getHeight() - cell, getWidth(), getHeight(), paint); return; }
            float width = getWidth(), height = getHeight() - cell; double floor = line ? Math.max(0, min - (max - min) * .25 - 1) : 0;
            float slot = width / n;
            for (int i = 0; i < n; i++) {
                float top = (float) (height - (values[i] - floor) / (max - floor) * (height - cell)); top = Math.round(top / cell) * cell;
                paint.setColor(i == n - 1 ? accent : (accent & 0x00FFFFFF) | 0x80000000);
                if (line) { float x = Math.round((i + .5f) * slot / cell) * cell; canvas.drawRect(x - cell, top, x + cell, top + cell * 2, paint);
                    if (i > 0) { float prev = (float) (height - (values[i - 1] - floor) / (max - floor) * (height - cell)); prev = Math.round(prev / cell) * cell; float px = Math.round((i - .5f) * slot / cell) * cell;
                        paint.setColor((accent & 0x00FFFFFF) | 0x60000000); for (float sx = px + cell * 2; sx < x - cell; sx += cell * 2) { float t = (sx - px) / (x - px); canvas.drawRect(sx, Math.round((prev + (top - prev) * t) / cell) * cell, sx + cell, Math.round((prev + (top - prev) * t) / cell) * cell + cell, paint); } } }
                else canvas.drawRect(Math.round(i * slot) + cell, values[i] > 0 ? top : height, Math.round((i + 1) * slot) - cell, height + cell, paint);
            }
        }
    }
}
