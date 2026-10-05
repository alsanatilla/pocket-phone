package org.textphone.launcher;

import android.graphics.Bitmap;
import android.graphics.Matrix;
import android.graphics.Rect;
import android.util.Size;

/** A capture pipeline: limited sampling, imperfect color, short tonal range, sensor-like noise. */
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
        Rect crop = CameraMath.cropFourThree(input.getWidth(), input.getHeight());
        Size target = CameraMath.outputSize(input.getWidth(), input.getHeight(), profile, 0);
        Matrix transform = new Matrix();
        transform.setScale((float) target.getWidth() / crop.width(), (float) target.getHeight() / crop.height());
        transform.postRotate(rotation);
        Bitmap sampled = Bitmap.createBitmap(input, crop.left, crop.top, crop.width(), crop.height(), transform, true);
        if (sampled != input) input.recycle();
        int width = sampled.getWidth(), height = sampled.getHeight();
        int[] source = new int[width * height];
        sampled.getPixels(source, 0, width, 0, 0, width, height);
        int[] rendered = render(source, width, height, profile, scene, seed);
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
        int[] output = new int[input.length];
        int[] curve = toneCurve(p, scene.flash);
        // Modern auto WB is deliberately allowed to retain a small amount of the illuminant.
        float residual = scene.flash ? 0 : scene.warmCast * p.whiteBalanceLeak;
        float rGain = p.red * (1 + residual), gGain = p.green, bGain = p.blue * (1 - residual);
        float stops = (float) (Math.log(Math.max(100, scene.iso) / 100.0) / Math.log(2));
        stops = Math.min(6, Math.max(0, stops));
        float read = p.readNoise + stops * .42f + (scene.exposureNanos > 30_000_000 ? .3f : 0);
        float chroma = p.chromaNoise * (.65f + stops * .7f);
        Noise noise = new Noise(seed);
        // Chroma errors have a spatial scale; independent RGB speckles look like a preset overlay.
        float[] redChroma = new float[(width + 3) / 4], blueChroma = new float[redChroma.length];
        for (int y = 0; y < height; y++) {
            if (y % 4 == 0) for (int k = 0; k < redChroma.length; k++) {
                redChroma[k] = noise.normal(); blueChroma[k] = noise.normal();
            }
            for (int x = 0; x < width; x++) {
                int i = y * width + x, color = input[i];
                float r = (color >>> 16) & 255, g = (color >>> 8) & 255, b = color & 255;
                float luma = .299f * r + .587f * g + .114f * b;
                float detail = 0;
                if (x > 0 && x + 1 < width && y > 0 && y + 1 < height) {
                    float neighbors = (luma(input[i - 1]) + luma(input[i + 1])
                            + luma(input[i - width]) + luma(input[i + width])) * .25f;
                    detail = Math.max(-10, Math.min(10, (luma - neighbors) * p.sharpening));
                }
                r = curve[clamp((luma + (r - luma) * p.saturation + detail) * rGain)];
                g = curve[clamp((luma + (g - luma) * p.saturation + detail) * gGain)];
                b = curve[clamp((luma + (b - luma) * p.saturation + detail) * bGain)];
                float shadow = 1 - luma / 255f;
                float sigma = read * (.45f + 1.35f * shadow * shadow);
                float luminanceError = noise.normal() * sigma;
                float chromaScale = chroma * (.25f + .95f * shadow);
                float redError = redChroma[x / 4] * chromaScale;
                float blueError = blueChroma[x / 4] * chromaScale;
                // Preserve truly clipped channels instead of painting noise into blown highlights.
                int rr = r >= 255 ? 255 : clamp(r + luminanceError + redError);
                int gg = g >= 255 ? 255 : clamp(g + luminanceError - .3f * (redError + blueError));
                int bb = b >= 255 ? 255 : clamp(b + luminanceError + blueError);
                output[i] = 0xFF000000 | (rr << 16) | (gg << 8) | bb;
            }
        }
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

    private static float luma(int c) { return .299f * ((c >>> 16) & 255) + .587f * ((c >>> 8) & 255) + .114f * (c & 255); }
    private static int clamp(float value) { return Math.max(0, Math.min(255, Math.round(value))); }

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
