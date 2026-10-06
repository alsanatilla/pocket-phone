package org.textphone.launcher;

import android.graphics.Bitmap;
import android.graphics.Matrix;
import android.graphics.Rect;
import android.util.Size;

/**
 * Renders a phone frame the way a 2003–2006 CCD compact rendered its own: a lens that resolves less than the
 * pixel count, colour fringes and dark corners, one global tone curve with hard clipping instead of local
 * tone mapping, CCD colour, sharpening halos, blotchy noise with in-camera smoothing, and bleeding colour.
 * A modern phone frame is clean, evenly lit and crisp to the last pixel; each stage takes one of those away.
 */
final class CompactProcessor {
    private CompactProcessor() {}

    static final class Conditions {
        final int iso;
        final boolean flash;
        final long exposureNanos;
        final float warmCast;

        Conditions(int iso, boolean flash, long exposureNanos, float warmCast) {
            this.iso = iso; this.flash = flash; this.exposureNanos = exposureNanos;
            this.warmCast = Math.max(-1f, Math.min(1f, warmCast));
        }
    }

    static Bitmap process(Bitmap input, CameraProfile profile, int rotation, Conditions scene, long seed) {
        return process(input, profile, CameraFormat.DEFAULT, rotation, scene, seed);
    }

    static Bitmap process(Bitmap input, CameraProfile profile, CameraFormat format, int rotation, Conditions scene, long seed) {
        Rect crop = format.aspect == CameraFormat.Aspect.FOUR_THREE ? CameraMath.cropFourThree(input.getWidth(), input.getHeight())
                : CameraMath.crop(input.getWidth(), input.getHeight(), format.aspect.ratio);
        Size target = CameraMath.outputSize(input.getWidth(), input.getHeight(), profile, format, 0);
        // The lens and colour filter resolve less than the pixel count: sample below the output size, then enlarge.
        int opticalWidth = Math.max(1, Math.round(target.getWidth() * profile.optics));
        int opticalHeight = Math.max(1, Math.round(target.getHeight() * profile.optics));
        Bitmap source = input;
        if (crop.width() != input.getWidth() || crop.height() != input.getHeight()) {
            source = Bitmap.createBitmap(input, crop.left, crop.top, crop.width(), crop.height());
            if (source != input) input.recycle();
        }
        // Halve while still twice the optical size: each filtered halving averages 2×2 pixels, so the frame shrinks
        // without the aliasing a single large bilinear step would add.
        while (source.getWidth() >= opticalWidth * 2 && source.getHeight() >= opticalHeight * 2) {
            Bitmap half = Bitmap.createScaledBitmap(source, source.getWidth() / 2, source.getHeight() / 2, true);
            if (half != source) source.recycle();
            source = half;
        }
        Matrix transform = new Matrix();
        transform.setScale((float) opticalWidth / source.getWidth(), (float) opticalHeight / source.getHeight());
        transform.postRotate(rotation);
        Bitmap optical = Bitmap.createBitmap(source, 0, 0, source.getWidth(), source.getHeight(), transform, true);
        if (optical != source) source.recycle();
        boolean turned = rotation % 180 != 0;
        Bitmap sampled = Bitmap.createScaledBitmap(optical, turned ? target.getHeight() : target.getWidth(),
                turned ? target.getWidth() : target.getHeight(), true);
        if (sampled != optical) optical.recycle();
        int width = sampled.getWidth(), height = sampled.getHeight();
        int[] pixels = new int[width * height];
        sampled.getPixels(pixels, 0, width, 0, 0, width, height);
        int[] rendered = render(pixels, width, height, profile, scene, seed);
        if (!sampled.isMutable()) {
            Bitmap mutable = sampled.copy(Bitmap.Config.ARGB_8888, true);
            sampled.recycle(); sampled = mutable;
        }
        sampled.setPixels(rendered, 0, width, 0, 0, width, height);
        return sampled;
    }

