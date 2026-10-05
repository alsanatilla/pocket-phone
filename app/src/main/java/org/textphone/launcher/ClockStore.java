package org.textphone.launcher;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.SystemClock;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONException;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;

final class ClockStore {
    static final class Entry {
        long id, due, elapsed, remaining,task; String kind, title; boolean enabled, daily; int hour, minute;
        int boot;
    }
    static synchronized SharedPreferences prefs(Context c) {
        if (android.os.Build.VERSION.SDK_INT < 24) return c.getSharedPreferences("pocket_clock", 0);
        Context application = c.getApplicationContext();
        Context device = application.createDeviceProtectedStorageContext();
        SharedPreferences target = device.getSharedPreferences("pocket_clock", 0);
        android.os.UserManager user = c.getSystemService(android.os.UserManager.class);
        if (!target.contains("entries") && user != null && user.isUserUnlocked()
                && application.getSharedPreferences("pocket_clock", 0).contains("entries")) {
            if (!device.moveSharedPreferencesFrom(application, "pocket_clock"))
                throw new IllegalStateException("Clock storage could not be migrated. Try reopening Clock.");
            target = device.getSharedPreferences("pocket_clock", 0);
        }
        return target;
    }
    static int boot(Context c) { return android.os.Build.VERSION.SDK_INT >= 24 ? android.provider.Settings.Global.getInt(c.getContentResolver(), "boot_count", 0) : 0; }
    static synchronized List<Entry> entries(Context c) {
        List<Entry> values = new ArrayList<>(); try { JSONArray all = new JSONArray(prefs(c).getString("entries", "[]"));
            for (int i = 0; i < all.length(); i++) { JSONObject o = all.getJSONObject(i); Entry e = new Entry();
                e.id = o.getLong("id"); e.due = o.getLong("due"); e.kind = o.getString("kind"); e.title = o.getString("title");
                e.enabled = o.getBoolean("enabled"); e.daily = o.optBoolean("daily"); e.hour = o.optInt("hour"); e.minute = o.optInt("minute");
                e.elapsed = o.optLong("elapsed"); e.remaining = o.optLong("remaining"); e.boot = o.optInt("boot");e.task=o.optLong("task"); values.add(e); }
        } catch (JSONException e) { throw new IllegalStateException("Clock data unavailable.", e); } return values;
    }
    static synchronized void save(Context c, Entry entry) {
        List<Entry> all = entries(c); if (entry.id == 0) entry.id = Math.max(System.currentTimeMillis(), prefs(c).getLong("last_id", 0) + 1);
        boolean found = false; for (int i = 0; i < all.size(); i++) if (all.get(i).id == entry.id) { all.set(i, entry); found = true; break; }
        if (!found) { if (all.size() >= 200) throw new IllegalArgumentException("Remove an old alarm first."); all.add(entry); } write(c, all, entry.id);
    }
    static synchronized void delete(Context c, long id) { List<Entry> all = entries(c); for (int i = all.size() - 1; i >= 0; i--) if (all.get(i).id == id) all.remove(i); write(c, all, 0); }
    static Entry find(Context c, long id) { for (Entry e : entries(c)) if (e.id == id) return e; return null; }
    private static void write(Context c, List<Entry> all, long id) { JSONArray array = new JSONArray();
        try { for (Entry e : all) { JSONObject o = new JSONObject(); o.put("id", e.id).put("due", e.due).put("kind", e.kind).put("title", e.title)
                .put("enabled", e.enabled).put("daily", e.daily).put("hour", e.hour).put("minute", e.minute)
                .put("elapsed", e.elapsed).put("remaining", e.remaining).put("boot", e.boot).put("task",e.task); array.put(o); }
        } catch (JSONException e) { throw new IllegalStateException(e); }
        if (!prefs(c).edit().putString("entries", array.toString()).putLong("last_id", Math.max(id, prefs(c).getLong("last_id", 0))).commit()) throw new IllegalStateException("Clock could not save.");
    }
    static long nextTime(int hour, int minute, long now) {
        Calendar date = Calendar.getInstance(); date.setTimeInMillis(now); date.set(Calendar.HOUR_OF_DAY, hour); date.set(Calendar.MINUTE, minute); date.set(Calendar.SECOND, 0); date.set(Calendar.MILLISECOND, 0);
        if (date.getTimeInMillis() <= now) date.add(Calendar.DAY_OF_YEAR, 1); return date.getTimeInMillis();
    }
    static long remaining(Context c, Entry e) { if (!e.enabled) return e.remaining;
        if ("timer".equals(e.kind) && e.boot == boot(c) && e.elapsed > 0) return Math.max(0, e.elapsed - SystemClock.elapsedRealtime());
        return Math.max(0, e.due - System.currentTimeMillis()); }
    static long lateness(Context c, Entry e) {
        return "timer".equals(e.kind) && e.boot == boot(c) && e.elapsed > 0
                ? Math.max(0, SystemClock.elapsedRealtime() - e.elapsed) : Math.max(0, System.currentTimeMillis() - e.due);
    }
}
