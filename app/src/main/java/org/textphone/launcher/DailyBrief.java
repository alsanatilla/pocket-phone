package org.textphone.launcher;

import java.net.URLEncoder;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** A deterministic, factual view of saved records; mirrors src/shared/daily-brief.js. */
final class DailyBrief {
    private static final long HOUR = 3_600_000L, MINUTE = 60_000L, MAX_EPOCH = 253_402_300_799_999L;
    static final class Fact {
        final String id, kind, text, uid, href;
        private final JSONObject value;
        Fact(JSONObject value) { this.value = value; id = value.optString("id"); kind = value.optString("kind"); text = value.optString("text"); uid = value.optString("uid"); href = value.optString("href"); }
        JSONObject json() throws JSONException { return new JSONObject(value.toString()); }
    }
    static final class Result {
        final String day, heading = "daily brief", text, context;
        final long now, start, end, weekStart;
        final List<Fact> facts;
        final List<String> unavailable;
        Result(String day, long now, long start, long end, long weekStart, List<Fact> facts, String text, String context, List<String> unavailable) {
            this.day = day; this.now = now; this.start = start; this.end = end; this.weekStart = weekStart;
            this.facts = Collections.unmodifiableList(new ArrayList<>(facts)); this.text = text; this.context = context;
            this.unavailable = Collections.unmodifiableList(new ArrayList<>(unavailable));
        }
        JSONObject json() throws JSONException {
            JSONArray rows = new JSONArray(); for (Fact fact : facts) rows.put(fact.json());
            return new JSONObject().put("day", day).put("horizon", new JSONObject().put("start", start).put("end", end).put("weekStart", weekStart))
                    .put("heading", heading).put("text", text).put("facts", rows).put("context", context);
        }
    }

