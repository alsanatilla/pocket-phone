package org.textphone.launcher;

import android.content.SharedPreferences;

/** Stable slot keys keep existing app assignments when the visible name changes. */
final class DashboardTiles {
    private final SharedPreferences preferences;
    DashboardTiles(SharedPreferences preferences) { this.preferences = preferences; }
    String app(String slot) { return preferences.getString("shortcut_" + slot, null); }
    String label(String slot) {
        String custom = preferences.getString("shortcut_name_" + slot, "");
        if (!custom.isEmpty()) return custom;
        String app = app(slot);
        if (app == null) return slot;
        String label = preferences.getString("shortcut_app_label_" + slot, "");
        // Old installations may only have a package binding. Show its name until the worker resolves it.
        return label.isEmpty() ? app.substring(app.lastIndexOf('.') + 1) : label;
    }
    void assign(String slot, String app, String label) {
        preferences.edit().putString("shortcut_" + slot, app).putString("shortcut_app_label_" + slot, label)
                .remove("shortcut_name_" + slot).apply();
    }
    void rename(String slot, String name) {
        String trimmed = name.trim();
        if (trimmed.isEmpty()) useAppName(slot);
        else preferences.edit().putString("shortcut_name_" + slot, trimmed).apply();
    }
    void useAppName(String slot) { preferences.edit().remove("shortcut_name_" + slot).apply(); }
    void reset(String slot) {
        preferences.edit().remove("shortcut_" + slot).remove("shortcut_app_label_" + slot).remove("shortcut_name_" + slot).apply();
    }
    void resolved(String slot, String app, String label) {
        if (app.equals(app(slot)) && !label.isEmpty()) preferences.edit().putString("shortcut_app_label_" + slot, label).apply();
    }
}
