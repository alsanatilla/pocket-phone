package org.textphone.launcher;

import android.content.Context;
import android.content.ContentValues;
import android.content.ContentUris;
import android.database.Cursor;
import android.net.Uri;
import android.provider.Telephony;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** Shared Android MMS storage, so changing the default SMS app retains messages. */
final class NativeMms {
    static void save(Context c, MmsCodec.Pdu pdu, int subscription) throws Exception {
        String sender = pdu.from.isEmpty() ? "Unknown sender" : pdu.from;
        ContentValues values = new ContentValues(); values.put("thread_id", Telephony.Threads.getOrCreateThreadId(c, sender));
        values.put("date", System.currentTimeMillis() / 1000); values.put("msg_box", 1); values.put("m_type", 132); values.put("v", 18);
        values.put("ct_t", "application/vnd.wap.multipart.related"); values.put("read", 0); values.put("seen", 0); values.put("sub_id", subscription);
        values.put("sub", pdu.subject); values.put("sub_cs", 106);
        Uri message = c.getContentResolver().insert(Telephony.Mms.CONTENT_URI, values); if (message == null) throw new java.io.IOException("MMS could not save.");
        boolean complete = false;
        try {
            ContentValues address = new ContentValues(); address.put("address", sender); address.put("charset", 106); address.put("type", 137);
            if (c.getContentResolver().insert(message.buildUpon().appendPath("addr").build(), address) == null) throw new java.io.IOException("MMS address could not save.");
            int index = 0; for (MmsCodec.Part part : pdu.parts) { ContentValues item = new ContentValues(); item.put("ct", part.mime); item.put("seq", index++); item.put("chset", 106);
                item.put("cl", "part-" + index); item.put("cid", "<part-" + index + ">");
                boolean text = "text/plain".equals(part.mime) || "application/smil".equals(part.mime);
                if (text) item.put("text", new String(part.data, StandardCharsets.UTF_8));
                Uri uri = c.getContentResolver().insert(message.buildUpon().appendPath("part").build(), item); if (uri == null) throw new java.io.IOException("MMS part could not save.");
                if (!text) try (OutputStream output = c.getContentResolver().openOutputStream(uri, "wt")) { if (output == null) throw new java.io.IOException(); output.write(part.data); }
            }
            complete = true;
        } finally { if (!complete) c.getContentResolver().delete(message, null, null); }
    }
    static List<MessageBook.Message> messages(Context c, long thread) {
        List<MessageBook.Message> result = new ArrayList<>();
        try (Cursor rows = c.getContentResolver().query(Telephony.Mms.CONTENT_URI, new String[]{"_id", "thread_id", "date", "msg_box", "read"},
                thread == 0 ? null : "thread_id = ?", thread == 0 ? null : new String[]{Long.toString(thread)}, "date DESC")) {
            if (rows != null) while (rows.moveToNext() && result.size() < 300) {
                MessageBook.Message m = new MessageBook.Message(); m.id = rows.getLong(0); m.thread = rows.getLong(1); m.date = rows.getLong(2) * 1000;
                m.type = rows.getInt(3); m.read = rows.getInt(4) != 0; m.uri = ContentUris.withAppendedId(Telephony.Mms.CONTENT_URI, m.id); m.address = "MMS";
                try (Cursor from = c.getContentResolver().query(m.uri.buildUpon().appendPath("addr").build(), new String[]{"address"}, "type = ?", new String[]{m.type == 1 ? "137" : "151"}, null)) {
                    if (from != null && from.moveToFirst()) m.address = from.getString(0);
                }
                StringBuilder text = new StringBuilder(); List<String[]> attachments = new ArrayList<>();
                try (Cursor parts = c.getContentResolver().query(m.uri.buildUpon().appendPath("part").build(), new String[]{"_id", "ct", "text"}, null, null, "seq ASC")) {
                    if (parts != null) while (parts.moveToNext()) { String mime = parts.getString(1);
                        if ("text/plain".equals(mime)) { if (parts.getString(2) != null) text.append(parts.getString(2)).append('\n'); }
                        else if (!"application/smil".equals(mime)) attachments.add(new String[]{"content://mms/part/" + parts.getLong(0), mime});
                    }
                }
                m.text = text.length() == 0 ? "MMS" : text.toString().trim();
                if (!attachments.isEmpty()) { m.attachment = attachments.get(0)[0]; m.mime = attachments.get(0)[1]; } result.add(m);
                if (thread != 0) for (int i = 1; i < attachments.size(); i++) { MessageBook.Message extra = new MessageBook.Message(); extra.id = m.id; extra.thread = m.thread;
                    extra.date = m.date; extra.type = m.type; extra.read = m.read; extra.uri = m.uri; extra.address = m.address;
                    extra.text = "Attachment " + (i + 1); extra.attachment = attachments.get(i)[0]; extra.mime = attachments.get(i)[1]; result.add(extra); }
            }
        } return result;
    }
    static void markRead(Context c, long thread) { ContentValues values = new ContentValues(); values.put("read", 1); values.put("seen", 1);
        c.getContentResolver().update(Telephony.Mms.CONTENT_URI, values, "thread_id = ? AND read = 0", new String[]{Long.toString(thread)}); }
}
