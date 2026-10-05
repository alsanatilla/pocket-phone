package org.textphone.launcher;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.Telephony;
import android.telephony.SmsManager;
import android.telephony.SubscriptionManager;
import android.os.Build;
import android.app.PendingIntent;
import android.content.Intent;
import org.json.JSONArray;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class MessageBook {
    static final class Message { long id, thread, date; String address, text, attachment, mime, retry; int type, subscription; boolean read; Uri uri; }
    static List<Message> sms(Context c, long thread) {
        List<Message> result = new ArrayList<>();
        try (Cursor cursor = c.getContentResolver().query(Telephony.Sms.CONTENT_URI,
                new String[]{"_id", "thread_id", "address", "body", "date", "type", "read"}, thread == 0 ? null : "thread_id = ?",
                thread == 0 ? null : new String[]{Long.toString(thread)}, "date DESC")) {
            if (cursor != null) while (cursor.moveToNext() && result.size() < (thread == 0 ? 1000 : 300)) {
                Message m = new Message(); m.id = cursor.getLong(0); m.thread = cursor.getLong(1); m.address = cursor.getString(2); m.text = cursor.getString(3);
                m.date = cursor.getLong(4); m.type = cursor.getInt(5); m.read = cursor.getInt(6) != 0; m.uri = android.content.ContentUris.withAppendedId(Telephony.Sms.CONTENT_URI, m.id); result.add(m);
            }
        }
        result.addAll(NativeMms.messages(c, thread)); result.addAll(MmsInbox.messages(c, thread)); java.util.Collections.sort(result, (a, b) -> Long.compare(b.date, a.date)); return result;
    }
    static List<Message> conversations(Context c) { Map<Long, Message> result = new LinkedHashMap<>(); for (Message m : sms(c, 0)) {
        if (!result.containsKey(m.thread)) result.put(m.thread, m); else if (!m.read) result.get(m.thread).read = false;
    } return new ArrayList<>(result.values()); }
    static long send(Context c, String address, String text, int subscription) {
        if (address.trim().isEmpty() || text.trim().isEmpty()) throw new IllegalArgumentException("Enter a recipient and message.");
        if (text.length() > 4000) throw new IllegalArgumentException("Message is too long.");
        SmsManager manager = subscription == SubscriptionManager.INVALID_SUBSCRIPTION_ID ? SmsManager.getDefault()
                : Build.VERSION.SDK_INT >= 31 ? c.getSystemService(SmsManager.class).createForSubscriptionId(subscription) : SmsManager.getSmsManagerForSubscriptionId(subscription);
        ArrayList<String> parts = manager.divideMessage(text); if (parts.isEmpty()) throw new IllegalArgumentException("Empty message.");
        ContentValues values = new ContentValues(); values.put("address", address.trim()); values.put("body", text); values.put("date", System.currentTimeMillis());
        values.put("type", Telephony.Sms.MESSAGE_TYPE_OUTBOX); values.put("read", 1); values.put("sub_id", subscription);
        long thread = Telephony.Threads.getOrCreateThreadId(c, address.trim()); values.put("thread_id", thread);
        Uri uri = c.getContentResolver().insert(Telephony.Sms.CONTENT_URI, values); if (uri == null) throw new IllegalStateException("Message could not be saved.");
        JSONArray states = new JSONArray(); for (int i = 0; i < parts.size(); i++) states.put(-1);
        c.getSharedPreferences("pocket_sms_results", 0).edit().putString(uri.toString(), states.toString()).commit();
        ArrayList<PendingIntent> sent = new ArrayList<>(); for (int i = 0; i < parts.size(); i++) sent.add(PendingIntent.getBroadcast(c, i,
                new Intent(c, SmsResultReceiver.class).setData(uri).putExtra("part", i), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        try { manager.sendMultipartTextMessage(address.trim(), null, parts, sent, null); }
        catch (RuntimeException failure) { ContentValues failed = new ContentValues(); failed.put("type", Telephony.Sms.MESSAGE_TYPE_FAILED); c.getContentResolver().update(uri, failed, null, null); throw failure; }
        return thread;
    }
}
