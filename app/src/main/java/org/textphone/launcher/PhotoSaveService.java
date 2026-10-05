package org.textphone.launcher;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/** Keeps an accepted photo write alive while Home is visible; no work without an explicit capture. */
public final class PhotoSaveService extends Service {
    private static final AtomicLong serial = new AtomicLong();
    private static final java.util.Set<Long> pending = java.util.Collections.newSetFromMap(new ConcurrentHashMap<Long, Boolean>());
    private static volatile PhotoSaveService instance;
    private PowerManager.WakeLock awake;
    static long begin(Context context) {
        long token = serial.incrementAndGet(); pending.add(token);
        try { Intent intent = new Intent(context, PhotoSaveService.class);
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent); else context.startService(intent);
            return token;
        } catch (RuntimeException blocked) { pending.remove(token); return 0; }
    }
    static void finish(long token) {
        pending.remove(token);
        new Handler(Looper.getMainLooper()).post(() -> { PhotoSaveService service = instance; if (service != null && pending.isEmpty()) service.stopSelf(); });
    }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onCreate() { super.onCreate(); instance = this; }
    @Override public int onStartCommand(Intent intent, int flags, int id) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26 && manager != null) { NotificationChannel channel = new NotificationChannel("pocket_photo_save", "Saving photos", NotificationManager.IMPORTANCE_LOW); channel.setSound(null, null); manager.createNotificationChannel(channel); }
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, "pocket_photo_save") : new Notification.Builder(this);
        startForeground(722, builder.setSmallIcon(R.drawable.ic_launcher).setContentTitle("Saving photo").setContentText("Pocket Camera").setOngoing(true).setOnlyAlertOnce(true).setPriority(Notification.PRIORITY_LOW).build());
        if (pending.isEmpty()) { stopSelf(); return START_NOT_STICKY; }
        PowerManager power = getSystemService(PowerManager.class);
        if (power != null) { if (awake == null) { awake = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Pocket:photo-save"); awake.setReferenceCounted(false); } awake.acquire(120000); }
        return START_NOT_STICKY;
    }
    @Override public void onDestroy() { if (awake != null && awake.isHeld()) awake.release(); if (instance == this) instance = null; stopForeground(true); super.onDestroy(); }
}
