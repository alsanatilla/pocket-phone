package org.textphone.launcher;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;

/** Shows the real access/binding state and takes the user to Android's controls. */
public final class NotificationSetupActivity extends PocketActivity {
    private boolean registered;
    private final BroadcastReceiver updates = new BroadcastReceiver() { public void onReceive(Context c, Intent i) { render(); } };
    @android.annotation.SuppressLint("UnspecifiedRegisterReceiverFlag")
    @Override protected void onStart() { super.onStart(); IntentFilter filter = new IntentFilter(PhoneNotifications.ACTION_UPDATED);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(updates, filter, Context.RECEIVER_NOT_EXPORTED); else registerReceiver(updates, filter); registered = true; }
    @Override protected void onResume() { super.onResume(); NotificationAccess.connect(this); render(); }
    @Override protected void onStop() { if (registered) { unregisterReceiver(updates); registered = false; } super.onStop(); }
    private void render() {
        screen("notifications"); boolean allowed = NotificationAccess.allowed(this);
        body.addView(label(allowed ? PhoneNotifications.connected() ? "Connected to Android" : "Access allowed · waiting for Android" : "Notification access is off", 17, WHITE));
        body.addView(label("To show other apps' notifications in Pocket, Android must allow its notification reader. This can include bank notices and codes.", 13, GRAY));
        action(allowed ? "Open notification access" : "Enable notification access", () -> NotificationAccess.settings(this));
        action("refresh connection", () -> { NotificationAccess.connect(this); render(); });
        body.addView(label("WhatsApp keeps receiving messages through its installed app. Pocket can show active messages and reply when WhatsApp offers that action; earlier conversations stay in WhatsApp.",16,GRAY));
        if(getPackageManager().getLaunchIntentForPackage("com.whatsapp")!=null)action("WhatsApp notification settings",()->{
            if(Build.VERSION.SDK_INT>=26)startActivity(new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,"com.whatsapp"));
            else startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,android.net.Uri.parse("package:com.whatsapp")));});
        body.addView(label("Android says Restricted setting?", 17, WHITE));
        body.addView(label("Open app info → ⋮ → Allow restricted settings, if available. Then return here and enable notification access. Android requires you to approve it; Pocket cannot turn it on itself.", 13, GRAY));
        action("open app info", () -> NotificationAccess.appInfo(this));
        body.addView(label("Allow notifications is different: it lets Pocket post its own alerts. It does not unlock the reader.", 13, GRAY));
        if (allowed && PhoneNotifications.connected()) {
            action("show test notification", () -> { if (Build.VERSION.SDK_INT >= 33) permissions(this::test, Manifest.permission.POST_NOTIFICATIONS); else test(); });
            action("view notifications", () -> startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("pocket_screen", "notifications")));
        }
        body.addView(label("Only active notifications appear. Dismissed notices are not stored; Android may hide protected content.", 13, GRAY));
    }
    private void test() {
        NotificationManager manager = getSystemService(NotificationManager.class); if (manager == null) { message("Android notification service unavailable."); return; }
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel("pocket_access_test", "Pocket setup", NotificationManager.IMPORTANCE_DEFAULT));
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, "pocket_access_test") : new Notification.Builder(this);
        PendingIntent open = PendingIntent.getActivity(this, 6010, new Intent(this, MainActivity.class).putExtra("pocket_screen", "notifications"), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        manager.notify("pocket-access-test", 6010, builder.setSmallIcon(R.drawable.ic_launcher).setContentTitle("Pocket test").setContentText("This is a local notification for checking setup.").setAutoCancel(true).setContentIntent(open).build());
        message("Test posted. Open View notifications to check it.");
    }
}
