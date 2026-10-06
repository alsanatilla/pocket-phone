package org.textphone.launcher;

import android.content.Context;
import android.graphics.Bitmap;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.Build;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Image work continues off the UI thread if the user returns to Home while a photo is saving. */
final class PhotoWriter {
    interface Callback { void saved(Uri uri, Bitmap thumbnail); void failed(String message); }
    private static final ExecutorService WORK = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "Pocket photo"); thread.setDaemon(true); return thread;
    });
    private PhotoWriter() {}

    static void save(Context context, YuvFrame frame, CameraProfile profile, CameraFormat format, int rotation,
                     CompactProcessor.Conditions scene, long taken, Callback callback) {
        Context application = context.getApplicationContext();
        Handler ui = new Handler(Looper.getMainLooper());
        long lease = PhotoSaveService.begin(application);
        WORK.execute(() -> {
            File temporary = null;
            Bitmap photo = null;
            Uri published = null;
            try {
                photo = CompactProcessor.process(frame.bitmap(), profile, format, rotation, scene,
                        frame.timestamp ^ System.nanoTime());
                temporary = File.createTempFile("pocket-shot-", ".jpg", application.getCacheDir());
                try (FileOutputStream output = new FileOutputStream(temporary)) {
                    if (!photo.compress(Bitmap.CompressFormat.JPEG, format.quality.jpeg(profile), output))
                        throw new IOException("JPEG encoding failed");
                }
                addMetadata(temporary, photo.getWidth(), photo.getHeight(), profile, scene, taken);
                String name = "DSC_" + new SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.ROOT).format(new Date(taken))
                        + "_" + UUID.randomUUID().toString().substring(0, 4) + ".JPG";
                Uri uri = PhotoStore.save(application, temporary, name, photo.getWidth(), photo.getHeight(), taken);
                published = uri;
                ReceiptTape.log(application, ReceiptTape.PHOTO, profile.label, taken);
                application.getSharedPreferences("pocket_camera", Context.MODE_PRIVATE).edit()
                        .putString("last_photo", uri.toString()).apply();
                float scale = Math.min(1f, 160f / Math.max(photo.getWidth(), photo.getHeight()));
                Bitmap thumb = Bitmap.createScaledBitmap(photo,
                        Math.max(1, Math.round(photo.getWidth() * scale)), Math.max(1, Math.round(photo.getHeight() * scale)), true);
                if (thumb == photo) photo = null;
                ui.post(() -> callback.saved(uri, thumb));
            } catch (IOException | RuntimeException | OutOfMemoryError error) {
                if (published != null) { Uri uri = published; ui.post(() -> callback.saved(uri, null)); }
                else ui.post(() -> callback.failed(error instanceof SecurityException
                        ? "Photo access was denied" : "Photo could not be saved. Check free storage."));
            } finally {
                if (photo != null) photo.recycle();
                if (temporary != null && temporary.exists()) temporary.delete();
                PhotoSaveService.finish(lease);
            }
        });
    }

    static void addMetadata(File file, int width, int height, CameraProfile p,
                            CompactProcessor.Conditions scene, long taken) throws IOException {
        ExifInterface exif = new ExifInterface(file.getAbsolutePath());
        exif.setAttribute(ExifInterface.TAG_MAKE, "Pocket");
        exif.setAttribute(ExifInterface.TAG_MODEL, p.label);
        if (Build.VERSION.SDK_INT >= 24) exif.setAttribute(ExifInterface.TAG_SOFTWARE, "Pocket compact camera 0.4");
        exif.setAttribute(ExifInterface.TAG_DATETIME,
                new SimpleDateFormat("yyyy:MM:dd HH:mm:ss", Locale.ROOT).format(new Date(taken)));
        exif.setAttribute(ExifInterface.TAG_ORIENTATION, Integer.toString(ExifInterface.ORIENTATION_NORMAL));
        exif.setAttribute(ExifInterface.TAG_IMAGE_WIDTH, Integer.toString(width));
        exif.setAttribute(ExifInterface.TAG_IMAGE_LENGTH, Integer.toString(height));
        exif.setAttribute(ExifInterface.TAG_FLASH, scene.flash ? "1" : "0");
        if (Build.VERSION.SDK_INT >= 24 && scene.iso > 0) exif.setAttribute(ExifInterface.TAG_ISO_SPEED_RATINGS, Integer.toString(scene.iso));
        if (scene.exposureNanos > 0) exif.setAttribute(ExifInterface.TAG_EXPOSURE_TIME, (scene.exposureNanos / 1000) + "/1000000");
        exif.saveAttributes();
    }
}
