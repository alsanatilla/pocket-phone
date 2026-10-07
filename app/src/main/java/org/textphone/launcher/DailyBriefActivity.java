package org.textphone.launcher;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

/** A live brief with direct links to the records behind every fact. */
public final class DailyBriefActivity extends PocketActivity {
    private LinearLayout facts;
    private Button ask;
    private DailyBrief.Result result;
    private String signature = "";
    private boolean visible, registered;
    private int request;
    private final BroadcastReceiver changes = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent intent) { refresh(); }
    };

    @Override protected void onCreate(Bundle state) { super.onCreate(state); render(); }
    @Override protected String scene() { return PixelBackdrop.SKY; }
    @android.annotation.SuppressLint("UnspecifiedRegisterReceiverFlag")
    @Override protected void onStart() {
        super.onStart();
        IntentFilter filter = new IntentFilter(CorosRepository.ACTION_UPDATED);
        filter.addAction(Intent.ACTION_TIME_TICK); filter.addAction(Intent.ACTION_TIME_CHANGED); filter.addAction(Intent.ACTION_TIMEZONE_CHANGED);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(changes, filter, Context.RECEIVER_NOT_EXPORTED); else registerReceiver(changes, filter);
        registered = true;
    }
    @Override protected void onResume() { super.onResume(); visible = true; refresh(); }
    @Override protected void onPause() { visible = false; request++; signature = ""; super.onPause(); }
    @Override protected void onStop() { if (registered) { unregisterReceiver(changes); registered = false; } super.onStop(); }
    @Override protected void onCloudSynced() { signature = ""; refresh(); }

    private void render() {
        screen("brief");
        appSettings(this::settings);
        facts = new LinearLayout(this); facts.setOrientation(LinearLayout.VERTICAL); facts.setTag("brief_facts");
        body.addView(facts, new LinearLayout.LayoutParams(-1, -2));
        LinearLayout keys = softKeys(new String[]{"ask pip"}, -1, () -> { if (result != null) askPip(this, result); });
        ask = (Button) keys.getChildAt(0); ask.setTag("brief_ask_pip"); ask.setEnabled(false);
        signature = "";
    }
    private void settings() {
        boolean enabled = DailyBriefLocal.enabled(this);
        new AlertDialog.Builder(this).setTitle("Daily brief").setItems(new String[]{enabled ? "turn off" : "turn on"}, (dialog, which) -> {
            if (closed) return;
            try { DailyBriefLocal.enabled(this, !enabled); result = null; render(); refresh(); }
            catch (RuntimeException error) { message(error.getMessage() == null ? "Could not save the setting." : error.getMessage()); }
        }).setNegativeButton("Close", null).show();
    }
    private void refresh() {
        if (closed || !visible || facts == null) return;
        String fresh = DailyBriefLocal.signature(this, System.currentTimeMillis());
        if (fresh.equals(signature)) return;
        signature = fresh;
        if (!DailyBriefLocal.enabled(this)) {
            request++; result = null; facts.removeAllViews(); facts.addView(label("Daily brief is off", PocketDesign.BODY, GRAY));
            facts.addView(item("turn on", () -> { DailyBriefLocal.enabled(this, true); signature = ""; refresh(); }));
            ask.setEnabled(false); return;
        }
        final int owner = ++request; final LinearLayout target = facts;
        ask.setEnabled(false);
        load(() -> DailyBriefLocal.read(getApplicationContext(), System.currentTimeMillis()), next -> {
            if (closed || !visible || owner != request || target != facts) return;
            if (!fresh.equals(DailyBriefLocal.signature(this, System.currentTimeMillis()))) { signature = ""; refresh(); return; }
            result = next; show(next); ask.setEnabled(true);
        }, error -> {
            if (!closed && visible && owner == request && target == facts) { signature = ""; message("Could not read the brief. Pull to refresh or reopen it."); }
        });
    }
    private void show(DailyBrief.Result brief) {
        facts.removeAllViews();
        facts.addView(label(DateTimeFormatter.ofPattern("EEE · d MMM", Locale.getDefault()).format(Instant.ofEpochMilli(brief.now).atZone(ZoneId.systemDefault())), PocketDesign.META, GRAY));
        if (brief.facts.isEmpty()) facts.addView(label(brief.text, PocketDesign.BODY, WHITE));
        for (DailyBrief.Fact fact : brief.facts) {
            TextView source = label(source(fact.kind), PocketDesign.META, GRAY); facts.addView(source);
            Button row = item(fact.text, () -> { String error = openSource(this, fact); if (error != null) { message(error); signature = ""; refresh(); } });
            row.setTag("brief_fact_" + fact.id); row.setMaxLines(5); row.setContentDescription(fact.text + ". Open " + source(fact.kind) + ".");
            facts.addView(row, new LinearLayout.LayoutParams(-1, -2));
        }
        if (!brief.unavailable.isEmpty()) facts.addView(label("Unavailable: " + String.join(", ", brief.unavailable), PocketDesign.SMALL, GRAY));
    }
    static String source(String kind) {
        switch (kind) { case "recovery": return "movement"; case "agenda": return "agenda"; case "task": return "task"; case "thought": return "thought"; case "training": return "gym"; case "note": return "note"; default: return "Pocket"; }
    }
    /** Resolve the current record at the moment of the tap; deleted facts cannot open an unrelated record. */
    static String openSource(Activity activity, DailyBrief.Fact fact) {
        try {
            Intent intent;
            switch (fact.kind) {
                case "recovery": intent = new Intent(activity, MovementActivity.class).putExtra("score", 0); break;
                case "agenda": {
                    AgendaStore.Event event = DailyBriefLocal.appointment(activity, fact.uid);
                    if (event == null) return "This appointment was removed.";
                    intent = new Intent(activity, AgendaActivity.class).putExtra("appointment_id", event.id); break;
                }
                case "task": {
                    if (fact.uid.isEmpty()) { intent = new Intent(activity, OrganizerActivity.class).putExtra("workspace_tab", "tasks"); break; }
                    PlannerStore.Entry task = DailyBriefLocal.task(activity, fact.uid);
                    if (task == null) return "This task was removed.";
                    intent = new Intent(activity, OrganizerActivity.class).putExtra("pocket_task", task.id); break;
                }
                case "thought": {
                    ParkingStore.Item thought = ParkingStore.find(activity, Long.parseLong(fact.uid));
                    if (thought == null || !thought.open()) return "This thought was already handled.";
                    intent = new Intent(activity, OrganizerActivity.class).putExtra("pocket_thought", thought.id); break;
                }
                case "training": {
                    if (!fact.uid.isEmpty() && GymStore.find(activity, fact.uid) == null) return "This workout was removed.";
                    intent = new Intent(activity, GymActivity.class);
                    if (!fact.uid.isEmpty()) intent.putExtra("pocket_workout", fact.uid);
                    break;
                }
                case "note": {
                    PlannerStore.Entry note = DailyBriefLocal.note(activity, fact.uid);
                    if (note == null) return "This note was removed.";
                    intent = new Intent(activity, OrganizerActivity.class).putExtra("pocket_note", note.id); break;
                }
                default: return "This source is unavailable.";
            }
            activity.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return null;
        } catch (RuntimeException unavailable) { return "This source is unavailable."; }
    }
    static void askPip(Activity activity, DailyBrief.Result brief) {
        activity.startActivity(new Intent(activity, MainActivity.class).putExtra("pocket_brief_context", brief.context).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }
}
