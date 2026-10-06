package org.textphone.launcher;

import android.Manifest;
import android.app.TimePickerDialog;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.provider.Settings;
import android.text.InputType;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.TextView;
import java.util.Calendar;
import java.util.Locale;

public final class ClockActivity extends PocketActivity {
    private String page = "alarms"; private TextView counter, wallClock;
    private final java.util.Map<TextView, ClockStore.Entry> countdowns = new java.util.LinkedHashMap<>();
    private int requestedSeconds, chosenHour, chosenMinute; private String requestedTitle = "Focus"; private boolean editingAlarm;
    private EditText alarmTitle; private CheckBox alarmDaily; private long editingAlarmId;
    private EditText timerMinutes, timerLabel; private String minutesDraft = "25", timerLabelDraft = "";
    private String renderedEntries;
    private final java.util.ArrayDeque<String> pageTrail=new java.util.ArrayDeque<>();
    private String rootClockPage="alarms";
    private void changePage(String destination) {
        if(destination.equals(page))return;
        if(pageTrail.size()==12)pageTrail.removeFirst();pageTrail.addLast(page);page=destination;render();
    }
    private final Runnable tick = new Runnable() { @Override public void run() { if (closed) return;
        if (counter != null && "stopwatch".equals(page)) setCounter(counter, duration(stopwatchMillis()));
        if (wallClock != null) setCounter(wallClock, new java.text.SimpleDateFormat("HH:mm", Locale.getDefault()).format(new java.util.Date()));
        for (java.util.Map.Entry<TextView, ClockStore.Entry> item : countdowns.entrySet()) { ClockStore.Entry e = item.getValue(); setCounter(item.getKey(), duration(ClockStore.remaining(ClockActivity.this, e)) + "  " + e.title); }
        ui.postDelayed(this, 250); } };
    private static void setCounter(TextView view, String value) { if (!value.contentEquals(view.getText())) view.setText(value); }
    private String entriesRevision() { return ClockStore.prefs(this).getString("entries", ""); }
    @Override protected void onCreate(Bundle state) { super.onCreate(state); page = state == null ? "alarms" : state.getString("page", "alarms"); if (state != null) { minutesDraft = state.getString("minutes_draft", "25"); timerLabelDraft = state.getString("timer_label", ""); }
        if(state!=null&&state.getStringArrayList("clock_page_trail")!=null)pageTrail.addAll(state.getStringArrayList("clock_page_trail"));
        requestedSeconds = state == null ? getIntent().getIntExtra("seconds", 0) : state.getInt("requested_seconds");
        requestedTitle = state == null ? getIntent().getStringExtra("title") : state.getString("requested_title"); if (requestedTitle == null) requestedTitle = "Focus";
        rootClockPage=state!=null?state.getString("clock_root_page","alarms"):requestedSeconds>0?"timer":"alarms";
        if(state==null&&requestedSeconds>0)page="timer";
        if (state != null && state.getBoolean("editing_alarm")) alarmForm(state.getInt("hour"), state.getInt("minute"), state.getString("alarm_title", "Alarm"), state.getBoolean("daily"),state.getLong("alarm_id"));
        else { render(); if (requestedSeconds > 0) ui.post(() -> ready(this::startRequested)); }
    }
    @Override protected void onResume() { super.onResume(); if (!editingAlarm && ("setup".equals(page) || !entriesRevision().equals(renderedEntries))) render(); ui.removeCallbacks(tick); ui.post(tick); }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); if (intent.hasExtra("seconds")) {
        requestedSeconds = intent.getIntExtra("seconds", 0); requestedTitle = intent.getStringExtra("title"); if (requestedTitle == null) requestedTitle = "Focus";pageTrail.clear();rootClockPage=page="timer";render();ready(this::startRequested);
    } }
    @Override protected void onPause() { ui.removeCallbacks(tick); super.onPause(); }
    @Override protected void onSaveInstanceState(Bundle out) { out.putString("page", page); out.putInt("requested_seconds", requestedSeconds); out.putString("requested_title", requestedTitle);
        out.putStringArrayList("clock_page_trail",new java.util.ArrayList<>(pageTrail));out.putString("clock_root_page",rootClockPage);
        if (timerMinutes != null) out.putString("minutes_draft", timerMinutes.getText().toString()); else out.putString("minutes_draft", minutesDraft);
        out.putString("timer_label",timerLabel==null?timerLabelDraft:timerLabel.getText().toString());
        out.putBoolean("editing_alarm", editingAlarm); if (editingAlarm) { out.putLong("alarm_id",editingAlarmId); out.putInt("hour", chosenHour); out.putInt("minute", chosenMinute); out.putString("alarm_title", alarmTitle.getText().toString()); out.putBoolean("daily", alarmDaily.isChecked()); } super.onSaveInstanceState(out); }
    private void startRequested() { int seconds = requestedSeconds; String title = requestedTitle; if (seconds < 1) return; requestedSeconds = 0; timer(seconds, title); }
    private void ready(Runnable action) {
        if (Build.VERSION.SDK_INT >= 33 && !permitted(Manifest.permission.POST_NOTIFICATIONS)) { permissions(() -> ready(action), Manifest.permission.POST_NOTIFICATIONS); return; }
        if (!AlarmScheduler.allowed(this)) { message("Allow exact alarms, then tap again."); startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, android.net.Uri.parse("package:" + getPackageName()))); return; }
        action.run();
    }
    private void render() { if (timerMinutes != null) minutesDraft = timerMinutes.getText().toString(); if(timerLabel!=null)timerLabelDraft=timerLabel.getText().toString(); timerMinutes = timerLabel = null;
        editingAlarm = false; screen("clock", "clock:" + page); counter = wallClock = null; countdowns.clear(); renderedEntries = entriesRevision();
        int selected="alarms".equals(page)?0:"timer".equals(page)?1:"stopwatch".equals(page)?2:-1;
        tabs(new String[]{"alarms", "timer", "stopwatch"}, selected, () -> changePage("alarms"), () -> changePage("timer"), () -> changePage("stopwatch"));
        if ("setup".equals(page)) { setup(); return; }appSettings(()->changePage("setup"));
        if (requestedSeconds > 0) action("start " + requestedSeconds / 60 + " min", () -> ready(this::startRequested));
        if ("stopwatch".equals(page)) { stopwatch(); return; }
        if ("timer".equals(page)) {
            EditText minutes = input("Minutes", InputType.TYPE_CLASS_NUMBER); minutes.setText(minutesDraft); minutes.setTag("timer_minutes"); timerMinutes = minutes;
            keys(new String[]{"5 min","25 min","50 min"},()->{minutes.setText("5");minutes.setSelection(minutes.length());},()->{minutes.setText("25");minutes.setSelection(minutes.length());},()->{minutes.setText("50");minutes.setSelection(minutes.length());});
            timerLabel=input("Timer label (optional)",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);timerLabel.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(200)});timerLabel.setText(timerLabelDraft);timerLabel.setTag("timer_label");
            action("start timer", () -> { int value; try { value = Integer.parseInt(minutes.getText().toString()); } catch (NumberFormatException e) { throw new IllegalArgumentException("Enter minutes."); }
                if (value < 1 || value > 1440) throw new IllegalArgumentException("Use 1 to 1440 minutes.");String label=timerLabel.getText().toString().trim();ready(() -> timer(value * 60,label.isEmpty()?"Timer":label)); });
        } else {
            wallClock = label(new java.text.SimpleDateFormat("HH:mm", Locale.getDefault()).format(new java.util.Date()), 40, WHITE); body.addView(wallClock);
            commands(body, new String[]{"+ alarm", "agenda"}, 0, this::alarmEditor, () -> startActivity(new Intent(this, AgendaActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)));
        }
        boolean listed = false;
        for (ClockStore.Entry e : ClockStore.entries(this)) {
            if (!page.equals("timer".equals(e.kind) ? "timer" : "alarms")) continue;
            if (!listed) { section("timer".equals(page) ? "running" : "alarms"); listed = true; }
            String when = "timer".equals(e.kind) ? duration(ClockStore.remaining(this, e)) : new java.text.SimpleDateFormat("HH:mm", Locale.getDefault()).format(new java.util.Date(e.due));
            String kind = "task".equals(e.kind) ? " · task" : "reminder".equals(e.kind) ? " · appointment" : "";
            android.widget.LinearLayout row = ReadableRows.item(this, when + "  " + e.title, (e.enabled ? "on" : "off") + (e.daily ? " · daily" : "") + kind, GRAY,
                    "clock_entry_" + e.id, "alarm".equals(e.kind) ? () -> alarmForm(e.hour, e.minute, e.title, e.daily, e.id) : null);
            TextView title = (TextView) row.getChildAt(0); if (!e.enabled) title.setTextColor(GRAY);
            body.addView(row, new android.widget.LinearLayout.LayoutParams(-1, -2));
            if ("alarm".equals(e.kind)) row.setContentDescription("Edit alarm · " + when + " · " + e.title + (e.enabled ? " · on" : " · off"));
            if ("timer".equals(e.kind)) countdowns.put(title, e);
            commands(body, new String[]{e.enabled ? "pause" : "resume", "delete"}, -1, () -> {
                if (e.enabled) { e.remaining = ClockStore.remaining(this, e); e.enabled = false; ClockStore.save(this, e); AlarmScheduler.cancel(this, e.id); render(); }
                else ready(() -> { if ("timer".equals(e.kind) && e.remaining <= 0) { message("This timer has finished."); return; }
                    if ("task".equals(e.kind)) { if(e.due<=System.currentTimeMillis()){message("Open the task to choose a future reminder time.");return;}TaskReminders.set(this,e.task,e.due);render();return; }
                    if ("reminder".equals(e.kind) && e.due <= System.currentTimeMillis()) { message("Edit the appointment to choose a future time."); return; }
                    e.enabled = true; if ("timer".equals(e.kind)) {
                    e.due = System.currentTimeMillis() + e.remaining; e.elapsed = SystemClock.elapsedRealtime() + e.remaining; e.boot = ClockStore.boot(this);
                } else if ("alarm".equals(e.kind)) e.due = ClockStore.nextTime(e.hour, e.minute, System.currentTimeMillis());
                    AlarmScheduler.saveAndArm(this, e); render(); });
            }, () -> { ClockStore.delete(this, e.id); AlarmScheduler.cancel(this, e.id); render(); });
        }
    }
    private void alarmEditor() { Calendar now = Calendar.getInstance(); new TimePickerDialog(this, (picker, hour, minute) -> alarmForm(hour, minute, "Alarm", false), now.get(Calendar.HOUR_OF_DAY), now.get(Calendar.MINUTE), true).show(); }
    private void alarmForm(int hour,int minute,String savedTitle,boolean savedDaily){alarmForm(hour,minute,savedTitle,savedDaily,0);}
    private void alarmForm(int hour, int minute, String savedTitle, boolean savedDaily,long id) {
        editingAlarm = true; editingAlarmId=id; chosenHour = hour; chosenMinute = minute; screen(id==0?"new alarm":"edit alarm"); counter=wallClock=null;countdowns.clear();alarmTitle = input("Label", InputType.TYPE_CLASS_TEXT); alarmTitle.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(200)}); alarmTitle.setText(savedTitle);alarmTitle.setTag("alarm_title");
        android.widget.Button time=action(String.format(Locale.getDefault(),"%02d:%02d",chosenHour,chosenMinute),()->new TimePickerDialog(this,(picker,h,m)->{chosenHour=h;chosenMinute=m;((TextView)body.findViewWithTag("alarm_time")).setText(String.format(Locale.getDefault(),"%02d:%02d",h,m));},chosenHour,chosenMinute,true).show());time.setTag("alarm_time");time.setContentDescription("Change alarm time");time.setTextSize(PocketDesign.typeSize(this,30));
        alarmDaily = new CheckBox(this); alarmDaily.setText("Daily"); PocketDesign.text(alarmDaily, PocketDesign.BODY, WHITE); alarmDaily.setMinHeight(dp(PocketDesign.CONTROL)); alarmDaily.setChecked(savedDaily); body.addView(alarmDaily);
        android.widget.Button save = action("save", () -> {ClockStore.Entry existing=editingAlarmId==0?null:ClockStore.find(this,editingAlarmId);if(editingAlarmId!=0&&existing==null){message("This alarm was removed. Return to the alarm list.");return;}Runnable commit=()->{ClockStore.Entry e = new ClockStore.Entry();e.id=editingAlarmId; e.kind = "alarm"; e.enabled = existing==null||existing.enabled; e.daily = alarmDaily.isChecked(); e.title = alarmTitle.getText().toString().trim();
            if (e.title.isEmpty()) e.title = "Alarm"; e.hour = chosenHour; e.minute = chosenMinute; e.due = ClockStore.nextTime(e.hour, e.minute, System.currentTimeMillis()); AlarmScheduler.saveAndArm(this, e); page = "alarms"; render(); };if(existing!=null&&!existing.enabled)commit.run();else ready(commit);}); PocketDesign.primary(save);
    }
    private void timer(int seconds, String title) { if (seconds < 1 || seconds > 86400) throw new IllegalArgumentException("Invalid duration.");
        ClockStore.Entry e = new ClockStore.Entry(); e.kind = "timer"; e.title = title; e.enabled = true; e.due = System.currentTimeMillis() + seconds * 1000L;
        e.elapsed = SystemClock.elapsedRealtime() + seconds * 1000L; e.boot = ClockStore.boot(this); AlarmScheduler.saveAndArm(this, e); page = "timer"; render(); }
    private void setup() {
        android.app.NotificationManager alerts = getSystemService(android.app.NotificationManager.class);
        android.media.AudioManager audio = getSystemService(android.media.AudioManager.class);
        body.addView(label(AlarmScheduler.allowed(this) ? "Exact alarms · allowed" : "Exact alarms · off", 16, WHITE));
        if (!AlarmScheduler.allowed(this) && Build.VERSION.SDK_INT >= 31) action("allow exact alarms", () -> startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, android.net.Uri.parse("package:"+getPackageName()))));
        boolean visible = alerts != null && (Build.VERSION.SDK_INT < 24 || alerts.areNotificationsEnabled());
        if (Build.VERSION.SDK_INT >= 26 && alerts != null) { android.app.NotificationChannel channel = alerts.getNotificationChannel("pocket_alarm"); visible &= channel == null || channel.getImportance() != android.app.NotificationManager.IMPORTANCE_NONE; }
        body.addView(label(visible ? "Alarm alerts · allowed" : "Alarm alerts · off", 16, WHITE));
        action("alarm alert settings", () -> startActivity(new Intent(Build.VERSION.SDK_INT >= 26 ? Settings.ACTION_APP_NOTIFICATION_SETTINGS : Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()).setData(Build.VERSION.SDK_INT >= 26 ? null : android.net.Uri.parse("package:"+getPackageName()))));
        if (audio != null) body.addView(label("Alarm volume · " + audio.getStreamVolume(android.media.AudioManager.STREAM_ALARM) + " / " + audio.getStreamMaxVolume(android.media.AudioManager.STREAM_ALARM), 16, WHITE));
        action("volume / sound", () -> startActivity(new Intent(Settings.ACTION_SOUND_SETTINGS)));
        if (Build.VERSION.SDK_INT >= 34 && alerts != null) {
            body.addView(label(alerts.canUseFullScreenIntent() ? "Lock-screen alarm popup · allowed" : "Lock-screen popup · off; use notification controls", 14, GRAY));
            action("allow alarm popup", () -> startActivity(new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, android.net.Uri.parse("package:"+getPackageName()))));
        }
        action(ClockStore.prefs(this).getBoolean("vibrate", true) ? "Vibration · on" : "Vibration · off", () -> { ClockStore.prefs(this).edit().putBoolean("vibrate", !ClockStore.prefs(this).getBoolean("vibrate", true)).commit(); render(); });
        body.addView(label("Test the real alarm. After tapping, lock the screen and wait ten seconds.", 14, GRAY));
        action("test alarm · 10 seconds", () -> ready(() -> timer(10, "Test alarm"))).setTag("test_alarm");
        String issue = ClockStore.prefs(this).getString("last_issue", "");
        if (!issue.isEmpty()) { body.addView(label(issue, 14, GRAY)); action("clear last issue", () -> { ClockStore.prefs(this).edit().remove("last_issue").commit(); render(); }); }
    }
    static String duration(long value) { long seconds = value / 1000; return String.format(Locale.getDefault(), "%02d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60); }
    private long stopwatchMillis() { android.content.SharedPreferences p = getSharedPreferences("pocket_stopwatch", 0); long total = p.getLong("total", 0);
        if (p.getBoolean("running", false) && p.getInt("boot", -1) == ClockStore.boot(this)) total += Math.max(0, SystemClock.elapsedRealtime() - p.getLong("start", SystemClock.elapsedRealtime())); return total; }
    private void stopwatch() { android.content.SharedPreferences p = getSharedPreferences("pocket_stopwatch", 0);
        if (p.getInt("boot", -1) != ClockStore.boot(this)) p.edit().putBoolean("running", false).apply();
        counter = label(duration(stopwatchMillis()), 36, WHITE); body.addView(counter);
        keys(new String[]{p.getBoolean("running", false) ? "pause" : "start", "reset"}, () -> {
            if (p.getBoolean("running", false)) p.edit().putLong("total", stopwatchMillis()).putBoolean("running", false).apply();
            else p.edit().putLong("start", SystemClock.elapsedRealtime()).putInt("boot", ClockStore.boot(this)).putBoolean("running", true).apply(); render();
        }, () -> { p.edit().clear().apply(); render(); });
        action("lap", () -> { String lap = duration(stopwatchMillis()) + "\n" + p.getString("laps", ""); p.edit().putString("laps", lap.substring(0, Math.min(2400, lap.length()))).apply(); render(); });
        body.addView(label(p.getString("laps", ""), 15, GRAY));
    }
    @Override protected boolean hasInternalBack() { return editingAlarm || !pageTrail.isEmpty() || !rootClockPage.equals(page); }
    @Override protected String backPageKey(String rootPage) { return "clock:"+(editingAlarm?page:pageTrail.isEmpty()?rootClockPage:pageTrail.peekLast()); }
    @Override public void onBackPressed() { if (hasInternalBack()) back(() -> { if(!editingAlarm)page=pageTrail.isEmpty()?rootClockPage:pageTrail.removeLast(); render(); }); else super.onBackPressed(); }
}
