package org.textphone.launcher;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Photographed journal pages. The photo stays the original; the transcript is an index for search, thoughts and tasks.
 * Cloud document: {"v":1,"pages":[…]} with images as "page-&lt;uid&gt;.jpg" next to it. Mirrors docs/js/store.js.
 */
final class JournalStore {
    static final String WAITING = "waiting", READING = "reading", DONE = "done", FAILED = "failed";
    static final int STORE_EDGE = 2000, SEND_EDGE = 1568;
    private static final long KEEP_DELETED = 30L * 24 * 3_600_000L;
    private static final Object LOCK = new Object();
    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("pocket_journal", 0); }
    static File image(Context c, String uid) { File dir = new File(c.getFilesDir(), "journal"); dir.mkdirs(); return new File(dir, uid.replaceAll("[^a-zA-Z0-9-]", "") + ".jpg"); }

    static List<JSONObject> pages(Context c) {
        List<JSONObject> pages = new ArrayList<>();
        synchronized (LOCK) {
            try { JSONArray array = new JSONArray(prefs(c).getString("pages", "[]")); for (int i = 0; i < array.length(); i++) pages.add(array.getJSONObject(i)); }
            catch (JSONException ignored) { /* A damaged list reads as empty; photos stay on disk. */ }
        }
        return pages;
    }
    /** Newest first, without deleted pages. */
    static List<JSONObject> visible(Context c) {
        List<JSONObject> out = new ArrayList<>(); for (JSONObject p : pages(c)) if (!p.optBoolean("deleted")) out.add(p);
        java.util.Collections.sort(out, (a, b) -> Long.compare(b.optLong("created"), a.optLong("created"))); return out;
    }
    static JSONObject find(Context c, String uid) { for (JSONObject p : pages(c)) if (uid != null && uid.equals(p.optString("uid"))) return p; return null; }
    static JSONObject forNote(Context c, String noteUid) {
        if (noteUid == null) return null;
        for (JSONObject p : pages(c)) if (!p.optBoolean("deleted") && noteUid.equals(p.optString("note"))) return p;
        return null;
    }

    interface Change { void apply(JSONObject page) throws JSONException; }
    static JSONObject update(Context c, String uid, Change change) {
        synchronized (LOCK) {
            List<JSONObject> pages = pages(c);
            for (JSONObject p : pages) if (uid.equals(p.optString("uid"))) {
                try { change.apply(p); p.put("updated", System.currentTimeMillis()); } catch (JSONException e) { throw new IllegalStateException(e); }
                write(c, pages); return p;
            }
            throw new IllegalStateException("This page was removed.");
        }
    }
    static void delete(Context c, String uid) {
        update(c, uid, p -> { p.put("deleted", true); p.put("lines", new JSONArray()); p.put("groups", new JSONArray()); });
        image(c, uid).delete(); CloudSync.changed(c);
    }
    private static void write(Context c, List<JSONObject> pages) {
        JSONArray array = new JSONArray(); for (JSONObject p : pages) array.put(p);
        if (!prefs(c).edit().putString("pages", array.toString()).commit()) throw new IllegalStateException("Could not save the page.");
    }

    /** Takes a photo file, turns it upright, scales it and keeps it as a new page waiting to be read. */
    static String add(Context c, File photo) throws IOException {
        Bitmap upright = upright(photo, STORE_EDGE); String uid = UUID.randomUUID().toString();
        try (FileOutputStream out = new FileOutputStream(image(c, uid))) { if (!upright.compress(Bitmap.CompressFormat.JPEG, 85, out)) throw new IOException("Could not save the photo."); }
        finally { upright.recycle(); }
        long now = System.currentTimeMillis();
        synchronized (LOCK) {
            List<JSONObject> pages = pages(c);
            try { pages.add(new JSONObject().put("uid", uid).put("created", now).put("updated", now).put("state", WAITING).put("title", "").put("lines", new JSONArray()).put("groups", new JSONArray())); }
            catch (JSONException e) { throw new IllegalStateException(e); }
            write(c, pages);
        }
        return uid;
    }
    /** The page photo as the JPEG Claude reads: long edge 1568 px, Claude's sweet spot for image tokens. */
    static byte[] forReading(Context c, String uid) throws IOException {
        Bitmap bitmap = upright(image(c, uid), SEND_EDGE); ByteArrayOutputStream out = new ByteArrayOutputStream();
        try { bitmap.compress(Bitmap.CompressFormat.JPEG, 85, out); } finally { bitmap.recycle(); }
        return out.toByteArray();
    }
    static Bitmap upright(File file, int edge) throws IOException {
        BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true; BitmapFactory.decodeFile(file.getPath(), bounds);
        if (bounds.outWidth <= 0) throw new IOException("This is not a photo Pocket can read.");
        BitmapFactory.Options options = new BitmapFactory.Options(); options.inSampleSize = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / (options.inSampleSize * 2) >= edge) options.inSampleSize *= 2;
        Bitmap decoded = BitmapFactory.decodeFile(file.getPath(), options); if (decoded == null) throw new IOException("This is not a photo Pocket can read.");
        int rotation; switch (new ExifInterface(file.getPath()).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
            case ExifInterface.ORIENTATION_ROTATE_90: rotation = 90; break;
            case ExifInterface.ORIENTATION_ROTATE_180: rotation = 180; break;
            case ExifInterface.ORIENTATION_ROTATE_270: rotation = 270; break;
            default: rotation = 0;
        }
        float scale = Math.min(1f, edge / (float) Math.max(decoded.getWidth(), decoded.getHeight()));
        if (rotation == 0 && scale == 1f) return decoded;
        Matrix matrix = new Matrix(); matrix.postScale(scale, scale); matrix.postRotate(rotation);
        Bitmap out = Bitmap.createBitmap(decoded, 0, 0, decoded.getWidth(), decoded.getHeight(), matrix, true);
        if (out != decoded) decoded.recycle(); return out;
    }

    /** Whether any page waits to be read, including pages uploaded from the web. */
    static boolean unread(Context c) { for (JSONObject p : visible(c)) if (WAITING.equals(p.optString("state"))) return true; return false; }

    /** Images upload once; a local flag that never syncs remembers which ones are in Drive. */
    static boolean uploaded(Context c, String uid) { return prefs(c).getBoolean("uploaded_" + uid, false); }
    static void markUploaded(Context c, String uid) { prefs(c).edit().putBoolean("uploaded_" + uid, true).apply(); }

    /** Per page, the later edit wins; deleted pages stay as markers for 30 days. Local-only fields never leave the phone. */
    static JSONObject merge(Context c, JSONObject remote) throws JSONException {
        synchronized (LOCK) {
            JSONArray local = new JSONArray(prefs(c).getString("pages", "[]"));
            JSONArray merged = SyncMerge.byId(local, remote == null ? null : remote.optJSONArray("pages"), "uid", "updated");
            List<JSONObject> kept = new ArrayList<>(); long now = System.currentTimeMillis();
            for (int i = 0; i < merged.length(); i++) { JSONObject p = merged.getJSONObject(i); kept.add(p); }
            write(c, kept);
            JSONArray out = new JSONArray(); for (JSONObject p : kept) out.put(p);
            return new JSONObject().put("v", 1).put("pages", out);
        }
    }
    private JournalStore() { }
}