    static int[] render(int[] input, int width, int height, CameraProfile p, Conditions scene, long seed) {
        if (width <= 0 || height <= 0 || (long) width * height != input.length)
            throw new IllegalArgumentException("Invalid pixel buffer");
        int count = input.length;
        int[] output = new int[count];
        byte[] luma = new byte[count];
        long total = 0;
        for (int i = 0; i < count; i++) { int l = luma(input[i]); luma[i] = (byte) l; total += l; }
        float mean = total / (float) count;
        // A small blur is the reference for sharpening halos (one to two pixels wide) and for noise smoothing.
        int halo = Math.max(width, height) >= 1600 ? 2 : 1;
        byte[] soft = boxBlur(luma, width, height, halo);
        // Clipped highlights spread a few pixels into their surroundings: CCD bloom and purple fringes.
        int reach = Math.max(2, Math.round(Math.min(width, height) / 400f));
        byte[] glow = highlights(luma, width, height, reach);
        // About eight areas across the frame: the scene's broad light, which one global curve keeps apart.
        int cell = Math.max(8, Math.max(width, height) / 8);
        int columns = (width + cell - 1) / cell, rows = (height + cell - 1) / cell;
        float[] broad = areas(luma, width, height, cell, columns, rows);

        int[] curve = toneCurve(p, scene.flash);
        // Modern auto white balance is deliberately allowed to retain a small amount of the illuminant.
        float residual = scene.flash ? 0 : scene.warmCast * p.whiteBalanceLeak;
        float rGain = p.red * (1 + residual), gGain = p.green, bGain = p.blue * (1 - residual);
        float[] m = p.matrix;
        float stops = (float) (Math.log(Math.max(100, scene.iso) / 100.0) / Math.log(2));
        stops = Math.min(6, Math.max(0, stops));
        float read = p.readNoise * (1 + .55f * stops) + (scene.exposureNanos > 30_000_000 ? .6f : 0);
        float chroma = p.chromaNoise * (.6f + .8f * stops);
        // Above ISO 200 the cameras smeared fine texture to hide noise, most of all in the shadows.
        float smoothing = Math.min(.7f, Math.max(0, (stops - 1) * .22f)) * p.noiseReduction / .5f;
        // Those cameras topped out near ISO 400: in dimmer light than that they simply recorded a darker frame.
        float pull = (float) Math.min(1.2, Math.max(0, Math.log(Math.max(1, scene.iso) / 400.0) / Math.log(2) * .5));
        float exposure = (float) Math.pow(2, -pull / 2.2);
        float cx = (width - 1) / 2f, cy = (height - 1) / 2f, corner = 1f / (cx * cx + cy * cy + 1);
        Noise noise = new Noise(seed);
        Field coarse = new Field(noise, width, 3), redField = new Field(noise, width, 6), blueField = new Field(noise, width, 6);
        for (int y = 0; y < height; y++) {
            coarse.row(y); redField.row(y); blueField.row(y);
            float dy = y - cy;
            for (int x = 0; x < width; x++) {
                int i = y * width + x;
                float dx = x - cx, radius = (dx * dx + dy * dy) * corner;
                // Lateral colour: the lens draws red slightly larger and blue slightly smaller toward the corners.
                float r = channel(input, width, height, cx + dx * (1 + p.aberration), cy + dy * (1 + p.aberration), 16);
                float g = (input[i] >>> 8) & 255;
                float b = channel(input, width, height, cx + dx * (1 - p.aberration), cy + dy * (1 - p.aberration), 0);
                int l = luma[i] & 255;
                float shadow = 1 - l / 255f;
                float edge = l - (soft[i] & 255);
                float detail = Math.max(-28, Math.min(28, edge * p.sharpening)) - edge * smoothing * (.35f + .65f * shadow);
                float lift = p.depth * (sample(broad, columns, rows, cell, x, y) - mean);
                r += detail + lift; g += detail + lift; b += detail + lift;
                float cr = m[0] * r + m[1] * g + m[2] * b, cg = m[3] * r + m[4] * g + m[5] * b, cb = m[6] * r + m[7] * g + m[8] * b;
                float mixed = .299f * cr + .587f * cg + .114f * cb;
                float fall = (1 - p.vignette * radius) * exposure;
                r = curve[clamp((mixed + (cr - mixed) * p.saturation) * rGain * fall)];
                g = curve[clamp((mixed + (cg - mixed) * p.saturation) * gGain * fall)];
                b = curve[clamp((mixed + (cb - mixed) * p.saturation) * bGain * fall)];
                float spill = (glow[i] & 255) / 255f;
                if (spill > 0) {
                    float bloom = p.bloom * spill * 70, fringe = p.fringe * spill * shadow * shadow * 120;
                    r += bloom + fringe * .55f; g += bloom - fringe * .25f; b += bloom + fringe;
                }
                float sigma = read * (.5f + 1.5f * shadow * shadow);
                float luminanceError = (.5f * noise.normal() + .6f * coarse.at(x)) * sigma;
                float chromaScale = chroma * (.3f + shadow);
                float redError = redField.at(x) * chromaScale, blueError = blueField.at(x) * chromaScale;
                // Preserve truly clipped channels instead of painting noise into blown highlights.
                int rr = r >= 255 ? 255 : clamp(r + luminanceError + redError);
                int gg = g >= 255 ? 255 : clamp(g + luminanceError - .3f * (redError + blueError));
                int bb = b >= 255 ? 255 : clamp(b + luminanceError + blueError);
                output[i] = 0xFF000000 | (rr << 16) | (gg << 8) | bb;
            }
        }
        bleed(output, width, height, p.chromaBlur);
        return output;
    }

