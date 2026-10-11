package org.textphone.launcher;

import android.content.Context;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import org.json.JSONObject;

/** Readings from Pocket's local stores. Drawing a tile never starts a network request. */
final class LiveTileData {
    final String value, detail, status;
    final double[] bars;
    final int progress;

    LiveTileData(String value, String detail, String status) { this(value, detail, status, -1, null); }
    LiveTileData(String value, String detail, String status, int progress, double[] bars) {
        this.value = value; this.detail = detail; this.status = status; this.progress = progress; this.bars = bars;
    }
    String key() { return value + "\n" + detail + "\n" + status + ":" + progress + java.util.Arrays.toString(bars); }
    static String title(String text) { return ReadableRows.excerpt(text)[0]; }
    static String time(Context c, long when) {
        boolean full = c.getSharedPreferences("text_phone", 0).getBoolean("twenty_four_hour", true);
        return new SimpleDateFormat(full ? "HH:mm" : "h:mm a", Locale.getDefault()).format(new Date(when));
    }
    static LiveTileData read(Context c, PlannerStore planner, String kind) {
        try { return fromStore(c, planner, kind); }
        catch (RuntimeException unavailable) { return new LiveTileData("—", "Unavailable", ""); }
    }
    private static LiveTileData fromStore(Context c, PlannerStore planner, String kind) {
        long now = System.currentTimeMillis();
        switch (kind) {
            case "tasks": {
                List<PlannerStore.Entry> entries = planner.entries();
                PlannerStore.Entry chosen = planner.nextTask(entries);
                List<String> preview = new ArrayList<>();
                if (chosen != null) preview.add(title(chosen.text));
                int open = 0, done = 0;
                for (PlannerStore.Entry e : entries) if ("task".equals(e.kind)) {
                    if (e.done) done++; else { open++; if (preview.size() < 2 && (chosen == null || chosen.id != e.id)) preview.add(title(e.text)); }
                }
                return new LiveTileData(String.valueOf(open), preview.isEmpty() ? "All clear" : String.join("\n", preview), "open",
                        open + done == 0 ? -1 : done * 100 / (open + done), null);
            }
            case "agenda": {
                DayPlan.Item next = DayPlan.local(c, now).next();
                if (next == null) return new LiveTileData("Free", "No upcoming events", "");
                String day = new SimpleDateFormat("EEE d MMM", Locale.getDefault()).format(new Date(next.when));
                if (ReceiptTape.day(next.when).equals(ReceiptTape.day(now))) day = "today";
                return new LiveTileData(next.allDay ? "All day" : time(c, next.when), next.title,
                        next.when <= now && next.end > now ? "now" : day);
            }
            case "thoughts": {
                List<ParkingStore.Item> items = ParkingStore.open(c);
                ParkingStore.Item first = null; int ready = 0;
                for (ParkingStore.Item item : items) { if (first == null) first = item; if (item.back(now)) { ready++; if (!first.back(now)) first = item; } }
                return new LiveTileData(String.valueOf(items.size()), first == null ? "Nothing parked" : title(first.text), ready > 0 ? ready + " to revisit" : "parked");
            }
            case "notes": {
                PlannerStore.Entry latest = null; int count = 0;
                for (PlannerStore.Entry e : planner.entries()) if ("note".equals(e.kind)) {
                    count++; if (latest == null || planner.noteUpdated(e) > planner.noteUpdated(latest)) latest = e;
                }
                return new LiveTileData(String.valueOf(count), latest == null ? "No notes yet" : title(latest.text), "saved");
            }
            case "movement": {
                CorosRepository repo = CorosRepository.get(c);
                CorosRepository.Snapshot snapshot = repo.cached();
                if (snapshot == null || snapshot.scores == null) return new LiveTileData("—", repo.connected() ? "Waiting for COROS" : "Connect COROS", "");
                Scores.Result s = snapshot.scores;
                String recovery = s.recovery == null ? "—" : s.recovery.score + "%";
                String detail = "Recovery" + (s.strain == null ? "" : " · strain " + s.strain.strain + "%")
                        + (s.conditioning == null ? "" : "\nCondition " + s.conditioning.score);
                return new LiveTileData(recovery, detail, snapshot.today() ? "today" : snapshot.date.toString(), s.recovery == null ? -1 : s.recovery.score, null);
            }
            case "gym": {
                JSONObject active = GymStore.active(c);
                if (active != null) return new LiveTileData(String.valueOf(GymStore.setCount(active)),
                        String.join(" · ", GymStore.exerciseNames(active)), "sets · now");
                int count = GymStore.sessionsSince(c, GymStore.weekStart(now));
                double[] volume = GymStore.weeklyVolume(c, 8);
                double total = volume.length == 0 ? 0 : volume[volume.length - 1];
                return new LiveTileData(count + "×", total > 0 ? GymStore.kg(total) + " kg lifted" : "No sets this week", "this week", -1, volume);
            }
            case "clock": {
                ClockStore.Entry next = null;
                for (ClockStore.Entry e : ClockStore.entries(c)) if (e.enabled && "alarm".equals(e.kind) && (next == null || e.due < next.due)) next = e;
                return new LiveTileData(time(c, now), next == null ? new SimpleDateFormat("EEEE d MMM", Locale.getDefault()).format(new Date(now)) : "Alarm " + time(c, next.due), "");
            }
            case "focus": {
                ClockStore.Entry active = null;
                for (ClockStore.Entry e : ClockStore.entries(c)) if (e.enabled && "timer".equals(e.kind)
                        && (e.title.equals("Focus") || e.title.startsWith("Focus:") || e.title.equals("Break"))) {
                    if (active == null || e.due < active.due) active = e;
                }
                if (active != null) return new LiveTileData(String.valueOf((ClockStore.remaining(c, active) + 59999) / 60000), active.title, "min left");
                PlannerStore.Entry next = planner.nextTask();
                return new LiveTileData("25", next == null ? "Start a session" : title(next.text), "min");
            }
            case "activity": {
                List<ReceiptTape.Line> lines = ReceiptTape.lines(c, now);
                return new LiveTileData(String.valueOf(lines.size()), lines.isEmpty() ? "Nothing recorded" : lines.get(lines.size() - 1).text, "today");
            }
            case "pip": return new LiveTileData("", "", "");
            default: {
                String[] reading = TodayTiles.reading(c, planner, kind);
                return new LiveTileData(reading[0], reading[1], "");
            }
        }
    }
    private LiveTileData() { throw new AssertionError(); }
}
