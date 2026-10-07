package org.textphone.launcher;

import android.content.Context;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The tiles on Today: which ones, in what order. The layout is the synced "today-tiles" preference
 * ([{uid, kind, label?}]); the browser reads the same list. Zines only exist in the browser, so the phone keeps them but does not draw them.
 */
final class TodayTiles {
    static final String[] CATALOG = {"brief", "tasks", "agenda", "thoughts", "notes", "movement", "gym", "pip", "activity", "focus", "clock", "paper", "zines", "dice"};
    static final String[] DEFAULTS = {"agenda", "thoughts", "tasks", "activity"};
    private static final String PREFERENCE = "today-tiles";

    static boolean known(String kind) { return Arrays.asList(CATALOG).contains(kind); }
    static boolean onPhone(String kind) { return known(kind) && !"zines".equals(kind); }

    private static JSONArray stored(Context c) {
        Object value = WorkspaceExtras.preference(c, PREFERENCE);
        return value instanceof JSONArray ? (JSONArray) value : null;
    }
    /** Every kind in saved order, defaults when nothing is saved, no repeats. */
    static List<String> kinds(Context c) {
        List<String> out = new ArrayList<>(); JSONArray saved = stored(c);
        if (saved == null) { out.addAll(Arrays.asList(DEFAULTS)); return out; }
        for (int i = 0; i < saved.length() && out.size() < CATALOG.length; i++) {
            JSONObject item = saved.optJSONObject(i); String kind = item == null ? "" : item.optString("kind");
            if (known(kind) && !out.contains(kind)) out.add(kind);
        }
        return out;
    }
    static void save(Context c, List<String> kinds) {
        JSONArray old = stored(c), out = new JSONArray();
        try {
            for (String kind : kinds) {
                JSONObject item = null;
                if (old != null) for (int i = 0; i < old.length(); i++) { JSONObject o = old.optJSONObject(i); if (o != null && kind.equals(o.optString("kind"))) item = o; }
                out.put(item != null ? item : new JSONObject().put("uid", kind).put("kind", kind));
            }
        } catch (JSONException error) { throw new IllegalStateException("Could not save the tiles.", error); }
        WorkspaceExtras.preference(c, PREFERENCE, out);
    }
    /** Tiles the phone can draw, in order. */
    static List<String> visible(Context c) { List<String> out = new ArrayList<>(); for (String kind : kinds(c)) if (onPhone(kind)) out.add(kind); return out; }
    /** Kinds the browser holds that the phone cannot show; saving from the phone keeps them. */
    static void saveVisible(Context c, List<String> visible) {
        List<String> all = new ArrayList<>(visible); for (String kind : kinds(c)) if (!onPhone(kind) && !all.contains(kind)) all.add(kind);
        save(c, all);
    }
    private static boolean sameDay(long a, long b) { java.util.Calendar x = java.util.Calendar.getInstance(), y = java.util.Calendar.getInstance(); x.setTimeInMillis(a); y.setTimeInMillis(b); return x.get(java.util.Calendar.YEAR) == y.get(java.util.Calendar.YEAR) && x.get(java.util.Calendar.DAY_OF_YEAR) == y.get(java.util.Calendar.DAY_OF_YEAR); }

    /** A tile's live reading: {value, detail}. Cheap local reads only. */
    static String[] reading(Context c, PlannerStore planner, String kind) {
        long now = System.currentTimeMillis();
        switch (kind) {
            case "brief": return new String[]{DailyBriefLocal.enabled(c) ? "today" : "off", ""};
            case "tasks": {
                int open = 0; String next = "";
                for (PlannerStore.Entry e : planner.entries()) if ("task".equals(e.kind) && !e.done) { open++; if (next.isEmpty()) next = ReadableRows.excerpt(e.text)[0]; }
                return new String[]{open == 0 ? "clear" : open + " open", next.isEmpty() ? "nothing waiting" : next};
            }
            case "agenda": {
                AgendaStore.Event next = null;
                for (AgendaStore.Event e : AgendaStore.list(c)) if (e.end() >= now && (next == null || e.when < next.when)) next = e;
                if (next == null) return new String[]{"free", "no appointments"};
                java.text.DateFormat time = java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT);
                boolean today = sameDay(next.when, now);
                return new String[]{(today ? "" : new java.text.SimpleDateFormat("EEE ", Locale.getDefault()).format(new Date(next.when))) + time.format(new Date(next.when)), next.title};
            }
            case "thoughts": {
                int open = ParkingStore.open(c).size(), ready = ParkingStore.backCount(c, now);
                return new String[]{open + " open", ready > 0 ? ready + " to revisit" : "undecided"};
            }
            case "notes": {
                int count = 0; long newest = -1; String title = "";
                for (PlannerStore.Entry e : planner.entries()) if ("note".equals(e.kind)) { count++; if (e.id > newest) { newest = e.id; title = ReadableRows.excerpt(e.text)[0]; } }
                return new String[]{String.valueOf(count), count == 0 ? "no notes yet" : title};
            }
            case "movement": {
                CorosRepository repository = CorosRepository.get(c);
                if (!repository.connected()) return new String[]{"connect", "COROS"};
                CorosRepository.Snapshot snapshot = repository.cached();
                if (snapshot == null || snapshot.scores == null || snapshot.scores.recovery == null) return new String[]{"…", "recovery"};
                return new String[]{snapshot.scores.recovery.score + "%", "recovery · " + snapshot.scores.recovery.zone};
            }
            case "gym": {
                if (GymStore.active(c) != null) return new String[]{"now", "workout in progress"};
                int sessions = GymStore.sessionsSince(c, GymStore.weekStart(now));
                return new String[]{sessions + "×", "this week"};
            }
            case "pip": return new String[]{"ask", "think with context"};
            case "activity": return new String[]{String.valueOf(ReceiptTape.lines(c, now).size()), "recorded today"};
            case "focus": return new String[]{"start", "a focus session"};
            case "clock": return new String[]{"clock", "alarms · timers"};
            case "paper": {
                int pages = JournalStore.visible(c).size();
                return new String[]{String.valueOf(pages), JournalStore.unread(c) ? "waiting to be read" : "handwritten pages"};
            }
            case "dice": return new String[]{"roll", "dice · coin · pick"};
            default: return new String[]{"", ""};
        }
    }
    private TodayTiles() { }
}
