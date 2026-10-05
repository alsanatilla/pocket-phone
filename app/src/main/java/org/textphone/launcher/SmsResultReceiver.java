package org.textphone.launcher;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.ContentValues;
import android.provider.Telephony;
import org.json.JSONArray;

public final class SmsResultReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent intent) {
        if (intent.getData() == null) return;
        android.content.SharedPreferences prefs = c.getSharedPreferences("pocket_sms_results", 0);
        try {
            JSONArray states = new JSONArray(prefs.getString(intent.getData().toString(), "[]")); int part = intent.getIntExtra("part", -1);
            if (part < 0 || part >= states.length() || states.getInt(part) != -1) return;
            states.put(part, getResultCode() == Activity.RESULT_OK ? 0 : 1); boolean complete = true, failed = false;
            for (int i = 0; i < states.length(); i++) { complete &= states.getInt(i) != -1; failed |= states.getInt(i) == 1; }
            if (failed || complete) { ContentValues values = new ContentValues(); values.put("type", failed ? Telephony.Sms.MESSAGE_TYPE_FAILED : Telephony.Sms.MESSAGE_TYPE_SENT);
                c.getContentResolver().update(intent.getData(), values, null, null); }
            if (complete) prefs.edit().remove(intent.getData().toString()).commit(); else prefs.edit().putString(intent.getData().toString(), states.toString()).commit();
            c.sendBroadcast(new Intent("org.textphone.launcher.MESSAGES_CHANGED").setPackage(c.getPackageName()));
        } catch (org.json.JSONException | SecurityException ignored) { /* Never report success when receipt persistence fails. */ }
    }
}
