package org.textphone.launcher;

import android.content.Context;
import android.content.SharedPreferences;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CancellationException;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Opt-in, read-only local tools. No refresh, credentials, drafts or cloud writes. */
final class PocketChatTools {
    static final String NOTES = "notes", THOUGHTS = "thoughts", COROS = "coros";
    private static final String PREFS = "pocket_chat_access";
    private static final int RESULT_LIMIT = 8000;

    static final class Definition {
        final String name, description;
        final JSONObject schema;
        Definition(String name, String description, JSONObject schema) {
            this.name = name; this.description = description; this.schema = schema;
        }
    }

    static synchronized boolean enabled(Context context, String category) {
        if (!category(category)) return false;
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return recipient(context).equals(prefs.getString("recipient", "")) && prefs.getBoolean(category, false);
    }

    static synchronized void enabled(Context context, String category, boolean value) {
        if (!category(category)) throw new IllegalArgumentException("Unknown chat access category.");
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        SharedPreferences.Editor edit = prefs.edit();
        String recipient = recipient(context);
        if (value && !recipient.equals(prefs.getString("recipient", "")))
            edit.remove(NOTES).remove(THOUGHTS).remove(COROS).putString("recipient", recipient);
        edit.putBoolean(category, value).apply();
    }

    static synchronized void reset(Context context) {
        if (!context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().commit())
            throw new IllegalStateException("Could not reset Pocket access. Try saving the provider again.");
    }

    private static String recipient(Context context) {
        ChatProvider.Config selected = ChatProvider.get(context);
        return selected.provider + "|" + selected.baseUrl;
    }

    static List<Definition> definitions(Context context) {
        List<Definition> result = new ArrayList<>();
        try {
            if (enabled(context, NOTES)) {
                result.add(new Definition("search_notes", "Search saved Pocket notes, newest first. "
                        + "All query words must match. An empty query lists recent notes. Read a result by its id when more text is needed.",
                        schema(json("query", stringProperty("Words to find; empty lists recent notes.", 200),
                                "limit", integerProperty("Maximum matching notes to return.", 1, 5, 5)), new JSONArray())));
                JSONObject id = json("description", "The id returned by search_notes.", "anyOf", new JSONArray()
                        .put(json("type", "string", "pattern", "^[1-9][0-9]*$", "maxLength", 19))
                        .put(json("type", "integer", "minimum", 1)));
                result.add(new Definition("read_note", "Read one saved Pocket note, up to 6000 characters. "
                        + "The truncated field indicates missing text. Drafts and tasks are excluded.",
                        schema(json("id", id), new JSONArray().put("id"))));
            }
            // Parked thoughts became tasks (0.5.21). Tasks stay outside chat access, so no thoughts tool is offered.
            if (enabled(context, COROS))
                result.add(new Definition("coros_summary", "Read COROS data already cached on this phone for the last 1–30 calendar days "
                        + "(default 7). Includes recent activities, daily HRV, resting heart rate, sleep and steps when available. "
                        + "Never refreshes COROS. Check last_updated and stale; Pocket scores are estimates for score_date.",
                        schema(json("days", integerProperty("Calendar days ending today in the phone's time zone.", 1, 30, 7)), new JSONArray())));
        } catch (JSONException impossible) { throw new IllegalStateException("Chat tools could not be described."); }
        return Collections.unmodifiableList(result);
    }

    static String execute(Context context, String name, JSONObject arguments) {
        checkInterrupted();
        String category = toolCategory(name);
        if (category == null) return error("unknown_tool", "This tool is not available.");
        if (!enabled(context, category)) return error("access_disabled", "Access to this category is disabled in Chat settings.");
        try {
            JSONObject args = arguments == null ? new JSONObject() : arguments;
            JSONObject result;
            switch (name) {
                case "search_notes":
                    keys(args, "query", "limit");
                    result = searchNotes(context, query(args), integer(args, "limit", 5, 1, 5));
                    break;
                case "read_note":
                    keys(args, "id");
                    result = readNote(context, id(args));
                    break;
                case "search_thoughts":
                    keys(args, "query", "limit");
                    result = searchThoughts(context, query(args), integer(args, "limit", 8, 1, 8));
                    break;
                default:
                    keys(args, "days");
                    result = coros(context, integer(args, "days", 7, 1, 30));
            }
            // A category can be switched off while a worker is reading its local snapshot.
            if (!enabled(context, category)) return error("access_disabled", "Access to this category is disabled in Chat settings.");
            String encoded = result.toString();
            return encoded.length() <= RESULT_LIMIT ? encoded : error("result_too_large", "Use a narrower request.");
        } catch (CancellationException cancelled) {
            throw cancelled;
        } catch (IllegalArgumentException invalid) {
            return error("invalid_arguments", invalid.getMessage());
        } catch (JSONException | RuntimeException unavailable) {
            return error("data_unavailable", "The saved data could not be read.");
        }
    }