    static int[] toneCurve(CameraProfile p, boolean flash) {
        int[] curve = new int[256];
        float white = p.white - (flash ? .018f : 0);
        for (int i = 0; i < 256; i++) {
            float t = Math.max(0, Math.min(1, (i / 255f - p.black) / (white - p.black)));
            t = (float) Math.pow(t, p.gamma);
            t += p.contrast * (t - .5f) * t * (1 - t) * 4;
            curve[i] = clamp(t * 255);
        }
        return curve;
    }

    /** Separable box blur of an 8-bit plane. */
    static byte[] boxBlur(byte[] plane, int width, int height, int radius) {
        byte[] across = new byte[plane.length], result = new byte[plane.length];
        int span = radius * 2 + 1;
        for (int y = 0; y < height; y++) {
            int row = y * width, sum = 0;
            for (int k = -radius; k <= radius; k++) sum += plane[row + Math.max(0, Math.min(width - 1, k))] & 255;
            for (int x = 0; x < width; x++) {
                across[row + x] = (byte) (sum / span);
                sum += (plane[row + Math.min(width - 1, x + radius + 1)] & 255) - (plane[row + Math.max(0, x - radius)] & 255);
            }
        }
        for (int x = 0; x < width; x++) {
            int sum = 0;
            for (int k = -radius; k <= radius; k++) sum += across[Math.max(0, Math.min(height - 1, k)) * width + x] & 255;
            for (int y = 0; y < height; y++) {
                result[y * width + x] = (byte) (sum / span);
                sum += (across[Math.min(height - 1, y + radius + 1) * width + x] & 255) - (across[Math.max(0, y - radius) * width + x] & 255);
            }
        }
        return result;
    }

    /** How strongly clipped highlights reach each pixel, 0–255. */
    private static byte[] highlights(byte[] luma, int width, int height, int radius) {
        byte[] mask = new byte[luma.length]; boolean any = false;
        for (int i = 0; i < luma.length; i++) { int l = luma[i] & 255; if (l > 238) { mask[i] = (byte) Math.min(255, (l - 238) * 15); any = true; } }
        if (!any) return mask;
        byte[] spread = boxBlur(boxBlur(mask, width, height, radius), width, height, radius);
        for (int i = 0; i < spread.length; i++) spread[i] = (byte) Math.min(255, (spread[i] & 255) * 3);
        return spread;
    }

    /** Mean brightness of each area of the frame. */
    private static float[] areas(byte[] luma, int width, int height, int cell, int columns, int rows) {
        float[] sums = new float[columns * rows]; int[] counts = new int[sums.length];
        for (int y = 0; y < height; y++) for (int x = 0; x < width; x++) { int a = (y / cell) * columns + x / cell; sums[a] += luma[y * width + x] & 255; counts[a]++; }
        for (int a = 0; a < sums.length; a++) sums[a] /= Math.max(1, counts[a]);
        return sums;
    }
    /** Smooth brightness between area centres, so area boundaries never show. */
    private static float sample(float[] areas, int columns, int rows, int cell, int x, int y) {
        float gx = Math.max(0, Math.min(columns - 1, (x + .5f) / cell - .5f)), gy = Math.max(0, Math.min(rows - 1, (y + .5f) / cell - .5f));
        int x0 = (int) gx, y0 = (int) gy, x1 = Math.min(columns - 1, x0 + 1), y1 = Math.min(rows - 1, y0 + 1);
        float fx = gx - x0, fy = gy - y0;
        float top = areas[y0 * columns + x0] * (1 - fx) + areas[y0 * columns + x1] * fx;
        float bottom = areas[y1 * columns + x0] * (1 - fx) + areas[y1 * columns + x1] * fx;
        return top * (1 - fy) + bottom * fy;
    }

