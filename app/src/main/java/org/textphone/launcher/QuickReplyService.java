package org.textphone.launcher;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import android.telephony.SubscriptionManager;

/** Android's reject-call-with-SMS contract. No third-party messenger is opened. */
public final class QuickReplyService extends Service {
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public int onStartCommand(Intent intent, int flags, int id) {
        if (intent != null && intent.getData() != null && intent.getStringExtra(Intent.EXTRA_TEXT) != null) {
            String address = intent.getData().getSchemeSpecificPart(); int q = address.indexOf('?'); if (q >= 0) address = address.substring(0, q);
            try { MessageBook.send(this, address, intent.getStringExtra(Intent.EXTRA_TEXT), android.os.Build.VERSION.SDK_INT >= 24 ? SubscriptionManager.getDefaultSmsSubscriptionId() : SubscriptionManager.INVALID_SUBSCRIPTION_ID); }
            catch (RuntimeException e) { MessageAlerts.show(this, address, "Reply could not be sent."); }
        } stopSelf(id); return START_NOT_STICKY;
    }
}