    private static JSONObject searchNotes(Context context, String query, int limit) throws JSONException {
        List<PlannerStore.Entry> notes = new ArrayList<>();
        for (PlannerStore.Entry entry : planner(context).entries()) {
            checkInterrupted();
            if ("note".equals(entry.kind) && matches(entry.text, query)) notes.add(entry);
        }
        Collections.sort(notes, (a, b) -> {
            int recent = Long.compare(b.created, a.created);
            return recent == 0 ? Long.compare(b.id, a.id) : recent;
        });
        JSONArray found = new JSONArray();
        JSONObject result = json("source", "pocket:notes", "matched", notes.size(),
                "truncated", notes.size() > limit, "notes", found);
        for (PlannerStore.Entry note : notes) {
            checkInterrupted();
            if (found.length() >= limit) break;
            JSONObject item = noteMetadata(note).put("excerpt", excerpt(note.text, query, 500))
                    .put("text_truncated", note.text.length() > 500);
            if (!append(result, found, item)) { result.put("truncated", true); break; }
        }
        return result;
    }

    private static JSONObject readNote(Context context, long id) throws JSONException {
        PlannerStore.Entry note = planner(context).find(id);
        if (note == null || !"note".equals(note.kind))
            return json("error", "note_not_found", "message", "That saved note is no longer available.");
        JSONObject result = noteMetadata(note).put("truncated", note.text.length() > 6000);
        String text = clip(note.text, 6000);
        result.put("text", text);
        // JSON escaping can be larger than the source text; keep the complete JSON within its budget.
        while (result.toString().length() > RESULT_LIMIT && !text.isEmpty()) {
            int excess = result.toString().length() - RESULT_LIMIT;
            text = clip(text, Math.max(0, text.length() - Math.max(1, excess)));
            result.put("text", text).put("truncated", true);
        }
        return result;
    }

    private static JSONObject noteMetadata(PlannerStore.Entry note) throws JSONException {
        return json("source", "pocket:note:" + note.id, "id", Long.toString(note.id),
                "title", title(note.text), "created", timestamp(note.created));
    }

    private static JSONObject searchThoughts(Context context, String query, int limit) throws JSONException {
        List<ParkingStore.Item> thoughts = new ArrayList<>();
        for (ParkingStore.Item item : ParkingStore.items(context)) {
            checkInterrupted();
            if (ParkingStore.PARKED.equals(item.state) && matches(item.text, query)) thoughts.add(item);
        }
        Collections.sort(thoughts, (a, b) -> {
            int recent = Long.compare(b.created, a.created);
            return recent == 0 ? Long.compare(b.id, a.id) : recent;
        });
        JSONArray found = new JSONArray();
        JSONObject result = json("source", "pocket:thoughts", "matched", thoughts.size(),
                "truncated", thoughts.size() > limit, "thoughts", found);
        for (ParkingStore.Item item : thoughts) {
            checkInterrupted();
            if (found.length() >= limit) break;
            JSONObject value = json("source", "pocket:thought:" + item.id, "id", Long.toString(item.id),
                    "text", excerpt(item.text, query, 500), "text_truncated", item.text.length() > 500,
                    "created", timestamp(item.created), "due", timestamp(item.due), "state", "parked");
            if (!append(result, found, value)) { result.put("truncated", true); break; }
        }
        return result;
    }

