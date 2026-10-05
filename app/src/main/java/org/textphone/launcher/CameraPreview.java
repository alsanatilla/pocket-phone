package org.textphone.launcher;

import android.content.Context;
import android.graphics.Matrix;
import android.graphics.RectF;
import android.view.Surface;
import android.view.TextureView;
import android.util.Size;

/** A fitted preview with the same sensor crop as capture. Front preview is mirrored; files are not. */
final class CameraPreview extends TextureView {
    private int aspectWidth = 3, aspectHeight = 4;
    private Size buffer;
    private int displayRotation;
    private boolean front;
    private float sourceAspect = .75f;
    CameraPreview(Context context) { super(context); }

    @Override public boolean performClick() { return super.performClick(); }

    void configure(Size buffer, int sensor, int displayRotation, boolean front) {
        this.buffer = buffer; this.displayRotation = displayRotation; this.front = front;
        int rotation = CameraMath.previewRotation(sensor, displayRotation * 90, front);
        aspectWidth = rotation % 180 == 0 ? 4 : 3;
        aspectHeight = rotation % 180 == 0 ? 3 : 4;
        sourceAspect = rotation % 180 == 0 ? (float) buffer.getWidth() / buffer.getHeight()
                : (float) buffer.getHeight() / buffer.getWidth();
        requestLayout(); applyTransform();
    }

    @Override protected void onMeasure(int widthSpec, int heightSpec) {
        int width = MeasureSpec.getSize(widthSpec), height = MeasureSpec.getSize(heightSpec);
        if (width * aspectHeight > height * aspectWidth) width = height * aspectWidth / aspectHeight;
        else height = width * aspectHeight / aspectWidth;
        setMeasuredDimension(width, height);
    }

    @Override protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        super.onSizeChanged(w, h, oldw, oldh); applyTransform();
    }

    private void applyTransform() {
        if (buffer == null || getWidth() == 0 || getHeight() == 0) return;
        Matrix matrix = new Matrix();
        float cx = getWidth() / 2f, cy = getHeight() / 2f;
        if (displayRotation == Surface.ROTATION_90 || displayRotation == Surface.ROTATION_270) {
            RectF view = new RectF(0, 0, getWidth(), getHeight());
            RectF target = new RectF(0, 0, buffer.getHeight(), buffer.getWidth());
            target.offset(cx - target.centerX(), cy - target.centerY());
            matrix.setRectToRect(view, target, Matrix.ScaleToFit.FILL);
            float scale = Math.max((float) getHeight() / buffer.getHeight(), (float) getWidth() / buffer.getWidth());
            matrix.postScale(scale, scale, cx, cy);
            matrix.postRotate(90 * (displayRotation - 2), cx, cy);
        } else if (displayRotation == Surface.ROTATION_180) matrix.postRotate(180, cx, cy);
        // When the device offers only a wide stream, match the output's central 4:3 crop.
        float viewAspect = (float) getWidth() / getHeight();
        if (sourceAspect > viewAspect) matrix.postScale(sourceAspect / viewAspect, 1, cx, cy);
        else matrix.postScale(1, viewAspect / sourceAspect, cx, cy);
        if (front) matrix.postScale(-1, 1, cx, cy);
        setTransform(matrix);
    }
}
