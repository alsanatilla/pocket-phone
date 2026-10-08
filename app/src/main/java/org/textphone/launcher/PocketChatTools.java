package org.textphone.launcher;

import android.content.Context;
import android.content.SharedPreferences;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CancellationException;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Opt-in local reads and validated plan/proposal outputs. Never refreshes or saves workspace data. */
final class PocketChatTools {
    static final String NOTES = "notes", THOUGHTS = "thoughts", TASKS = "tasks", CALENDAR = "calendar", GYM = "gym", COROS = "coros";
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
            edit.remove(NOTES).remove(THOUGHTS).remove(TASKS).remove(CALENDAR).remove(GYM).remove(COROS).putString("recipient", recipient);
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
                result.add(new Definition("read_note", "Read a saved note in pages. Use next_offset to continue; drafts and tasks are excluded.",
                        schema(json("id", idProperty(), "offset", integerProperty("Starting character offset.", 0, 200000, 0),
                                "length", integerProperty("Maximum page characters.", 200, 6000, 6000)), new JSONArray().put("id"))));
            }
            for (String category : new String[]{THOUGHTS, TASKS}) if (enabled(context, category))
                result.add(new Definition("search_" + category, "thoughts".equals(category)
                        ? "Search undecided, parked Pocket thoughts. All query words must match; empty lists recent thoughts. Thoughts are separate from tasks. Read only; never turns an idea into an action."
                        : "Search chosen Pocket tasks, including completion and due date. All query words must match; empty lists recent tasks. Read only; never edits or completes a task.",
                        schema(json("query", stringProperty("Words to match; empty lists recent records.", 200),
                                "limit", integerProperty("Maximum results.", 1, 5, 5)), new JSONArray())));
            if (enabled(context, TASKS))
                result.add(new Definition("read_task", "Read a chosen task, its steps, source context, due date and completion. Never edits the task.",
                        schema(json("id", idProperty()), new JSONArray().put("id"))));
            if (enabled(context, CALENDAR))
                result.add(new Definition("search_calendar", "Search saved Pocket appointments from today over the next 1–30 calendar days. All query words must match; empty lists upcoming appointments.",
                        schema(json("query", stringProperty("Words to match; empty lists appointments.", 200),
                                "days", integerProperty("Calendar days beginning today.", 1, 30, 7), "limit", integerProperty("Maximum results.", 1, 5, 5)), new JSONArray())));
            if (workspaceAccess(context))
                result.add(new Definition("search_pocket", "Search enabled Notes, Tasks, Thoughts and Calendar together. Includes only granted categories; thoughts remain separate from tasks.",
                        schema(json("query", stringProperty("Words to match; empty lists recent records.", 200),
                                "limit", integerProperty("Maximum results.", 1, 10, 10), "days", integerProperty("Upcoming calendar days beginning today.", 1, 30, 7)), new JSONArray())));
            if (enabled(context, GYM))
                result.add(new Definition("gym_summary", "Read locally saved workouts and exercise sets from the last 1–30 calendar days. Use for questions about logged strength training. Results may be partial; check truncated. Read only; never edits a workout.",
                        schema(json("days", integerProperty("Calendar days ending today.", 1, 30, 7)), new JSONArray())));
            if (enabled(context, COROS))
                result.add(new Definition("coros_summary", "Read COROS data already cached on this phone for the last 1–30 calendar days "
                        + "(default 7). Includes recent activities, daily HRV, resting heart rate, sleep and steps when available. "
                        + "Never refreshes COROS. Check last_updated and stale; Pocket scores are estimates for score_date.",
                        schema(json("days", integerProperty("Calendar days ending today in the phone's time zone.", 1, 30, 7)), new JSONArray())));
            result.add(new Definition("update_plan", "Show or update a short visible working plan. Returns a validated plan; never changes saved Pocket data.",
                    schema(json("steps", json("type", "array", "minItems", 1, "maxItems", 6, "items",
                            schema(json("text", json("type", "string", "minLength", 1, "maxLength", 160),
                                    "status", json("type", "string", "enum", new JSONArray().put("pending").put("in_progress").put("done"))), new JSONArray().put("text").put("status")))), new JSONArray().put("steps"))));
            result.add(new Definition("propose_action", "Propose a new note, task or appointment for explicit user review. This tool never saves anything. The user must apply the proposal in Pocket.",
                    schema(json("kind", json("type", "string", "enum", new JSONArray().put("note").put("task").put("appointment")),
                            "title", json("type", "string", "minLength", 1, "maxLength", 200), "text", json("type", "string", "maxLength", 6000),
                            "due", json("type", "string", "pattern", "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"),
                            "steps", json("type", "array", "maxItems", 12, "items", json("type", "string", "minLength", 1, "maxLength", 160, "pattern", "^[^\\r\\n]+$")),
                            "when", json("type", "string", "maxLength", 80, "description", "An ISO 8601 timestamp with UTC or an offset."),
                            "minutes", integerProperty("Appointment duration in minutes.", 15, 480, 60)), new JSONArray().put("kind").put("title").put("text"))));
            if (enabled(context, TASKS) || enabled(context, NOTES) || enabled(context, CALENDAR))
                result.add(new Definition("propose_change", "Prepare a change to an existing record for the user to review and apply with a tap: "
                        + "complete_task, update_task (title, due YYYY-MM-DD or empty to clear, add_steps), append_note (text) or move_appointment (when, minutes). "
                        + "Use ids from Pocket searches or reads. Never applies the change.",
                        schema(json("change", json("type", "string", "enum", new JSONArray().put("complete_task").put("update_task").put("append_note").put("move_appointment")),
                                "id", idProperty(), "title", json("type", "string", "minLength", 1, "maxLength", 200),
                                "due", json("type", "string", "maxLength", 10),
                                "add_steps", json("type", "array", "maxItems", 6, "items", json("type", "string", "minLength", 1, "maxLength", 160, "pattern", "^[^\\r\\n]+$")),
                                "text", json("type", "string", "minLength", 1, "maxLength", 4000),
                                "when", json("type", "string", "maxLength", 40, "description", "An ISO 8601 timestamp with UTC or an offset."),
                                "minutes", integerProperty("Appointment duration in minutes.", 15, 480, 60),
                                "reason", json("type", "string", "maxLength", 300, "description", "One short line on why, shown in the review.")),
                                new JSONArray().put("change").put("id"))));
        } catch (JSONException impossible) { throw new IllegalStateException("Chat tools could not be described."); }
        return Collections.unmodifiableList(result);
    }

    /** Firecrawl reading and filtered search are available alongside a provider's own search. */
    static List<Definition> definitions(Context context, ChatProvider.Config config) {
        if (!webTools(config)) return definitions(context);
        List<Definition> result = new ArrayList<>(definitions(context));
        try {
            result.add(new Definition("search_web", "Search the web for current information. Returns up to 5 results with title, url and description. Cite the urls you use.",
                    schema(json("query", json("type", "string", "minLength", 1, "maxLength", 300),
                            "limit", integerProperty("Maximum results.", 1, 5, 5),
                            "domains", json("type", "array", "maxItems", 5, "items", json("type", "string", "minLength", 1, "maxLength", 253)),
                            "time_range", json("type", "string", "enum", new JSONArray().put("any").put("day").put("week").put("month").put("year"), "default", "any")), new JSONArray().put("query"))));
            result.add(new Definition("read_web_page", "Read public page text in pages. Optional query finds matching passages at or after offset. Pages are cached only for this run; use next_offset to continue.",
                    schema(json("url", json("type", "string", "minLength", 1, "maxLength", 2048),
                            "offset", integerProperty("Starting character offset.", 0, 200000, 0),
                            "length", integerProperty("Maximum page characters.", 200, 6000, 6000),
                            "query", stringProperty("Words to locate in this page.", 200)), new JSONArray().put("url"))));
        } catch (JSONException impossible) { throw new IllegalStateException("Chat tools could not be described."); }
        return Collections.unmodifiableList(result);
    }

    static boolean webTools(ChatProvider.Config config) { return config.webSearch; }

    static String accessFingerprint(Context context) {
        StringBuilder value = new StringBuilder();
        for (String category : new String[]{NOTES, THOUGHTS, TASKS, CALENDAR, GYM, COROS})
            value.append(enabled(context, category) ? '1' : '0');
        return value.toString();
    }

    static boolean permitted(Context context, ChatProvider.Config config, String name, JSONObject args) {
        if ("update_plan".equals(name) || "propose_action".equals(name)) return true;
        if ("search_web".equals(name) || "read_web_page".equals(name)) return webTools(config) && webTools(ChatProvider.get(context));
        if ("search_pocket".equals(name)) return workspaceAccess(context);
        if ("propose_change".equals(name)) return enabled(context, TASKS) || enabled(context, NOTES) || enabled(context, CALENDAR);
        String category = toolCategory(name);
        return category != null && enabled(context, category);
    }

    private static boolean workspaceAccess(Context context) {
        return enabled(context, NOTES) || enabled(context, THOUGHTS) || enabled(context, TASKS) || enabled(context, CALENDAR);
    }

    static String execute(Context context, String name, JSONObject arguments) {
        return execute(context, name, arguments, new RunContext());
    }

    static String execute(Context context, String name, JSONObject arguments, RunContext run) {
        checkInterrupted();
        if (run == null) run = new RunContext();
        run.check();
        JSONObject args = arguments == null ? new JSONObject() : arguments;
        if (args.toString().length() > RESULT_LIMIT) return error("invalid_arguments", "Use arguments of up to 8000 characters.");
        if ("search_web".equals(name) || "read_web_page".equals(name)) return web(context, name, args, run);
        boolean universal = "update_plan".equals(name) || "propose_action".equals(name);
        String category = toolCategory(name);
        if (!universal && category == null && !"search_pocket".equals(name) && !"propose_change".equals(name)) return error("unknown_tool", "This tool is not available.");
        if (!universal && !permitted(context, ChatProvider.get(context), name, args))
            return error("access_disabled", "Access to this category is disabled in Chat settings.");
        String access = accessFingerprint(context);
        try {
            JSONObject result;
            switch (name) {
                case "search_notes":
                    keys(args, "query", "limit");
                    result = searchNotes(context, query(args), integer(args, "limit", 5, 1, 5));
                    break;
                case "read_note":
                    keys(args, "id", "offset", "length");
                    result = readNote(context, savedEntry(context, args, "note"), integer(args, "offset", 0, 0, 200000), integer(args, "length", 6000, 200, 6000));
                    break;
                case "search_thoughts":
                    keys(args, "query", "limit");
                    result = searchThoughts(context, query(args), integer(args, "limit", 5, 1, 5));
                    break;
                case "search_tasks":
                    keys(args, "query", "limit");
                    result = searchTasks(context, query(args), integer(args, "limit", 5, 1, 5));
                    break;
                case "read_task":
                    keys(args, "id"); result = readTask(context, savedEntry(context, args, "task")); break;
                case "search_calendar":
                    keys(args, "query", "days", "limit"); result = searchCalendar(context, query(args), integer(args, "days", 7, 1, 30), integer(args, "limit", 5, 1, 5)); break;
                case "search_pocket":
                    keys(args, "query", "days", "limit"); result = searchPocket(context, query(args), integer(args, "days", 7, 1, 30), integer(args, "limit", 10, 1, 10)); break;
                case "update_plan": result = plan(args); break;
                case "propose_action": result = proposal(args); break;
                case "propose_change": result = change(context, args); break;
                case "gym_summary":
                    keys(args, "days");
                    result = gym(context, integer(args, "days", 7, 1, 30));
                    break;
                default:
                    keys(args, "days");
                    result = coros(context, integer(args, "days", 7, 1, 30));
            }
            // A category can be switched off while a worker is reading its local snapshot.
            run.check();
            if (!universal && (!permitted(context, ChatProvider.get(context), name, args)
                    || (("search_pocket".equals(name) || "read_task".equals(name)) && !access.equals(accessFingerprint(context)))))
                return error("access_disabled", "Pocket access changed while this data was being read. Try again.");
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
            JSONObject item = noteMetadata(context, note).put("excerpt", excerpt(note.text, query, 500))
                    .put("text_truncated", note.text.length() > 500);
            if (!append(result, found, item)) { result.put("truncated", true); break; }
        }
        return result;
    }

    private static JSONObject readNote(Context context, PlannerStore.Entry note, int offset, int length) throws JSONException {
        if (note == null)
            return json("error", "note_not_found", "message", "That saved note is no longer available.");
        return pageResult(noteMetadata(context, note), note.text, offset, length);
    }

    private static JSONObject noteMetadata(Context context, PlannerStore.Entry note) throws JSONException {
        String id = entryId(context, note);
        return json("source", "pocket:note:" + id, "id", id,
                "title", title(note.text), "created", timestamp(note.created), "href", "/notes/" + id);
    }

    private static PlannerStore.Entry savedEntry(Context context, JSONObject args, String kind) {
        String id = savedId(args);
        for (PlannerStore.Entry entry : planner(context).entries()) {
            checkInterrupted();
            if (kind.equals(entry.kind) && (Long.toString(entry.id).equals(id) || entryId(context, entry).equals(id))) return entry;
        }
        return null;
    }

    private static String entryId(Context context, PlannerStore.Entry entry) {
        String uid = context.getSharedPreferences("pocket_planner", Context.MODE_PRIVATE).getString(entry.kind + "_uid_" + entry.id, "");
        return uid == null || uid.isEmpty() ? Long.toString(entry.id) : uid;
    }

    private static JSONObject readTask(Context context, PlannerStore.Entry task) throws JSONException {
        if (task == null) return json("error", "task_not_found", "message", "That saved task is no longer available.");
        String id = entryId(context, task);
        JSONArray steps = new JSONArray();
        for (PlannerStore.Step step : task.steps) { checkInterrupted(); steps.put(json("text", clip(step.text, 200), "done", step.done)); }
        JSONObject result = json("source", "pocket:task:" + id, "id", id, "title", title(task.text), "text", clip(task.text, 6000),
                "done", task.done, "completed", task.done, "due", task.due, "important", task.important, "created", timestamp(task.created), "steps", steps,
                "completed_steps", task.completedSteps(), "href", "/tasks/" + id, "truncated", false);
        if (task.source == null) return result.put("task_source", JSONObject.NULL);
        TaskSource source = task.source;
        // Note text has a separate read grant even when a task retains a source link.
        if ("note".equals(source.kind) && !enabled(context, NOTES))
            return result.put("task_source", json("kind", "note", "name", "", "text", "", "note_uid", "", "access_disabled", true));
        String href = "";
        if ("note".equals(source.kind)) {
            PlannerStore.Entry note = planner(context).find(source.note);
            if (note != null && "note".equals(note.kind)) href = "/notes/" + entryId(context, note);
        } else {
            try { href = publicUrl(source.link()).toString(); } catch (IllegalArgumentException invalid) { }
        }
        return result.put("task_source", json("kind", source.kind, "name", clip(source.name, 200), "text", clip(source.text, 1500),
                "note_uid", href.startsWith("/notes/") ? href.substring(7) : "", "href", href, "truncated", source.text.length() > 1500));
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
                    "title", title(item.text), "href", "/thoughts/" + item.id,
                    "text", excerpt(item.text, query, 500), "text_truncated", item.text.length() > 500,
                    "created", timestamp(item.created), "due", timestamp(item.due), "state", "parked");
            if (!append(result, found, value)) { result.put("truncated", true); break; }
        }
        return result;
    }

    private static JSONObject searchTasks(Context context, String query, int limit) throws JSONException {
        List<PlannerStore.Entry> tasks = new ArrayList<>();
        for (PlannerStore.Entry entry : planner(context).entries()) {
            checkInterrupted(); if ("task".equals(entry.kind) && matches(entry.text, query)) tasks.add(entry);
        }
        Collections.sort(tasks, (a, b) -> Long.compare(b.created, a.created));
        JSONArray found = new JSONArray();
        JSONObject result = json("source", "pocket:tasks", "matched", tasks.size(), "truncated", tasks.size() > limit, "tasks", found);
        for (PlannerStore.Entry task : tasks) {
            checkInterrupted(); if (found.length() >= limit) break;
            JSONObject item = json("source", "pocket:task:" + entryId(context, task), "id", entryId(context, task), "title", title(task.text),
                    "href", "/tasks/" + entryId(context, task), "text", excerpt(task.text, query, 500),
                    "text_truncated", task.text.length() > 500, "done", task.done, "due", task.due);
            if (!append(result, found, item)) { result.put("truncated", true); break; }
        }
        return result;
    }

    private static JSONObject searchCalendar(Context context, String query, int days, int limit) throws JSONException {
        List<AgendaStore.Event> events = calendar(context, query, days);
        JSONArray found = new JSONArray();
        JSONObject result = json("source", "pocket:calendar", "matched", events.size(), "truncated", events.size() > limit, "appointments", found);
        for (AgendaStore.Event event : events) {
            checkInterrupted(); if (found.length() >= limit) break;
            String id = event.uid.isEmpty() ? Long.toString(event.id) : event.uid;
            if (!append(result, found, json("id", id, "title", clip(event.title, 200), "when", timestamp(event.when), "minutes", event.minutes, "href", "/calendar/" + id))) {
                result.put("truncated", true); break;
            }
        }
        return result;
    }

    private static List<AgendaStore.Event> calendar(Context context, String query, int days) {
        ZoneId zone = ZoneId.systemDefault();
        long start = LocalDate.now(zone).atStartOfDay(zone).toInstant().toEpochMilli();
        long end = LocalDate.now(zone).plusDays(days).atStartOfDay(zone).toInstant().toEpochMilli();
        List<AgendaStore.Event> events = new ArrayList<>();
        for (AgendaStore.Event event : AgendaStore.list(context)) {
            checkInterrupted();
            if (event.end() > start && event.when < end && matches(event.title, query)) events.add(event);
        }
        return events;
    }

    private static JSONObject searchPocket(Context context, String query, int days, int limit) throws JSONException {
        List<JSONObject> rows = new ArrayList<>();
        boolean notes = enabled(context, NOTES), tasks = enabled(context, TASKS);
        if (notes || tasks) {
            List<PlannerStore.Entry> entries = planner(context).entries();
            Collections.sort(entries, (a, b) -> Long.compare(b.created, a.created));
            for (PlannerStore.Entry entry : entries) {
                checkInterrupted();
                StringBuilder content = new StringBuilder(entry.text);
                if ("task".equals(entry.kind)) for (PlannerStore.Step step : entry.steps) content.append('\n').append(step.text);
                if (!((notes && "note".equals(entry.kind)) || (tasks && "task".equals(entry.kind))) || !matches(content.toString(), query)) continue;
                String id = entryId(context, entry), href = "/" + ("note".equals(entry.kind) ? "notes" : "tasks") + "/" + id;
                rows.add(workspaceRow(entry.kind, id, title(entry.text), excerpt(content.toString(), query, 400), href));
            }
        }
        if (enabled(context, THOUGHTS)) {
            List<ParkingStore.Item> items = ParkingStore.items(context);
            Collections.sort(items, (a, b) -> Long.compare(b.created, a.created));
            for (ParkingStore.Item item : items) {
                checkInterrupted();
                if (ParkingStore.PARKED.equals(item.state) && matches(item.text, query)) {
                    String id = Long.toString(item.id);
                    rows.add(workspaceRow("thought", id, title(item.text), excerpt(item.text, query, 400), "/thoughts/" + id));
                }
            }
        }
        if (enabled(context, CALENDAR)) for (AgendaStore.Event event : calendar(context, query, days)) {
            String id = event.uid.isEmpty() ? Long.toString(event.id) : event.uid;
            rows.add(workspaceRow("appointment", id, clip(event.title, 200), clip(event.title, 400), "/calendar/" + id));
        }
        JSONArray found = new JSONArray();
        JSONObject result = json("source", "pocket:workspace", "matched", rows.size(), "truncated", rows.size() > limit, "results", found);
        for (JSONObject row : rows) {
            checkInterrupted(); if (found.length() >= limit) break;
            if (!append(result, found, row)) { result.put("truncated", true); break; }
        }
        return result;
    }

    private static JSONObject workspaceRow(String kind, String id, String title, String excerpt, String href) throws JSONException {
        return json("kind", kind, "type", kind, "id", id, "title", title, "excerpt", excerpt, "href", href, "route", href);
    }

    private static JSONObject plan(JSONObject args) throws JSONException {
        keys(args, "steps");
        Object raw = args.opt("steps");
        if (!(raw instanceof JSONArray) || ((JSONArray) raw).length() < 1 || ((JSONArray) raw).length() > 6)
            throw new IllegalArgumentException("steps must contain 1 to 6 plan steps.");
        JSONArray steps = new JSONArray(), values = (JSONArray) raw;
        for (int index = 0; index < values.length(); index++) {
            Object value = values.opt(index);
            if (!(value instanceof JSONObject)) throw new IllegalArgumentException("Each plan step must be an object.");
            JSONObject step = (JSONObject) value;
            keys(step, "text", "status");
            String text = requiredText(step, "text", 160, false), status = requiredText(step, "status", 20, false);
            if (!"pending".equals(status) && !"in_progress".equals(status) && !"done".equals(status))
                throw new IllegalArgumentException("Plan status must be pending, in_progress or done.");
            steps.put(json("text", text.trim(), "status", status));
        }
        return json("kind", "plan", "plan", steps);
    }

    /** Validates a change against the record as it is now and keeps a short "before" for the review. Nothing is written here. */
    private static JSONObject change(Context context, JSONObject args) throws JSONException {
        keys(args, "change", "id", "title", "due", "add_steps", "text", "when", "minutes", "reason");
        String change = requiredText(args, "change", 40, false), reason = optionalText(args, "reason", 300).trim();
        String category = "complete_task".equals(change) || "update_task".equals(change) ? TASKS : "append_note".equals(change) ? NOTES : "move_appointment".equals(change) ? CALENDAR : null;
        if (category == null) throw new IllegalArgumentException("change must be complete_task, update_task, append_note or move_appointment.");
        if (!enabled(context, category)) return json("error", "access_disabled", "message", "Turn on " + category + " access before proposing this change.");
        JSONObject proposed = json("change", change);
        if (!reason.isEmpty()) proposed.put("reason", reason);
        if (TASKS.equals(category)) {
            PlannerStore.Entry task = savedEntry(context, args, "task");
            if (task == null) return json("error", "task_not_found", "message", "That task is no longer available.");
            JSONObject before = json("title", title(task.text), "due", task.due, "done", task.done, "steps", task.steps.size());
            proposed.put("id", entryId(context, task));
            if ("complete_task".equals(change)) {
                if (task.done) return json("error", "already_done", "message", "That task is already complete.");
                return json("kind", "change", "change", proposed, "before", before, "requires_confirmation", true);
            }
            JSONArray add = new JSONArray();
            if (args.has("add_steps")) {
                Object raw = args.opt("add_steps");
                if (!(raw instanceof JSONArray) || ((JSONArray) raw).length() > 6) throw new IllegalArgumentException("add_steps must be an array of at most 6 strings.");
                for (int i = 0; i < ((JSONArray) raw).length(); i++) {
                    Object value = ((JSONArray) raw).opt(i);
                    if (!(value instanceof String) || ((String) value).trim().isEmpty() || ((String) value).length() > 160 || ((String) value).contains("\n") || ((String) value).contains("\r"))
                        throw new IllegalArgumentException("Each step must be one nonempty line of up to 160 characters.");
                    String step = ((String) value).trim(); boolean known = false;
                    for (PlannerStore.Step old : task.steps) if (old.text.equals(step)) known = true;
                    if (!known) add.put(step);
                }
            }
            if (task.steps.size() + add.length() > 12) return json("error", "too_many_steps", "message", "A task keeps at most 12 steps.");
            if (args.has("title")) proposed.put("title", requiredText(args, "title", 200, false).trim());
            if (args.has("due")) {
                String due = optionalText(args, "due", 10);
                if (!due.isEmpty()) {
                    if (!due.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")) throw new IllegalArgumentException("due must be YYYY-MM-DD or empty.");
                    try { LocalDate.parse(due); } catch (DateTimeParseException invalid) { throw new IllegalArgumentException("due must be YYYY-MM-DD or empty."); }
                }
                proposed.put("due", due);
            }
            if (!args.has("title") && !args.has("due") && add.length() == 0) throw new IllegalArgumentException("Change the title, due date or steps.");
            return json("kind", "change", "change", proposed.put("add_steps", add), "before", before, "requires_confirmation", true);
        }
        if (NOTES.equals(category)) {
            PlannerStore.Entry note = savedEntry(context, args, "note");
            if (note == null) return json("error", "note_not_found", "message", "That saved note is no longer available.");
            String text = requiredText(args, "text", 4000, false).trim(), current = note.text.replaceAll("\\s+$", "");
            if (current.length() + text.length() + 2 > 8000) return json("error", "note_full", "message", "The note would exceed its length limit.");
            return json("kind", "change", "change", proposed.put("id", entryId(context, note)).put("text", text),
                    "before", json("title", title(note.text).replaceFirst("^#+\\s*", ""), "ending", current.substring(Math.max(0, current.length() - 240))), "requires_confirmation", true);
        }
        String id = savedId(args); AgendaStore.Event event = null;
        for (AgendaStore.Event candidate : AgendaStore.list(context)) if (id.equals(candidate.uid) || id.equals(Long.toString(candidate.id))) event = candidate;
        if (event == null) return json("error", "appointment_not_found", "message", "That appointment is no longer available.");
        String when = optionalText(args, "when", 40);
        if (!when.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\\.[0-9]{1,3})?)?(Z|[+-][0-9]{2}:[0-9]{2})"))
            throw new IllegalArgumentException("Use an ISO date and time with timezone.");
        try { OffsetDateTime.parse(when); } catch (DateTimeParseException invalid) { throw new IllegalArgumentException("Use an ISO date and time with timezone."); }
        int minutes = integer(args, "minutes", event.minutes, 15, 480);
        return json("kind", "change", "change", proposed.put("id", event.uid.isEmpty() ? Long.toString(event.id) : event.uid).put("when", when).put("minutes", minutes),
                "before", json("title", clip(event.title, 200), "when", timestamp(event.when), "minutes", event.minutes), "requires_confirmation", true);
    }

    private static JSONObject proposal(JSONObject args) throws JSONException {
        keys(args, "kind", "title", "text", "due", "steps", "when", "minutes");
        String kind = requiredText(args, "kind", 20, false);
        if (!"note".equals(kind) && !"task".equals(kind) && !"appointment".equals(kind))
            throw new IllegalArgumentException("kind must be note, task or appointment.");
        String title = requiredText(args, "title", 200, false), text = requiredText(args, "text", 6000, true);
        String due = optionalText(args, "due", 10), when = optionalText(args, "when", 80);
        if (!due.isEmpty()) {
            if (!due.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")) throw new IllegalArgumentException("due must be a valid YYYY-MM-DD date.");
            try { LocalDate.parse(due); } catch (DateTimeParseException invalid) { throw new IllegalArgumentException("due must be a valid YYYY-MM-DD date."); }
        }
        if ("appointment".equals(kind) && when.isEmpty()) throw new IllegalArgumentException("Appointments need an ISO date and time with timezone.");
        if (!when.isEmpty()) {
            if (!when.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\\.[0-9]{1,3})?)?(Z|[+-][0-9]{2}:[0-9]{2})"))
                throw new IllegalArgumentException("when must be an ISO timestamp with UTC or an offset.");
            try { OffsetDateTime.parse(when); } catch (DateTimeParseException invalid) { throw new IllegalArgumentException("when must be a valid ISO timestamp."); }
        }
        JSONArray steps = new JSONArray();
        if (args.has("steps")) {
            Object raw = args.opt("steps");
            if (!(raw instanceof JSONArray) || ((JSONArray) raw).length() > 12) throw new IllegalArgumentException("steps must be an array of at most 12 strings.");
            JSONArray values = (JSONArray) raw;
            for (int index = 0; index < values.length(); index++) {
                Object value = values.opt(index);
                if (!(value instanceof String) || ((String) value).trim().isEmpty() || ((String) value).length() > 160
                        || ((String) value).contains("\n") || ((String) value).contains("\r"))
                    throw new IllegalArgumentException("Each action step must be one nonempty line of up to 160 characters.");
                steps.put(((String) value).trim());
            }
        }
        return json("kind", "proposal", "proposal", json("kind", kind, "title", title, "text", text, "due", due, "steps", steps, "when", when,
                "minutes", integer(args, "minutes", 60, 15, 480)), "requires_confirmation", true);
    }

    private static JSONObject gym(Context context, int days) throws JSONException {
        long start = LocalDate.now().minusDays(days - 1L).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli();
        List<JSONObject> saved = new ArrayList<>();
        for (JSONObject workout : GymStore.workouts(context)) { checkInterrupted(); if (workout.optLong("started") >= start) saved.add(workout); }
        JSONArray workouts = new JSONArray();
        JSONObject result = json("source", "pocket:gym", "days", days, "matched", saved.size(), "truncated", saved.size() > 10, "workouts", workouts);
        for (JSONObject workout : saved) {
            checkInterrupted(); if (workouts.length() >= 10) break;
            JSONArray exercises = new JSONArray(); int total = 0;
            List<String> names = GymStore.exerciseNames(workout);
            for (String name : names) {
                List<GymStore.Set> sets = GymStore.sets(workout, name); total += sets.size();
                if (exercises.length() >= 12) continue;
                JSONArray values = new JSONArray();
                for (int n = Math.max(0, sets.size() - 8); n < sets.size(); n++) {
                    GymStore.Set set = sets.get(n); values.put(json("kg", set.kg, "reps", set.reps, "at", set.at));
                }
                exercises.put(json("exercise", name, "sets", values, "truncated", sets.size() > 8));
            }
            JSONObject item = json("id", workout.optString("id"), "started", workout.optLong("started"), "ended", workout.optLong("ended"),
                    "sets", total, "volume_kg", GymStore.volume(workout), "exercises", exercises, "truncated", names.size() > 12);
            if (!append(result, workouts, item)) { result.put("truncated", true); break; }
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

    private static final String FIRECRAWL = "https://api.firecrawl.dev/v2";
    private static final okhttp3.OkHttpClient WEB = new okhttp3.OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
            .connectTimeout(15, java.util.concurrent.TimeUnit.SECONDS).readTimeout(40, java.util.concurrent.TimeUnit.SECONDS)
            .callTimeout(45, java.util.concurrent.TimeUnit.SECONDS).build();

    private static final class WebRefused extends java.io.IOException { WebRefused(String message) { super(message); } }

    /** One invocation owns page text and the active request; neither survives cancellation or another run. */
    static final class RunContext {
        private final Map<String, WebPage> pages = new LinkedHashMap<>();
        private final okhttp3.OkHttpClient client;
        private okhttp3.Call active;
        private boolean cancelled;
        RunContext() { this(WEB); }
        RunContext(okhttp3.OkHttpClient client) { this.client = client; }
        synchronized void check() { checkInterrupted(); if (cancelled) throw new CancellationException(); }
        synchronized void cancel() { cancelled = true; pages.clear(); if (active != null) active.cancel(); }
        synchronized void begin(okhttp3.Call call) { check(); active = call; }
        synchronized void end(okhttp3.Call call) { if (active == call) active = null; }
        synchronized WebPage page(String url) { check(); return pages.get(url); }
        synchronized void page(String url, WebPage page) {
            check();
            if (pages.size() >= 6 && !pages.containsKey(url)) pages.remove(pages.keySet().iterator().next());
            pages.put(url, page);
        }
    }

    private static final class WebPage {
        final String title, text;
        WebPage(String title, String text) { this.title = title; this.text = text; }
    }

    private static String web(Context context, String name, JSONObject args, RunContext run) {
        if (!webTools(ChatProvider.get(context))) return error("access_disabled", "Web search is off.");
        String recipient = recipient(context);
        try {
            JSONObject result;
            if ("search_web".equals(name)) {
                keys(args, "query", "limit", "domains", "time_range");
                String query = requiredText(args, "query", 300, false);
                int limit = integer(args, "limit", 5, 1, 5);
                JSONObject body = searchRequest(args, query, limit);
                JSONObject found = firecrawl(context, "/search", body, run);
                JSONArray list = found.optJSONArray("data");
                if (list == null && found.optJSONObject("data") != null) list = found.optJSONObject("data").optJSONArray("web");
                JSONArray results = new JSONArray();
                if (list != null) for (int i = 0; i < list.length() && results.length() < limit; i++) {
                    run.check();
                    JSONObject item = list.optJSONObject(i);
                    String url = item == null ? "" : item.optString("url");
                    try { url = publicUrl(url).toString(); } catch (IllegalArgumentException invalid) { continue; }
                    results.put(json("title", clip(item.optString("title", url), 160), "url", url, "description", clip(item.optString("description"), 400)));
                }
                result = json("source", "web:firecrawl", "query", query, "results", results);
            } else {
                keys(args, "url", "offset", "length", "query");
                java.net.URI uri = publicUrl(requiredText(args, "url", 2048, false));
                String url = uri.toString();
                int offset = integer(args, "offset", 0, 0, 200000), length = integer(args, "length", 6000, 200, 6000);
                String query = query(args);
                WebPage saved = run.page(url);
                if (saved == null) {
                    JSONObject page = firecrawl(context, "/scrape", json("url", url, "formats", new JSONArray().put("markdown"),
                            "onlyMainContent", true, "timeout", 20000), run).optJSONObject("data");
                    if (page == null) page = new JSONObject();
                    JSONObject metadata = page.optJSONObject("metadata");
                    String title = metadata == null ? "" : metadata.optString("title", "");
                    saved = new WebPage(clip(title.isEmpty() ? uri.getHost() : title, 160), page.optString("markdown", ""));
                    run.page(url, saved);
                }
                result = webPageResult(url, saved, offset, length, query);
            }
            run.check();
            if (!webTools(ChatProvider.get(context)) || !recipient.equals(recipient(context)))
                return error("access_disabled", "Web access changed while this page was being read. Try again.");
            String encoded = result.toString();
            return encoded.length() <= RESULT_LIMIT ? encoded : error("result_too_large", "Use a narrower request.");
        } catch (WebRefused refused) {
            return error("web_unavailable", refused.getMessage());
        } catch (java.io.InterruptedIOException stopped) {
            if (Thread.currentThread().isInterrupted()) throw new CancellationException();
            return error("web_unavailable", "Web search timed out. Retry.");
        } catch (java.io.IOException offline) {
            run.check();
            return error("web_unavailable", "Web search could not connect.");
        } catch (IllegalArgumentException invalid) {
            return error("invalid_arguments", invalid.getMessage());
        } catch (JSONException damaged) {
            return error("web_unavailable", "Web search returned an unreadable reply.");
        }
    }

    private static JSONObject searchRequest(JSONObject args, String query, int limit) throws JSONException {
        JSONObject body = json("query", query, "limit", limit, "timeout", 20000);
        if (args.has("domains")) {
            Object raw = args.opt("domains");
            if (!(raw instanceof JSONArray) || ((JSONArray) raw).length() > 5)
                throw new IllegalArgumentException("domains must contain at most 5 public hostnames.");
            JSONArray domains = new JSONArray(), values = (JSONArray) raw;
            for (int index = 0; index < values.length(); index++) {
                Object value = values.opt(index);
                if (!(value instanceof String)) throw new IllegalArgumentException("domains must contain public hostnames.");
                String host = ((String) value).trim().toLowerCase(Locale.ROOT);
                if (host.length() > 253 || host.contains("/") || host.contains(":") || host.contains("@") || host.contains("?") || host.contains("#"))
                    throw new IllegalArgumentException("Use domains without a protocol or path.");
                publicUrl("https://" + host);
                domains.put(host);
            }
            // Firecrawl v2 documented filters: includeDomains and tbs, not arbitrary query interpolation.
            if (domains.length() > 0) body.put("includeDomains", domains);
        }
        String range = args.has("time_range") ? requiredText(args, "time_range", 10, false) : "any";
        String filter;
        switch (range) {
            case "any": filter = ""; break;
            case "day": filter = "qdr:d"; break;
            case "week": filter = "qdr:w"; break;
            case "month": filter = "qdr:m"; break;
            case "year": filter = "qdr:y"; break;
            default: throw new IllegalArgumentException("time_range must be any, day, week, month or year.");
        }
        if (!filter.isEmpty()) body.put("tbs", filter);
        return body;
    }

    private static JSONObject webPageResult(String url, WebPage saved, int offset, int length, String query) throws JSONException {
        int start = Math.min(offset, saved.text.length());
        JSONArray passages = new JSONArray();
        boolean matched = query.isEmpty();
        if (!query.isEmpty()) {
            String text = saved.text.toLowerCase(Locale.ROOT);
            int position = text.indexOf(query, start);
            if (position >= 0) {
                int passageBudget = Math.min(800, length / 2);
                int context = Math.min(100, Math.max(0, passageBudget - query.length()));
                int beginning = Math.max(start, position - context);
                if (beginning > 0 && Character.isLowSurrogate(saved.text.charAt(beginning))) beginning--;
                if (query.length() <= passageBudget) {
                    String passage = clip(saved.text.substring(beginning), passageBudget);
                    passages.put(json("offset", beginning, "text", passage));
                }
                start = beginning; matched = true;
            }
        }
        JSONObject result = json("source", url, "url", url, "title", saved.title);
        if (!query.isEmpty()) result.put("query", query).put("query_found", matched).put("passages", passages);
        // Reserve the passage bytes before choosing how much surrounding page text to return.
        return pageResult(result, saved.text, start, length - passagesText(passages));
    }

    private static int passagesText(JSONArray passages) {
        int count = 0;
        for (int index = 0; index < passages.length(); index++) count += passages.optJSONObject(index).optString("text").length();
        return count;
    }

    private static JSONObject pageResult(JSONObject result, String original, int offset, int length) throws JSONException {
        int start = Math.min(offset, original.length());
        if (start > 0 && start < original.length() && Character.isLowSurrogate(original.charAt(start))) start--;
        String text = clip(original.substring(start), length);
        result.put("offset", start).put("total_length", original.length()).put("text", text)
                .put("truncated", start + text.length() < original.length())
                .put("next_offset", start + text.length() < original.length() && start + text.length() <= 200000 ? start + text.length() : JSONObject.NULL);
        // Escaping can exceed the character budget. Keep a usable continuation offset after reducing text.
        while (result.toString().length() > RESULT_LIMIT && !text.isEmpty()) {
            int excess = result.toString().length() - RESULT_LIMIT;
            text = clip(text, Math.max(0, text.length() - Math.max(1, excess)));
            result.put("text", text).put("truncated", start + text.length() < original.length())
                    .put("next_offset", start + text.length() < original.length() && start + text.length() <= 200000 ? start + text.length() : JSONObject.NULL);
        }
        return result;
    }

    private static java.net.URI publicUrl(String value) {
        try {
            if (value == null || value.isEmpty() || value.length() > 2048 || !value.equals(value.trim())) throw new IllegalArgumentException();
            java.net.URI uri = new java.net.URI(value);
            String scheme = uri.getScheme(), host = uri.getHost();
            if (!("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme)) || host == null || uri.getRawUserInfo() != null
                    || uri.getPort() > 65535 || uri.getPort() == 0 || uri.getRawAuthority().endsWith(":")) throw new IllegalArgumentException();
            host = host.toLowerCase(Locale.ROOT).replaceFirst("\\.$", "");
            if (host.startsWith("[")) host = host.substring(1, host.length() - 1);
            if (host.contains("%") || host.equals("localhost") || host.endsWith(".localhost") || host.endsWith(".local")
                    || host.endsWith(".localdomain") || host.endsWith(".internal") || host.endsWith(".lan") || host.endsWith(".home")
                    || host.endsWith(".test") || host.endsWith(".invalid"))
                throw new IllegalArgumentException();
            if (host.contains(":")) {
                java.net.InetAddress address = java.net.InetAddress.getByName(host);
                if (!publicAddress(address)) throw new IllegalArgumentException();
            } else if (host.matches("[0-9.]+")) {
                String[] octets = host.split("\\.", -1);
                if (octets.length != 4) throw new IllegalArgumentException();
                byte[] bytes = new byte[4];
                for (int index = 0; index < 4; index++) {
                    if (!octets[index].matches("0|[1-9][0-9]{0,2}")) throw new IllegalArgumentException();
                    int octet = Integer.parseInt(octets[index]); if (octet > 255) throw new IllegalArgumentException(); bytes[index] = (byte) octet;
                }
                if (!publicAddress(java.net.InetAddress.getByAddress(bytes))) throw new IllegalArgumentException();
            } else {
                if (!host.contains(".") || host.length() > 253) throw new IllegalArgumentException();
                for (String label : host.split("\\.", -1))
                    if (!label.matches("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?")) throw new IllegalArgumentException();
            }
            // Fragments do not change fetched page text and must not create separate run cache entries.
            String normalized = uri.normalize().toString();
            int fragment = normalized.indexOf('#');
            return new java.net.URI(fragment < 0 ? normalized : normalized.substring(0, fragment));
        } catch (java.net.URISyntaxException | java.net.UnknownHostException | IllegalArgumentException invalid) {
            throw new IllegalArgumentException("Use a public http or https URL without credentials or private hosts.");
        }
    }

    private static boolean publicAddress(java.net.InetAddress address) {
        if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress() || address.isSiteLocalAddress() || address.isMulticastAddress()) return false;
        byte[] bytes = address.getAddress();
        if (bytes.length == 4) {
            int a = bytes[0] & 255, b = bytes[1] & 255;
            return a != 0 && a != 127 && a < 224 && !(a == 100 && b >= 64 && b <= 127)
                    && !(a == 192 && (b == 0 || b == 168)) && !(a == 198 && (b == 18 || b == 19));
        }
        return (bytes[0] & 0xfe) != 0xfc;
    }

    private static JSONObject firecrawl(Context context, String path, JSONObject body, RunContext run) throws java.io.IOException, JSONException {
        okhttp3.Request.Builder request = new okhttp3.Request.Builder().url(FIRECRAWL + path).header("User-Agent", "Pocket/pip")
                .post(okhttp3.RequestBody.create(body.toString(), okhttp3.MediaType.parse("application/json; charset=utf-8")));
        String key = ChatProvider.firecrawlKey(context);
        if (!key.isEmpty()) request.header("Authorization", "Bearer " + key);
        okhttp3.Call call = run.client.newCall(request.build());
        run.begin(call);
        try (okhttp3.Response response = call.execute()) {
            run.check();
            int code = response.code();
            if (code != 200) throw new WebRefused(code == 401 || code == 402 || code == 429
                    ? "Web search is unavailable right now (Firecrawl " + code + "). A Firecrawl key in Provider settings raises the limit."
                    : "Web search failed (Firecrawl " + code + ").");
            if (response.body() == null) throw new WebRefused("Web search returned an empty reply.");
            okio.BufferedSource source = response.body().source();
            if (source.request(2_000_001)) throw new WebRefused("That page is too large to read.");
            JSONObject result = new JSONObject(source.getBuffer().readUtf8());
            run.check();
            return result;
        } finally { run.end(call); }
    }

    private static void checkInterrupted() {
        if (Thread.currentThread().isInterrupted()) throw new CancellationException();
    }

    private static boolean category(String value) {
        return NOTES.equals(value) || THOUGHTS.equals(value) || TASKS.equals(value) || CALENDAR.equals(value) || GYM.equals(value) || COROS.equals(value);
    }

    private static String toolCategory(String name) {
        if ("search_notes".equals(name) || "read_note".equals(name)) return NOTES;
        if ("search_thoughts".equals(name)) return THOUGHTS;
        if ("search_tasks".equals(name) || "read_task".equals(name)) return TASKS;
        if ("search_calendar".equals(name)) return CALENDAR;
        if ("gym_summary".equals(name)) return GYM;
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

    private static String requiredText(JSONObject args, String key, int max, boolean empty) {
        Object raw = args.opt(key);
        if (!(raw instanceof String) || ((String) raw).length() > max || (!empty && ((String) raw).trim().isEmpty()))
            throw new IllegalArgumentException(key + " must be " + (empty ? "text" : "nonempty text") + " of up to " + max + " characters.");
        return "text".equals(key) ? (String) raw : ((String) raw).trim();
    }

    private static String optionalText(JSONObject args, String key, int max) {
        return args.has(key) ? requiredText(args, key, max, true) : "";
    }

    private static String savedId(JSONObject args) {
        Object value = args.opt("id");
        String text = value instanceof String ? (String) value : value instanceof Number ? value.toString() : "";
        if (!text.matches("[A-Za-z0-9][A-Za-z0-9_-]{0,79}") || (value instanceof Number && !text.matches("[1-9][0-9]{0,18}")))
            throw new IllegalArgumentException("id must be an id returned by a Pocket search.");
        if (text.matches("[0-9]+")) {
            try { if (!text.matches("[1-9][0-9]{0,18}") || Long.parseLong(text) <= 0) throw new NumberFormatException(); }
            catch (NumberFormatException invalid) { throw new IllegalArgumentException("id must be an id returned by a Pocket search."); }
        }
        return text;
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

    private static JSONObject idProperty() throws JSONException {
        return json("description", "The id returned by a Pocket search.", "anyOf", new JSONArray()
                .put(json("type", "string", "pattern", "^[A-Za-z0-9][A-Za-z0-9_-]*$", "maxLength", 80))
                .put(json("type", "integer", "minimum", 1)));
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
