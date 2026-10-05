package org.textphone.launcher;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Bitmap;
import android.view.View;

/** Original vector drawings of the nine symbols visible in the public product photograph, plus Pocket's own additions. */
final class PhoneIcon extends View {
    private final int kind;
    private final Paint paint = new Paint();
    private final Paint pixelPaint = new Paint();
    private final Bitmap pixelGlyph = Bitmap.createBitmap(26, 26, Bitmap.Config.ARGB_8888);
    private final Canvas glyphCanvas = new Canvas(pixelGlyph);
    private final RectF drawingBounds = new RectF();
    private final Path drawingPath = new Path();
    private int tint = Color.WHITE;
    private int background = Color.BLACK;
    private boolean notificationDot;

    PhoneIcon(Context context, int kind) { super(context); this.kind = kind; }
    public PhoneIcon(Context context) { this(context, 0); }
    void setTint(int color, int background) { tint = color; this.background = background; invalidate(); }
    void setNotificationDot(boolean show) { notificationDot = show; invalidate(); }

    private void stroke() {
        paint.setColor(tint);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(1.8f);
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setStrokeJoin(Paint.Join.ROUND);
    }

    private void fill() { paint.setStyle(Paint.Style.FILL); paint.setColor(tint); }

    private void polygon(Canvas c, float... points) {
        Path path = drawingPath;
        path.reset();
        path.moveTo(points[0], points[1]);
        for (int i = 2; i < points.length; i += 2) path.lineTo(points[i], points[i + 1]);
        path.close();
        c.drawPath(path, paint);
    }

    private RectF bounds(float left, float top, float right, float bottom) {
        drawingBounds.set(left, top, right, bottom);
        return drawingBounds;
    }