    private static JSONObject coros(Context context, int days) throws JSONException {
        ZoneId zone = ZoneId.systemDefault();
        LocalDate end = LocalDate.now(zone), start = end.minusDays(days - 1L);
        JSONObject result = json("source", "pocket:coros:" + start + ":" + end,
                "range_start", start.toString(), "range_end", end.toString(), "time_zone", zone.getId(),
                "cached_only", true, "truncated", false);
        CorosRepository.Snapshot saved = CorosRepository.get(context).cached();
        if (saved == null)
            return result.put("available", false).put("message", "No cached COROS data. Open Movement and refresh it to make data available.");
        long age = Math.max(0L, System.currentTimeMillis() - saved.updated);
        result.put("available", true).put("last_updated", timestamp(saved.updated))
                .put("cache_age_hours", Math.round(age / 360000.0) / 10.0)
                .put("stale", !saved.date.equals(end) || age >= 24 * 3600000L)
                .put("score_date", saved.date.toString()).put("score_estimates", scoreEstimates(saved.scores));
        Map<LocalDate, CorosData.Hrv> nights = new HashMap<>();
        for (CorosData.Hrv hrv : saved.hrv) nights.put(hrv.date, hrv);
        JSONArray health = new JSONArray();
        result.put("daily", health);
        for (LocalDate date = end; !date.isBefore(start); date = date.minusDays(1)) {
            checkInterrupted();
            CorosData.Day day = saved.daily.get(date);
            CorosData.Hrv hrv = nights.get(date);
            Integer rest = saved.resting.get(date);
            if (day == null && hrv == null && rest == null) continue;
            JSONObject value = json("date", date.toString());
            if (hrv != null) {
                if (hrv.avg > 0) value.put("hrv_ms", hrv.avg);
                if (hrv.baseline > 0) value.put("hrv_baseline_ms", hrv.baseline);
            }
            if (rest != null && rest > 0) value.put("resting_hr_bpm", rest);
            if (day != null) {
                value.put("steps", Math.max(0, day.steps));
                // A zero sleep duration means there is no sleep record, rather than zero hours slept.
                if (day.sleep > 0) value.put("sleep_minutes", day.sleep).put("awake_minutes", Math.max(0, day.awake));
            }
            if (!append(result, health, value)) { result.put("truncated", true); break; }
        }
        List<CorosData.Activity> activities = new ArrayList<>();
        double distance = 0; long seconds = 0;
        for (CorosData.Activity activity : saved.activities) {
            checkInterrupted();
            LocalDate date = activity.day(zone);
            if (date.isBefore(start) || date.isAfter(end)) continue;
            activities.add(activity); distance += Math.max(0, activity.km); seconds += Math.max(0, activity.seconds);
        }
        Collections.sort(activities, (a, b) -> Long.compare(b.start, a.start));
        result.put("activity_count", activities.size()).put("total_distance_km", Math.round(distance * 1000) / 1000.0)
                .put("total_duration_seconds", seconds);
        JSONArray shown = new JSONArray(); result.put("activities", shown);
        for (CorosData.Activity activity : activities) {
            checkInterrupted();
            if (shown.length() == 20) { result.put("truncated", true); break; }
            JSONObject value = json("source", "pocket:coros:activity:" + clip(activity.id, 80),
                    "date", activity.day(zone).toString(), "started", timestamp(activity.start),
                    "sport_code", activity.sport, "distance_km", Math.round(Math.max(0, activity.km) * 1000) / 1000.0,
                    "duration_seconds", Math.max(0, activity.seconds));
            if (activity.hr > 0) value.put("average_hr_bpm", activity.hr);
            if (!append(result, shown, value)) { result.put("truncated", true); break; }
        }
        result.put("activities_omitted", activities.size() - shown.length());
        return result;
    }

    private static JSONObject scoreEstimates(Scores.Result scores) throws JSONException {
        JSONObject estimates = json("estimated", true, "description", "Approximate scores calculated by Pocket.");
        if (scores.recovery != null)
            estimates.put("recovery", json("score", scores.recovery.score, "zone", scores.recovery.zone));
        if (scores.strain != null) estimates.put("strain", json("score", scores.strain.strain));
        if (scores.conditioning != null)
            estimates.put("conditioning", json("score", scores.conditioning.score, "status", scores.conditioning.status));
        return estimates;
    }

    private static PlannerStore planner(Context context) {
        return new PlannerStore(context.getSharedPreferences("pocket_planner", Context.MODE_PRIVATE));
    }

    private static void checkInterrupted() {
        if (Thread.currentThread().isInterrupted()) throw new CancellationException();
    }

    private static boolean category(String value) {
        return NOTES.equals(value) || THOUGHTS.equals(value) || COROS.equals(value);
    }

