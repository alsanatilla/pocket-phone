package org.textphone.launcher;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.view.View;

final class FocusOverlay extends View {
    private final Paint paint = new Paint();
    private float x, y;
    private boolean show, locked;
    FocusOverlay(Context context) { super(context); setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO); }
    void focus(float x, float y) { this.x = x; this.y = y; show = true; locked = false; invalidate(); }
    void result(boolean success) {
        locked = success; invalidate(); removeCallbacks(hide); postDelayed(hide, 1300);
    }
    private final Runnable hide = () -> { show = false; invalidate(); };
    @Override protected void onDraw(Canvas canvas) {
        if (!show) return;
        float half = 22 * getResources().getDisplayMetrics().density;
        paint.setColor(locked ? 0xFF9BE564 : 0xFFF9F594); paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(2 * getResources().getDisplayMetrics().density);
        canvas.drawRect(x - half, y - half, x + half, y + half, paint);
    }
}