    private void gear(Canvas c, float x, float y, float radius, int body, int cutout) {
        fill();
        paint.setColor(body);
        c.drawCircle(x, y, radius * .78f, paint);
        for (int i = 0; i < 8; i++) {
            c.save(); c.rotate(i * 45, x, y);
            c.drawRect(x - radius * .23f, y - radius, x + radius * .23f, y - radius * .53f, paint);
            c.restore();
        }
        paint.setColor(cutout);
        c.drawCircle(x, y, radius * .32f, paint);
        paint.setColor(tint);
    }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        pixelGlyph.eraseColor(Color.TRANSPARENT);
        drawGlyph(glyphCanvas);
        pixelPaint.setFilterBitmap(false);
        canvas.drawBitmap(pixelGlyph, null, bounds(0, 0, getWidth(), getHeight()), pixelPaint);
    }

    private void drawGlyph(Canvas canvas) {
        canvas.save();
        canvas.translate(1, 1);
        stroke();
        int cutout = background;
        switch (kind) {
            case 0: // Head with a cog: smart text.
                fill();
                canvas.drawOval(bounds(5, 2, 23, 19), paint);
                polygon(canvas, 6, 8, 2, 14, 6, 15, 6, 20, 12, 20, 12, 23, 18, 23, 18, 15);
                gear(canvas, 15, 10, 4.8f, cutout, tint);
                break;
            case 1: // Outlined phone in a speech bubble.
                if (tint != Color.BLACK) {
                    fill(); paint.setColor(0xFF999999);
                    canvas.drawRect(0, 0, 24, 24, paint);
                }
                stroke();
                canvas.drawCircle(12, 11, 9.2f, paint);
                polygon(canvas, 4, 16, 1, 22, 8, 20);
                Path handset = drawingPath;
                handset.reset();
                handset.moveTo(8, 6); handset.cubicTo(6, 9, 9, 16, 15, 17);
                handset.lineTo(17, 14); handset.moveTo(8, 6); handset.lineTo(10, 8);
                canvas.drawPath(handset, paint);
                break;
            case 2: // SMS speech bubble with three lines.
                fill();
                canvas.drawRoundRect(bounds(2, 2, 23, 20), 1, 1, paint);
                polygon(canvas, 2, 16, 2, 24, 9, 19);
                paint.setColor(cutout);
                canvas.drawRect(6, 6, 19, 8, paint);
                canvas.drawRect(6, 10, 19, 12, paint);
                canvas.drawRect(6, 14, 17, 16, paint);
                break;
            case 3: // Address book.
                canvas.drawRoundRect(bounds(2, 2, 23, 23), 5, 5, paint);
                fill(); canvas.drawCircle(12.5f, 8.5f, 3.1f, paint);
                canvas.drawRoundRect(bounds(6, 13, 19, 20), 4, 4, paint);
                break;
            case 4: // Call history.
                canvas.drawArc(bounds(3, 3, 23, 23), -140, 305, false, paint);
                canvas.drawLine(13, 7, 13, 13, paint);
                canvas.drawLine(13, 13, 17, 16, paint);
                fill(); polygon(canvas, 1, 5, 2, 12, 8, 9);
                break;
            case 5: gear(canvas, 12, 12, 11, tint, cutout); break;
            case 6: // Globe and magnifier.
                canvas.drawCircle(10, 10, 8.5f, paint);
                fill();
                polygon(canvas, 3, 5, 7, 3, 9, 6, 12, 5, 14, 9, 10, 12, 7, 10, 5, 12, 4, 9);
                polygon(canvas, 10, 14, 13, 11, 16, 13, 14, 17, 11, 18);
                stroke();
                canvas.drawCircle(15, 15, 6.5f, paint);
                canvas.drawLine(19.5f, 19.5f, 24, 24, paint);
                break;
            case 7: // Camera.
                fill();
                canvas.drawRoundRect(bounds(1, 6, 23, 22), 1.5f, 1.5f, paint);
                polygon(canvas, 6, 6, 8, 3, 16, 3, 18, 6);
                paint.setColor(cutout); canvas.drawCircle(12, 14, 6, paint);
                paint.setColor(tint); canvas.drawCircle(12, 14, 3.6f, paint);
                break;
            case 8: // Front of a taxi.
                fill();
                canvas.drawRoundRect(bounds(3, 4, 21, 21), 2, 2, paint);
                canvas.drawRect(8, 1, 16, 5, paint);
                canvas.drawRect(3, 19, 6, 24, paint);
                canvas.drawRect(18, 19, 21, 24, paint);
                paint.setColor(cutout);
                canvas.drawRect(5, 7, 19, 14, paint);
                canvas.drawCircle(7, 18, 1.6f, paint);
                canvas.drawCircle(17, 18, 1.6f, paint);
                break;
            case 9: // Telephone handset.
                fill();
                polygon(canvas, 4, 2, 9, 2, 11, 7, 8, 10, 14, 16, 17, 13, 22, 15,
                        22, 20, 19, 23, 12, 20, 5, 13, 2, 6);
                break;
            case 10: // Clock.
                canvas.drawCircle(12, 12, 10, paint);
                canvas.drawLine(12, 5, 12, 12, paint);
                canvas.drawLine(12, 12, 17, 15, paint);
                break;
            case 11: // Calculator.
                canvas.drawRect(3, 1, 21, 23, paint);
                canvas.drawRect(6, 4, 18, 8, paint);
                fill();
                for (int y = 11; y < 22; y += 4)
                    for (int x = 6; x < 19; x += 5) canvas.drawRect(x, y, x + 2, y + 2, paint);
                break;
            case 12: // Folder.
                fill();
                polygon(canvas, 1, 5, 10, 5, 13, 8, 23, 8, 23, 21, 1, 21);
                break;
            case 13: // Calendar.
                canvas.drawRect(2, 4, 22, 23, paint);
                canvas.drawLine(2, 9, 22, 9, paint);
                canvas.drawLine(7, 1, 7, 6, paint);
                canvas.drawLine(17, 1, 17, 6, paint);
                fill();
                for (int y = 12; y < 21; y += 4)
                    for (int x = 6; x < 20; x += 5) canvas.drawRect(x, y, x + 2, y + 2, paint);
                break;
            case 14: // Tile group: a small grid of nine.
                fill();
                for (int y = 2; y < 22; y += 7)
                    for (int x = 2; x < 22; x += 7) canvas.drawRect(x, y, x + 5, y + 5, paint);
                break;
            case 15: // Die showing five.
                fill();
                canvas.drawRoundRect(bounds(2, 2, 22, 22), 3, 3, paint);
                paint.setColor(cutout);
                for (float[] pip : new float[][]{{7, 7}, {17, 7}, {12, 12}, {7, 17}, {17, 17}}) canvas.drawCircle(pip[0], pip[1], 2, paint);
                break;
            case 16: // Parking sign.
                fill();
                canvas.drawRoundRect(bounds(2, 2, 22, 22), 2, 2, paint);
                paint.setColor(cutout);
                canvas.drawRect(8, 6, 11, 19, paint);
                canvas.drawRect(8, 6, 15, 9, paint);
                canvas.drawRect(8, 12, 15, 15, paint);
                canvas.drawRect(14, 7, 17, 14, paint);
                break;
            case 17: // Receipt with a torn edge.
                fill();
                polygon(canvas, 4, 1, 20, 1, 20, 22, 18, 20, 16, 22, 14, 20, 12, 22, 10, 20, 8, 22, 6, 20, 4, 22);
                paint.setColor(cutout);
                canvas.drawRect(7, 5, 17, 7, paint);
                canvas.drawRect(7, 10, 14, 12, paint);
                canvas.drawRect(7, 15, 17, 17, paint);
                break;
            case 19: // Open notebook with handwriting.
                fill();
                polygon(canvas, 1, 4, 11, 6, 11, 22, 1, 20);
                polygon(canvas, 13, 6, 23, 4, 23, 20, 13, 22);
                paint.setColor(cutout);
                canvas.drawRect(3, 9, 9, 10.5f, paint); canvas.drawRect(3, 13, 8, 14.5f, paint);
                canvas.drawRect(15, 9, 21, 10.5f, paint); canvas.drawRect(15, 13, 20, 14.5f, paint);
                break;
            case 18: // Any installed app.
                canvas.drawRoundRect(bounds(3, 3, 21, 21), 4, 4, paint);
                fill(); canvas.drawRect(9, 9, 15, 15, paint);
                break;
            default: break;
        }
        if (notificationDot) {
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(0xFFC08CDD);
            canvas.drawCircle(23, 1, 2, paint);
        }
        canvas.restore();
    }
}
