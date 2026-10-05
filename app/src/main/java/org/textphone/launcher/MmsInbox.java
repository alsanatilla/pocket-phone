package org.textphone.launcher;

import android.content.Context;
import android.net.Uri;
import android.provider.Telephony;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;
import java.io.FileOutputStream;

/** Received MMS are kept locally; the SMS provider remains the source for SMS. */
final class MmsInbox {
    private static JSONArray entries(Context c) throws Exception { return new JSONArray(c.getSharedPreferences("pocket_mms", 0).getString("entries", "[]")); }
    private static void write(Context c, JSONArray values) { if (!c.getSharedPreferences("pocket_mms", 0).edit().putString("entries", values.toString()).commit()) throw new IllegalStateException("MMS could not save."); }
    static synchronized List<MessageBook.Message> messages(Context c, long thread) {
        List<MessageBook.Message> result = new ArrayList<>(); try { JSONArray all = entries(c); for (int i = 0; i < all.length(); i++) {
            JSONObject o = all.getJSONObject(i); if (thread != 0 && o.getLong("thread") != thread) continue;
            MessageBook.Message m = new MessageBook.Message(); m.id = o.getLong("id"); m.thread = o.getLong("thread"); m.address = o.getString("address");
            m.text = o.getString("text"); m.type = Telephony.Sms.MESSAGE_TYPE_INBOX; m.date = o.getLong("date"); m.read = o.optBoolean("read");
            m.retry = o.optString("retry", null); m.subscription = o.optInt("subscription", -1);
            JSONArray files = o.optJSONArray("files"); if (files != null && files.length() > 0) { m.attachment = files.getJSONObject(0).getString("uri"); m.mime = files.getJSONObject(0).getString("mime"); }
            result.add(m);
            if (thread != 0 && files != null) for (int n = 1; n < files.length(); n++) { MessageBook.Message extra = new MessageBook.Message();
                extra.id = m.id; extra.thread = m.thread; extra.address = m.address; extra.date = m.date; extra.type = m.type; extra.read = m.read;
                extra.text = "Attachment " + (n + 1); extra.attachment = files.getJSONObject(n).getString("uri"); extra.mime = files.getJSONObject(n).getString("mime"); result.add(extra); }
        } } catch (Exception e) { throw new IllegalStateException("MMS data unavailable.", e); } return result;
    }
    static synchronized void save(Context c, MmsCodec.Pdu pdu, String retry, int subscription, long replace) throws Exception {
        JSONObject o = new JSONObject(); long id = Math.max(System.currentTimeMillis(), c.getSharedPreferences("pocket_mms", 0).getLong("last_id", 0) + 1);
        String address = pdu.from.isEmpty() ? "Unknown sender" : pdu.from;
        o.put("id", id).put("thread", Telephony.Threads.getOrCreateThreadId(c, address)).put("address", address).put("text", pdu.text.isEmpty() ? "MMS" : pdu.text)
                .put("date", System.currentTimeMillis()).put("read", false).put("retry", retry).put("subscription", subscription);
        JSONArray files = new JSONArray(); int n = 0; for (MmsCodec.Part part : pdu.parts) {
            if ("text/plain".equals(part.mime) || "application/smil".equals(part.mime)) continue;
            String extension = "image/jpeg".equals(part.mime) ? "jpg" : "image/png".equals(part.mime) ? "png" : "image/gif".equals(part.mime) ? "gif" : "bin";
            Uri uri = MmsFiles.uri(id + "-" + n++ + "." + extension); try (FileOutputStream output = new FileOutputStream(MmsFiles.file(c, uri))) { output.write(part.data); }
            c.getSharedPreferences("pocket_mms_types", 0).edit().putString(uri.toString(), part.mime).commit(); files.put(new JSONObject().put("uri", uri.toString()).put("mime", part.mime));
        }
        o.put("files", files); JSONArray all = entries(c); all.put(o); write(c, all); c.getSharedPreferences("pocket_mms", 0).edit().putLong("last_id", id).commit();
        if (replace != 0) delete(c, replace); MessageAlerts.show(c, address, o.getString("text"));
    }
    static synchronized void markRead(Context c, long thread) { try { JSONArray all = entries(c); boolean changed = false; for (int i = 0; i < all.length(); i++) if (all.getJSONObject(i).getLong("thread") == thread && !all.getJSONObject(i).optBoolean("read")) { all.getJSONObject(i).put("read", true); changed = true; } if (changed) write(c, all); } catch (Exception e) { throw new IllegalStateException(e); } }
    static synchronized void delete(Context c, long id) { try { JSONArray all = entries(c), next = new JSONArray(); for (int i = 0; i < all.length(); i++) {
        JSONObject o = all.getJSONObject(i); if (o.getLong("id") != id) next.put(o); else { JSONArray files = o.optJSONArray("files"); if (files != null) for (int n = 0; n < files.length(); n++) {
            Uri uri = Uri.parse(files.getJSONObject(n).getString("uri")); MmsFiles.file(c, uri).delete(); c.getSharedPreferences("pocket_mms_types", 0).edit().remove(uri.toString()).apply(); } }
    } write(c, next); } catch (Exception e) { throw new IllegalStateException(e); } }
}
