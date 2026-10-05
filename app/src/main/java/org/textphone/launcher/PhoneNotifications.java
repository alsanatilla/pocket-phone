package org.textphone.launcher;

import android.content.Intent;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

/** Notifications are read only after the user explicitly enables Android notification access. */
public final class PhoneNotifications extends NotificationListenerService {
    static final String ACTION_UPDATED = "org.textphone.launcher.NOTIFICATIONS_UPDATED";
    private static volatile PhoneNotifications listener;

    static boolean connected() { return listener != null; }

    static StatusBarNotification[] active() {
        PhoneNotifications current = listener;
        if (current == null) return new StatusBarNotification[0];
        try {
            StatusBarNotification[] result = current.getActiveNotifications();
            return result == null ? new StatusBarNotification[0] : result;
        } catch (SecurityException | IllegalStateException ignored) {
            return new StatusBarNotification[0];
        }
    }

    static boolean dismiss(String key) {
        PhoneNotifications current = listener; if (current == null) return false;
        try {
            for (StatusBarNotification notice : active()) if (notice.getKey().equals(key) && notice.isClearable()) {
                current.cancelNotification(key); return true;
            }
        } catch (SecurityException | IllegalStateException ignored) { return false; }
        return false;
    }

    private void updated() {
        sendBroadcast(new Intent(ACTION_UPDATED).setPackage(getPackageName()));
    }

    @Override public void onListenerConnected() { listener = this; updated(); }
    @Override public void onListenerDisconnected() { listener = null; updated(); }
    @Override public void onNotificationPosted(StatusBarNotification notice) { updated(); }
    @Override public void onNotificationRemoved(StatusBarNotification notice) { updated(); }
    @Override public void onDestroy() { if (listener == this) listener = null; super.onDestroy(); }
}
