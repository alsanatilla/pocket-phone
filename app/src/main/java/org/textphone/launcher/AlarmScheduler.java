package org.textphone.launcher;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;

final class AlarmScheduler {
    static boolean allowed(Context c) { AlarmManager a = c.getSystemService(AlarmManager.class); return a != null && (Build.VERSION.SDK_INT < 31 || a.canScheduleExactAlarms()); }
    private static PendingIntent pending(Context c, long id, long due) { return PendingIntent.getBroadcast(c, 0,
            new Intent(c, AlarmReceiver.class).setData(Uri.parse("pocket:alarm/" + id)).putExtra("id", id).putExtra("due", due), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE); }
    static void saveAndArm(Context c, ClockStore.Entry e) {
        ClockStore.Entry previous = e.id == 0 ? null : ClockStore.find(c, e.id);
        ClockStore.save(c, e);
        try { arm(c, e); }
        catch (RuntimeException error) {
            if (previous == null) ClockStore.delete(c, e.id); else ClockStore.save(c, previous);
            throw new IllegalStateException("Alarm was not scheduled. Check exact-alarm access and try again.", error);
        }
    }
    static void arm(Context c, ClockStore.Entry e) {
        if (!e.enabled) { cancel(c, e.id); return; }
        if (!allowed(c)) throw new IllegalArgumentException("Allow exact alarms in Clock settings.");
        AlarmManager manager = c.getSystemService(AlarmManager.class);
        if ("timer".equals(e.kind)) {
            long trigger = e.boot == ClockStore.boot(c) && e.elapsed > 0 ? e.elapsed : SystemClock.elapsedRealtime() + Math.max(0, e.due - System.currentTimeMillis());
            manager.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, trigger, pending(c, e.id, e.due));
        } else {
            PendingIntent show = PendingIntent.getActivity(c, 0, new Intent(c, ClockActivity.class).setData(Uri.parse("pocket:clock/" + e.id)), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            manager.setAlarmClock(new AlarmManager.AlarmClockInfo(e.due, show), pending(c, e.id, e.due));
        }
    }
    static void cancel(Context c, long id) { AlarmManager a = c.getSystemService(AlarmManager.class); if (a != null) a.cancel(pending(c, id, 0)); }
    static void restore(Context c, boolean timeChanged) {
        for (ClockStore.Entry e : ClockStore.entries(c)) {
            if (!e.enabled) continue;
            if ("alarm".equals(e.kind) && timeChanged) { e.due = ClockStore.nextTime(e.hour, e.minute, System.currentTimeMillis()); ClockStore.save(c, e); }
            else if (ClockStore.remaining(c, e) == 0 && ClockStore.lateness(c, e) > 300000) {
                AlarmService.missed(c, e.title);
                if ("alarm".equals(e.kind) && e.daily) e.due = ClockStore.nextTime(e.hour, e.minute, System.currentTimeMillis());
                else { e.enabled = false; e.remaining = 0; ClockStore.save(c, e); continue; }
                ClockStore.save(c, e);
            }
            if (allowed(c)) arm(c, e);
        }
    }
}
