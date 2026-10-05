package org.textphone.launcher;

import android.app.Activity;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.view.View;

/** A deliberately stepped, pixel-grid wireframe. It owns no work while hidden or paused. */
final class PixelLoadingView extends View {
    private static final int GRID = 22, FRAMES = 48;
    private static final long FRAME_MS = 84;
    private static final int[][] EDGES = {
            {0, 1}, {0, 2}, {0, 4}, {1, 3}, {1, 5}, {2, 3},
            {2, 6}, {3, 7}, {4, 5}, {4, 6}, {5, 7}, {6, 7}
    };
    private final Activity activity;
    private final Paint pixels = new Paint();
    private final int[] projectedX = new int[8], projectedY = new int[8];
    private final float[] depth = new float[8];
    private boolean running, paused = true, attached, destroyed, scheduled, motionAllowed;
    private int frame, accent;
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            scheduled = false;
            if (!visibleRunning() || !motionAllowed) return;
            frame = (frame + 1) % FRAMES;
            invalidate();
            schedule();
        }
    };

    PixelLoadingView(Activity activity) {
        super(activity);
        this.activity = activity;
        accent = PocketDesign.accent(activity);
        pixels.setAntiAlias(false);
        pixels.setDither(false);
        setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        setFocusable(false);
        setClickable(false);
        setMinimumWidth(PocketDesign.dp(activity, 44));
        setMinimumHeight(PocketDesign.dp(activity, 44));
        setTag("chat_pixel_loading");
    }

    void setRunning(boolean value) {
        if (running == value || destroyed) return;
        running = value;
        if (!value) frame = 0;
        update();
    }

    void setPaused(boolean value) {
        if (paused == value || destroyed) return;
        paused = value;
        update();
    }

    void refresh() { if (!destroyed) update(); }

    void destroy() {
        destroyed = true;
        running = false;
        paused = true;
        removeCallbacks(tick);
        scheduled = false;
    }

    @Override protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        attached = true;
        update();
    }

    @Override protected void onDetachedFromWindow() {
        attached = false;
        removeCallbacks(tick);
        scheduled = false;
        super.onDetachedFromWindow();
    }

    @Override protected void onVisibilityChanged(View changed, int visibility) {
        super.onVisibilityChanged(changed, visibility);
        if (activity != null) update();
    }

    @Override protected void onWindowVisibilityChanged(int visibility) {
        super.onWindowVisibilityChanged(visibility);
        if (activity != null) update();
    }

    private boolean visibleRunning() {
        return !destroyed && running && !paused && attached && isShown() && getWindowVisibility() == View.VISIBLE;
    }

    private void update() {
        removeCallbacks(tick);
        scheduled = false;
        if (destroyed) return;
        accent = PocketDesign.accent(activity);
        motionAllowed = PageMotion.enabled(activity);
        if (!motionAllowed) frame = 0;
        invalidate();
        if (visibleRunning() && motionAllowed) schedule();
    }

    private void schedule() {
        if (!scheduled && visibleRunning() && motionAllowed) scheduled = postDelayed(tick, FRAME_MS);
    }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        int cell = Math.max(1, Math.min(getWidth(), getHeight()) / GRID);
        int left = (getWidth() - GRID * cell) / 2, top = (getHeight() - GRID * cell) / 2;
        double angle = frame * Math.PI * 2 / FRAMES;
        float cosine = (float) Math.cos(angle), sine = (float) Math.sin(angle);
        float tiltCos = .9f, tiltSin = .4359f;
        for (int vertex = 0; vertex < 8; vertex++) {
            float x = (vertex & 1) == 0 ? -1 : 1;
            float y = (vertex & 2) == 0 ? -1 : 1;
            float z = (vertex & 4) == 0 ? -1 : 1;
            float rotatedX = x * cosine + z * sine;
            float rotatedZ = z * cosine - x * sine;
            float rotatedY = y * tiltCos - rotatedZ * tiltSin;
            depth[vertex] = y * tiltSin + rotatedZ * tiltCos;
            float scale = 6f / (1 + depth[vertex] * .16f);
            projectedX[vertex] = Math.round(10.5f + rotatedX * scale);
            projectedY[vertex] = Math.round(10.5f + rotatedY * scale);
        }
        // Back edges first; bright front edges stay crisp, with no interpolated drawing.
        for (int pass = 0; pass < 2; pass++) {
            pixels.setColor(pass == 0 ? (accent & 0x00FFFFFF) | 0x66000000 : accent);
            for (int[] edge : EDGES) {
                boolean front = depth[edge[0]] + depth[edge[1]] < 0;
                if (front == (pass == 1)) line(canvas, left, top, cell,
                        projectedX[edge[0]], projectedY[edge[0]], projectedX[edge[1]], projectedY[edge[1]]);
            }
        }
        pixels.setColor(accent);
        for (int vertex = 0; vertex < 8; vertex++) if (depth[vertex] <= 0) {
            int x = left + projectedX[vertex] * cell, y = top + projectedY[vertex] * cell;
            canvas.drawRect(x, y, x + cell * 2, y + cell * 2, pixels);
        }
    }

    private void line(Canvas canvas, int left, int top, int cell, int x, int y, int endX, int endY) {
        int dx = Math.abs(endX - x), sx = x < endX ? 1 : -1;
        int dy = -Math.abs(endY - y), sy = y < endY ? 1 : -1, error = dx + dy;
        while (true) {
            int px = left + x * cell, py = top + y * cell;
            canvas.drawRect(px, py, px + cell, py + cell, pixels);
            if (x == endX && y == endY) break;
            int twice = error * 2;
            if (twice >= dy) { error += dy; x += sx; }
            if (twice <= dx) { error += dx; y += sy; }
        }
    }
}
