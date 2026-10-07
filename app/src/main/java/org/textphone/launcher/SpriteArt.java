package org.textphone.launcher;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.view.View;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Plays pip (a PS1-style 3D render) and the PS2-style save screen from the sprite sheets in assets/sprites,
 * drawn by tools/sprites/ps1. One sheet per accent colour; only the current accent's sheets stay in memory,
 * and they are decoded off the UI thread so drawing never waits.
 */
final class SpriteArt {
    static final int ACTIVITIES = 6, PULL = 6; // wave, walk, juggle, read, hop, write · then the pull crouch
    private static final Object LOCK = new Object();
    private static String loadedAccent = "", loadingAccent = "";
    private static Bitmap pip, save;
    private static final List<View> WAITING = new ArrayList<>();
    private final Rect source = new Rect(), destination = new Rect();

    /** The baked accent nearest to Pocket's current accent. */
    static String accentName(int accent) {
        String best = RetroSprites.ACCENT_NAMES[0]; long distance = Long.MAX_VALUE;
        for (int i = 0; i < RetroSprites.ACCENT_COLORS.length; i++) {
            int c = RetroSprites.ACCENT_COLORS[i];
            long dr = (c >> 16 & 255) - (accent >> 16 & 255), dg = (c >> 8 & 255) - (accent >> 8 & 255), db = (c & 255) - (accent & 255), d = dr * dr + dg * dg + db * db;
            if (d < distance) { distance = d; best = RetroSprites.ACCENT_NAMES[i]; }
        }
        return best;
    }
    private static Bitmap read(Context c, String name) {
        BitmapFactory.Options options = new BitmapFactory.Options(); options.inScaled = false; options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        try (InputStream in = c.getAssets().open("sprites/" + name + ".png")) { return BitmapFactory.decodeStream(in, null, options); }
        catch (IOException | OutOfMemoryError error) { return null; }
    }
    /** Starts decoding the accent's sheets in the background; `view` is redrawn when they are ready. */
    static void prepare(Context c, int accent, View view) {
        String name = accentName(accent); Context app = c.getApplicationContext();
        synchronized (LOCK) {
            if (name.equals(loadedAccent)) return;
            if (view != null && !WAITING.contains(view)) WAITING.add(view);
            if (name.equals(loadingAccent)) return;
            loadingAccent = name;
        }
        Thread worker = new Thread(() -> {
            Bitmap nextPip = read(app, "pip-" + name), nextSave = read(app, "save-" + name);
            List<View> redraw;
            synchronized (LOCK) {
                if (!name.equals(loadingAccent)) return; // a newer accent was asked for meanwhile
                pip = nextPip; save = nextSave; loadedAccent = name; loadingAccent = "";
                redraw = new ArrayList<>(WAITING); WAITING.clear();
            }
            for (View v : redraw) v.postInvalidate();
        }, "Pocket sprites");
        worker.setDaemon(true); worker.start();
    }
    private static Bitmap ready(boolean saveScreen, int accent) {
        synchronized (LOCK) { return accentName(accent).equals(loadedAccent) ? saveScreen ? save : pip : null; }
    }
    static int frames(boolean saveScreen, int activity) { return saveScreen ? RetroSprites.SAVE_FRAMES : RetroSprites.PIP_FRAMES[Math.max(0, Math.min(RetroSprites.PIP_FRAMES.length - 1, activity))]; }
    static long step(boolean saveScreen, int activity) { return saveScreen ? RetroSprites.SAVE_STEP_MS : RetroSprites.PIP_STEP_MS[Math.max(0, Math.min(RetroSprites.PIP_STEP_MS.length - 1, activity))]; }

    /** Draws one frame filling the view, square and centred, without smoothing so the pixels stay hard. */
    void draw(View view, Canvas canvas, boolean saveScreen, int activity, int frame, int accent, Paint paint) {
        Bitmap image = ready(saveScreen, accent);
        if (image == null) { prepare(view.getContext(), accent, view); return; }
        int size = RetroSprites.SIZE, cols = saveScreen ? RetroSprites.SAVE_COLS : RetroSprites.PIP_COLS;
        int index = saveScreen ? Math.floorMod(frame, RetroSprites.SAVE_FRAMES) : activity * RetroSprites.PIP_COLS + Math.floorMod(frame, frames(false, activity));
        source.set(index % cols * size, index / cols * size, index % cols * size + size, index / cols * size + size);
        int width = view.getWidth(), height = view.getHeight(), side = Math.min(width, height), left = (width - side) / 2, top = (height - side) / 2;
        destination.set(left, top, left + side, top + side);
        paint.setFilterBitmap(false); paint.setAntiAlias(false); paint.setDither(false);
        canvas.drawBitmap(image, source, destination, paint);
    }
}
