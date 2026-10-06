package org.textphone.launcher;

import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * How a photo is framed and stored, like a 2000s compact's menu: image size, aspect and JPEG quality.
 * Aspects other than 4:3 crop the 4:3 sensor frame, as those cameras did; nothing is ever upscaled.
 */
final class CameraFormat {
    enum Aspect {
        FOUR_THREE("4:3", 4f / 3), THREE_TWO("3:2", 1.5f), WIDE("16:9", 16f / 9), SQUARE("1:1", 1f);
        final String label; final float ratio;
        Aspect(String label, float ratio) { this.label = label; this.ratio = ratio; }
    }
    enum Quality {
        FINE("fine", 0), NORMAL("normal", 10), BASIC("basic", 22);
        final String label; private final int reduction;
        Quality(String label, int reduction) { this.label = label; this.reduction = reduction; }
        int jpeg(CameraProfile profile) { return Math.max(50, profile.jpegQuality - reduction); }
    }
    /** Long edges offered below a profile's own maximum: 3M, 2M, 1M and VGA classes. */
    private static final int[] SMALLER = {2048, 1600, 1280, 640};
    static final CameraFormat DEFAULT = new CameraFormat(Aspect.FOUR_THREE, 0, Quality.FINE);

    final Aspect aspect; final Quality quality;
    /** Requested long edge in pixels; 0 is the profile's largest size. */
    final int longEdge;

    CameraFormat(Aspect aspect, int longEdge, Quality quality) {
        this.aspect = aspect == null ? Aspect.FOUR_THREE : aspect; this.longEdge = Math.max(0, longEdge);
        this.quality = quality == null ? Quality.FINE : quality;
    }
    CameraFormat aspect(Aspect value) { return new CameraFormat(value, longEdge, quality); }
    CameraFormat size(int value) { return new CameraFormat(aspect, value, quality); }
    CameraFormat quality(Quality value) { return new CameraFormat(aspect, longEdge, value); }

    /** The long edge actually used with this profile. */
    int longEdge(CameraProfile profile) { return longEdge <= 0 ? profile.width : Math.min(longEdge, profile.width); }
    /** Sizes this profile offers, largest first; the first is always the profile's own maximum. */
    static int[] sizes(CameraProfile profile) {
        List<Integer> values = new ArrayList<>(); values.add(profile.width);
        for (int edge : SMALLER) if (edge < profile.width) values.add(edge);
        int[] result = new int[values.size()]; for (int i = 0; i < result.length; i++) result[i] = values.get(i); return result;
    }
    /**
     * Landscape pixels of an aspect at a size: the aspect cut from a 4:3 frame whose long edge is {@code longEdge},
     * so a square photo from a 3M camera is 1536 × 1536, never larger than the camera's own frame.
     */
    static int[] frame(int longEdge, Aspect aspect) {
        int width = longEdge, height = Math.max(1, Math.round(longEdge * 3f / 4));
        if (aspect.ratio >= 4f / 3) return new int[]{width, Math.min(height, Math.max(1, Math.round(width / aspect.ratio)))};
        return new int[]{Math.max(1, Math.round(height * aspect.ratio)), height};
    }
    /** "3M", "1.2M" or "VGA", the way the cameras labelled their sizes. */
    static String megapixels(int width, int height) {
        if (Math.max(width, height) <= 640) return "VGA";
        float value = width * (float) height / 1_000_000f;
        return value >= 2.75f ? Math.round(value) + "M" : String.format(Locale.ROOT, "%.1fM", value);
    }
    String sizeLabel(CameraProfile profile) { int[] size = frame(longEdge(profile), aspect); return megapixels(size[0], size[1]); }
    String summary(CameraProfile profile) { return sizeLabel(profile) + " · " + aspect.label + " · " + quality.label; }

    static CameraFormat read(SharedPreferences prefs) {
        return new CameraFormat(value(Aspect.class, prefs.getString("aspect", null), Aspect.FOUR_THREE), prefs.getInt("size_long", 0),
                value(Quality.class, prefs.getString("quality", null), Quality.FINE));
    }
    void write(SharedPreferences prefs) {
        prefs.edit().putString("aspect", aspect.name()).putInt("size_long", longEdge).putString("quality", quality.name()).apply();
    }
    private static <T extends Enum<T>> T value(Class<T> type, String name, T fallback) {
        try { return name == null ? fallback : Enum.valueOf(type, name); } catch (IllegalArgumentException unknown) { return fallback; }
    }
}
