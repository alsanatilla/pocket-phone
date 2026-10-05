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
 * Thoughts written inside a note: a line "&gt;&gt; call Sam @tomorrow" parks "call Sam" in the Parking Lot.
 * The note text is never rewritten; the Parking item keeps the link. Mirrors docs/js/store.js.
 */
final class NoteThoughts {
    static final Pattern LINE = Pattern.compile("^[ \\t]*>>[ \\t]+(.+?)(?:[ \\t]+@(1h|tonight|tomorrow|tmrw|nextweek))?[ \\t]*$", Pattern.CASE_INSENSITIVE);
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
        if (tag == null) return "1 hour";
        switch (tag.toLowerCase(Locale.ROOT)) { case "tonight": return "tonight"; case "tomorrow": case "tmrw": return "tomorrow"; case "nextweek": return "next week"; default: return "1 hour"; }
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
        int parked = 0; long now = System.currentTimeMillis();
        for (Thought t : added) {
            ParkingStore.Item item = ParkingStore.parkFromNote(c, id(uid, t.key), t.text, ParkingStore.when(t.delay, now), uid);
            if (item != null) { parked++; ReceiptTape.log(c, ReceiptTape.PARK, item.text); }
        }
        if (parked > 0) ParkingReceiver.arm(c);
        return parked;
    }

    /** Preview only: each thought line shows what happened to it in the Parking Lot. */
    static String annotate(Context c, PlannerStore store, long noteId, String text) {
        String uid = noteId == 0 ? null : NoteSync.existingUid(store, noteId);
        StringBuilder out = new StringBuilder(); long now = System.currentTimeMillis();
        for (String line : text.split("\n", -1)) {
            Matcher m = LINE.matcher(line.replace("\r", ""));
            if (!m.matches() || m.group(1).trim().isEmpty()) { out.append(line).append('\n'); continue; }
            ParkingStore.Item item = uid == null ? null : ParkingStore.find(c, id(uid, key(m.group(1))));
            out.append("> **»** ").append(m.group(1).trim()).append("  _· ").append(status(item, now)).append("_\n");
        }
        return out.length() > 0 ? out.substring(0, out.length() - 1) : "";
    }
    static String status(ParkingStore.Item item, long now) {
        if (item == null) return "not parked yet";
        if (ParkingStore.CLEARED.equals(item.state)) return "cleared";
        if (ParkingStore.KILLED.equals(item.state)) return "let go";
        if (ParkingStore.TASK.equals(item.state)) return "moved to Today";
        return item.back(now) ? "back now" : "back " + ParkingActivity.relative(item.due, now);
    }
    private NoteThoughts() { }
}
