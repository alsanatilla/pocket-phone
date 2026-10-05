package org.textphone.launcher;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.OutputStream;

/** Publish only complete JPEGs to the native photo library; remove failed pending entries. */
final class PhotoStore {
    private PhotoStore() {}

    static Uri save(Context context, File jpeg, String name, int width, int height, long taken) throws IOException {
        ContentResolver resolver = context.getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, name);
        values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
        values.put(MediaStore.Images.Media.WIDTH, width);
        values.put(MediaStore.Images.Media.HEIGHT, height);
        values.put(MediaStore.Images.Media.DATE_TAKEN, taken);
        if (Build.VERSION.SDK_INT >= 29) {
            values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_DCIM + "/Pocket");
            values.put(MediaStore.Images.Media.IS_PENDING, 1);
        } else {
            File directory = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DCIM), "Pocket");
            if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Cannot create photo folder");
            values.put(MediaStore.Images.Media.DATA, new File(directory, name).getAbsolutePath());
        }
        Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new IOException("Photo library unavailable");
        try {
            try (FileInputStream input = new FileInputStream(jpeg);
                 OutputStream output = resolver.openOutputStream(uri, "w")) {
                if (output == null) throw new IOException("Cannot open photo file");
                byte[] buffer = new byte[65536];
                int length;
                while ((length = input.read(buffer)) != -1) output.write(buffer, 0, length);
                output.flush();
            }
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues published = new ContentValues();
                published.put(MediaStore.Images.Media.IS_PENDING, 0);
                if (resolver.update(uri, published, null, null) != 1) throw new IOException("Cannot publish photo");
            }
            CameraAlbum.record(context, uri, name, taken);
            return uri;
        } catch (IOException | RuntimeException failure) {
            try { resolver.delete(uri, null, null); }
            catch (RuntimeException cleanup) { failure.addSuppressed(cleanup); }
            throw failure;
        }
    }
}
