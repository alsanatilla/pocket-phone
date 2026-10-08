package org.textphone.launcher;

import static org.junit.Assert.*;
import android.content.Context;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CancellationException;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

/** Focused fixtures for tool grants, strict arguments and run-scoped web reads. No keys or network. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class PocketChatToolsTest {
    private Context context;
    @Before public void setup() {
        context = RuntimeEnvironment.getApplication();
        for (String file : new String[]{"pocket_chat_provider", "pocket_chat_access", "pocket_planner", "pocket_parking", "pocket_agenda"})
            context.getSharedPreferences(file, 0).edit().clear().commit();
    }

    @Test public void plansAndProposalsAreAvailableWithoutReadGrantsAndNeverSave() throws Exception {
        List<String> offered = new ArrayList<>();
        for (PocketChatTools.Definition item : PocketChatTools.definitions(context)) offered.add(item.name);
        assertEquals(List.of("update_plan", "propose_action"), offered);
        JSONObject plan = execute("update_plan", new JSONObject().put("steps", new JSONArray().put(new JSONObject().put("text", "Find sources").put("status", "in_progress"))));
        assertEquals("Find sources", plan.getJSONArray("plan").getJSONObject(0).getString("text"));
        JSONObject proposal = execute("propose_action", new JSONObject().put("kind", "task").put("title", " Review ").put("text", "Read the source").put("due", "2026-10-09"));
        assertTrue(proposal.getBoolean("requires_confirmation"));
        assertEquals("Review", proposal.getJSONObject("proposal").getString("title"));
        assertEquals(0, proposal.getJSONObject("proposal").getJSONArray("steps").length());
        assertEquals(60, proposal.getJSONObject("proposal").getInt("minutes"));
        assertTrue(context.getSharedPreferences("pocket_planner", 0).getAll().isEmpty());
        assertTrue(context.getSharedPreferences("pocket_agenda", 0).getAll().isEmpty());
        assertTrue(context.getSharedPreferences("pocket_parking", 0).getAll().isEmpty());
    }

    @Test public void proposalAndPlanValidationRejectsMalformedOrUnexpectedArguments() throws Exception {
        JSONObject valid = new JSONObject().put("kind", "task").put("title", "Review").put("text", "");
        invalid("propose_action", new JSONObject(valid.toString()).put("save", true));
        invalid("propose_action", new JSONObject(valid.toString()).put("due", "2026-02-30"));
        invalid("propose_action", new JSONObject(valid.toString()).put("minutes", "60"));
        invalid("propose_action", new JSONObject(valid.toString()).put("kind", "thought"));
        invalid("propose_action", new JSONObject(valid.toString()).put("title", " "));
        invalid("propose_action", new JSONObject(valid.toString()).put("steps", new JSONArray().put(" ")));
        invalid("propose_action", new JSONObject(valid.toString()).put("steps", new JSONArray().put("x".repeat(161))));
        invalid("propose_action", new JSONObject(valid.toString()).put("kind", "appointment"));
        invalid("propose_action", new JSONObject(valid.toString()).put("when", "2026-10-08T12:00"));
        invalid("propose_action", new JSONObject().put("kind", "note").put("title", "Missing body"));
        invalid("update_plan", new JSONObject().put("steps", new JSONArray()));
        invalid("update_plan", new JSONObject().put("steps", new JSONArray().put(new JSONObject().put("text", "Do it").put("status", "complete"))));
        invalid("update_plan", new JSONObject().put("steps", new JSONArray().put(new JSONObject().put("text", "Do it").put("status", "done").put("save", true))));
        assertFalse(execute("propose_action", new JSONObject(valid.toString()).put("kind", "appointment").put("when", "2026-10-08T12:00:00+02:00")).has("error"));
    }

    @Test public void changeProposalsNeedTheirCategoryAndCheckLiveRecordsWithoutWriting() throws Exception {
        saveEntries(new JSONObject().put("id", 1).put("kind", "note").put("text", "# Lisbon\n\nFerry before Friday.").put("created", 1),
                new JSONObject().put("id", 2).put("kind", "task").put("text", "Book ferry tickets").put("created", 2).put("due", "2026-10-09")
                        .put("steps", new JSONArray().put(new JSONObject().put("text", "compare times").put("done", true))),
                new JSONObject().put("id", 3).put("kind", "task").put("text", "Already done").put("done", true).put("created", 3));
        context.getSharedPreferences("pocket_planner", 0).edit().putString("task_uid_2", "task-portable-id").commit();
        context.getSharedPreferences("pocket_agenda", 0).edit().putString("events", new JSONArray().put(new JSONObject().put("id", 7).put("when", 1791534600000L)
                .put("title", "Dentist").put("minutes", 45).put("uid", "appt-portable-id")).toString()).commit();
        for (PocketChatTools.Definition item : PocketChatTools.definitions(context)) assertNotEquals("propose_change", item.name);
        PocketChatTools.enabled(context, PocketChatTools.TASKS, true);
        boolean offered = false;
        for (PocketChatTools.Definition item : PocketChatTools.definitions(context)) offered |= "propose_change".equals(item.name);
        assertTrue(offered);
        assertEquals("access_disabled", execute("propose_change", new JSONObject().put("change", "append_note").put("id", 1).put("text", "Bring the camera.")).getString("error"));
        assertEquals("access_disabled", execute("propose_change", new JSONObject().put("change", "move_appointment").put("id", 7).put("when", "2026-10-10T10:30:00Z")).getString("error"));
        PocketChatTools.enabled(context, PocketChatTools.NOTES, true); PocketChatTools.enabled(context, PocketChatTools.CALENDAR, true);
        String before = stores();

        JSONObject complete = execute("propose_change", new JSONObject().put("change", "complete_task").put("id", "task-portable-id").put("reason", "You booked it."));
        assertEquals("change", complete.getString("kind")); assertTrue(complete.getBoolean("requires_confirmation"));
        assertEquals("task-portable-id", complete.getJSONObject("change").getString("id")); assertEquals("You booked it.", complete.getJSONObject("change").getString("reason"));
        assertEquals("Book ferry tickets", complete.getJSONObject("before").getString("title"));
        assertEquals("already_done", execute("propose_change", new JSONObject().put("change", "complete_task").put("id", 3)).getString("error"));
        assertEquals("task_not_found", execute("propose_change", new JSONObject().put("change", "complete_task").put("id", "missing")).getString("error"));
        JSONObject update = execute("propose_change", new JSONObject().put("change", "update_task").put("id", 2).put("due", "2026-10-11")
                .put("add_steps", new JSONArray().put("compare times").put("pay online")));
        assertEquals("[\"pay online\"]", update.getJSONObject("change").getJSONArray("add_steps").toString());
        assertEquals("2026-10-11", update.getJSONObject("change").getString("due")); assertEquals(1, update.getJSONObject("before").getInt("steps"));
        invalid("propose_change", new JSONObject().put("change", "update_task").put("id", 2));
        invalid("propose_change", new JSONObject().put("change", "update_task").put("id", 2).put("due", "2026-02-30"));
        invalid("propose_change", new JSONObject().put("change", "update_task").put("id", 2).put("add_steps", new JSONArray().put("a\nb")));
        invalid("propose_change", new JSONObject().put("change", "delete_task").put("id", 2));
        JSONObject append = execute("propose_change", new JSONObject().put("change", "append_note").put("id", 1).put("text", "Bring the camera."));
        assertEquals("Lisbon", append.getJSONObject("before").getString("title"));
        assertTrue(append.getJSONObject("before").getString("ending").endsWith("Ferry before Friday."));
        JSONObject move = execute("propose_change", new JSONObject().put("change", "move_appointment").put("id", "appt-portable-id").put("when", "2026-10-10T10:30:00+02:00"));
        assertEquals(45, move.getJSONObject("change").getInt("minutes")); assertEquals("Dentist", move.getJSONObject("before").getString("title"));
        invalid("propose_change", new JSONObject().put("change", "move_appointment").put("id", 7).put("when", "tomorrow"));
        invalid("propose_change", new JSONObject().put("change", "move_appointment").put("id", 7).put("when", "2026-10-10T10:30:00Z").put("save", true));
        assertEquals(before, stores());
    }

    @Test public void notePagesContinueAtReturnedOffsetsAndStayBoundedAfterJsonEscaping() throws Exception {
        String text = "\"\\\n".repeat(2300);
        saveEntries(new JSONObject().put("id", 1).put("kind", "note").put("text", text).put("created", 1));
        context.getSharedPreferences("pocket_planner", 0).edit().putString("note_uid_1", "note-portable-id").commit();
        PocketChatTools.enabled(context, PocketChatTools.NOTES, true);
        JSONObject first = execute("read_note", new JSONObject().put("id", "note-portable-id").put("length", 6000));
        assertEquals(text.length(), first.getInt("total_length")); assertTrue(first.getBoolean("truncated"));
        assertTrue(first.toString().length() <= 8000);
        int next = first.getInt("next_offset"); assertEquals(first.getString("text").length(), next);
        StringBuilder restored = new StringBuilder(first.getString("text"));
        JSONObject page = first;
        int count = 1;
        while (!page.isNull("next_offset")) {
            int offset = page.getInt("next_offset");
            page = execute("read_note", new JSONObject().put("id", 1).put("offset", offset).put("length", 6000));
            assertTrue(page.toString().length() <= 8000); assertEquals(offset, page.getInt("offset"));
            restored.append(page.getString("text")); assertTrue(++count < 10);
        }
        assertEquals(text, restored.toString()); assertFalse(page.getBoolean("truncated"));
        invalid("read_note", new JSONObject().put("id", 1).put("length", 199));
        invalid("read_note", new JSONObject().put("id", 1).put("offset", 200001));
        invalid("read_note", new JSONObject().put("id", 1).put("length", 200.5));
        PocketChatTools.enabled(context, PocketChatTools.NOTES, false);
        assertEquals("access_disabled", execute("read_note", new JSONObject().put("id", 1)).getString("error"));
    }

    @Test public void workspaceSearchReadsOnlyGrantedCategoriesAndCapsResults() throws Exception {
        JSONArray entries = new JSONArray();
        for (int index = 1; index <= 12; index++) entries.put(new JSONObject().put("id", index).put("kind", "note").put("text", "shared note " + index).put("created", index));
        entries.put(new JSONObject().put("id", 20).put("kind", "task").put("text", "shared task").put("created", 20));
        context.getSharedPreferences("pocket_planner", 0).edit().putString("entries", entries.toString()).commit();
        PocketChatTools.enabled(context, PocketChatTools.NOTES, true);
        JSONObject result = execute("search_pocket", new JSONObject().put("query", "shared"));
        assertEquals("pocket:workspace", result.getString("source")); assertEquals(12, result.getInt("matched"));
        assertEquals(10, result.getJSONArray("results").length()); assertTrue(result.getBoolean("truncated"));
        for (int index = 0; index < 10; index++) assertEquals("note", result.getJSONArray("results").getJSONObject(index).getString("kind"));
        PocketChatTools.enabled(context, PocketChatTools.TASKS, true);
        assertEquals(13, execute("search_pocket", new JSONObject().put("query", "shared")).getInt("matched"));
        PocketChatTools.enabled(context, PocketChatTools.NOTES, false);
        assertEquals(1, execute("search_pocket", new JSONObject().put("query", "shared")).getInt("matched"));
        invalid("search_pocket", new JSONObject().put("limit", 11));
        assertFalse(context.getSharedPreferences("pocket_planner", 0).contains("note_uid_1"));
    }

    @Test public void taskReadsExposeStepsAndCompletionButRespectSourceNoteGrant() throws Exception {
        JSONObject source = new JSONObject().put("kind", "note").put("name", "Private note").put("text", "note-only context").put("note", 1);
        saveEntries(new JSONObject().put("id", 1).put("kind", "note").put("text", "note-only context").put("created", 1),
                new JSONObject().put("id", 2).put("kind", "task").put("text", "Chosen action").put("done", true).put("created", 2).put("due", "2026-10-09")
                        .put("steps", new JSONArray().put(new JSONObject().put("text", "First step").put("done", true))).put("source", source));
        context.getSharedPreferences("pocket_planner", 0).edit().putString("task_uid_2", "task-portable-id").putString("note_uid_1", "note-portable-id").commit();
        PocketChatTools.enabled(context, PocketChatTools.TASKS, true);
        JSONObject hidden = execute("read_task", new JSONObject().put("id", "task-portable-id"));
        assertTrue(hidden.getBoolean("completed")); assertEquals("2026-10-09", hidden.getString("due"));
        assertTrue(hidden.getJSONArray("steps").getJSONObject(0).getBoolean("done"));
        assertFalse(hidden.toString().contains("note-only context"));
        assertTrue(hidden.getJSONObject("task_source").getBoolean("access_disabled"));
        PocketChatTools.enabled(context, PocketChatTools.NOTES, true);
        assertEquals("note-only context", execute("read_task", new JSONObject().put("id", 2)).getJSONObject("task_source").getString("text"));
        assertEquals("task_not_found", execute("read_task", new JSONObject().put("id", 1)).getString("error"));
    }

    @Test public void calendarReadsOnlyTheRequestedUpcomingWindow() throws Exception {
        ZoneId zone = ZoneId.systemDefault();
        long today = LocalDate.now(zone).atStartOfDay(zone).toInstant().toEpochMilli();
        JSONArray events = new JSONArray().put(event(1, today + 3600000, "Review source", "appointment-one"))
                .put(event(2, today + 31 * 86400000L, "Review later", "appointment-later"))
                .put(event(3, today - 86400000L, "Review old", "appointment-old"));
        context.getSharedPreferences("pocket_agenda", 0).edit().putString("events", events.toString()).commit();
        assertEquals("access_disabled", execute("search_calendar", new JSONObject()).getString("error"));
        PocketChatTools.enabled(context, PocketChatTools.CALENDAR, true);
        JSONObject result = execute("search_calendar", new JSONObject().put("query", "review source").put("days", 30));
        assertEquals(1, result.getInt("matched"));
        assertEquals("/calendar/appointment-one", result.getJSONArray("appointments").getJSONObject(0).getString("href"));
        invalid("search_calendar", new JSONObject().put("days", 31));
    }

    @Test public void webSearchUsesDocumentedDomainAndTimeFieldsAndFiltersPrivateResults() throws Exception {
        enableWeb(); List<JSONObject> bodies = new ArrayList<>();
        PocketChatTools.RunContext run = fakeWeb(bodies, new JSONObject().put("data", new JSONObject().put("web", new JSONArray()
                .put(new JSONObject().put("url", "https://docs.firecrawl.dev/features/search").put("title", "Search"))
                .put(new JSONObject().put("url", "http://127.0.0.1/private").put("title", "Private")))));
        JSONObject args = new JSONObject().put("query", "api filters").put("domains", new JSONArray().put("docs.firecrawl.dev")).put("time_range", "week");
        JSONObject result = new JSONObject(PocketChatTools.execute(context, "search_web", args, run));
        assertEquals("qdr:w", bodies.get(0).getString("tbs"));
        assertEquals("docs.firecrawl.dev", bodies.get(0).getJSONArray("includeDomains").getString(0));
        assertEquals(1, result.getJSONArray("results").length());
        invalid("search_web", new JSONObject(args.toString()).put("time_range", "yesterday"));
        invalid("search_web", new JSONObject(args.toString()).put("domains", new JSONArray().put("localhost")));
        invalid("search_web", new JSONObject(args.toString()).put("domains", new JSONArray().put("https://docs.firecrawl.dev")));
        assertTrue(PocketChatTools.definitions(context, ChatProvider.get(context)).stream().anyMatch(item -> item.name.equals("read_web_page")));
    }

    @Test public void publicPageReadsCacheWithinOneRunAndFindLaterPassages() throws Exception {
        enableWeb(); List<JSONObject> bodies = new ArrayList<>();
        String page = "intro ".repeat(400) + "relevant passage " + "end ".repeat(600);
        PocketChatTools.RunContext run = fakeWeb(bodies, new JSONObject().put("data", new JSONObject().put("markdown", page).put("metadata", new JSONObject().put("title", "Fixture"))));
        JSONObject args = new JSONObject().put("url", "https://docs.firecrawl.dev/features/search").put("length", 500);
        JSONObject first = new JSONObject(PocketChatTools.execute(context, "read_web_page", args, run));
        JSONObject next = new JSONObject(PocketChatTools.execute(context, "read_web_page", new JSONObject(args.toString()).put("offset", first.getInt("next_offset")), run));
        JSONObject relevant = new JSONObject(PocketChatTools.execute(context, "read_web_page", new JSONObject(args.toString()).put("query", "relevant passage"), run));
        assertEquals(1, bodies.size()); assertEquals(500, next.getInt("offset"));
        assertTrue(relevant.getBoolean("query_found")); assertTrue(relevant.getInt("offset") > 2000);
        assertTrue(relevant.getJSONArray("passages").getJSONObject(0).getString("text").contains("relevant passage"));
        assertTrue(relevant.toString().length() <= 8000);
        JSONObject shortPage = new JSONObject(PocketChatTools.execute(context, "read_web_page", new JSONObject(args.toString()).put("length", 200).put("query", "relevant passage"), run));
        assertTrue(shortPage.getString("text").contains("relevant passage"));
        assertTrue(shortPage.getJSONArray("passages").getJSONObject(0).getString("text").contains("relevant passage"));
        run.cancel();
        try { PocketChatTools.execute(context, "read_web_page", args, run); fail("Cancelled run reused page text"); }
        catch (CancellationException expected) { }
        PocketChatTools.RunContext another = fakeWeb(bodies, new JSONObject().put("data", new JSONObject().put("markdown", "fresh page")));
        PocketChatTools.execute(context, "read_web_page", args, another);
        assertEquals(2, bodies.size());
    }

    @Test public void privateUrlsAndCredentialsAreRejectedBeforeAnyNetworkRequest() throws Exception {
        enableWeb(); List<JSONObject> bodies = new ArrayList<>(); PocketChatTools.RunContext run = fakeWeb(bodies, new JSONObject());
        for (String url : new String[]{"http://localhost/a", "http://10.0.0.1/a", "http://172.16.1.2/a", "http://169.254.169.254/a", "http://100.64.0.1/a",
                "http://127.1/a", "http://2130706433/a", "http://[::1]/a", "http://[fc00::1]/a", "https://user:secret@docs.firecrawl.dev/a", "file:///etc/passwd", "https://host.internal/a"})
            assertEquals(url, "invalid_arguments", new JSONObject(PocketChatTools.execute(context, "read_web_page", new JSONObject().put("url", url), run)).getString("error"));
        assertTrue(bodies.isEmpty());
    }

    private void saveEntries(JSONObject... entries) throws Exception { JSONArray array = new JSONArray(); for (JSONObject entry : entries) array.put(entry); context.getSharedPreferences("pocket_planner", 0).edit().putString("entries", array.toString()).commit(); }
    private void enableWeb() { context.getSharedPreferences("pocket_chat_provider", 0).edit().putBoolean("web_search", true).commit(); }
    private String stores() { return new java.util.TreeMap<>(context.getSharedPreferences("pocket_planner", 0).getAll()) + "\n" + new java.util.TreeMap<>(context.getSharedPreferences("pocket_agenda", 0).getAll()); }
    private JSONObject execute(String name, JSONObject args) throws Exception { return new JSONObject(PocketChatTools.execute(context, name, args)); }
    private void invalid(String name, JSONObject args) throws Exception { assertEquals(name + " " + args, "invalid_arguments", execute(name, args).getString("error")); }
    private static JSONObject event(long id, long when, String title, String uid) throws Exception { return new JSONObject().put("id", id).put("when", when).put("title", title).put("uid", uid).put("minutes", 60); }
    private PocketChatTools.RunContext fakeWeb(List<JSONObject> bodies, JSONObject reply) {
        return new PocketChatTools.RunContext(new okhttp3.OkHttpClient.Builder().addInterceptor(chain -> {
            okio.Buffer request = new okio.Buffer(); chain.request().body().writeTo(request);
            try { bodies.add(new JSONObject(request.readUtf8())); } catch (Exception invalid) { throw new AssertionError(invalid); }
            return new okhttp3.Response.Builder().request(chain.request()).protocol(okhttp3.Protocol.HTTP_1_1).code(200).message("OK")
                    .body(okhttp3.ResponseBody.create(reply.toString(), okhttp3.MediaType.parse("application/json"))).build();
        }).build());
    }
}
