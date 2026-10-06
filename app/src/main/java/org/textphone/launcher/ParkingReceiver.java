package org.textphone.launcher;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import java.util.List;

/** Brings parked items back. Inexact delivery is fine here, so no exact-alarm access is needed. */
public final class ParkingReceiver extends BroadcastReceiver {
    static final String ACTION_DUE = "org.textphone.launcher.PARKING_DUE";
    private static final int NOTICE = 9301;

    /** An optional review time invites a decision; it never creates a task. */
    @Override public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction()) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) CorosJob.ensure(context);
        if (ACTION_DUE.equals(intent.getAction())) notice(context);
        arm(context);
    }
    private static PendingIntent pending(Context c) {
        return PendingIntent.getBroadcast(c, 0, new Intent(c, ParkingReceiver.class).setAction(ACTION_DUE),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    /** One wake-up for the earliest open item; each delivery arms the next. */
    static void arm(Context c) {
        try {
            AlarmManager alarms = c.getSystemService(AlarmManager.class); if (alarms == null) return;
            long next = ParkingStore.nextDue(c, System.currentTimeMillis());
            if (next == 0) alarms.cancel(pending(c)); else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pending(c));
        } catch (RuntimeException ignored) { /* The list still shows what is back the next time it opens. */ }
    }
    static void notice(Context c) {
        NotificationManager manager = c.getSystemService(NotificationManager.class); if (manager == null) return;
        List<ParkingStore.Item> open = ParkingStore.open(c); long now = System.currentTimeMillis();
        int back = 0; ParkingStore.Item first = null;
        for (ParkingStore.Item item : open) if (item.back(now + 60_000)) { back++; if (first == null) first = item; }
        if (first == null) { manager.cancel(NOTICE); return; }
        if (Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel("pocket_parking", "Thought review", NotificationManager.IMPORTANCE_DEFAULT));
        PendingIntent show = PendingIntent.getActivity(c, 0, new Intent(c, ParkingActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, "pocket_parking") : new Notification.Builder(c);
        manager.notify(NOTICE, builder.setSmallIcon(R.drawable.ic_launcher)
                .setContentTitle(back == 1 ? "A thought to revisit" : back + " thoughts to revisit")
                .setContentText(first.text)
                .setCategory(Notification.CATEGORY_REMINDER).setVisibility(Notification.VISIBILITY_PRIVATE)
                .setContentIntent(show).setAutoCancel(true).build());
    }
    static void clearNotice(Context c) { NotificationManager manager = c.getSystemService(NotificationManager.class); if (manager != null) manager.cancel(NOTICE); }
}
