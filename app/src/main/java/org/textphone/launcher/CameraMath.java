package org.textphone.launcher;

import android.graphics.Rect;
import android.util.Size;

/** Geometry kept separate from camera hardware so rotation, crops and bounds can be checked. */
final class CameraMath {
    private CameraMath() {}

    static int orientation(int sensor, int device, boolean front) {
        int rounded = ((Math.max(0, device) + 45) / 90 * 90) % 360;
        return (sensor + (front ? -rounded : rounded) + 360) % 360;
    }

    static int previewRotation(int sensor, int displayDegrees, boolean front) {
        return (sensor + (front ? displayDegrees : -displayDegrees) + 360) % 360;
    }

    static Size chooseSize(Size[] sizes, long limit, double aspect, boolean preferSmall) {
        if (sizes == null || sizes.length == 0) throw new IllegalArgumentException("No camera output sizes");
        Size best = null;
        double score = Double.MAX_VALUE;
        for (Size size : sizes) {
            long pixels = (long) size.getWidth() * size.getHeight();
            double ratio = (double) size.getWidth() / size.getHeight();
            double penalty = Math.abs(Math.log(ratio / aspect)) * 30;
            if (pixels > limit) penalty += 10 + Math.log((double) pixels / limit) * 10;
            else penalty += preferSmall ? Math.abs(Math.log((double) pixels / limit))
                    : Math.log((double) limit / pixels);
            if (best == null || penalty < score) { best = size; score = penalty; }
        }
        return best;
    }

    static Rect cropFourThree(int width, int height) {
        if (width <= 0 || height <= 0) throw new IllegalArgumentException("Invalid image size");
        int w = Math.min(width, Math.max(1, height * 4 / 3));
        int h = Math.min(height, Math.max(1, w * 3 / 4));
        return new Rect((width - w) / 2, (height - h) / 2, (width + w) / 2, (height + h) / 2);
    }

    static Size outputSize(int width, int height, CameraProfile profile, int rotation) {
        return outputSize(width, height, profile, CameraFormat.DEFAULT, rotation);
    }

    /** The central crop with long/short ratio {@code ratio}, cut from the frame's own orientation. */
    static Rect crop(int width, int height, float ratio) {
        if (width <= 0 || height <= 0 || ratio < 1) throw new IllegalArgumentException("Invalid image size");
        boolean landscape = width >= height; int along = landscape ? width : height, across = landscape ? height : width;
        int keepLong = Math.min(along, Math.max(1, Math.round(across * ratio)));
        int keepShort = Math.min(across, Math.max(1, Math.round(keepLong / ratio)));
        int w = landscape ? keepLong : keepShort, h = landscape ? keepShort : keepLong;
        return new Rect((width - w) / 2, (height - h) / 2, (width - w) / 2 + w, (height - h) / 2 + h);
    }

    /** Output pixels for a format: its crop scaled down to the camera frame's cut at that size, never up. */
    static Size outputSize(int width, int height, CameraProfile profile, CameraFormat format, int rotation) {
        Rect crop = format.aspect == CameraFormat.Aspect.FOUR_THREE ? cropFourThree(width, height) : crop(width, height, format.aspect.ratio);
        int[] frame = CameraFormat.frame(format.longEdge(profile), format.aspect);
        float scale = Math.min(1f, (float) Math.max(frame[0], frame[1]) / Math.max(crop.width(), crop.height()));
        int w = Math.max(1, Math.round(crop.width() * scale));
        int h = Math.max(1, Math.round(crop.height() * scale));
        return rotation % 180 == 0 ? new Size(w, h) : new Size(h, w);
    }

    static Rect metering(float x, float y, Rect crop, int rotation, boolean front) {
        float u = Math.max(0f, Math.min(1f, front ? 1f - x : x));
        float v = Math.max(0f, Math.min(1f, y));
        float sensorX = u, sensorY = v;
        switch (rotation) {
            case 90: sensorX = v; sensorY = 1f - u; break;
            case 180: sensorX = 1f - u; sensorY = 1f - v; break;
            case 270: sensorX = 1f - v; sensorY = u; break;
            default: break;
        }
        int w = Math.max(1, Math.round(crop.width() * .12f));
        int h = Math.max(1, Math.round(crop.height() * .12f));
        int left = Math.max(crop.left, Math.min(crop.right - w,
                crop.left + Math.round(sensorX * crop.width()) - w / 2));
        int top = Math.max(crop.top, Math.min(crop.bottom - h,
                crop.top + Math.round(sensorY * crop.height()) - h / 2));
        return new Rect(left, top, left + w, top + h);
    }
}
