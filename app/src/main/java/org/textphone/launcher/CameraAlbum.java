package org.textphone.launcher;

import android.content.ContentUris;
import android.content.Context;
import android.database.Cursor;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.util.ArrayList;
import java.util.List;

/** Only Camera2 captures published by Pocket; no SAF grants or general library access. */
final class CameraAlbum {
    static final class Photo { Uri uri; String name; long taken; }
    private static final String INDEX = "camera_photos";
    static synchronized void record(Context c, Uri uri, String name, long taken) {
        try {
            JSONArray old = new JSONArray(c.getSharedPreferences("pocket_camera", 0).getString(INDEX, "[]"));
            JSONArray items = new JSONArray(); items.put(new JSONObject().put("uri", uri.toString()).put("name", name).put("taken", taken));
            for (int i = 0; i < old.length() && items.length() < 5000; i++) { JSONObject item = old.getJSONObject(i); if (!uri.toString().equals(item.optString("uri"))) items.put(item); }
            c.getSharedPreferences("pocket_camera", 0).edit().putString(INDEX, items.toString()).putString("last_photo", uri.toString()).commit();
        } catch (org.json.JSONException ignored) { /* MediaStore still retains the successfully published capture. */ }
    }
    static List<Photo> list(Context c) throws Exception {
        List<Photo> photos = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 29) {
            // The MediaStore owner column also finds captures from previous Pocket versions.
            String selection = "(" + MediaStore.Images.Media.RELATIVE_PATH + " = ? OR " + MediaStore.Images.Media.RELATIVE_PATH + " = ?) AND "
                    + MediaStore.MediaColumns.OWNER_PACKAGE_NAME + " = ? AND mime_type = ? AND is_pending = 0 AND _display_name LIKE ?";
            try (Cursor rows = c.getContentResolver().query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    new String[]{"_id", "_display_name", "datetaken"}, selection,
                    new String[]{"DCIM/Pocket/", "DCIM/Pocket", c.getPackageName(), "image/jpeg", "DSC_%"}, "datetaken DESC, _id DESC")) {
                if (rows == null) throw new java.io.IOException("Photo album unavailable");
                while (rows.moveToNext() && photos.size() < 2000) { Photo p = new Photo(); p.uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, rows.getLong(0));
                    p.name = rows.isNull(1) ? "Photo" : rows.getString(1); p.taken = rows.getLong(2); photos.add(p); }
            }
        } else {
            // Legacy Android lacks MediaStore ownership. Read only our private capture index.
            JSONArray index = new JSONArray(c.getSharedPreferences("pocket_camera", 0).getString(INDEX, "[]"));
            for (int i = 0; i < index.length() && photos.size() < 2000; i++) { JSONObject item = index.getJSONObject(i); Uri uri = Uri.parse(item.getString("uri"));
                if (!mediaUri(uri)) continue;
                try (Cursor row = c.getContentResolver().query(uri, new String[]{"_id", "_display_name", "mime_type"}, null, null, null)) {
                    if (row != null && row.moveToFirst() && "image/jpeg".equals(row.getString(2))) { Photo p = new Photo(); p.uri = uri; p.name = row.getString(1); p.taken = item.optLong("taken"); photos.add(p); }
                }
            }
            // Recover the old last-photo link only if its native file identifies Pocket's camera.
            String last = c.getSharedPreferences("pocket_camera", 0).getString("last_photo", null);
            boolean indexedLast = false; for (Photo p : photos) if (p.uri.toString().equals(last)) indexedLast = true;
            if (last != null && !indexedLast) { Uri uri = Uri.parse(last);
                if (mediaUri(uri)) try (Cursor row = c.getContentResolver().query(uri, new String[]{"_data", "_display_name", "datetaken"}, null, null, null)) {
                    if (row != null && row.moveToFirst() && row.getString(0) != null) { File photo = new File(row.getString(0));
                        File folder = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DCIM), "Pocket");
                        if (folder.getCanonicalFile().equals(photo.getCanonicalFile().getParentFile()) && "Pocket".equals(new ExifInterface(photo.getAbsolutePath()).getAttribute(ExifInterface.TAG_MAKE))) {
                            Photo p = new Photo(); p.uri = uri; p.name = row.getString(1); p.taken = row.getLong(2); photos.add(p);
                        }
                    }
                }
            }
            java.util.Collections.sort(photos, (a, b) -> Long.compare(b.taken, a.taken));
        }
        return photos;
    }
    static boolean mediaUri(Uri uri) { return "content".equals(uri.getScheme()) && "media".equals(uri.getAuthority())
            && uri.getPath() != null && uri.getPath().matches("/[a-zA-Z0-9_]+/images/media/[0-9]+"); }
}
