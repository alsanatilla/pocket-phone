package org.textphone.launcher;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import java.util.HashMap;
import java.util.Map;

/** Decodes the run-length frames of {@link RetroSprites}, tints them from the accent colour and draws them pixel-crisp. */
final class SpriteArt {
    private static final Object LOCK = new Object();
    private static final Map<String, Bitmap> FRAMES = new HashMap<>();
    private static int tinted = Integer.MIN_VALUE;

    /** Same letters and mixes as src/client/sprite-player.js. */
    private static int[] palette(int accent) {
        int r = accent >> 16 & 255, g = accent >> 8 & 255, b = accent & 255;
        int[] p = new int[128];
        p['o'] = shade(r, g, b, .16f); p['d'] = shade(r, g, b, .38f); p['s'] = shade(r, g, b, .62f); p['a'] = 0xff000000 | accent & 0xffffff;
        p['l'] = mix(r, g, b, .38f); p['h'] = mix(r, g, b, .75f);
        p['G'] = rgb(85, 88, 92); p['g'] = rgb(141, 144, 148); p['w'] = rgb(242, 242, 242); p['k'] = rgb(5, 5, 5);
        p['t'] = shade(r, g, b, .09f); p['u'] = shade(r, g, b, .17f);
        p['Y'] = rgb(140, 100, 50); p['y'] = rgb(255, 191, 105); p['z'] = rgb(255, 225, 175);
        return p;
    }
    private static int rgb(int r, int g, int b) { return 0xff000000 | r << 16 | g << 8 | b; }
    private static int shade(int r, int g, int b, float k) { return rgb(Math.round(r * k), Math.round(g * k), Math.round(b * k)); }
    private static int mix(int r, int g, int b, float k) { return rgb(Math.round(r + (255 - r) * k), Math.round(g + (255 - g) * k), Math.round(b + (255 - b) * k)); }

    /** One tinted frame; frames of the previous accent are dropped when the accent changes. */
    static Bitmap frame(String rle, int accent) {
        synchronized (LOCK) {
            if (accent != tinted) { FRAMES.clear(); tinted = accent; }
            Bitmap bitmap = FRAMES.get(rle);
            if (bitmap != null) return bitmap;
            int size = RetroSprites.SIZE, cells = size * size, cell = 0;
            int[] colors = palette(accent), pixels = new int[cells];
            for (int i = 0; i < rle.length() && cell < cells;) {
                int count = 0;
                while (i < rle.length() && Character.isDigit(rle.charAt(i))) count = count * 10 + (rle.charAt(i++) - '0');
                char letter = i < rle.length() ? rle.charAt(i++) : '.';
                int color = letter < 128 ? colors[letter] : 0;
                for (int n = 0; n < count && cell < cells; n++) pixels[cell++] = color;
            }
            bitmap = Bitmap.createBitmap(pixels, size, size, Bitmap.Config.ARGB_8888);
            FRAMES.put(rle, bitmap);
            return bitmap;
        }
    }

    /** Draws a frame centred in the view with the largest whole-number scale that fits. */
    static void draw(Canvas canvas, int width, int height, String rle, int accent, Paint paint) {
        int scale = Math.max(1, Math.min(width, height) / RetroSprites.SIZE), side = scale * RetroSprites.SIZE;
        int left = (width - side) / 2, top = (height - side) / 2;
        paint.setFilterBitmap(false); paint.setAntiAlias(false); paint.setDither(false);
        canvas.drawBitmap(frame(rle, accent), null, new Rect(left, top, left + side, top + side), paint);
    }

    static String[] activity(int index) { return RetroSprites.PIP[Math.max(0, Math.min(RetroSprites.PIP.length - 1, index))]; }
    static final int ACTIVITIES = 6, PULL = 6;
    private SpriteArt() { }
}
