package org.textphone.launcher;

import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Stable slot keys keep existing app assignments when the visible name changes.
 *  Each of the nine slots holds a group, an installed app or one of Pocket's own apps, in that order. */
final class DashboardTiles {
    static final int GROUP_LIMIT = 9;
    private static final String[] KEYS = {"shortcut_", "shortcut_app_label_", "shortcut_name_", "tile_pocket_", "tile_group_"};
    /** A group entry opens either a Pocket app id or an installed package. */
    static final class Member {
        final String pocket, app, label;
        private Member(String pocket, String app, String label) { this.pocket = pocket; this.app = app; this.label = label; }
        static Member pocket(String id) { return new Member(id, null, PocketApps.label(id)); }
        static Member app(String packageName, String label) { return new Member(null, packageName, label == null || label.isEmpty() ? packageName : label); }
        int icon() { return pocket == null ? PocketApps.APP_ICON : PocketApps.icon(pocket); }
    }
    private final SharedPreferences preferences;
    DashboardTiles(SharedPreferences preferences) { this.preferences = preferences; }
    String app(String slot) { return group(slot) ? null : preferences.getString("shortcut_" + slot, null); }
    /** The Pocket app a slot opens without an app binding; also the icon an app binding keeps. */
    String pocket(String slot) {
        String id = preferences.getString("tile_pocket_" + slot, slot);
        return PocketApps.known(id) ? id : slot;
    }
    boolean group(String slot) { return preferences.contains("tile_group_" + slot); }
    int icon(String slot) { return group(slot) ? PocketApps.GROUP_ICON : PocketApps.icon(pocket(slot)); }
    String label(String slot) {
        String custom = preferences.getString("shortcut_name_" + slot, "");
        if (!custom.isEmpty()) return custom;
        if (group(slot)) return "group";
        String app = app(slot);
        if (app == null) return PocketApps.known(pocket(slot)) ? PocketApps.label(pocket(slot)) : slot;
        String label = preferences.getString("shortcut_app_label_" + slot, "");
        // Old installations may only have a package binding. Show its name until the worker resolves it.
        return label.isEmpty() ? app.substring(app.lastIndexOf('.') + 1) : label;
    }
    void assign(String slot, String app, String label) {
        preferences.edit().putString("shortcut_" + slot, app).putString("shortcut_app_label_" + slot, label)
                .remove("shortcut_name_" + slot).remove("tile_group_" + slot).apply();
    }
    void usePocket(String slot, String id) {
        if (!PocketApps.known(id)) throw new IllegalArgumentException("Unknown Pocket app.");
        preferences.edit().remove("shortcut_" + slot).remove("shortcut_app_label_" + slot).remove("shortcut_name_" + slot)
                .remove("tile_group_" + slot).putString("tile_pocket_" + slot, id).apply();
    }
    void rename(String slot, String name) {
        String trimmed = name.trim();
        if (trimmed.isEmpty()) useAppName(slot);
        else preferences.edit().putString("shortcut_name_" + slot, trimmed).apply();
    }
    void useAppName(String slot) { preferences.edit().remove("shortcut_name_" + slot).apply(); }
    void reset(String slot) {
        SharedPreferences.Editor edit = preferences.edit();
        for (String key : KEYS) edit.remove(key + slot);
        edit.apply();
    }
    void resolved(String slot, String app, String label) {
        if (app.equals(app(slot)) && !label.isEmpty()) preferences.edit().putString("shortcut_app_label_" + slot, label).apply();
    }
    /** Moving a tile swaps everything both slots hold, so positions change but nothing is lost. */
    void swap(String first, String second) {
        if (first.equals(second)) return;
        java.util.Map<String, ?> all = preferences.getAll(); SharedPreferences.Editor edit = preferences.edit();
        for (String key : KEYS) {
            Object a = all.get(key + first), b = all.get(key + second);
            if (b instanceof String) edit.putString(key + first, (String) b); else edit.remove(key + first);
            if (a instanceof String) edit.putString(key + second, (String) a); else edit.remove(key + second);
        }
        edit.apply();
    }

    /** The slot's current app becomes the first member, so turning a tile into a group never hides it. */
    void makeGroup(String slot, String name) {
        List<Member> members = new ArrayList<>();
        if (!group(slot)) {
            String app = app(slot);
            members.add(app == null ? Member.pocket(pocket(slot)) : Member.app(app, preferences.getString("shortcut_app_label_" + slot, "")));
        } else members.addAll(members(slot));
        String trimmed = name == null ? "" : name.trim();
        SharedPreferences.Editor edit = preferences.edit().remove("shortcut_" + slot).remove("shortcut_app_label_" + slot)
                .putString("tile_group_" + slot, encode(members));
        if (trimmed.isEmpty()) edit.remove("shortcut_name_" + slot); else edit.putString("shortcut_name_" + slot, trimmed);
        edit.apply();
    }
    List<Member> members(String slot) {
        List<Member> members = new ArrayList<>();
        try {
            JSONArray array = new JSONArray(preferences.getString("tile_group_" + slot, "[]"));
            for (int i = 0; i < array.length() && members.size() < GROUP_LIMIT; i++) {
                JSONObject item = array.getJSONObject(i);
                if (item.has("p") && PocketApps.known(item.getString("p"))) members.add(Member.pocket(item.getString("p")));
                else if (item.has("a")) members.add(Member.app(item.getString("a"), item.optString("l", "")));
            }
        } catch (JSONException ignored) { /* A damaged group opens empty and can be refilled. */ }
        return members;
    }
    void saveMembers(String slot, List<Member> members) {
        if (members.size() > GROUP_LIMIT) throw new IllegalArgumentException("A group holds up to nine apps.");
        preferences.edit().putString("tile_group_" + slot, encode(members)).apply();
    }
    void addMember(String slot, Member member) {
        List<Member> members = members(slot);
        if (members.size() >= GROUP_LIMIT) throw new IllegalArgumentException("This group is full. Remove an app first.");
        members.add(member); saveMembers(slot, members);
    }
    private static String encode(List<Member> members) {
        JSONArray array = new JSONArray();
        try {
            for (Member member : members) {
                JSONObject item = new JSONObject();
                if (member.pocket != null) item.put("p", member.pocket); else item.put("a", member.app).put("l", member.label);
                array.put(item);
            }
        } catch (JSONException impossible) { throw new IllegalStateException(impossible); }
        return array.toString();
    }
}
