package org.textphone.launcher;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Half-formed thoughts with a short fuse. Every item comes back until it is cleared, moved to Today or let go. */
final class ParkingStore {
    static final String PARKED = "parked", CLEARED = "cleared", TASK = "task", KILLED = "killed";
    static final String[] DELAYS = {"1 hour", "tonight", "tomorrow", "next week"};
    static final int HECKLE = 3;
    private static final long HOUR = 3_600_000L, DAY = 24 * HOUR, KEEP_CLOSED = 7 * DAY;
    static final class Item {
        long id, created, due, closed, updated; int notches; String text = "", state = PARKED;
        /** The uid of the note this thought was written in, or empty. */
        String note = "";
        boolean open() { return PARKED.equals(state); }
        boolean back(long now) { return open() && due <= now; }
    }
    private static final Object LOCK = new Object();
    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("pocket_parking", 0); }

    static List<Item> items(Context c) {
        List<Item> items = new ArrayList<>();
        synchronized (LOCK) {
            try {
                JSONArray array = new JSONArray(prefs(c).getString("items", "[]"));
                for (int i = 0; i < array.length(); i++) {
                    JSONObject o = array.getJSONObject(i); Item item = new Item();
                    item.id = o.getLong("id"); item.text = o.optString("text", ""); item.created = o.optLong("created");
                    item.due = o.optLong("due"); item.closed = o.optLong("closed"); item.notches = o.optInt("notches");
                    item.state = o.optString("state", PARKED); item.updated = o.optLong("updated", Math.max(item.created, item.closed)); item.note = o.optString("note", ""); items.add(item);
                }
            } catch (JSONException ignored) { /* A damaged list reads as empty rather than blocking new parking. */ }
        }
        return items;
    }
    /** Open items, the ones already back first, then by when they return. */
    static List<Item> open(Context c) {
        List<Item> open = new ArrayList<>(); for (Item item : items(c)) if (item.open()) open.add(item);
        java.util.Collections.sort(open, (a, b) -> Long.compare(a.due, b.due)); return open;
    }
    static Item find(Context c, long id) { for (Item item : items(c)) if (item.id == id) return item; return null; }
    static int backCount(Context c, long now) { int n = 0; for (Item item : items(c)) if (item.back(now)) n++; return n; }
    static long nextDue(Context c, long after) {
        long next = 0; for (Item item : items(c)) if (item.open() && item.due > after && (next == 0 || item.due < next)) next = item.due; return next;
    }

    static Item park(Context c, String text, long due) {
        String value = text == null ? "" : text.trim();
        if (value.isEmpty()) throw new IllegalArgumentException("Type the thought first.");
        synchronized (LOCK) {
            List<Item> items = items(c); Item item = new Item(); long now = System.currentTimeMillis();
            item.id = Math.max(now, prefs(c).getLong("last_id", 0) + 1); item.created = item.updated = now; item.due = due; item.text = value;
            items.add(item); write(c, items, now); prefs(c).edit().putLong("last_id", item.id).apply(); return item;
        }
    }
    /** Parking again earns a notch; the notch count is what the heckling reads. */
    static Item repark(Context c, long id, long due) {
        synchronized (LOCK) {
            List<Item> items = items(c); Item item = only(items, id); item.due = due; item.notches++; item.updated = System.currentTimeMillis();
            write(c, items, System.currentTimeMillis()); return item;
        }
    }
    /**
     * A thought written in a note. Its id comes from the note and the line, so the phone and the web create the same item.
     * Writing a cleared thought again parks it again; one that is still parked is left alone.
     */
    static Item parkFromNote(Context c, long id, String text, long due, String note) {
        synchronized (LOCK) {
            List<Item> items = items(c); long now = System.currentTimeMillis();
            for (Item item : items) if (item.id == id) {
                if (item.open()) return null;
                item.state = PARKED; item.due = due; item.closed = 0; item.text = text; item.note = note; item.updated = now;
                write(c, items, now); return item;
            }
            Item item = new Item(); item.id = id; item.created = item.updated = now; item.due = due; item.text = text; item.note = note;
            items.add(item); write(c, items, now); return item;
        }
    }
    static Item bringBack(Context c, long id) {
        synchronized (LOCK) { List<Item> items = items(c); Item item = only(items, id); item.due = item.updated = System.currentTimeMillis(); write(c, items, item.due); return item; }
    }
    static Item close(Context c, long id, String state) {
        synchronized (LOCK) {
            List<Item> items = items(c); Item item = only(items, id); long now = System.currentTimeMillis();
            item.state = state; item.closed = item.updated = now; write(c, items, now); return item;
        }
    }
    private static Item only(List<Item> items, long id) {
        for (Item item : items) if (item.id == id && item.open()) return item;
        throw new IllegalStateException("This item was already cleared.");
    }
    private static void write(Context c, List<Item> items, long now) { save(c, encode(items, now)); CloudSync.changed(c); }
    private static void save(Context c, JSONArray array) {
        if (!prefs(c).edit().putString("items", array.toString()).commit()) throw new IllegalStateException("Could not save. Try again.");
    }
    /** Closed items fall out after a week on every copy, so an old copy cannot bring them back for good. */
    private static JSONArray encode(List<Item> items, long now) {
        JSONArray array = new JSONArray();
        try {
            for (Item item : items) {
                if (!item.open() && now - item.closed > KEEP_CLOSED) continue;
                array.put(new JSONObject().put("id", item.id).put("text", item.text).put("created", item.created).put("due", item.due)
                        .put("closed", item.closed).put("notches", item.notches).put("state", item.state).put("updated", item.updated).put("note", item.note));
            }
        } catch (JSONException impossible) { throw new IllegalStateException(impossible); }
        return array;
    }

    /** Cloud document: {"v":1,"items":[…]}. Each item keeps whichever copy was edited last. */
    static JSONObject merge(Context c, JSONObject remote) throws JSONException {
        synchronized (LOCK) {
            JSONArray local = new JSONArray(prefs(c).getString("items", "[]"));
            JSONArray merged = SyncMerge.byId(local, remote == null ? new JSONArray() : remote.optJSONArray("items"), "id", "updated");
            List<Item> items = new ArrayList<>(); save(c, merged);
            items.addAll(items(c)); JSONArray pruned = encode(items, System.currentTimeMillis()); save(c, pruned);
            long last = prefs(c).getLong("last_id", 0); for (Item item : items) last = Math.max(last, item.id);
            prefs(c).edit().putLong("last_id", last).apply();
            return new JSONObject().put("v", 1).put("items", pruned);
        }
    }

    static long when(String delay, long now) {
        Calendar at = Calendar.getInstance(); at.setTimeInMillis(now); at.set(Calendar.SECOND, 0); at.set(Calendar.MILLISECOND, 0);
        // A clock time ("16:30") means the next time the clock shows it: today, or tomorrow once it has passed.
        java.util.regex.Matcher clock = java.util.regex.Pattern.compile("(\\d{1,2})[:.](\\d{2})").matcher(delay);
        if (clock.matches() && Integer.parseInt(clock.group(1)) < 24 && Integer.parseInt(clock.group(2)) < 60) {
            at.set(Calendar.HOUR_OF_DAY, Integer.parseInt(clock.group(1))); at.set(Calendar.MINUTE, Integer.parseInt(clock.group(2)));
            if (at.getTimeInMillis() <= now) at.add(Calendar.DAY_OF_MONTH, 1);
            return at.getTimeInMillis();
        }
        switch (delay) {
            case "tonight":
                at.set(Calendar.HOUR_OF_DAY, 20); at.set(Calendar.MINUTE, 0);
                if (at.getTimeInMillis() - now < HOUR / 2) at.add(Calendar.DAY_OF_MONTH, 1);
                return at.getTimeInMillis();
            case "tomorrow":
                at.add(Calendar.DAY_OF_MONTH, 1); at.set(Calendar.HOUR_OF_DAY, 9); at.set(Calendar.MINUTE, 0); return at.getTimeInMillis();
            case "next week":
                at.set(Calendar.HOUR_OF_DAY, 9); at.set(Calendar.MINUTE, 0);
                do at.add(Calendar.DAY_OF_MONTH, 1); while (at.get(Calendar.DAY_OF_WEEK) != Calendar.MONDAY);
                return at.getTimeInMillis();
            default: return now + HOUR;
        }
    }
    /** "[###··]" — five notches is the end of the meter, not of the nagging. */
    static String meter(int notches) {
        StringBuilder out = new StringBuilder("[");
        for (int i = 0; i < 5; i++) out.append(i < notches ? '#' : '·');
        return out.append(']').toString();
    }
    static int days(Item item, long now) { return (int) Math.max(0, (now - item.created) / DAY); }
    static String heckle(Item item, long now) {
        int days = days(item, now);
        if (item.notches >= 6) return "PARKED " + item.notches + "×. I AM BEGGING YOU.";
        if (item.notches >= 4) return "PARKED " + item.notches + "×. JUST LET IT GO. NOBODY WILL KNOW.";
        if (item.notches >= HECKLE) return days == 0 ? "PARKED " + item.notches + "× TODAY. DO IT OR LET IT GO."
                : "THIS HAS BEEN HERE " + (days == 1 ? "1 DAY" : days + " DAYS") + ". DO SOMETHING OR LET IT GO.";
        if (item.notches == 2) return "parked twice. hmm.";
        if (item.notches == 1) return "back again.";
        return "";
    }
    private ParkingStore() { }
}
