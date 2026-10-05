package org.textphone.launcher;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ActivityNotFoundException;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;

/** Opens Android consent screens; it cannot grant or bypass restricted access. */
final class NotificationAccess {
    static ComponentName component(Context c) { return new ComponentName(c, PhoneNotifications.class); }
    static boolean allowed(Context c) {
        NotificationManager manager = c.getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 27 && manager != null) return manager.isNotificationListenerAccessGranted(component(c));
        String enabled = Settings.Secure.getString(c.getContentResolver(), "enabled_notification_listeners");
        if (enabled != null) for (String item : enabled.split(":")) if (component(c).equals(ComponentName.unflattenFromString(item))) return true;
        return false;
    }
    static void connect(Context c) { if (Build.VERSION.SDK_INT >= 24 && allowed(c) && !PhoneNotifications.connected())
        try { NotificationListenerService.requestRebind(component(c)); } catch (SecurityException | IllegalStateException ignored) { } }
    static void settings(Activity a) {
        if (Build.VERSION.SDK_INT >= 30) try { a.startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
                .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, component(a).flattenToString())); return; }
            catch (ActivityNotFoundException | SecurityException ignored) { }
        a.startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
    }
    static void appInfo(Activity a) { a.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + a.getPackageName()))); }
}
