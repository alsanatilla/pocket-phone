package org.textphone.launcher;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.ContentValues;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;

public final class SmsReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_DELIVER_ACTION.equals(intent.getAction())) return;
        SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent); if (parts == null || parts.length == 0 || parts[0] == null) return;
        StringBuilder body = new StringBuilder(); for (SmsMessage part : parts) if (part != null) body.append(part.getMessageBody());
        ContentValues values = new ContentValues(); String sender = parts[0].getOriginatingAddress();
        values.put("address", sender); values.put("body", body.toString()); values.put("date", System.currentTimeMillis());
        values.put("date_sent", parts[0].getTimestampMillis()); values.put("read", 0); values.put("seen", 0);
        values.put("sub_id", intent.getIntExtra("android.telephony.extra.SUBSCRIPTION_INDEX", intent.getIntExtra("subscription", -1)));
        try { c.getContentResolver().insert(Telephony.Sms.Inbox.CONTENT_URI, values); MessageAlerts.show(c, sender, body.toString());
            c.sendBroadcast(new Intent("org.textphone.launcher.MESSAGES_CHANGED").setPackage(c.getPackageName())); }
        catch (SecurityException ignored) { /* Android revokes provider writes when the SMS role is removed. */ }
    }
}
