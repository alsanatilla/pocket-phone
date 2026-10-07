package org.textphone.launcher;

import android.content.Context;
import android.graphics.Typeface;

/** The bundled faces: VT323 for titles and readings, IBM Plex Mono (SIL OFL) for everything that is read. Medium replaces bold. */
final class PocketFonts {
    private static Typeface pixel, mono, monoMedium, monoItalic;
    static synchronized Typeface pixel(Context context) {
        if (pixel == null) pixel = Typeface.createFromAsset(context.getAssets(), "fonts/VT323-Regular.ttf");
        return pixel;
    }
    /** Running text: IBM Plex Mono Regular. */
    static synchronized Typeface mono(Context context) {
        if (mono == null) mono = Typeface.createFromAsset(context.getAssets(), "fonts/IBMPlexMono-Regular.ttf");
        return mono;
    }
    /** Emphasis, section labels and the selected tab: IBM Plex Mono Medium, never a synthesized bold. */
    static synchronized Typeface monoMedium(Context context) {
        if (monoMedium == null) monoMedium = Typeface.createFromAsset(context.getAssets(), "fonts/IBMPlexMono-Medium.ttf");
        return monoMedium;
    }
    static synchronized Typeface monoItalic(Context context) {
        if (monoItalic == null) monoItalic = Typeface.createFromAsset(context.getAssets(), "fonts/IBMPlexMono-Italic.ttf");
        return monoItalic;
    }
    static Typeface body(Context context) { return mono(context); }
    static Typeface medium(Context context) { return monoMedium(context); }
    private PocketFonts() { }
}