    private static String toolCategory(String name) {
        if ("search_notes".equals(name) || "read_note".equals(name)) return NOTES;
        if ("search_thoughts".equals(name)) return THOUGHTS;
        return "coros_summary".equals(name) ? COROS : null;
    }

    private static void keys(JSONObject args, String... accepted) {
        Iterator<String> names = args.keys();
        while (names.hasNext()) {
            String name = names.next(); boolean known = false;
            for (String candidate : accepted) if (candidate.equals(name)) { known = true; break; }
            if (!known) throw new IllegalArgumentException("An unrecognized argument was supplied.");
        }
    }

    private static String query(JSONObject args) {
        if (!args.has("query")) return "";
        Object value = args.opt("query");
        if (!(value instanceof String) || ((String) value).length() > 200)
            throw new IllegalArgumentException("query must be text of up to 200 characters.");
        return ((String) value).trim().toLowerCase(Locale.ROOT);
    }

    private static int integer(JSONObject args, String key, int fallback, int min, int max) {
        if (!args.has(key)) return fallback;
        Object value = args.opt(key);
        if (!(value instanceof Number)) throw new IllegalArgumentException(key + " must be a whole number from " + min + " to " + max + ".");
        double number = ((Number) value).doubleValue();
        if (Double.isNaN(number) || Double.isInfinite(number) || number != Math.rint(number) || number < min || number > max)
            throw new IllegalArgumentException(key + " must be a whole number from " + min + " to " + max + ".");
        return (int) number;
    }

    private static long id(JSONObject args) {
        Object value = args.opt("id");
        String text = value instanceof String ? (String) value : value instanceof Number ? value.toString() : "";
        if (!text.matches("[1-9][0-9]{0,18}")) throw new IllegalArgumentException("id must be a saved note id.");
        try { return Long.parseLong(text); }
        catch (NumberFormatException invalid) { throw new IllegalArgumentException("id must be a saved note id."); }
    }

    private static boolean matches(String text, String query) {
        String normalized = text.toLowerCase(Locale.ROOT);
        for (String term : query.split("\\s+")) if (!normalized.contains(term)) return false;
        return true;
    }

    private static String excerpt(String text, String query, int limit) {
        if (text.length() <= limit || query.isEmpty()) return clip(text, limit);
        int first = text.toLowerCase(Locale.ROOT).indexOf(query.split("\\s+")[0]);
        int start = Math.max(0, first - 80);
        if (start > 0 && Character.isLowSurrogate(text.charAt(start))) start--;
        return clip(text.substring(start), limit);
    }

    private static String title(String text) {
        for (String line : text.split("\\r?\\n")) if (!line.trim().isEmpty()) return clip(line.trim(), 160);
        return "";
    }

    private static String clip(String text, int limit) {
        if (text.length() <= limit) return text;
        int end = limit;
        if (end > 0 && Character.isHighSurrogate(text.charAt(end - 1))) end--;
        return text.substring(0, end);
    }

    private static Object timestamp(long value) { return value > 0 ? Instant.ofEpochMilli(value).toString() : JSONObject.NULL; }

    private static boolean append(JSONObject result, JSONArray values, JSONObject value) {
        values.put(value);
        // Keep space for omitted counts/truncated flags appended after the array.
        if (result.toString().length() <= RESULT_LIMIT - 160) return true;
        values.remove(values.length() - 1);
        return false;
    }

    private static JSONObject schema(JSONObject properties, JSONArray required) throws JSONException {
        return json("type", "object", "properties", properties, "required", required, "additionalProperties", false);
    }

    private static JSONObject stringProperty(String description, int max) throws JSONException {
        return json("type", "string", "description", description, "maxLength", max, "default", "");
    }

    private static JSONObject integerProperty(String description, int min, int max, int fallback) throws JSONException {
        return json("type", "integer", "description", description, "minimum", min, "maximum", max, "default", fallback);
    }

    private static JSONObject json(Object... pairs) throws JSONException {
        JSONObject object = new JSONObject();
        for (int i = 0; i < pairs.length; i += 2) object.put((String) pairs[i], pairs[i + 1]);
        return object;
    }

    private static String error(String code, String message) {
        try { return json("error", code, "message", message).toString(); }
        catch (JSONException impossible) { return "{\"error\":\"data_unavailable\"}"; }
    }

    private PocketChatTools() { }
}
