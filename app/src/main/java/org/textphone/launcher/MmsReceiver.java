package org.textphone.launcher;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.provider.Telephony;
import android.telephony.SmsManager;
import android.os.Build;

public final class MmsReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent intent) {
        if (!Telephony.Sms.Intents.WAP_PUSH_DELIVER_ACTION.equals(intent.getAction())) return;
        try { MmsCodec.Pdu pdu = MmsCodec.decode(intent.getByteArrayExtra("data"));
            if (pdu.type == 130 && pdu.location != null) download(c, pdu.location, intent.getIntExtra("android.telephony.extra.SUBSCRIPTION_INDEX", intent.getIntExtra("subscription", -1)), 0);
        } catch (RuntimeException e) { MessageAlerts.show(c, "MMS", "Carrier message could not be read."); }
    }
    static void download(Context c, String location, int subscription, long failedId) {
        Uri remote = Uri.parse(location); if (!"http".equals(remote.getScheme()) && !"https".equals(remote.getScheme())) throw new IllegalArgumentException("Invalid carrier URL.");
        Uri file = MmsFiles.uri(java.util.UUID.randomUUID().toString() + ".pdu");
        c.grantUriPermission("com.android.phone", file, Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        PendingIntent done = PendingIntent.getBroadcast(c, 0, new Intent(c, MmsDownloadReceiver.class).setData(file).putExtra("location", location)
                .putExtra("subscription", subscription).putExtra("failed_id", failedId), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        SmsManager manager = subscription < 0 ? SmsManager.getDefault() : Build.VERSION.SDK_INT >= 31 ? c.getSystemService(SmsManager.class).createForSubscriptionId(subscription) : SmsManager.getSmsManagerForSubscriptionId(subscription);
        manager.downloadMultimediaMessage(c, location, file, null, done);
    }
}
