package org.textphone.launcher;

import static org.junit.Assert.*;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Looper;
import android.os.PowerManager;
import android.os.Vibrator;
import java.io.IOException;
import java.time.Duration;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ServiceController;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowAlarmManager;
import org.robolectric.shadows.ShadowMediaPlayer;
import org.robolectric.shadows.ShadowVibrator;
import org.robolectric.shadows.util.DataSource;
import org.robolectric.util.ReflectionHelpers;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {24, 35})
public class AlarmReliabilityTest {
    private Context context; private ServiceController<AlarmService> controller; private AlarmService service; private Uri fallback;
    @Before public void setup() {
        context = RuntimeEnvironment.getApplication(); ClockStore.prefs(context).edit().clear().commit();
        fallback = Uri.parse("android.resource://" + context.getPackageName() + "/" + R.raw.pocket_alarm);
        ShadowMediaPlayer.addMediaInfo(DataSource.toDataSource(context, fallback), new ShadowMediaPlayer.MediaInfo(2000, 1));
        RingtoneManager.setActualDefaultRingtoneUri(context, RingtoneManager.TYPE_ALARM, null);
        Shadows.shadowOf(context.getSystemService(Vibrator.class)).setHasVibrator(true);
        ShadowAlarmManager.setCanScheduleExactAlarms(true);
        controller = Robolectric.buildService(AlarmService.class).create(); service = controller.get();
    }
    @After public void cleanup() { controller.destroy(); }
    private void ring() { assertEquals(Service.START_STICKY, service.onStartCommand(new Intent().putExtra("title", "Wake up").putExtra("id", 7L).putExtra("occurrence", 99L), 0, 1)); Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(10)); }
    private Intent command(String action, long occurrence) { return new Intent().setAction(action).putExtra("id", 7L).putExtra("occurrence", occurrence); }
    private MediaPlayer player() { return ReflectionHelpers.getField(service, "sound"); }
    @Test public void aMissingDefaultToneUsesTheBundledLoopAndAlarmAudioAttributes() {
        ring(); MediaPlayer player = player(); assertTrue(player.isPlaying()); assertTrue(player.isLooping());
        assertEquals(fallback, Shadows.shadowOf(player).getSourceUri()); assertEquals(AudioAttributes.USAGE_ALARM, Shadows.shadowOf(player).getAudioAttributes().getUsage());
        assertTrue(Shadows.shadowOf(context.getSystemService(Vibrator.class)).isVibrating());
        assertEquals(720, Shadows.shadowOf(service).getLastForegroundNotificationId());
    }
    @Test public void anUnreadableUserToneFallsBackWithoutStoppingTheAlarm() {
        Uri unreadable = Uri.parse("content://test.ringtones/missing"); RingtoneManager.setActualDefaultRingtoneUri(context, RingtoneManager.TYPE_ALARM, unreadable);
        ShadowMediaPlayer.addException(DataSource.toDataSource(context, unreadable), new IOException("Tone removed")); ring();
        assertEquals(fallback, Shadows.shadowOf(player()).getSourceUri()); assertTrue(player().isPlaying());
    }
    @Test public void aToneThatNeverPreparesTimesOutToTheBundledTone() {
        Uri stalled = Uri.parse("content://test.ringtones/stalled"); RingtoneManager.setActualDefaultRingtoneUri(context, RingtoneManager.TYPE_ALARM, stalled);
        ShadowMediaPlayer.addMediaInfo(DataSource.toDataSource(context, stalled), new ShadowMediaPlayer.MediaInfo(2000, -1)); ring();
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(5100));
        assertEquals(fallback, Shadows.shadowOf(player()).getSourceUri()); assertTrue(player().isPlaying());
    }
    @Test public void staleStopCannotSilenceANewerOccurrenceAndValidStopReleasesResources() {
        ring(); MediaPlayer first = player(); PowerManager.WakeLock awake = ReflectionHelpers.getField(service, "awake"); assertTrue(awake.isHeld());
        service.onStartCommand(command("STOP", 98), 0, 2); assertTrue(first.isPlaying()); assertFalse(Shadows.shadowOf(service).isStoppedBySelf());
        service.onStartCommand(command("STOP", 99), 0, 3);
        assertTrue(Shadows.shadowOf(service).isStoppedBySelf()); assertFalse(awake.isHeld()); assertNull(player());
        assertFalse(Shadows.shadowOf(context.getSystemService(Vibrator.class)).isVibrating()); assertFalse(ClockStore.prefs(context).contains("active_started"));
    }
    @Test @Config(sdk = 35) public void deniedSnoozeKeepsTheCurrentAlarmRingingAndCreatesNoSilentTimer() {
        ring(); ShadowAlarmManager.setCanScheduleExactAlarms(false); service.onStartCommand(command("SNOOZE", 99), 0, 2);
        assertTrue(player().isPlaying()); assertTrue(ClockStore.entries(context).isEmpty()); assertFalse(Shadows.shadowOf(service).isStoppedBySelf());
        assertTrue(ClockStore.prefs(context).getString("last_issue", "").contains("still ringing"));
    }
    @Test public void stickyRestartRestoresTheSameActiveAlarmWithoutExtendingItsStartTime() {
        ring(); long started = ClockStore.prefs(context).getLong("active_started", -1); controller.destroy();
        controller = Robolectric.buildService(AlarmService.class).create(); service = controller.get();
        assertEquals(Service.START_STICKY, service.onStartCommand(null, 0, 2)); Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(10));
        assertEquals(started, ClockStore.prefs(context).getLong("active_started", -2)); assertTrue(player().isPlaying());
        service.onStartCommand(command("STOP", 99), 0, 3); assertFalse(ClockStore.prefs(context).contains("active_started"));
    }
}
