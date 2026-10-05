package org.textphone.launcher;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.UserManager;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** A private day log of things Pocket itself did. It never reads other apps, calls or messages. */
final class ReceiptTape {
    static final String ALARM = "ALARM", DONE = "DONE", PHOTO = "PHOTO", ROLL = "ROLL", PARK = "PARK", CLEAR = "CLEAR", KILL = "KILL", TASK = "TASK", MEMO = "MEMO";
    static final int KEEP_DAYS = 30, DAY_LIMIT = 300;
    static final class Line {
        final long when; final String kind, text;
        Line(long when, String kind, String text) { this.when = when; this.kind = kind; this.text = text; }
    }
    private static final Object LOCK = new Object();
    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("pocket_receipt", 0); }
    static String day(long when) { return new SimpleDateFormat("yyyyMMdd", Locale.ROOT).format(new Date(when)); }

    /** Logging is a side effect; it never interrupts the action that triggered it. */
    static void log(Context c, String kind, String text) { log(c, kind, text, System.currentTimeMillis()); }
    static void log(Context c, String kind, String text, long when) {
        try {
            if (Build.VERSION.SDK_INT >= 24) { UserManager user = c.getSystemService(UserManager.class); if (user != null && !user.isUserUnlocked()) return; }
            String value = text == null ? "" : text.replace('\n', ' ').trim();
            if (value.length() > 120) value = value.substring(0, 119) + "…";
            synchronized (LOCK) {
                SharedPreferences p = prefs(c); String key = "day_" + day(when);
                JSONArray lines = new JSONArray(p.getString(key, "[]"));
                if (lines.length() >= DAY_LIMIT) return;
                lines.put(new JSONObject().put("i", Long.toString(when, 36) + "-" + Integer.toString(new java.util.Random().nextInt(1 << 30), 36)).put("t", when).put("k", kind).put("x", value));
                SharedPreferences.Editor edit = p.edit().putString(key, lines.toString());
                Calendar oldest = Calendar.getInstance(); oldest.setTimeInMillis(when); oldest.add(Calendar.DAY_OF_MONTH, -KEEP_DAYS);
                String cutoff = "day_" + day(oldest.getTimeInMillis());
                for (String existing : p.getAll().keySet()) if (existing.startsWith("day_") && existing.compareTo(cutoff) < 0) edit.remove(existing);
                edit.apply(); CloudSync.changed(c);
            }
        } catch (JSONException | RuntimeException ignored) { /* The receipt is optional; the original action already happened. */ }
    }
    static List<Line> lines(Context c, long day) {
        List<Line> lines = new ArrayList<>();
        synchronized (LOCK) {
            try {
                JSONArray array = new JSONArray(prefs(c).getString("day_" + day(day), "[]"));
                for (int i = 0; i < array.length(); i++) { JSONObject item = array.getJSONObject(i);
                    lines.add(new Line(item.getLong("t"), item.optString("k", MEMO), item.optString("x", ""))); }
            } catch (JSONException ignored) { /* A damaged day reads as empty. */ }
        }
        java.util.Collections.sort(lines, (a, b) -> Long.compare(a.when, b.when));
        return lines;
    }
    /** Cloud document: {"v":1,"days":{"yyyyMMdd":[{"i","t","k","x"}]}}. Lines never change, so a day is the union of both copies. */
    static JSONObject merge(Context c, JSONObject remote) throws JSONException {
        synchronized (LOCK) {
            SharedPreferences p = prefs(c); JSONObject remoteDays = remote == null ? null : remote.optJSONObject("days");
            Calendar oldest = Calendar.getInstance(); oldest.add(Calendar.DAY_OF_MONTH, -KEEP_DAYS); String cutoff = day(oldest.getTimeInMillis());
            java.util.Set<String> days = new java.util.TreeSet<>();
            for (String key : p.getAll().keySet()) if (key.startsWith("day_")) days.add(key.substring(4));
            if (remoteDays != null) for (java.util.Iterator<String> it = remoteDays.keys(); it.hasNext(); ) { String day = it.next(); if (day.matches("\\d{8}")) days.add(day); }
            JSONObject out = new JSONObject(); SharedPreferences.Editor edit = p.edit();
            for (String day : days) {
                if (day.compareTo(cutoff) < 0) { edit.remove("day_" + day); continue; }
                JSONArray merged = SyncMerge.byId(withIds(new JSONArray(p.getString("day_" + day, "[]"))),
                        remoteDays == null ? null : withIds(remoteDays.optJSONArray(day)), "i", "t");
                List<JSONObject> sorted = new ArrayList<>(); for (int i = 0; i < merged.length(); i++) sorted.add(merged.getJSONObject(i));
                java.util.Collections.sort(sorted, (a, b) -> Long.compare(a.optLong("t"), b.optLong("t")));
                JSONArray lines = new JSONArray(); for (int i = 0; i < Math.min(DAY_LIMIT, sorted.size()); i++) lines.put(sorted.get(i));
                edit.putString("day_" + day, lines.toString()); out.put(day, lines);
            }
            if (!edit.commit()) throw new IllegalStateException("Could not save the receipt.");
            return new JSONObject().put("v", 1).put("days", out);
        }
    }
    /** Lines from before sync get an id both copies derive the same way. */
    private static JSONArray withIds(JSONArray lines) throws JSONException {
        if (lines == null) return new JSONArray();
        for (int i = 0; i < lines.length(); i++) { JSONObject line = lines.optJSONObject(i);
            if (line != null && !line.has("i")) line.put("i", "legacy-" + line.optLong("t") + "-" + Integer.toHexString((line.optString("k") + line.optString("x")).hashCode())); }
        return lines;
    }
    static int count(List<Line> lines, String kind) { int total = 0; for (Line line : lines) if (kind.equals(line.kind)) total++; return total; }

    /** Plain 32-column text for sharing, the width of a real till roll. */
    static String text(long day, List<Line> lines, boolean twentyFour) {
        StringBuilder out = new StringBuilder(); String rule = "--------------------------------\n";
        out.append(center("POCKET PHONE")).append(center("** DAY RECEIPT **"))
                .append(center(new SimpleDateFormat("EEE dd MMM yyyy", Locale.getDefault()).format(new Date(day)).toUpperCase(Locale.getDefault()))).append(rule);
        SimpleDateFormat time = new SimpleDateFormat(twentyFour ? "HH:mm" : "h:mma", Locale.getDefault());
        if (lines.isEmpty()) out.append(center("NO ITEMS"));
        for (Line line : lines) out.append(pad(time.format(new Date(line.when)), 7)).append(pad(line.kind, 6)).append(line.text).append('\n');
        out.append(rule);
        for (String[] total : totals(lines)) out.append(pad(total[0], 26)).append(String.format(Locale.ROOT, "%6s", total[1])).append('\n');
        return out.append(rule).append(center("THANK YOU FOR LIVING")).append(center("PLEASE COME AGAIN")).toString();
    }
    static List<String[]> totals(List<Line> lines) {
        List<String[]> totals = new ArrayList<>();
        totals.add(new String[]{"ITEMS", String.valueOf(lines.size())});
        String[][] named = {{DONE, "TASKS DONE"}, {CLEAR, "CLEARED"}, {KILL, "LET GO"}, {PHOTO, "PHOTOS"}, {ROLL, "ROLLS"}, {ALARM, "ALARMS"}};
        for (String[] kind : named) { int n = count(lines, kind[0]); if (n > 0) totals.add(new String[]{kind[1], String.valueOf(n)}); }
        return totals;
    }
    private static String pad(String value, int width) { StringBuilder out = new StringBuilder(value); while (out.length() < width) out.append(' '); return out.toString(); }
    private static String center(String value) { int space = Math.max(0, (32 - value.length()) / 2); StringBuilder out = new StringBuilder(); for (int i = 0; i < space; i++) out.append(' '); return out.append(value).append('\n').toString(); }
    private ReceiptTape() { }
}