    /** One colour channel at a fractional position, bilinear and clamped to the frame. */
    private static float channel(int[] pixels, int width, int height, float x, float y, int shift) {
        x = Math.max(0, Math.min(width - 1.001f, x)); y = Math.max(0, Math.min(height - 1.001f, y));
        int x0 = (int) x, y0 = (int) y, x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
        float fx = x - x0, fy = y - y0;
        float a = (pixels[y0 * width + x0] >>> shift) & 255, b = (pixels[y0 * width + x1] >>> shift) & 255;
        float c = (pixels[y1 * width + x0] >>> shift) & 255, d = (pixels[y1 * width + x1] >>> shift) & 255;
        return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }

    /** Colour detail was stored at lower resolution and smeared across edges; luminance keeps its own detail. */
    private static void bleed(int[] pixels, int width, int height, int radius) {
        if (radius <= 0) return;
        float[] y = new float[width], cb = new float[width], cr = new float[width], blurredB = new float[width], blurredR = new float[width];
        int span = radius * 2 + 1;
        for (int row = 0; row < height; row++) {
            int start = row * width;
            for (int x = 0; x < width; x++) {
                int c = pixels[start + x]; float r = (c >>> 16) & 255, g = (c >>> 8) & 255, b = c & 255;
                y[x] = .299f * r + .587f * g + .114f * b; cb[x] = b - y[x]; cr[x] = r - y[x];
            }
            float sumB = 0, sumR = 0;
            for (int k = -radius; k <= radius; k++) { int at = Math.max(0, Math.min(width - 1, k)); sumB += cb[at]; sumR += cr[at]; }
            for (int x = 0; x < width; x++) {
                blurredB[x] = sumB / span; blurredR[x] = sumR / span;
                int add = Math.min(width - 1, x + radius + 1), drop = Math.max(0, x - radius);
                sumB += cb[add] - cb[drop]; sumR += cr[add] - cr[drop];
            }
            for (int x = 0; x < width; x++) {
                int c = pixels[start + x];
                // Leave clipped pixels alone so blown highlights stay pure white.
                if ((c & 0xFFFFFF) == 0xFFFFFF) continue;
                float r = y[x] + blurredR[x], b = y[x] + blurredB[x], g = (y[x] - .299f * r - .114f * b) / .587f;
                pixels[start + x] = 0xFF000000 | (clamp(r) << 16) | (clamp(g) << 8) | clamp(b);
            }
        }
    }

    private static int luma(int c) { return (299 * ((c >>> 16) & 255) + 587 * ((c >>> 8) & 255) + 114 * (c & 255) + 500) / 1000; }
    private static int clamp(float value) { return Math.max(0, Math.min(255, Math.round(value))); }

    /** Noise that varies smoothly across {@code step} pixels, generated one row of grid points at a time. */
    private static final class Field {
        private final Noise noise; private final int step; private float[] above, below, row; private int band = -1;
        Field(Noise noise, int width, int step) {
            this.noise = noise; this.step = step; int points = width / step + 2;
            above = new float[points]; below = new float[points]; row = new float[width];
            fill(below);
        }
        private void fill(float[] points) { for (int k = 0; k < points.length; k++) points[k] = noise.normal(); }
        void row(int y) {
            int next = y / step;
            while (band < next) { float[] old = above; above = below; below = old; fill(below); band++; }
            float t = (y % step) / (float) step;
            for (int x = 0; x < row.length; x++) {
                int k = x / step; float u = (x % step) / (float) step;
                float top = above[k] * (1 - u) + above[k + 1] * u, bottom = below[k] * (1 - u) + below[k + 1] * u;
                row[x] = top * (1 - t) + bottom * t;
            }
        }
        float at(int x) { return row[x]; }
    }

    private static final class Noise {
        private long state;
        Noise(long seed) { state = seed == 0 ? 0x51ED2705L : seed; }
        float uniform() {
            state ^= state << 13; state ^= state >>> 7; state ^= state << 17;
            return (state >>> 40) / (float) (1 << 24);
        }
        float normal() { return (uniform() + uniform() + uniform() - 1.5f) * 2; }
    }
}