    static Result build(JSONObject input, long now, ZoneId zone) throws JSONException {
        if (input == null) input = new JSONObject();
        if (now < 0 || now > MAX_EPOCH) now = System.currentTimeMillis();
        if (zone == null) zone = ZoneId.of("UTC");
        LocalDate date = Instant.ofEpochMilli(now).atZone(zone).toLocalDate(); String day = date.toString();
        long start = date.atStartOfDay(zone).toInstant().toEpochMilli(), end = date.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli();
        long weekStart = date.minusDays(date.getDayOfWeek().getValue() - 1).atStartOfDay(zone).toInstant().toEpochMilli();
        List<Fact> facts = new ArrayList<>();
        add(facts, recovery(input.optJSONObject("coros"), day, now));
        add(facts, agenda(input.optJSONArray("agenda"), start, end, now, zone, day));
        add(facts, task(input.optJSONArray("tasks"), id(input.opt("nextTaskUid")), day));
        add(facts, thought(input.optJSONArray("thoughts"), now));
        add(facts, training(input.optJSONArray("workouts"), weekStart, now, zone));
        if (facts.isEmpty()) add(facts, note(input.optJSONArray("notes")));
        StringBuilder text = new StringBuilder(); for (Fact fact : facts) { if (text.length() > 0) text.append('\n'); text.append(fact.text); }
        if (facts.isEmpty()) text.append("Nothing saved for this brief yet.");
        StringBuilder context = new StringBuilder("Daily brief · ").append(day).append(" · ").append(zone.getId()).append("\nSaved Pocket facts as of ")
                .append(DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneId.of("UTC")).format(Instant.ofEpochMilli(now))).append('\n');
        if (facts.isEmpty()) context.append(text);
        else for (int i = 0; i < facts.size(); i++) { if (i > 0) context.append('\n'); Fact fact = facts.get(i); context.append(fact.text).append("\nSource: ").append(fact.href); }
        List<String> unavailable = new ArrayList<>(); JSONArray failures = input.optJSONArray("unavailable");
        if (failures != null) for (int i = 0; i < failures.length(); i++) { String value = clean(failures.opt(i)); if (!value.isEmpty()) unavailable.add(value); }
        return new Result(day, now, start, end, weekStart, facts, text.toString(), context.substring(0, Math.min(context.length(), 6000)), unavailable);
    }

    private static JSONObject recovery(JSONObject value, String day, long now) throws JSONException {
        if (value == null || !(value.opt("recovery") instanceof Number)) return null;
        double score = ((Number) value.opt("recovery")).doubleValue(); if (!Double.isFinite(score) || score < 0 || score > 100) return null;
        String sampleDay = validDay(string(value.opt("date"))) ? string(value.opt("date")) : "";
        if (sampleDay.compareTo(day) > 0) return null;
        long at = epoch(value.opt("at")) && number(value.opt("at")) <= now ? number(value.opt("at")) : 0;
        Long ageHours = at > 0 ? (now - at) / HOUR : null;
        boolean stale = !sampleDay.isEmpty() && sampleDay.compareTo(day) < 0 || at > 0 && now - at > 24 * HOUR;
        String freshness = stale ? "stale" : sampleDay.equals(day) ? "dated" : at > 0 ? "cached" : "unknown";
        String source = "Pocket".equals(value.opt("source")) ? "Pocket" : "COROS";
        String reading = !sampleDay.isEmpty() ? "saved " + sampleDay : at > 0 ? "cached " + ageHours + "h ago" : "saved reading · age unknown";
        int rounded = (int) Math.round(score);
        return fact("recovery", "recovery", source + " recovery " + rounded + "% · " + reading + (stale ? " · stale" : ""), "", "/movement")
                .put("recovery", rounded).put("source", source).put("date", sampleDay).put("at", at).put("stale", stale).put("freshness", freshness).put("ageHours", ageHours == null ? JSONObject.NULL : ageHours);
    }

    private static final class Event {
        final JSONObject value; final String uid; final long when, end;
        Event(JSONObject value) { this.value = value; uid = id(value.opt("uid")); when = number(value.opt("when")); end = when + number(value.opt("minutes")) * MINUTE; }
    }
    private static JSONObject agenda(JSONArray input, long start, long end, long now, ZoneId zone, String day) throws JSONException {
        List<Event> allEvents = new ArrayList<>(), events = new ArrayList<>();
        for (JSONObject value : rows(input)) if (live(value) && !id(value.opt("uid")).isEmpty() && !clean(value.opt("title")).isEmpty() && epoch(value.opt("when"))
                && integer(value.opt("minutes")) && number(value.opt("minutes")) >= 1 && number(value.opt("minutes")) <= 1440) {
            allEvents.add(new Event(value));
        }
        allEvents.sort(Comparator.comparingLong((Event event) -> event.when).thenComparing(event -> event.uid));
        for (Event event : allEvents) if (event.when < end && event.end > start) events.add(event);
        if (events.isEmpty()) return null;
        int conflicts = 0;
        for (int i = 0; i < events.size(); i++) for (int j = i + 1; j < events.size(); j++) if (events.get(j).when < events.get(i).end && events.get(i).when < events.get(j).end) conflicts++;
        Event current = null, next = null;
        for (Event event : events) { if (current == null && event.when <= now && event.end > now) current = event; if (next == null && event.when > now) next = event; }
        long nextFree = now;
        if (current != null) { nextFree = current.end; for (Event event : allEvents) if (event.when <= nextFree && event.end > nextFree) nextFree = event.end; }
        Event chosen = current != null ? current : next != null ? next : events.get(events.size() - 1);
        String schedule = current != null ? "now: " + clean(current.value.opt("title")) + " · free at " + clock(nextFree, zone, day)
                : next != null ? "next " + clock(next.when, zone, day) + ": " + clean(next.value.opt("title")) + " · free until " + clock(next.when, zone, day) : "finished";
        return fact("agenda", "agenda", plural(events.size(), "appointment") + " · " + schedule + (conflicts > 0 ? " · " + plural(conflicts, "overlap") : ""), chosen.uid, path("calendar", chosen.uid))
                .put("count", events.size()).put("conflicts", conflicts).put("nextFree", nextFree).put("nextAt", next == null ? 0 : next.when)
                .put("current", current != null).put("when", chosen.when).put("until", chosen.end);
    }

    private static JSONObject task(JSONArray input, String nextUid, String day) throws JSONException {
        List<JSONObject> tasks = new ArrayList<>();
        for (JSONObject value : rows(input)) if (live(value) && Boolean.FALSE.equals(value.opt("done")) && !id(value.opt("uid")).isEmpty() && !clean(value.opt("text")).isEmpty()) tasks.add(value);
        tasks.sort(Comparator.comparing((JSONObject value) -> due(value).isEmpty() ? "9999-12-31" : due(value))
                .thenComparing(value -> !Boolean.TRUE.equals(value.opt("important")))
                .thenComparingLong(value -> epoch(value.opt("created")) ? number(value.opt("created")) : Long.MAX_VALUE)
                .thenComparing(value -> id(value.opt("uid"))));
        if (tasks.isEmpty()) return null;
        List<JSONObject> overdue = new ArrayList<>(), dueToday = new ArrayList<>(); JSONObject chosen = null;
        for (JSONObject value : tasks) {
            String due = due(value); if (!due.isEmpty() && due.compareTo(day) < 0) overdue.add(value); if (day.equals(due)) dueToday.add(value);
            if (chosen == null && nextUid.equals(id(value.opt("uid")))) chosen = value;
        }
        JSONObject selected = chosen != null ? chosen : !overdue.isEmpty() ? overdue.get(0) : !dueToday.isEmpty() ? dueToday.get(0) : null;
        String lead = chosen != null ? "chosen next: " + clean(chosen.opt("text")) : !overdue.isEmpty() ? plural(overdue.size(), "task") + " overdue · " + clean(selected.opt("text"))
                : !dueToday.isEmpty() ? plural(dueToday.size(), "task") + " due today · " + clean(selected.opt("text")) : plural(tasks.size(), "open task");
        String uid = selected == null ? "" : id(selected.opt("uid"));
        return fact("task", "task", lead + (chosen != null && !overdue.isEmpty() ? " · " + overdue.size() + " overdue" : ""), uid, path("tasks", uid))
                .put("open", tasks.size()).put("overdue", overdue.size()).put("dueToday", dueToday.size()).put("chosenNext", chosen != null).put("due", selected == null ? "" : due(selected));
    }
    private static JSONObject thought(JSONArray input, long now) throws JSONException {
        List<JSONObject> ready = new ArrayList<>();
        for (JSONObject value : rows(input)) if (live(value) && "parked".equals(value.opt("state")) && !id(value.opt("id")).isEmpty() && !clean(value.opt("text")).isEmpty() && epoch(value.opt("due")) && number(value.opt("due")) <= now) ready.add(value);
        ready.sort(Comparator.comparingLong(DailyBrief::thoughtAge).thenComparing(value -> id(value.opt("id"))));
        if (ready.isEmpty()) return null;
        JSONObject oldest = ready.get(0); String uid = id(oldest.opt("id"));
        return fact("thoughts", "thought", plural(ready.size(), "thought") + " ready to revisit · " + clean(oldest.opt("text")), uid, path("thoughts", uid)).put("count", ready.size()).put("due", number(oldest.opt("due")));
    }
    private static long thoughtAge(JSONObject value) { return epoch(value.opt("created")) ? number(value.opt("created")) : epoch(value.opt("updated")) ? number(value.opt("updated")) : number(value.opt("due")); }

    private static JSONObject training(JSONArray input, long weekStart, long now, ZoneId zone) throws JSONException {
        List<JSONObject> workouts = new ArrayList<>(), active = new ArrayList<>();
        for (JSONObject value : rows(input)) if (live(value) && !id(value.opt("id")).isEmpty() && epoch(value.opt("started")) && number(value.opt("started")) <= now) {
            if (integer(value.opt("ended")) && number(value.opt("ended")) == 0) active.add(value);
            else if (epoch(value.opt("ended")) && number(value.opt("ended")) >= number(value.opt("started")) && number(value.opt("ended")) <= now && loggedSets(value)) workouts.add(value);
        }
        Comparator<JSONObject> order = Comparator.comparingLong((JSONObject value) -> number(value.opt("started"))).reversed().thenComparing(value -> id(value.opt("id")));
        workouts.sort(order); active.sort(order);
        if (workouts.isEmpty() && active.isEmpty()) return null;
        JSONObject latest = active.isEmpty() ? workouts.get(0) : active.get(0); int sessions = 0;
        for (JSONObject value : workouts) if (number(value.opt("started")) >= weekStart && number(value.opt("started")) <= now) sessions++;
        String uid = id(latest.opt("id"));
        return fact("training", "training", plural(sessions, "gym session") + " this week · " + (!active.isEmpty() ? "workout in progress" : "last " + Instant.ofEpochMilli(number(latest.opt("started"))).atZone(zone).toLocalDate()), uid, path("gym", uid).replace("/gym/", "/gym/w:"))
                .put("sessions", sessions).put("active", !active.isEmpty()).put("started", number(latest.opt("started"))).put("ended", number(latest.opt("ended")));
    }
    private static boolean loggedSets(JSONObject workout) {
        for (JSONObject entry : rows(workout.optJSONArray("entries"))) for (JSONObject set : rows(entry.optJSONArray("sets")))
            if (set.opt("kg") instanceof Number && Double.isFinite(((Number) set.opt("kg")).doubleValue()) && ((Number) set.opt("kg")).doubleValue() >= 0 && integer(set.opt("reps")) && number(set.opt("reps")) > 0) return true;
        return false;
    }
    private static JSONObject note(JSONArray input) throws JSONException {
        List<JSONObject> notes = new ArrayList<>();
        for (JSONObject value : rows(input)) if (live(value) && !id(value.opt("uid")).isEmpty() && !clean(value.opt("text")).isEmpty() && epoch(value.opt("updated"))) notes.add(value);
        notes.sort(Comparator.comparingLong((JSONObject value) -> number(value.opt("updated"))).reversed().thenComparing(value -> id(value.opt("uid"))));
        if (notes.isEmpty()) return null;
        JSONObject latest = notes.get(0); String title = "";
        for (String line : string(latest.opt("text")).split("\\r?\\n")) if (!clean(line).isEmpty()) { title = clean(line); break; }
        String uid = id(latest.opt("uid")); return fact("note", "note", "latest note · " + title, uid, path("notes", uid)).put("updated", number(latest.opt("updated")));
    }

    private static void add(List<Fact> facts, JSONObject value) { if (value != null) facts.add(new Fact(value)); }
    private static JSONObject fact(String id, String kind, String text, String uid, String href) throws JSONException {
        JSONObject value = new JSONObject().put("id", id).put("kind", kind).put("text", text).put("href", href); if (!uid.isEmpty()) value.put("uid", uid); return value;
    }
    static boolean validDay(String day) {
        if (!day.matches("\\d{4}-\\d{2}-\\d{2}") || day.startsWith("0000")) return false;
        try { return LocalDate.parse(day).toString().equals(day); } catch (RuntimeException invalid) { return false; }
    }
    private static List<JSONObject> rows(JSONArray values) { List<JSONObject> out = new ArrayList<>(); if (values != null) for (int i = 0; i < values.length(); i++) { JSONObject value = values.optJSONObject(i); if (value != null) out.add(value); } return out; }
    private static boolean live(JSONObject value) { return !value.has("deleted") || Boolean.FALSE.equals(value.opt("deleted")); }
    private static boolean integer(Object value) { if (!(value instanceof Number)) return false; double number = ((Number) value).doubleValue(); return Double.isFinite(number) && number == Math.rint(number) && Math.abs(number) <= 9_007_199_254_740_991L; }
    private static long number(Object value) { return value instanceof Number ? ((Number) value).longValue() : 0; }
    private static boolean epoch(Object value) { return integer(value) && number(value) > 0 && number(value) <= MAX_EPOCH; }
    private static String id(Object value) { if (value instanceof String) { String text = (String) value; return !clean(text).isEmpty() && text.length() <= 200 ? text : ""; } return integer(value) && number(value) > 0 ? Long.toString(number(value)) : ""; }
    private static String string(Object value) { return value instanceof String ? (String) value : ""; }
    private static String clean(Object value) { String text = string(value).replaceAll("[\\s\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+", " ").trim(); return text.substring(0, Math.min(text.length(), 105)); }
    private static String due(JSONObject value) { String due = string(value.opt("due")); return validDay(due) ? due : ""; }
    private static String clock(long at, ZoneId zone, String day) { java.time.ZonedDateTime time = Instant.ofEpochMilli(at).atZone(zone); String date = time.toLocalDate().toString(); return (date.equals(day) ? "" : date + " ") + DateTimeFormatter.ofPattern("HH:mm").format(time); }
    private static String plural(int count, String word) { return count + " " + word + (count == 1 ? "" : "s"); }
    private static String path(String kind, String uid) {
        if (uid.isEmpty()) return "/" + kind;
        try { return "/" + kind + "/" + URLEncoder.encode(uid, "UTF-8").replace("+", "%20").replace("%21", "!").replace("%27", "'").replace("%28", "(").replace("%29", ")").replace("%7E", "~"); }
        catch (java.io.UnsupportedEncodingException impossible) { throw new IllegalStateException(impossible); }
    }
    private DailyBrief() { }
}
