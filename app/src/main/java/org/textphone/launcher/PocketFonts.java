package org.textphone.launcher;

import android.content.Context;
import android.graphics.Typeface;

final class PocketFonts {
    private static Typeface pixel;
    static synchronized Typeface pixel(Context context) {
        if (pixel == null) pixel = Typeface.createFromAsset(context.getAssets(), "fonts/VT323-Regular.ttf");
        return pixel;
    }
    private PocketFonts() { }
}
