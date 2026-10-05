package org.textphone.launcher;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public final class AlarmReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent intent) {
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || "android.intent.action.LOCKED_BOOT_COMPLETED".equals(action) || Intent.ACTION_TIME_CHANGED.equals(action) || Intent.ACTION_TIMEZONE_CHANGED.equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action) || "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED".equals(action)) {
            if (Intent.ACTION_BOOT_COMPLETED.equals(action) || "android.intent.action.LOCKED_BOOT_COMPLETED".equals(action)) {
                if (Intent.ACTION_BOOT_COMPLETED.equals(action)) c.getSharedPreferences("pocket_stopwatch", 0).edit().putBoolean("running", false).apply();
                for (ClockStore.Entry e : ClockStore.entries(c)) if (e.enabled && "timer".equals(e.kind) && (Build.VERSION.SDK_INT < 24 || e.boot != ClockStore.boot(c))) {
                    e.elapsed = android.os.SystemClock.elapsedRealtime() + e.due - System.currentTimeMillis(); e.boot = ClockStore.boot(c); ClockStore.save(c, e);
                }
            }
            AlarmScheduler.restore(c, Intent.ACTION_TIME_CHANGED.equals(action) || Intent.ACTION_TIMEZONE_CHANGED.equals(action)); return;
        }
        ClockStore.Entry e = ClockStore.find(c, intent.getLongExtra("id", 0)); if (e == null || !e.enabled) return;
        if (intent.hasExtra("due") && intent.getLongExtra("due", 0) != e.due) return;
        long occurrence = e.due;
        if (e.daily) { e.due = ClockStore.nextTime(e.hour, e.minute, System.currentTimeMillis()); ClockStore.save(c, e);
            try { if (AlarmScheduler.allowed(c)) AlarmScheduler.arm(c, e); }
            catch (RuntimeException error) { ClockStore.prefs(c).edit().putString("last_issue", "The next daily alarm could not be scheduled. Review exact-alarm access.").commit(); }
        }
        else { e.enabled = false; e.remaining = 0; ClockStore.save(c, e); }
        Intent ringing = new Intent(c, AlarmService.class).putExtra("title", e.title).putExtra("id", e.id).putExtra("occurrence", occurrence).putExtra("task",e.task);
        try { if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(ringing); else c.startService(ringing); }
        catch (RuntimeException failure) { AlarmService.missed(c, e.title); }
    }
}
