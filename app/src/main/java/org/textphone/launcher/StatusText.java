package org.textphone.launcher;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Small formatting helpers shared by the live home screen and its tests. */
final class StatusText {
    private StatusText() {}

    static String battery(int level, int scale, boolean charging) {
        if (level < 0 || scale <= 0) return "Battery unavailable";
        int percent = Math.max(0, Math.min(100, Math.round(level * 100f / scale)));
        return "Battery " + percent + "%" + (charging ? " · Charging" : "");
    }

    static String alarm(long triggerTime, Locale locale, boolean twentyFourHour) {
        if (triggerTime <= 0) return "No alarm set";
        String pattern = twentyFourHour ? "EEE HH:mm" : "EEE h:mm a";
        return "Next alarm · " + new SimpleDateFormat(pattern, locale).format(new Date(triggerTime));
    }
}
