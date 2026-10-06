package org.textphone.launcher;

import android.content.Context;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * A line "&gt;&gt; call Sam @tomorrow" captures an undecided thought to revisit tomorrow.
 * The note stays intact. Stable ids match the web; making a task is a separate, explicit choice.
 */
final class NoteThoughts {
    static final Pattern LINE = Pattern.compile("^[ \\t]*>>[ \\t]+(.+?)(?:[ \\t]+@(1h|tonight|tomorrow|tmrw|nextweek|\\d{1,2}[:.]\\d{2}))?[ \\t]*$", Pattern.CASE_INSENSITIVE);
    private static final long ID_BASE = 9_000_000_000_000_000L;

    static final class Thought { final String text, key, delay; Thought(String text, String delay) { this.text = text; this.key = key(text); this.delay = delay; } }

    static List<Thought> parse(String note) {
        List<Thought> thoughts = new ArrayList<>();
        for (String line : note.split("\n", -1)) {
            Matcher m = LINE.matcher(line.replace("\r", ""));
            if (m.matches() && !m.group(1).trim().isEmpty()) thoughts.add(new Thought(m.group(1).trim(), delay(m.group(2))));
        }
        return thoughts;
    }
    static String key(String text) { return text.trim().replaceAll("[ \\t]+", " ").toLowerCase(Locale.ROOT); }
    private static String delay(String tag) {
        if (tag == null) return "none";
        switch (tag.toLowerCase(Locale.ROOT)) { case "tonight": return "tonight"; case "tomorrow": case "tmrw": return "tomorrow"; case "nextweek": return "next week"; default: return tag.matches("\\d{1,2}[:.]\\d{2}") ? tag : "1 hour"; }
    }
    /** FNV-1a over "uid\nkey", in a range no timestamp id reaches. Same on the web. */
    static long id(String noteUid, String key) {
        int hash = 0x811c9dc5;
        for (byte b : (noteUid + "\n" + key).getBytes(StandardCharsets.UTF_8)) { hash ^= b & 0xff; hash *= 0x01000193; }
        return ID_BASE + (hash & 0xffffffffL);
    }

    /**
     * After a note is saved: park each thought line that is new, or that never became a Parking item
     * (for example a line that arrived by sync before its thought did). Unchanged parked lines are left alone.
     */
    static int parkNew(Context c, PlannerStore store, long noteId, String before, String after) {
        List<Thought> current = parse(after);
        if (current.isEmpty()) return 0;
        String uid = NoteSync.uid(store, noteId);
        Map<String, Integer> old = new HashMap<>();
        for (Thought t : parse(before == null ? "" : before)) {
            if (ParkingStore.find(c, id(uid, t.key)) == null) continue;
            Integer n = old.get(t.key); old.put(t.key, n == null ? 1 : n + 1);
        }
        List<Thought> added = new ArrayList<>();
        for (Thought t : current) { Integer n = old.get(t.key); if (n != null && n > 0) old.put(t.key, n - 1); else added.add(t); }
        if (added.isEmpty()) return 0;
        long now = System.currentTimeMillis();
        for (Thought t : added) ParkingStore.parkFromNote(c, id(uid, t.key), t.text, "none".equals(t.delay) ? 0 : ParkingStore.when(t.delay, now), uid);
        ParkingReceiver.arm(c);
        return added.size();
    }
    /** A note's first non-empty line without its heading marker or thought time. */
    static String title(PlannerStore.Entry note) {
        for (String line : note.text.split("\n")) if (!line.trim().isEmpty())
            return line.replaceFirst("^\\s*(#+|>>)\\s*", "").replaceFirst("(?i)\\s+@(1h|tonight|tomorrow|tmrw|nextweek|\\d{1,2}[:.]\\d{2})\\s*$", "").trim();
        return "note";
    }
    /** The task a thought line became, if it is still on this phone. */
    private static PlannerStore.Entry task(PlannerStore store, long thought) {
        String token = ParkingStore.token(thought);
        try { for (PlannerStore.Entry e : store.entries()) if (e.source != null && token.equals(e.source.token)) return e; }
        catch (IllegalStateException unreadable) { return null; }
        return null;
    }

    /** Preview only: each thought line shows what happened to it in the Parking Lot. */
    static String annotate(Context c, PlannerStore store, long noteId, String text) {
        String uid = noteId == 0 ? null : NoteSync.existingUid(store, noteId);
        StringBuilder out = new StringBuilder();
        for (String line : text.split("\n", -1)) {
            Matcher m = LINE.matcher(line.replace("\r", ""));
            if (!m.matches() || m.group(1).trim().isEmpty()) { out.append(line).append('\n'); continue; }
            long thought = uid == null ? 0 : id(uid, key(m.group(1)));
            ParkingStore.Item item = uid == null ? null : ParkingStore.find(c, thought);
            out.append("> **»** ").append(m.group(1).trim()).append("  _· ").append(status(item, item == null ? null : task(store, thought))).append("_\n");
        }
        return out.length() > 0 ? out.substring(0, out.length() - 1) : "";
    }
    static String status(ParkingStore.Item item, PlannerStore.Entry task) {
        if (item == null) return "saved to thoughts";
        if (ParkingStore.CLEARED.equals(item.state)) return "cleared";
        if (ParkingStore.KILLED.equals(item.state)) return "let go";
        if (task != null) return task.done ? "task done" : "task";
        return ParkingStore.TASK.equals(item.state) ? "task removed" : item.due == 0 ? "thought" : "parked for review";
    }
    private NoteThoughts() { }
}
