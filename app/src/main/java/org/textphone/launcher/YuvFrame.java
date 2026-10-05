package org.textphone.launcher;

import android.graphics.Bitmap;
import android.graphics.Rect;
import android.hardware.DataSpace;
import android.media.Image;
import android.os.Build;
import java.nio.ByteBuffer;

/** Copies native YUV planes before releasing the camera buffer. No intermediate JPEG or HDR stack. */
final class YuvFrame {
    final int width, height;
    final long timestamp;
    final Plane y, u, v;
    final boolean fullRange, bt709;
    private final int originX, originY;

    static final class Plane {
        final byte[] data;
        final int rowStride, pixelStride;
        Plane(byte[] data, int rowStride, int pixelStride) {
            this.data = data; this.rowStride = rowStride; this.pixelStride = pixelStride;
        }
        static Plane copy(Image.Plane plane) {
            ByteBuffer buffer = plane.getBuffer().duplicate();
            byte[] data = new byte[buffer.remaining()]; buffer.get(data);
            return new Plane(data, plane.getRowStride(), plane.getPixelStride());
        }
        int sample(int x, int y) { return data[y * rowStride + x * pixelStride] & 255; }
    }

    YuvFrame(int width, int height, long timestamp, Plane y, Plane u, Plane v, boolean fullRange, boolean bt709) {
        this(width, height, timestamp, y, u, v, fullRange, bt709, 0, 0);
    }
    private YuvFrame(int width, int height, long timestamp, Plane y, Plane u, Plane v,
                     boolean fullRange, boolean bt709, int originX, int originY) {
        this.width = width; this.height = height; this.timestamp = timestamp;
        this.y = y; this.u = u; this.v = v; this.fullRange = fullRange; this.bt709 = bt709;
        this.originX = originX; this.originY = originY;
    }

    // Image.getDataSpace has a broader annotation than the color-space accessors.
    // This reader is specifically YUV_420_888, so depth/JPEG data spaces cannot occur.
    @android.annotation.SuppressLint("WrongConstant")
    static YuvFrame copy(Image image) {
        Image.Plane[] planes = image.getPlanes();
        boolean full = false, rec709 = false;
        if (Build.VERSION.SDK_INT >= 33) {
            int space = image.getDataSpace();
            full = DataSpace.getRange(space) == DataSpace.RANGE_FULL;
            rec709 = DataSpace.getStandard(space) == DataSpace.STANDARD_BT709;
        }
        Rect crop = image.getCropRect();
        return new YuvFrame(crop.width(), crop.height(), image.getTimestamp(),
                Plane.copy(planes[0]), Plane.copy(planes[1]), Plane.copy(planes[2]), full, rec709, crop.left, crop.top);
    }

    Bitmap bitmap() {
        int[] pixels = new int[width * height];
        for (int row = 0; row < height; row++) for (int x = 0; x < width; x++) {
            int sx = x + originX, sy = row + originY;
            float luminance = y.sample(sx, sy);
            float cb = u.sample(sx / 2, sy / 2) - 128f, cr = v.sample(sx / 2, sy / 2) - 128f;
            float r, g, b;
            if (!fullRange) { luminance = Math.max(0, luminance - 16) * (255f / 219f); cb *= 255f / 224f; cr *= 255f / 224f; }
            if (bt709) { r = luminance + 1.5748f * cr; g = luminance - .1873f * cb - .4681f * cr; b = luminance + 1.8556f * cb; }
            else { r = luminance + 1.402f * cr; g = luminance - .344136f * cb - .714136f * cr; b = luminance + 1.772f * cb; }
            pixels[row * width + x] = 0xFF000000 | (clamp(r) << 16) | (clamp(g) << 8) | clamp(b);
        }
        return Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888);
    }
    private static int clamp(float v) { return Math.max(0, Math.min(255, Math.round(v))); }
}
