package org.textphone.launcher;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.text.DateFormat;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.DoubleFunction;
import org.json.JSONArray;
import org.json.JSONObject;

/** COROS cockpit and saved activity instruments, using the web's readings, units and cache format. */
public final class MovementActivity extends PocketActivity {
    private static final int GREEN = PocketDesign.MOVEMENT, BLUE = PocketDesign.CALENDAR;
    private CorosRepository repository;
    private boolean busy, visible, settings, direct, allCharts, more, sample;
    private int selected = -1;
    private String activityId = "", owner = "", settingsReturn = "movement";
    private CorosRepository.Snapshot snapshot;
    private final Map<String, JSONObject> details = new HashMap<>();
    private final Map<String, String> errors = new HashMap<>();
    private final Set<String> loadingDetails = new HashSet<>();
    private final Runnable claim = this::completeLogin;
    private final Runnable redraw = () -> { if (visible && !closed && !busy) render(); };
    private final BroadcastReceiver updated = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) { queueRedraw(); }
    };

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state); repository = CorosRepository.get(this);
        if (state != null) {
            selected = state.getInt("score", -1); settings = state.getBoolean("settings"); direct = state.getBoolean("direct");
            activityId = state.getString("activity", ""); allCharts = state.getBoolean("charts"); more = state.getBoolean("more"); settingsReturn = state.getString("settingsReturn", "movement");
        } else chooseScore(getIntent());
        render();
    }
    private void chooseScore(Intent intent) {
        int chosen = intent.getIntExtra("score", -1);
        if (chosen >= 0 && chosen < 3) { selected = chosen; settings = false; activityId = ""; direct = true; }
    }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); chooseScore(intent); render(); }
    @android.annotation.SuppressLint("UnspecifiedRegisterReceiverFlag")
    @Override protected void onStart() {
        super.onStart(); IntentFilter filter = new IntentFilter(CorosRepository.ACTION_UPDATED);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(updated, filter, Context.RECEIVER_NOT_EXPORTED); else registerReceiver(updated, filter);
    }
    @Override protected void onStop() { unregisterReceiver(updated); ui.removeCallbacks(redraw); super.onStop(); }
    @Override protected void onResume() {
        super.onResume(); visible = true; render();
        if (repository.pending()) completeLogin(); else if (repository.connected()) refresh(false);
    }
    @Override protected void onPause() { visible = false; ui.removeCallbacks(claim); ui.removeCallbacks(redraw); super.onPause(); }
    @Override protected void onSaveInstanceState(Bundle state) {
        state.putInt("score", selected); state.putBoolean("settings", settings); state.putBoolean("direct", direct);
        state.putString("activity", activityId); state.putBoolean("charts", allCharts); state.putBoolean("more", more); state.putString("settingsReturn", settingsReturn); super.onSaveInstanceState(state);
    }
    @Override protected boolean hasInternalBack() { return settings || !activityId.isEmpty() || selected >= 0 && !direct; }
    @Override protected String backPageKey(String rootPage) { return settings ? settingsReturn : "movement"; }
    @Override protected String scene() { return PixelBackdrop.TERRAIN; }
    @Override public void onBackPressed() {
        if (hasInternalBack()) back(() -> { if (settings) settings = false; else if (!activityId.isEmpty()) activityId = ""; else selected = -1; render(); });
        else super.onBackPressed();
    }
    private void queueRedraw() { ui.removeCallbacks(redraw); ui.postDelayed(redraw, 120); }
    @Override protected void onCloudSynced() { queueRedraw(); }
    @Override protected boolean canRefreshData() { return repository.connected() || CloudSync.enabled(this); }
    @Override protected void refreshPageData() throws Exception {
        Exception failure = null;
        if (CloudSync.enabled(this)) try { CloudSync.run(getApplicationContext()); } catch (Exception error) { failure = error; }
        if (repository.connected()) repository.refresh(true);
        if (failure != null) throw failure;
    }
    @Override protected void onPageRefreshed() { render(); }

    private void render() {
        ui.removeCallbacks(redraw);
        String currentOwner = repository.detailOwner();
        if (!owner.equals(currentOwner)) { owner = currentOwner; details.clear(); errors.clear(); loadingDetails.clear(); }
        snapshot = repository.cached(); sample = snapshot == null && !repository.connected() && !repository.pending();
        if (sample) snapshot = MovementSample.snapshot();
        CorosData.Activity activity = findActivity(activityId); if (activity == null) activityId = "";
        String key = activity == null ? "movement" : "movement-activity-" + activity.id;
        screen(settings ? "movement settings" : activity == null ? "movement" : activity.type.toLowerCase(Locale.ROOT), settings ? "movement-settings" : key);
        if (settings) { renderSettings(); return; }
        appSettings(() -> { settingsReturn = key; settings = true; render(); });
        if (activity != null) { renderActivity(activity); return; }
        renderSource();
        if (snapshot == null) { section(busy ? "LOADING FROM COROS…" : "NO READINGS"); return; }
        Scores.Result scores = snapshot.scores; LinearLayout rings = row(); rings.setTag("movement_scores");
        boolean large = getResources().getConfiguration().fontScale > 1.25f || getSharedPreferences("text_phone", 0).getBoolean("large_text", false);
        if (large) rings.setOrientation(LinearLayout.VERTICAL);
        score(rings, 0, "recovery", scores.recovery == null ? Double.NaN : scores.recovery.score, scores.recovery == null ? "—" : scores.recovery.score + "%", scores.recovery == null ? "no reading" : scores.recovery.zone);
        score(rings, 1, "strain", scores.strain.strain, scores.strain.strain + "%", scores.strain.low + "–" + scores.strain.high + "%");
        score(rings, 2, "conditioning", scores.conditioning.score, String.valueOf(scores.conditioning.score), scores.conditioning.status); body.addView(rings);
        if (selected >= 0) scorePanel(scores, snapshot.cockpit);
        week(); section("ACTIVITIES");
        if (snapshot.activities.isEmpty()) note("No activities", GRAY);
        for (CorosData.Activity item : snapshot.activities) {
            // Invented older workouts inform sample scores but do not belong in the sample archive.
            if (sample && item.id.startsWith("sample-history-")) continue;
            Button entry = action(item.type + " · " + date(item.day(ZoneId.systemDefault())) + "\n" + decimal(item.km, 1) + " km · " + moving(item.seconds) + (item.hr > 0 ? " · " + item.hr + " bpm" : ""), () -> { activityId = item.id; render(); });
            entry.setTag("movement_activity_" + item.id); entry.setContentDescription(item.name + ", " + entry.getText());
        }
    }
    private void renderSource() {
        if (!repository.connected()) {
            if (repository.pending()) { action("check COROS sign-in", this::completeLogin).setTag("coros_check"); action("start again", this::connect); }
            else action(snapshot != null && !sample ? "reconnect COROS" : "connect COROS", this::connect).setTag("coros_connect");
        }
        if (sample) { section("SAMPLE DATA").setTag("movement_sample"); return; }
        String device = snapshot == null ? "" : CorosData.string(snapshot.cockpit, "device"); if (device != null && !device.isEmpty()) note(device, GRAY);
        String time = snapshot == null ? "" : DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(new Date(snapshot.updated));
        if (repository.connected()) {
            Button source = action(busy ? "COROS · refreshing…" : "COROS · " + (repository.error().isEmpty() ? time : "retry"), () -> refresh(true)); source.setTag("movement_refresh"); source.setEnabled(!busy);
        } else if (!time.isEmpty()) note("COROS · " + time, GRAY);
        if (!repository.error().isEmpty()) note(repository.error(), PocketDesign.WARNING);
    }
    private void renderSettings() {
        action("open COROS", () -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://training.coros.com/"))));
        if (repository.connected() || repository.pending()) action("disconnect COROS", () -> confirm("Disconnect COROS?", () -> {
            if (busy) return; busy = true;
            load(() -> { repository.disconnect(); return true; }, done -> { busy = false; settings = false; render(); }, error -> { busy = false; message(error.getMessage()); });
        }));
        action("open web movement", () -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(CloudSync.WEB + "#/movement"))));
    }
    private void score(LinearLayout host, int index, String title, double number, String value, String meta) {
        int color = index == 0 ? GREEN : index == 1 ? YELLOW : BLUE;
        LinearLayout cell = column(); cell.setPadding(dp(2), dp(8), dp(2), dp(8)); cell.setGravity(Gravity.CENTER_HORIZONTAL);
        cell.setFocusable(true); cell.setClickable(true); cell.setTag("movement_score_" + index); cell.setSelected(selected == index);
        TextView name = compact(title, 11, selected == index ? color : GRAY), status = compact(meta, 11, GRAY);
        name.setTypeface(PocketFonts.pixel(this)); name.setTextSize(18); name.setMaxLines(1); name.setGravity(Gravity.CENTER); name.setTag("movement_score_name_" + index); status.setGravity(Gravity.CENTER);
        MovementChart ring = MovementChart.ring(this, number, value, color);
        if (host.getOrientation() == LinearLayout.VERTICAL) {
            cell.setOrientation(LinearLayout.HORIZONTAL); cell.setGravity(Gravity.CENTER_VERTICAL);
            cell.addView(ring, new LinearLayout.LayoutParams(dp(104), dp(104)));
            LinearLayout info = column(); info.setPadding(dp(18), 0, 0, 0); name.setGravity(Gravity.START); status.setGravity(Gravity.START);
            info.addView(name); info.addView(status); cell.addView(info, new LinearLayout.LayoutParams(0, -2, 1));
        } else { cell.addView(name); cell.addView(ring, new LinearLayout.LayoutParams(-1, dp(96))); cell.addView(status); }
        cell.setContentDescription(title + " " + value + ", " + meta + (selected == index ? ". Close details." : ". Show details."));
        name.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO); status.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        cell.setOnClickListener(v -> { selected = selected == index ? -1 : index; direct = false; render(); }); host.addView(cell, host.getOrientation() == LinearLayout.VERTICAL ? new LinearLayout.LayoutParams(-1, -2) : new LinearLayout.LayoutParams(0, -2, 1));
    }
    private void scorePanel(Scores.Result scores, JSONObject deck) {
        String[] dates = dateKeys(snapshot.date, 28);
        if (selected == 0) {
            section("RECOVERY");
            if (scores.recovery != null) for (Scores.Part p : scores.recovery.parts) note((p.z > .3 ? "▲ " : p.z < -.3 ? "▼ " : "· ") + p.text, WHITE);
            double[] history = new double[scores.recoveries.size()]; for (int i = 0; i < history.length; i++) history[i] = scores.recoveries.get(i) == null ? Double.NaN : scores.recoveries.get(i).score;
            plot("RECOVERY · 28 MORNINGS", history, dates, MovementChart.Kind.LINE, GREEN, v -> integer(v) + "%").bounds(0, 100);
            gauges(deck); JSONObject daily = deck.optJSONObject("daily"); JSONArray days = daily == null ? null : daily.optJSONArray("days");
            trend("SLEEP · 28 NIGHTS", days, "sleep.total", dates, MovementChart.Kind.BARS, BLUE, MovementActivity::minutes);
            MovementChart hrv = trend("HRV · MS", deck.optJSONArray("hrv"), "avg", dates, MovementChart.Kind.LINE, GREEN, v -> integer(v) + " ms");
            if (hrv != null) hrv.band(onDays(deck.optJSONArray("hrv"), "low", dates), onDays(deck.optJSONArray("hrv"), "high", dates));
            trend("RESTING HR · BPM", deck.optJSONArray("resting"), "bpm", dates, MovementChart.Kind.LINE, YELLOW, v -> integer(v) + " bpm");
            MovementChart stress = trend("STRESS · 0–100", days, "stress", dates, MovementChart.Kind.BARS, YELLOW, MovementActivity::integer); if (stress != null) stress.bounds(0, 100);
            JSONObject own = deck.optJSONObject("recovery");
            if (metric(own, "percent") != null) { section("COROS TRAINING RECOVERY"); note(integer(own.optDouble("percent")) + "% · " + text(own, "level"), GREEN); if (CorosData.string(own, "full") != null) note(text(own, "full"), GRAY); }
        } else if (selected == 1) {
            section("STRAIN"); metrics(new String[][]{{"workouts", String.valueOf(scores.strain.workouts)}, {"active TRIMP", integer(scores.strain.active)}, {"everyday TRIMP", integer(scores.strain.passive)}, {"target", scores.strain.low + "–" + scores.strain.high + "%"}});
            double[] history = new double[scores.strains.size()]; for (int i = 0; i < history.length; i++) history[i] = scores.strains.get(i);
            plot("STRAIN · 28 DAYS", history, dates, MovementChart.Kind.BARS, YELLOW, v -> integer(v) + "%");
            JSONObject daily = deck.optJSONObject("daily"); trend("STEPS · 28 DAYS", daily == null ? null : daily.optJSONArray("days"), "steps", dates, MovementChart.Kind.BARS, GREEN, MovementActivity::integer);
        } else {
            section("CONDITIONING"); Scores.Conditioning c = scores.conditioning;
            metrics(new String[][]{{"7-day TRIMP", integer(c.acute)}, {"42-day TRIMP", integer(c.chronic)}, {"balance", c.chronic > 0 ? decimal(c.acute / c.chronic, 2) : "—"}, {"status", c.status}});
            double[] history = new double[28]; for (int i = 0; i < 28; i++) history[i] = c.trail.get(c.trail.size() - 28 + i);
            plot("CONDITIONING · 28 DAYS", history, dates, MovementChart.Kind.LINE, BLUE, MovementActivity::integer).bounds(0, 100); fitness(deck.optJSONObject("fitness"));
            double[] shortLoad = onDays(deck.optJSONArray("load"), "short", dates), longLoad = onDays(deck.optJSONArray("load"), "long", dates);
            if (present(shortLoad) || present(longLoad)) loadPlot(shortLoad, longLoad, dates);
        }
        action("how it's calculated", () -> method(scores)).setTag("movement_method");
    }
    private void gauges(JSONObject deck) {
        JSONObject hrv = latest(deck.optJSONArray("hrv")), rest = latest(deck.optJSONArray("resting")); section("HRV");
        if (metric(hrv, "avg") == null) note("—", GRAY);
        else {
            metrics(new String[][]{{"HRV", integer(hrv.optDouble("avg")) + " ms"}, {"baseline", number(hrv, "baseline", " ms")}});
            double value = hrv.optDouble("avg"), low = hrv.optDouble("low", value), high = hrv.optDouble("high", value);
            MovementChart meter = new MovementChart(this, MovementChart.Kind.METER, new double[]{value}, new String[0], GREEN).bounds(Math.min(low, value) - 12, Math.max(high, value) + 12).baseline(hrv.optDouble("baseline", Double.NaN));
            if (metric(hrv, "low") != null && metric(hrv, "high") != null) meter.band(new double[]{low}, new double[]{high}); body.addView(meter);
            note(text(hrv, "status") + " · " + text(hrv, "date"), GRAY); if (metric(hrv, "low") != null) note("normal " + integer(low) + "–" + integer(high) + " ms", GRAY);
        }
        section("RESTING HR");
        if (metric(rest, "bpm") == null) note("—", GRAY);
        else {
            JSONArray all = deck.optJSONArray("resting"); double[] data = new double[all.length()]; for (int i = 0; i < data.length; i++) data[i] = all.optJSONObject(i) == null ? Double.NaN : all.optJSONObject(i).optDouble("bpm", Double.NaN);
            double avg = average(data), low = min(data), high = max(data); metrics(new String[][]{{"resting HR", number(rest, "bpm", " bpm")}, {"28-day avg", integer(avg) + " bpm"}});
            body.addView(new MovementChart(this, MovementChart.Kind.METER, new double[]{rest.optDouble("bpm")}, new String[0], YELLOW).bounds(low - 3, high + 3).baseline(avg)); note(text(rest, "date") + " · " + integer(low) + "–" + integer(high) + " bpm", GRAY);
        }
        section("LAST SLEEP"); JSONObject daily = deck.optJSONObject("daily"), night = latestSleep(daily == null ? null : daily.optJSONArray("days"));
        if (night == null) { note("—", GRAY); return; }
        JSONObject sleep = night.optJSONObject("sleep"), score = dated(deck.optJSONArray("sleep"), night.optString("date"));
        metrics(new String[][]{{"sleep", minutes(sleep.optDouble("total", Double.NaN))}, {"score", number(score, "score", "")}});
        double[] stages = new double[4]; String[] names = {"deep", "light", "rem", "awake"}; for (int i = 0; i < 4; i++) stages[i] = sleep.optDouble(names[i], Double.NaN);
        body.addView(new MovementChart(this, MovementChart.Kind.STACK, stages, new String[0], BLUE).title("Sleep stages")); metrics(new String[][]{{"deep", minutes(stages[0])}, {"light", minutes(stages[1])}, {"REM", minutes(stages[2])}, {"awake", minutes(stages[3])}}); note(night.optString("date"), GRAY);
        if (score != null && CorosData.string(score, "window") != null) note(text(score, "window").replaceAll("\\d{4}-\\d{2}-\\d{2} ", ""), GRAY);
        JSONObject hr = sleep.optJSONObject("hr"); if (hr != null) note("sleep HR " + number(hr, "avg", " bpm") + " · " + number(hr, "min", "") + "–" + number(hr, "max", ""), GRAY);
    }
    private void fitness(JSONObject fitness) {
        if (fitness == null) return; java.util.ArrayList<String[]> cells = new java.util.ArrayList<>();
        if (metric(fitness, "vo2max") != null) cells.add(new String[]{"VO2max", number(fitness, "vo2max", "")});
        if (metric(fitness, "level") != null) cells.add(new String[]{"running level", number(fitness, "level", "")});
        if (CorosData.string(fitness, "threshold") != null) cells.add(new String[]{"threshold", text(fitness, "threshold")});
        JSONArray predictions = fitness.optJSONArray("predictions"); if (predictions != null) for (int i = 0; i < predictions.length(); i++) { JSONArray p = predictions.optJSONArray(i); if (p != null && p.length() == 2) cells.add(new String[]{p.optString(0), p.optString(1)}); }
        if (!cells.isEmpty()) { section("FITNESS · COROS"); metrics(cells.toArray(new String[0][])); }
    }
    private void method(Scores.Result scores) {
        String[] methods = {
            "HRV against your COROS baseline (50%), resting heart rate against the previous 28 days (30%) and sleep against 8 hours plus extra after a hard day (20%). Missing inputs are excluded. An ordinary morning is near 60%; 67% and up is primed, below 34% is run down.",
            "Workout TRIMP weights minutes by average heart rate against a maximum of " + scores.maxHr + " bpm. Everyday steps outside workouts add load. The logarithmic scale is open-ended: 100% is about an hour of hard effort. The target follows your previous two weeks and today's recovery.",
            "Conditioning follows a 42-day weighted average of workout TRIMP on a 0–100 scale. The status compares your 7-day and 42-day load. Less than 28 days of history is still calibrating."
        };
        new android.app.AlertDialog.Builder(this).setTitle("Pocket " + new String[]{"recovery", "strain", "conditioning"}[selected]).setMessage(methods[selected] + "\n\nPocket estimates from COROS readings. Bevel's formulas are not public; these are not Bevel or COROS scores.").setPositiveButton("Close", null).show();
    }
    private void week() {
        section("LAST 7 DAYS"); LocalDate today = LocalDate.now(); double km = 0; int seconds = 0, kcal = 0, count = 0; double[] distances = new double[7];
        for (CorosData.Activity item : snapshot.activities) { LocalDate d = item.day(ZoneId.systemDefault()); long offset = java.time.temporal.ChronoUnit.DAYS.between(today.minusDays(6), d); if (offset < 0 || offset > 6) continue; distances[(int) offset] += item.km; km += item.km; seconds += item.seconds; kcal += item.kcal; count++; }
        metrics(new String[][]{{"distance", decimal(km, 1) + " km"}, {"moving", moving(seconds)}, {"activities", String.valueOf(count)}, {"kcal", String.valueOf(kcal)}});
        plot("DISTANCE · KM", distances, dateKeys(today, 7), MovementChart.Kind.BARS, GREEN, v -> decimal(v, 1) + " km").setTag("movement_week");
    }

    private CorosData.Activity findActivity(String id) { if (snapshot != null) for (CorosData.Activity item : snapshot.activities) if (item.id.equals(id)) return item; return null; }
    private void renderActivity(CorosData.Activity item) {
        int index = snapshot.activities.indexOf(item) + 1; note(item.type + " · " + date(item.day(ZoneId.systemDefault())) + (sample ? " · SAMPLE DATA" : " · " + index + "/" + snapshot.activities.size()), GRAY);
        TextView title = label(item.name, 32, WHITE); title.setTypeface(PocketFonts.pixel(this)); body.addView(title);
        JSONObject ready = details.get(item.id); if (sample) ready = MovementSample.detail(item); else if (ready == null) ready = repository.cachedDetail(item.id); if (ready != null) details.put(item.id, ready);
        boolean loading = loadingDetails.contains(item.id);
        if (ready == null && !errors.containsKey(item.id) && !loading && repository.connected()) { fetchDetail(item, false); loading = true; }
        JSONObject path = ready == null ? null : ready.optJSONObject("path");
        if (path != null) { MovementChart route = MovementChart.route(this, path); route.setTag("movement_route"); body.addView(route, new LinearLayout.LayoutParams(-1, dp(190))); }
        else { TextView empty = label(loading ? "LOADING FROM COROS…" : errors.containsKey(item.id) ? "ROUTE NOT AVAILABLE" : "NO GPS TRACK", PocketDesign.META, GRAY); empty.setGravity(Gravity.CENTER); body.addView(empty, new LinearLayout.LayoutParams(-1, dp(150))); }
        metrics(new String[][]{{"distance", decimal(item.km, 1) + " km"}, {"moving", moving(item.seconds)}, {item.paceLabel, item.pace == null ? "—" : item.pace}, {"climb", number(ready, "climb", " m")}, {"avg heart rate", item.hr > 0 ? item.hr + " bpm" : "—"}, {"kcal", item.kcal > 0 ? String.valueOf(item.kcal) : "—"}});
        if (loading) note("Loading activity…", GRAY); String error = errors.get(item.id); if (error != null) note(error, PocketDesign.WARNING);
        boolean partial = ready != null && ready.optBoolean("partial"); if (partial) note("Some activity data is unavailable", PocketDesign.WARNING);
        if (!sample && !loading && (ready == null || partial || error != null)) {
            if (repository.connected()) action("retry activity", () -> fetchDetail(item, true)).setTag("movement_detail_retry"); else action("reconnect COROS", this::connect).setTag("coros_connect");
        }
        if (ready == null) return;
        JSONObject series = ready.optJSONObject("series"); if (series != null) activityCharts(series, item.type.equals("RIDE"));
        JSONObject laps = ready.optJSONObject("laps"); JSONArray facts = ready.optJSONArray("detail");
        if (laps != null && laps.optJSONArray("laps") != null && laps.optJSONArray("laps").length() > 0 || series != null && series.optJSONArray("hrBands") != null && series.optJSONArray("hrBands").length() > 0 || facts != null && facts.length() > 0) {
            Button fold = action(more ? "− splits & metrics" : "+ splits & metrics", () -> { more = !more; render(); }); fold.setTag("movement_more"); fold.setContentDescription((more ? "Collapse" : "Expand") + " splits, time by heart rate and every metric");
            if (more) {
                splits(laps, item.type.equals("RIDE")); bands(series);
                if (facts != null && facts.length() > 0) {
                    section("EVERY METRIC · COROS");
                    for (int i = 0; i < facts.length(); i++) {
                        JSONArray pair = facts.optJSONArray(i);
                        if (pair != null && pair.length() >= 2) { note(pair.optString(0), GRAY); note(pair.optString(1), WHITE); }
                    }
                }
            }
        }
    }
    private void fetchDetail(CorosData.Activity item, boolean force) {
        if (loadingDetails.contains(item.id)) return; String requestOwner = owner; loadingDetails.add(item.id); errors.remove(item.id);
        load(() -> repository.detail(item, force), value -> {
            if (!requestOwner.equals(repository.detailOwner())) return; loadingDetails.remove(item.id); details.put(item.id, value);
            if (activityId.equals(item.id) && !settings && visible) render();
        }, error -> {
            if (!requestOwner.equals(repository.detailOwner())) return; loadingDetails.remove(item.id); errors.put(item.id, error.getMessage() == null ? "Activity unavailable" : error.getMessage());
            if (activityId.equals(item.id) && !settings && visible) render();
        });
        if (force) render();
    }
    private void activityCharts(JSONObject series, boolean ride) {
        String[] keys = {"pace", "hr", "altitude", "cadence", "power", "contact", "oscillation", "ratio", "step"};
        String[] names = {ride ? "SPEED" : "PACE", "HEART RATE", "ELEVATION", "CADENCE", "POWER", "GROUND CONTACT", "VERT. OSCILLATION", "VERT. RATIO", "STEP LENGTH"};
        double[] axis = MovementChart.array(series.optJSONArray("x")); if (axis.length == 0) return;
        String unit = series.optString("unit", "km"); String[] ticks = new String[axis.length]; for (int i = 0; i < ticks.length; i++) ticks[i] = decimal(axis[i], 2) + " " + unit;
        MovementChart.Cursor cursor = new MovementChart.Cursor(); int extra = 0; section("ALONG THE WAY"); final TextView readout = compact("average", PocketDesign.SMALL, GRAY); readout.setTag("movement_cursor");
        readout.setFocusable(true); readout.setClickable(true); readout.setMinHeight(dp(48)); readout.setContentDescription("Clear chart cursor and show averages"); readout.setOnClickListener(view -> cursor.set(-1));
        for (int channel = 0; channel < keys.length; channel++) {
            final int which = channel; double[] data = MovementChart.array(series.optJSONArray(keys[channel])); if (!present(data)) continue;
            if (channel >= 3) { extra++; if (!allCharts) continue; }
            if (data.length != axis.length) { int length = data.length; data = Arrays.copyOf(data, axis.length); if (length < axis.length) Arrays.fill(data, length, axis.length, Double.NaN); }
            if (channel == 0 && ride) for (int i = 0; i < data.length; i++) data[i] = data[i] > 0 ? 3600 / data[i] : Double.NaN;
            DoubleFunction<String> format = value -> channelValue(which, value, ride); final double[] values = data; final TextView reading = plotHead(names[channel], format.apply(average(values)));
            MovementChart chart = new MovementChart(this, MovementChart.Kind.LINE, data, ticks, channel == 0 ? GREEN : channel == 1 ? YELLOW : BLUE).invert(channel == 0 && !ride).title(names[channel]).format(format); chart.setTag("movement_chart_" + keys[channel]);
            chart.linked(cursor, point -> { reading.setText(format.apply(point >= 0 && point < values.length ? values[point] : average(values))); readout.setText(point >= 0 && point < ticks.length ? ticks[point] : "average"); }); body.addView(chart, new LinearLayout.LayoutParams(-1, dp(150)));
        }
        body.addView(readout); if (extra > 0) action(allCharts ? "− fewer charts" : "+ " + extra + " more charts", () -> { allCharts = !allCharts; render(); }).setTag("movement_more_charts");
    }
    private static String channelValue(int channel, double value, boolean ride) {
        if (!Double.isFinite(value)) return "—";
        switch (channel) { case 0: return ride ? decimal(value, 1) + " km/h" : pace(value) + " /km"; case 1: return integer(value) + " bpm"; case 2: return integer(value) + " m"; case 3: return integer(value) + (ride ? " rpm" : " spm"); case 4: return integer(value) + " W"; case 5: return integer(value) + " ms"; case 6: return decimal(value / 10, 1) + " cm"; case 7: return decimal(value, 1) + "%"; default: return decimal(value / 1000, 2) + " m"; }
    }
    private void splits(JSONObject source, boolean ride) {
        JSONArray laps = source == null ? null : source.optJSONArray("laps"); if (laps == null || laps.length() == 0) return;
        section("SPLITS · " + decimal(source.optDouble("every"), 1) + " KM"); java.util.ArrayList<String> fields = new java.util.ArrayList<>(); fields.add("km"); fields.add(ride ? "speed" : "pace");
        for (String field : new String[]{"adjusted", "hr", "maxHr", "cadence", "power", "stride", "contact", "oscillation", "ratio", "climb", "descent"}) {
            if (ride && field.equals("adjusted")) continue; for (int i = 0; i < laps.length(); i++) if (metric(laps.optJSONObject(i), field) != null) { fields.add(field); break; }
        }
        Map<String, String> names = new HashMap<>(); String[][] pairs = {{"km", "KM"}, {"speed", "KM/H"}, {"pace", "PACE"}, {"adjusted", "ADJUSTED"}, {"hr", "HR"}, {"maxHr", "MAX HR"}, {"cadence", ride ? "RPM" : "SPM"}, {"power", "W"}, {"stride", "STRIDE"}, {"contact", "GCT"}, {"oscillation", "V.OSC"}, {"ratio", "V.RATIO"}, {"climb", "↑ M"}, {"descent", "↓ M"}};
        for (String[] pair : pairs) names.put(pair[0], pair[1]);
        HorizontalScrollView scroll = new HorizontalScrollView(this); scroll.setTag("movement_splits"); LinearLayout table = column(); table.addView(tableRow(fields.stream().map(names::get).toArray(String[]::new), GRAY, -1));
        double fastestSpeed = 0;
        for (int i = 0; i < laps.length(); i++) if (laps.optJSONObject(i) != null) fastestSpeed = Math.max(fastestSpeed, lapSpeed(laps.optJSONObject(i)));
        JSONArray fastest = source.optJSONArray("fastest"); double cumulative = 0;
        for (int i = 0; i < laps.length(); i++) {
            JSONObject lap = laps.optJSONObject(i); if (lap == null) continue; cumulative += lap.optDouble("km"); boolean best = false;
            if (fastest != null) for (int j = 0; j < fastest.length(); j++) if (fastest.optInt(j) == lap.optInt("index", i + 1)) best = true;
            String[] cells = new String[fields.size()]; for (int j = 0; j < cells.length; j++) cells[j] = fields.get(j).equals("km") ? decimal(cumulative, 2) : splitValue(lap, fields.get(j));
            LinearLayout line = tableRow(cells, best ? GREEN : WHITE, fastestSpeed > 0 ? lapSpeed(lap) / fastestSpeed : 0); line.setTag("movement_split_" + lap.optInt("index", i + 1)); table.addView(line);
        }
        scroll.addView(table, new HorizontalScrollView.LayoutParams(-2, -2)); body.addView(scroll, new LinearLayout.LayoutParams(-1, -2));
    }
    private static String splitValue(JSONObject lap, String key) {
        Double value = metric(lap, key); if (value == null) return "—";
        switch (key) { case "pace": case "adjusted": return pace(value); case "speed": return decimal(value, 1); case "stride": return decimal(value / 100, 2) + " m"; case "contact": return integer(value) + " ms"; case "oscillation": return decimal(value, 1) + " cm"; case "ratio": return decimal(value, 1) + "%"; default: return integer(value); }
    }
    private static double lapSpeed(JSONObject lap) { double pace = lap.optDouble("pace", 0), speed = lap.optDouble("speed", 0); return pace > 0 ? 3600 / pace : speed > 0 && Double.isFinite(speed) ? speed : 0; }
    private LinearLayout tableRow(String[] cells, int color, double fraction) {
        LinearLayout line = row(); line.setBackground(PocketDesign.separator(this));
        for (int i = 0; i < cells.length; i++) {
            TextView cell = compact(cells[i], PocketDesign.SMALL, color); cell.setPadding(dp(4), dp(10), dp(6), dp(10)); line.addView(cell, new LinearLayout.LayoutParams(dp(96), -2));
            if (i == 0) {
                LinearLayout track = row(); track.setPadding(dp(4), 0, dp(4), 0);
                if (fraction >= 0) { View bar = new View(this); bar.setBackgroundColor(color == GREEN ? GREEN : PocketDesign.LINE); track.addView(bar, new LinearLayout.LayoutParams(0, dp(8), (float) Math.max(.001, fraction))); track.addView(new View(this), new LinearLayout.LayoutParams(0, dp(8), (float) Math.max(0, 1 - fraction))); }
                line.addView(track, new LinearLayout.LayoutParams(dp(56), dp(32)));
            }
        }
        return line;
    }
    private void bands(JSONObject series) {
        JSONArray bands = series == null ? null : series.optJSONArray("hrBands"); if (bands == null || bands.length() == 0) return; section("TIME BY HEART RATE"); double top = 0;
        for (int i = 0; i < bands.length(); i++) if (bands.optJSONObject(i) != null) top = Math.max(top, bands.optJSONObject(i).optDouble("share"));
        for (int i = 0; i < bands.length(); i++) {
            JSONObject band = bands.optJSONObject(i); if (band == null || band.optDouble("share") < .005) continue; double share = band.optDouble("share"); int from = band.optInt("from"); LinearLayout line = row();
            line.addView(compact(from + "–" + (from + 9), 12, GRAY), new LinearLayout.LayoutParams(dp(76), -2));
            LinearLayout track = row(); View bar = new View(this); bar.setBackgroundColor(share == top ? YELLOW : GREEN); track.addView(bar, new LinearLayout.LayoutParams(0, dp(8), (float) (share / top))); track.addView(new View(this), new LinearLayout.LayoutParams(0, dp(8), (float) (1 - share / top)));
            line.addView(track, new LinearLayout.LayoutParams(0, -2, 1)); TextView percent = compact(integer(share * 100) + "%", 12, WHITE); percent.setGravity(Gravity.END); line.addView(percent, new LinearLayout.LayoutParams(dp(52), -2)); line.setPadding(0, dp(5), 0, dp(5)); line.setContentDescription(from + " to " + (from + 9) + " bpm, " + integer(share * 100) + " percent"); body.addView(line);
        }
    }
    private void connect() {
        if (busy) return; busy = true; load(repository::begin, url -> { busy = false; render(); startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }, error -> { busy = false; render(); message(error.getMessage()); });
    }
    private void completeLogin() {
        if (busy || !visible || !repository.pending()) return; busy = true;
        load(repository::finish, done -> { busy = false; render(); if (done) refresh(true); else if (visible && repository.pending()) ui.postDelayed(claim, 3_000); }, error -> { busy = false; render(); message(error.getMessage()); });
    }
    private void refresh(boolean force) {
        if (busy || !repository.connected()) return; busy = true; render(); load(() -> repository.refresh(force), value -> { busy = false; render(); }, error -> { busy = false; render(); message(error.getMessage()); });
    }
    private LinearLayout column() { LinearLayout view = new LinearLayout(this); view.setOrientation(LinearLayout.VERTICAL); return view; }
    private TextView compact(String text, int size, int color) { TextView view = label(text, size, color); view.setPadding(0, dp(3), 0, dp(3)); return view; }
    private void note(String text, int color) { body.addView(compact(text, PocketDesign.SMALL, color)); }
    private void metrics(String[][] cells) {
        for (int offset = 0; offset < cells.length; offset += 2) {
            LinearLayout line = row(); line.setGravity(Gravity.TOP);
            for (int i = offset; i < Math.min(cells.length, offset + 2); i++) { LinearLayout cell = column(); cell.setPadding(0, dp(6), dp(10), dp(8)); TextView value = compact(cells[i][1], 26, WHITE); value.setTypeface(PocketFonts.pixel(this)); cell.addView(value); cell.addView(compact(cells[i][0], PocketDesign.META, GRAY)); line.addView(cell, new LinearLayout.LayoutParams(0, -2, 1)); } body.addView(line);
        }
    }
    private TextView plotHead(String title, String value) { LinearLayout line = row(); line.setPadding(0, dp(14), 0, 0); TextView name = compact(title, 11, GRAY), reading = compact(value, 13, WHITE); name.setMaxLines(2); reading.setGravity(Gravity.END); line.addView(name, new LinearLayout.LayoutParams(0, -2, 1)); line.addView(reading, new LinearLayout.LayoutParams(0, -2, 1)); body.addView(line); return reading; }
    private MovementChart plot(String title, double[] values, String[] dates, MovementChart.Kind kind, int color, DoubleFunction<String> format) {
        TextView reading = plotHead(title, format.apply(last(values))); String[] labels = Arrays.stream(dates).map(MovementActivity::shortDate).toArray(String[]::new); MovementChart chart = new MovementChart(this, kind, values, labels, color).title(title).format(format);
        chart.linked(new MovementChart.Cursor(), index -> reading.setText(index >= 0 && index < values.length ? shortDate(dates[index]) + " · " + format.apply(values[index]) : format.apply(last(values)))); body.addView(chart, new LinearLayout.LayoutParams(-1, dp(150))); return chart;
    }
    private MovementChart trend(String title, JSONArray rows, String field, String[] dates, MovementChart.Kind kind, int color, DoubleFunction<String> format) { double[] values = onDays(rows, field, dates); return present(values) ? plot(title, values, dates, kind, color, format) : null; }
    private void loadPlot(double[] shortLoad, double[] longLoad, String[] dates) {
        TextView reading = plotHead("COROS LOAD · SHORT / LONG", integer(last(shortLoad)) + " / " + integer(last(longLoad)));
        MovementChart chart = new MovementChart(this, MovementChart.Kind.PAIR, shortLoad, Arrays.stream(dates).map(MovementActivity::shortDate).toArray(String[]::new), BLUE).paired(longLoad).title("COROS load: blue short-term, cream long-term");
        chart.linked(new MovementChart.Cursor(), index -> reading.setText(index >= 0 && index < shortLoad.length ? shortDate(dates[index]) + " · " + integer(shortLoad[index]) + " / " + integer(longLoad[index]) : integer(last(shortLoad)) + " / " + integer(last(longLoad))));
        body.addView(chart, new LinearLayout.LayoutParams(-1, dp(150)));
    }
    static double[] onDays(JSONArray rows, String field, String[] dates) {
        double[] values = new double[dates.length]; Arrays.fill(values, Double.NaN);
        for (int i = 0; i < dates.length; i++) { JSONObject row = dated(rows, dates[i]); if (row == null) continue; String[] path = field.split("\\."); for (int j = 0; j < path.length - 1 && row != null; j++) row = row.optJSONObject(path[j]); if (row != null) values[i] = row.optDouble(path[path.length - 1], Double.NaN); } return values;
    }
    private static JSONObject dated(JSONArray rows, String date) { if (rows != null) for (int i = 0; i < rows.length(); i++) { JSONObject row = rows.optJSONObject(i); if (row != null && date.equals(row.optString("date"))) return row; } return null; }
    private static JSONObject latest(JSONArray rows) { JSONObject last = null; if (rows != null) for (int i = 0; i < rows.length(); i++) { JSONObject row = rows.optJSONObject(i); if (row != null && (last == null || row.optString("date").compareTo(last.optString("date")) > 0)) last = row; } return last; }
    private static JSONObject latestSleep(JSONArray rows) { JSONObject last = null; if (rows != null) for (int i = 0; i < rows.length(); i++) { JSONObject row = rows.optJSONObject(i); if (row != null && row.optJSONObject("sleep") != null && (last == null || row.optString("date").compareTo(last.optString("date")) > 0)) last = row; } return last; }
    private static String[] dateKeys(LocalDate end, int count) { String[] dates = new String[count]; for (int i = 0; i < count; i++) dates[i] = end.minusDays(count - i - 1).toString(); return dates; }
    private static String date(LocalDate date) { return date.format(DateTimeFormatter.ofPattern("EEE, d MMM", Locale.getDefault())); }
    private static String shortDate(String date) { try { return LocalDate.parse(date).format(DateTimeFormatter.ofPattern("d MMM", Locale.getDefault())); } catch (RuntimeException unknown) { return date; } }
    private static Double metric(JSONObject row, String key) { return CorosData.metric(row, key); }
    private static String text(JSONObject row, String key) { String value = row == null ? null : CorosData.string(row, key); return value == null ? "" : value; }
    private static String number(JSONObject row, String key, String unit) { Double value = metric(row, key); return value == null ? "—" : decimal(value, value == Math.rint(value) ? 0 : 1) + unit; }
    static String moving(int seconds) { int mins = Math.max(0, seconds) / 60; return mins >= 60 ? mins / 60 + "h " + mins % 60 + "m" : mins + "m"; }
    private static String minutes(double minutes) { return Double.isFinite(minutes) ? moving((int) Math.round(minutes * 60)) : "—"; }
    static String pace(double seconds) { if (!Double.isFinite(seconds) || seconds <= 0) return "—"; long rounded = Math.round(seconds); return rounded / 60 + ":" + String.format(Locale.ROOT, "%02d", rounded % 60); }
    private static String decimal(double value, int places) { return Double.isFinite(value) ? String.format(Locale.getDefault(), "%." + places + "f", value) : "—"; }
    private static String integer(double value) { return Double.isFinite(value) ? String.format(Locale.getDefault(), "%,d", Math.round(value)) : "—"; }
    private static boolean present(double[] data) { for (double value : data) if (Double.isFinite(value)) return true; return false; }
    private static double last(double[] data) { for (int i = data.length - 1; i >= 0; i--) if (Double.isFinite(data[i])) return data[i]; return Double.NaN; }
    private static double average(double[] data) { double sum = 0; int count = 0; for (double value : data) if (Double.isFinite(value)) { sum += value; count++; } return count > 0 ? sum / count : Double.NaN; }
    private static double min(double[] data) { double low = Double.POSITIVE_INFINITY; for (double value : data) if (Double.isFinite(value)) low = Math.min(low, value); return Double.isFinite(low) ? low : Double.NaN; }
    private static double max(double[] data) { double high = Double.NEGATIVE_INFINITY; for (double value : data) if (Double.isFinite(value)) high = Math.max(high, value); return Double.isFinite(high) ? high : Double.NaN; }
}
