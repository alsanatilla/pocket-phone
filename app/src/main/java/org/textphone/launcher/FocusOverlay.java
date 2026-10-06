package org.textphone.launcher;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.view.View;

/** Focus mark, plus black bars outside the chosen aspect so the viewfinder shows exactly what is saved. */
final class FocusOverlay extends View {
    private final Paint paint = new Paint(), bars = new Paint();
    private float x, y, ratio = 4f / 3;
    private boolean show, locked;
    FocusOverlay(Context context) { super(context); setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO); bars.setColor(0xFF000000); }
    void focus(float x, float y) { this.x = x; this.y = y; show = true; locked = false; invalidate(); }
    /** Long/short ratio of the saved photo; the viewfinder itself is the sensor's 4:3. */
    void aspect(float value) { if (value != ratio) { ratio = value; invalidate(); } }
    void result(boolean success) {
        locked = success; invalidate(); removeCallbacks(hide); postDelayed(hide, 1300);
    }
    private final Runnable hide = () -> { show = false; invalidate(); };
    /** The viewfinder whose picture the bars mask; its bounds count even before this overlay is resized to match. */
    void frame(View preview) { frame = preview; }
    private View frame;
    @Override protected void onDraw(Canvas canvas) {
        boolean known = frame != null && frame.getWidth() > 0 && frame.getHeight() > 0;
        float left = known ? frame.getLeft() - getLeft() : 0, top = known ? frame.getTop() - getTop() : 0;
        float w = known ? frame.getWidth() : getWidth(), h = known ? frame.getHeight() : getHeight();
        if (w > 0 && h > 0) {
            boolean tall = h >= w; float along = tall ? h : w, across = tall ? w : h;
            float keepLong = Math.min(along, across * ratio), keepShort = Math.min(across, keepLong / ratio);
            float cutLong = (along - keepLong) / 2, cutShort = (across - keepShort) / 2;
            float cutX = tall ? cutShort : cutLong, cutY = tall ? cutLong : cutShort;
            if (cutX >= 1) { canvas.drawRect(left, top, left + cutX, top + h, bars); canvas.drawRect(left + w - cutX, top, left + w, top + h, bars); }
            if (cutY >= 1) { canvas.drawRect(left, top, left + w, top + cutY, bars); canvas.drawRect(left, top + h - cutY, left + w, top + h, bars); }
        }
        if (!show) return;
        float half = 22 * getResources().getDisplayMetrics().density;
        paint.setColor(locked ? 0xFF9BE564 : 0xFFF9F594); paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(2 * getResources().getDisplayMetrics().density);
        canvas.drawRect(x - half, y - half, x + half, y + half, paint);
    }
}
