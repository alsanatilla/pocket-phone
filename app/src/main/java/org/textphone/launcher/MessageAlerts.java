package org.textphone.launcher;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.content.pm.PackageManager;

final class MessageAlerts {
    static void show(Context c, String address, String text) {
        if (Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager manager = c.getSystemService(NotificationManager.class); if (manager == null) return;
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel("pocket_sms", "Messages", NotificationManager.IMPORTANCE_HIGH));
        int id = address == null ? 0 : address.hashCode(); PendingIntent open = PendingIntent.getActivity(c, id,
                new Intent(c, MessagesActivity.class).putExtra("address", address), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, "pocket_sms") : new Notification.Builder(c);
        manager.notify(id, builder.setSmallIcon(R.drawable.ic_launcher).setContentTitle(address == null ? "Message" : address).setContentText(text)
                .setCategory(Notification.CATEGORY_MESSAGE).setVisibility(Notification.VISIBILITY_PRIVATE).setContentIntent(open).setAutoCancel(true).build());
    }
}
