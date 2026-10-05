package org.textphone.launcher;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;

/** Foreground ringing with a local fallback tone and commands tied to one alarm occurrence. */
public final class AlarmService extends Service {
    private static final long RING_LIMIT = 600000;
    private final Handler handler = new Handler();
    private final AudioManager.OnAudioFocusChangeListener focusListener = change -> {};
    private MediaPlayer sound; private PowerManager.WakeLock awake; private AudioFocusRequest focus;
    private Vibrator vibrator; private Runnable soundTimeout;
    private String title = "Alarm"; private long alarmId, occurrence, started,taskId;
    private boolean active, fallback;
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        boolean command = intent != null && ("STOP".equals(intent.getAction()) || "SNOOZE".equals(intent.getAction()));
        if (command) {
            if (!active && ClockStore.prefs(this).contains("active_started")) onStartCommand(null, flags, startId);
            if (!active || intent.getLongExtra("id", -1) != alarmId || intent.getLongExtra("occurrence", -1) != occurrence) {
                if (!active) stopSelf(); return active ? START_STICKY : START_NOT_STICKY;
            }
            if ("SNOOZE".equals(intent.getAction())) {
                try {
                    synchronized(ClockStore.class){ClockStore.Entry original=ClockStore.find(this,alarmId);if(taskId>0&&(original==null||original.task!=taskId)){end();return START_NOT_STICKY;}
                    ClockStore.Entry e = new ClockStore.Entry();e.task=taskId;e.id=taskId>0?alarmId:0;e.kind=taskId>0?original.kind:"timer"; e.title = title; e.enabled = true;
                    e.due = System.currentTimeMillis() + 300000; e.elapsed = SystemClock.elapsedRealtime() + 300000; e.boot = ClockStore.boot(this);
                    AlarmScheduler.saveAndArm(this, e);
                    }
                } catch (RuntimeException error) { issue("Snooze could not be scheduled. The alarm is still ringing."); return START_STICKY; }
            }
            end(); return START_NOT_STICKY;
        }
        if (intent == null) {
            SharedPreferences p = ClockStore.prefs(this); started = p.getLong("active_started", -1);
            if (p.getInt("active_boot", -1) != ClockStore.boot(this) || started < 0 || SystemClock.elapsedRealtime() < started
                    || SystemClock.elapsedRealtime() - started >= RING_LIMIT) { end(); return START_NOT_STICKY; }
            alarmId = p.getLong("active_id", 0); occurrence = p.getLong("active_occurrence", 0); title = p.getString("active_title", "Alarm");taskId=p.getLong("active_task",0);
        } else {
            long nextId = intent.getLongExtra("id", 0), nextOccurrence = intent.getLongExtra("occurrence", 0);
            ClockStore.Entry requested=ClockStore.find(this,nextId);if(intent.getLongExtra("task",0)>0&&(requested==null||requested.task!=intent.getLongExtra("task",0)||requested.due!=nextOccurrence)){if(!active)stopSelf();return active?START_STICKY:START_NOT_STICKY;}
            if (active && alarmId == nextId && occurrence == nextOccurrence) return START_STICKY;
            alarmId = nextId; occurrence = nextOccurrence; title = intent.getStringExtra("title"); if (title == null || title.isEmpty()) title = "Alarm";
            ClockStore.Entry record=ClockStore.find(this,alarmId);taskId=record==null?0:record.task;
            ReceiptTape.log(this, ReceiptTape.ALARM, title);
            started = SystemClock.elapsedRealtime();
        }
        release(); active = true; fallback = false;
        ClockStore.prefs(this).edit().putLong("active_id", alarmId).putLong("active_occurrence", occurrence)
                .putString("active_title", title).putLong("active_started", started).putLong("active_task",taskId).putInt("active_boot", ClockStore.boot(this)).commit();
        channel(this); startForeground(720, notification("Alarm · Pocket"));
        long remaining = Math.max(1, RING_LIMIT - (SystemClock.elapsedRealtime() - started));
        PowerManager power = getSystemService(PowerManager.class);
        if (power != null) { awake = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Pocket:alarm"); awake.acquire(remaining + 30000); }
        AudioAttributes attrs = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
        AudioManager audio = getSystemService(AudioManager.class);
        if (audio != null) {
            if (Build.VERSION.SDK_INT >= 26) { focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(attrs).setOnAudioFocusChangeListener(focusListener).build(); audio.requestAudioFocus(focus); }
            else audio.requestAudioFocus(focusListener, AudioManager.STREAM_ALARM, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
        }
        if (ClockStore.prefs(this).getBoolean("vibrate", true)) {
            vibrator = getSystemService(Vibrator.class);
            if (vibrator != null && vibrator.hasVibrator()) { long[] pattern = {0, 500, 250, 500, 1000};
                if (Build.VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0), attrs); else vibrator.vibrate(pattern, 0, attrs); }
        }
        Uri tone; try { tone = android.media.RingtoneManager.getActualDefaultRingtoneUri(this, android.media.RingtoneManager.TYPE_ALARM); } catch (RuntimeException unavailable) { tone = null; }
        play(tone, attrs); handler.postDelayed(this::end, remaining); return START_STICKY;
    }
    private void play(Uri tone, AudioAttributes attrs) {
        if (!active) return;
        if (soundTimeout != null) handler.removeCallbacks(soundTimeout);
        if (sound != null) { sound.release(); sound = null; }
        if (tone == null) { fallback = true; tone = Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.pocket_alarm); }
        MediaPlayer player = new MediaPlayer(); sound = player;
        try {
            player.setAudioAttributes(attrs); player.setLooping(true);
            player.setOnPreparedListener(prepared -> {
                if (!active || sound != prepared) return; if (soundTimeout != null) handler.removeCallbacks(soundTimeout);
                try { prepared.start(); } catch (RuntimeException failure) { failedSound(prepared, attrs); }
            });
            player.setOnErrorListener((failed, what, extra) -> { failedSound(failed, attrs); return true; });
            player.setDataSource(this, tone);
            soundTimeout = () -> { if (active && sound == player) failedSound(player, attrs); }; handler.postDelayed(soundTimeout, 5000);
            player.prepareAsync();
        } catch (Exception failure) { failedSound(player, attrs); }
    }
    private void failedSound(MediaPlayer failed, AudioAttributes attrs) {
        if (!active || failed != sound) return;
        if (!fallback) { fallback = true; play(Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.pocket_alarm), attrs); }
        else { issue("Alarm sound could not play. Check alarm volume and sound settings.");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) try { manager.notify(720, notification("Sound unavailable · open Clock settings")); }
            catch (SecurityException denied) { /* The retained Clock issue remains readable without alert access. */ } }
    }
    private Notification notification(String message) {
        Intent target = new Intent(this, RingingActivity.class).putExtra("title", title).putExtra("id", alarmId).putExtra("occurrence", occurrence)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent open = PendingIntent.getActivity(this, 720, target, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, "pocket_alarm") : new Notification.Builder(this);
        return builder.setSmallIcon(R.drawable.ic_launcher).setContentTitle(title).setContentText(message).setVisibility(Notification.VISIBILITY_PRIVATE)
                .setCategory(Notification.CATEGORY_ALARM).setPriority(Notification.PRIORITY_MAX).setOngoing(true).setContentIntent(open).setFullScreenIntent(open, true)
                .addAction(new Notification.Action.Builder(null, "Stop", command("STOP")).build())
                .addAction(new Notification.Action.Builder(null, "+5 min", command("SNOOZE")).build()).build();
    }
    private PendingIntent command(String action) {
        Intent intent = new Intent(this, AlarmService.class).setAction(action).setData(Uri.parse("pocket:alarm-command/" + alarmId + "/" + occurrence + "/" + action))
                .putExtra("id", alarmId).putExtra("occurrence", occurrence);
        return PendingIntent.getService(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    private static void channel(Context c) {
        NotificationManager manager = c.getSystemService(NotificationManager.class);
        if (manager != null && Build.VERSION.SDK_INT >= 26) { NotificationChannel channel = new NotificationChannel("pocket_alarm", "Alarms and timers", NotificationManager.IMPORTANCE_HIGH); channel.setSound(null, null); manager.createNotificationChannel(channel); }
    }
    static void missed(Context c, String title) {
        String message = "Missed alarm · " + title;
        ClockStore.prefs(c).edit().putString("last_issue", message).commit(); channel(c);
        NotificationManager manager = c.getSystemService(NotificationManager.class); if (manager == null) return;
        PendingIntent open = PendingIntent.getActivity(c, 721, new Intent(c, ClockActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, "pocket_alarm") : new Notification.Builder(c);
        try { manager.notify(721, builder.setSmallIcon(R.drawable.ic_launcher).setContentTitle(message).setContentText("Open Clock to review.").setContentIntent(open).setAutoCancel(true).build()); }
        catch (SecurityException ignored) { /* Clock retains the issue even if Android blocks alerts. */ }
    }
    private void issue(String text) { ClockStore.prefs(this).edit().putString("last_issue", text).commit(); }
    private void end() { active = false; release(); ClockStore.prefs(this).edit().remove("active_id").remove("active_occurrence").remove("active_title").remove("active_started").remove("active_task").remove("active_boot").commit(); stopSelf(); }
    private void release() {
        handler.removeCallbacksAndMessages(null); soundTimeout = null;
        if (sound != null) { sound.release(); sound = null; }
        if (vibrator != null) vibrator.cancel(); vibrator = null;
        if (awake != null && awake.isHeld()) awake.release(); awake = null;
        AudioManager audio = getSystemService(AudioManager.class); if (audio != null) {
            if (Build.VERSION.SDK_INT >= 26 && focus != null) audio.abandonAudioFocusRequest(focus); else audio.abandonAudioFocus(focusListener);
        } focus = null;
    }
    @Override public void onDestroy() { release(); stopForeground(true); super.onDestroy(); }
}
