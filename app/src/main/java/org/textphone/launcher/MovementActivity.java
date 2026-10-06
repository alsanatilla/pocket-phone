package org.textphone.launcher;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.text.DateFormat;
import java.util.Date;
import java.util.Locale;

/** Quiet phone view: scores first, their inputs on tap, with independent COROS browser sign-in. */
public final class MovementActivity extends PocketActivity {
    private CorosRepository repository; private boolean busy, visible, settings, direct; private int selected = -1;
    private final Runnable claim = this::completeLogin;
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state); repository = CorosRepository.get(this);
        if (state != null) { selected = state.getInt("score", -1); settings = state.getBoolean("settings"); direct = state.getBoolean("direct"); }
        // A reading tapped on Home opens straight into its detail; Back then returns Home, not to an overview never seen.
        int chosen = getIntent().getIntExtra("score", -1); if (state == null && chosen >= 0 && chosen < 3) { selected = chosen; direct = true; }
        render();
    }
    @Override protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent); setIntent(intent);
        int chosen = intent.getIntExtra("score", -1); if (chosen < 0 || chosen >= 3) return;
        selected = chosen; settings = false; direct = true; render();
    }
    @Override protected void onResume() {
        super.onResume(); visible = true;
        if (repository.pending()) completeLogin(); else if (repository.connected()) refresh(false);
    }
    @Override protected void onPause() { visible = false; ui.removeCallbacks(claim); super.onPause(); }
    @Override protected void onSaveInstanceState(Bundle state) { state.putInt("score", selected); state.putBoolean("settings", settings); state.putBoolean("direct", direct); super.onSaveInstanceState(state); }
    @Override protected boolean hasInternalBack() { return settings || selected >= 0 && !direct; }
    @Override protected String scene() { return PixelBackdrop.TERRAIN; }
    @Override public void onBackPressed() { if (hasInternalBack()) { back(() -> { if (settings) settings = false; else selected = -1; render(); }); } else super.onBackPressed(); }
    private void render() {
        screen(settings ? "movement settings" : "movement", settings ? "movement-settings" : "movement");
        if (settings) {
            action("open COROS", () -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://training.coros.com/"))));
            if (repository.connected() || repository.pending()) action("disconnect COROS", () -> confirm("Disconnect COROS on this phone?", () -> {
                if (busy) { message("Wait for movement to finish refreshing."); return; }
                busy = true;
                load(() -> { repository.disconnect(); return true; }, done -> { busy = false; settings = false; selected = -1; render(); }, error -> { busy = false; message(error.getMessage()); });
            }));
            action("open web movement", () -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(CloudSync.WEB + "#/movement"))));
            return;
        }
        appSettings(() -> { settings = true; render(); });
        if (!repository.connected()) {
            body.addView(label(repository.pending() ? "Waiting for COROS sign-in" : "COROS", 22, WHITE));
            if (repository.pending()) {
                action("check sign-in", this::completeLogin).setTag("coros_check");
                action("start again", this::connect);
            } else action("connect COROS", this::connect).setTag("coros_connect");
            body.addView(label("Sign in in your browser, then return to Pocket.", PocketDesign.SMALL, GRAY));
            return;
        }
        CorosRepository.Snapshot snapshot = repository.cached();
        if (snapshot == null) body.addView(label(busy ? "Loading movement…" : "Movement has not loaded yet", PocketDesign.BODY, GRAY));
        else {
            body.addView(label((snapshot.today() ? "Today" : snapshot.date.toString()) + " · " + DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date(snapshot.updated)), PocketDesign.SMALL, GRAY));
            Scores.Result scores = snapshot.scores;
            LinearLayout row = row();
            score(row, 0, "recovery", scores.recovery == null ? "—" : scores.recovery.score + "%", scores.recovery == null ? "no reading" : scores.recovery.zone);
            score(row, 1, "strain", scores.strain.strain + "%", scores.strain.low + "–" + scores.strain.high);
            score(row, 2, "conditioning", String.valueOf(scores.conditioning.score), scores.conditioning.status);
            body.addView(row);
            if (selected == 0) {
                body.addView(label(Scores.recoveryLine(scores.recovery), PocketDesign.BODY, WHITE));
                if (scores.recovery != null) for (Scores.Part part : scores.recovery.parts) body.addView(label(part.text, PocketDesign.SMALL, GRAY));
            } else if (selected == 1) {
                body.addView(label(Scores.strainLine(scores.strain), PocketDesign.BODY, WHITE));
                body.addView(label(String.format(Locale.getDefault(), "Workout load %.0f · everyday steps %.0f", scores.strain.active, scores.strain.passive), PocketDesign.SMALL, GRAY));
            } else if (selected == 2) {
                body.addView(label(Scores.conditionLine(scores.conditioning.status), PocketDesign.BODY, WHITE));
                body.addView(label(String.format(Locale.getDefault(), "7-day load %.1f · 42-day load %.1f", scores.conditioning.acute, scores.conditioning.chronic), PocketDesign.SMALL, GRAY));
            }
            if (selected >= 0) action("how it's calculated", () -> new android.app.AlertDialog.Builder(this).setTitle("Pocket score estimates")
                    .setMessage("Recovery compares HRV, resting heart rate and sleep with your recent readings. Strain estimates effort from workout heart rate and other steps. Conditioning follows 42 days of workout load. These are Pocket's estimates, using COROS readings; they are not Bevel or COROS scores. Maximum heart rate is estimated from age. Missing readings reduce the inputs available.")
                    .setPositiveButton("Close", null).show());
            if (!snapshot.activities.isEmpty()) {
                body.addView(label("recent activities", PocketDesign.SMALL, GRAY));
                for (int i = 0; i < Math.min(5, snapshot.activities.size()); i++) {
                    CorosData.Activity activity = snapshot.activities.get(i);
                    body.addView(label(activity.day(java.time.ZoneId.systemDefault()) + " · " + activity.name + "\n"
                            + String.format(Locale.getDefault(), "%.1f km · %d min", activity.km, activity.seconds / 60), PocketDesign.SMALL, WHITE));
                }
            }
        }
        String error = repository.error(); if (!error.isEmpty()) body.addView(label(error, PocketDesign.SMALL, PocketDesign.WARNING));
        action(busy ? "Refreshing…" : "Refresh", () -> refresh(true)).setEnabled(!busy);
    }
    private void score(LinearLayout row, int index, String title, String value, String meta) {
        LinearLayout item = new LinearLayout(this); item.setOrientation(LinearLayout.VERTICAL); item.setMinimumHeight(dp(96));
        item.setPadding(dp(2), dp(8), dp(2), dp(8)); item.setFocusable(true); item.setTag("movement_score_" + index);
        TextView name = label(title, 11, GRAY), number = label(value, 30, WHITE), state = label(meta, 11, GRAY);
        for (TextView text : new TextView[]{name, number, state}) { text.setPadding(0, dp(2), 0, dp(2)); item.addView(text); text.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO); }
        item.setContentDescription(title + " " + value + ", " + meta + ". Show details.");
        item.setOnClickListener(v -> { selected = selected == index ? -1 : index; render(); });
        row.addView(item, new LinearLayout.LayoutParams(0, -2, 1));
    }
    private void connect() {
        if (busy) return; busy = true; message("Opening COROS…");
        load(repository::begin, url -> { busy = false; render(); startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }, error -> { busy = false; render(); message(error.getMessage()); });
    }
    private void completeLogin() {
        if (busy || !visible || !repository.pending()) return; busy = true;
        load(repository::finish, done -> {
            busy = false; render();
            if (done) refresh(true); else if (visible && repository.pending()) ui.postDelayed(claim, 3_000);
        }, error -> { busy = false; render(); message(error.getMessage()); });
    }
    private void refresh(boolean force) {
        if (busy || !repository.connected()) return; busy = true; render();
        load(() -> repository.refresh(force), value -> { busy = false; render(); }, error -> { busy = false; render(); message(error.getMessage()); });
    }
}
