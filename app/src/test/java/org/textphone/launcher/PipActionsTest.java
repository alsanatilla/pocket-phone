package org.textphone.launcher;

import static org.junit.Assert.*;
import android.content.Context;
import java.time.OffsetDateTime;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

/** Approval saves use actual offline stores and sync codecs, without provider keys or cloud access. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class PipActionsTest {
    private static final String CHAT = "chat-one", TURN = "user-one", EVENT = "proposal-event";
    private static final String PORTABLE_ID = "pip-84da10addfd8e10e5ffd0da79b85822a";
    private Context context;
    private PlannerStore planner;

    @Before public void setup() {
        context = RuntimeEnvironment.getApplication();
        for (String file : new String[]{"pocket_planner", "pocket_agenda", "pocket_parking", "pocket_clock", "pocket_cloud", "pocket_chat_provider", "pocket_chat_access"})
            context.getSharedPreferences(file, 0).edit().clear().commit();
        planner = new PlannerStore(context.getSharedPreferences("pocket_planner", 0));
    }

    @Test public void portableIdMatchesTheBrowserSha256Fixture() {
        // Independent Node/browser SHA-256 fixture over UTF-8 "chat-one\nuser-one\nproposal-event".
        assertEquals(PORTABLE_ID, PipActions.id(CHAT, TURN, EVENT));
        assertNotEquals(PORTABLE_ID, PipActions.id(CHAT, TURN, "another-event"));
        assertEquals("pip-5612e074b6dc7ffea9987b6f897ac972", PipActions.id("chat-ä", "user-雪", "event-🙂"));
    }

    @Test public void reviewedNoteSavesTitleAndBodyOnceAndRoundTripsThroughPortableNotes() throws Exception {
        JSONObject proposal = proposal("note", " Research ", "Read this source\n\n>> an undecided idea");
        assertEquals("/notes/" + PORTABLE_ID, apply(EVENT, proposal));
        PlannerStore.Entry note = onlyEntry("note");
        assertEquals("# Research\n\nRead this source\n\n>> an undecided idea", note.text);
        assertEquals(PORTABLE_ID, planner.preferences().getString("note_uid_" + note.id, ""));
        assertEquals("/notes/" + PORTABLE_ID, apply(EVENT, proposal));
        assertEquals(1, planner.entries().size()); assertTrue(ParkingStore.items(context).isEmpty());
        JSONObject exported = NoteSync.merge(context, null).getJSONArray("notes").getJSONObject(0);
        assertEquals(PORTABLE_ID, exported.getString("uid")); assertEquals(note.text, exported.getString("text"));
        assertFalse(exported.getBoolean("deleted"));
    }

    @Test public void reviewedTaskSavesChosenTitleStepsDueAndSourceContextOnce() throws Exception {
        String longestStep = "s".repeat(160);
        JSONObject proposal = proposal("task", " Review the source ", "Context to keep with this task")
                .put("due", "2026-10-09").put("steps", new JSONArray().put("Open source").put(longestStep));
        assertEquals("/tasks/" + PORTABLE_ID, apply(EVENT, proposal));
        PlannerStore.Entry task = onlyEntry("task");
        assertEquals("Review the source", task.text); assertEquals("2026-10-09", task.due); assertFalse(task.done);
        assertEquals(2, task.steps.size()); assertEquals(longestStep, task.steps.get(1).text); assertFalse(task.steps.get(0).done);
        assertNotNull(task.source); assertEquals("shared", task.source.kind); assertEquals("Pip", task.source.name);
        assertEquals("Context to keep with this task", task.source.text); assertEquals(PORTABLE_ID, task.source.token);
        assertEquals("/tasks/" + PORTABLE_ID, apply(EVENT, proposal)); assertEquals(1, planner.entries().size());
        JSONObject exported = TaskSync.merge(context, null).getJSONArray("tasks").getJSONObject(0);
        assertEquals(PORTABLE_ID, exported.getString("uid")); assertEquals(2, exported.getJSONArray("steps").length());
        assertEquals(PORTABLE_ID, exported.getJSONObject("source").getString("token"));
    }

    @Test public void reviewedAppointmentSavesItsTimeAndDurationOnceWithPortableId() throws Exception {
        JSONObject proposal = appointment().put("minutes", 90);
        assertEquals("/calendar/" + PORTABLE_ID, apply(EVENT, proposal));
        AgendaStore.Event appointment = onlyAppointment();
        assertEquals(PORTABLE_ID, appointment.uid); assertEquals("Review meeting", appointment.title);
        assertEquals(OffsetDateTime.parse("2026-10-09T10:30:00+02:00").toInstant().toEpochMilli(), appointment.when);
        assertEquals(90, appointment.minutes); assertEquals(0, appointment.alarm);
        assertEquals("/calendar/" + PORTABLE_ID, apply(EVENT, proposal)); assertEquals(1, AgendaStore.list(context).size());
        JSONObject exported = AgendaCloud.merge(context, null).getJSONArray("events").getJSONObject(0);
        assertEquals(PORTABLE_ID, exported.getString("uid")); assertEquals(appointment.when, exported.getLong("when"));
        assertEquals(90, exported.getInt("minutes"));
        assertTrue(planner.entries().isEmpty());
    }

    @Test public void deletedApprovedRecordsCannotBeResurrectedByRepeatingTheProposal() throws Exception {
        for (String kind : new String[]{"note", "task", "appointment"}) {
            String event = "removed-" + kind, uid = PipActions.id(CHAT, TURN, event);
            JSONObject proposal = "appointment".equals(kind) ? appointment() : proposal(kind, "Remove me", "Approved context");
            apply(event, proposal);
            if ("appointment".equals(kind)) {
                AgendaStore.Event item = onlyAppointment(); AgendaStore.delete(context, item.id);
                assertTrue(new JSONObject(context.getSharedPreferences("pocket_agenda", 0).getString("cloud_deleted", "{}")).has(uid));
            } else {
                PlannerStore.Entry item = onlyEntry(kind); planner.delete(item.id);
                assertTrue(new JSONObject(planner.preferences().getString(kind + "_tombstones", "{}")).has(uid));
            }
            rejected(event, proposal);
            assertTrue(planner.entries().isEmpty()); assertTrue(AgendaStore.list(context).isEmpty());
        }
    }

    @Test public void sameProposalOnAnotherOfflineWorkspaceRestoresTheSamePortableRecordId() throws Exception {
        JSONObject proposal = proposal("task", "Read", "Keep the context");
        apply(EVENT, proposal);
        JSONObject portable = TaskSync.merge(context, null);
        planner.preferences().edit().clear().commit();
        TaskSync.merge(context, portable);
        assertEquals("/tasks/" + PORTABLE_ID, apply(EVENT, proposal));
        assertEquals(1, planner.entries().size());
        assertEquals(PORTABLE_ID, planner.preferences().getString("task_uid_" + onlyEntry("task").id, ""));
    }

    @Test public void malformedFieldsAreRejectedWithoutCreatingAnyRecord() throws Exception {
        JSONObject note = proposal("note", "Review", "Body");
        rejected("bad-title-number", copy(note).put("title", 42));
        rejected("bad-title-empty", copy(note).put("title", " "));
        rejected("bad-body-number", copy(note).put("text", 42));
        rejected("bad-body-object", copy(note).put("text", new JSONObject().put("body", "text")));
        JSONObject missing = copy(note); missing.remove("text"); rejected("missing-body", missing);
        rejected("bad-title-limit", copy(note).put("title", "x".repeat(201)));
        rejected("bad-body-limit", copy(note).put("text", "x".repeat(6001)));
        assertTrue(planner.entries().isEmpty()); assertTrue(AgendaStore.list(context).isEmpty());
    }

    @Test public void taskDueAndStepsRejectImpossibleDatesAndCoercedOrOversizedSteps() throws Exception {
        JSONObject task = proposal("task", "Review", "Context");
        rejected("bad-due-day", copy(task).put("due", "2026-02-30"));
        rejected("bad-due-format", copy(task).put("due", "10/09/2026"));
        rejected("bad-due-number", copy(task).put("due", 20261009));
        rejected("bad-due-null", copy(task).put("due", JSONObject.NULL));
        rejected("bad-steps-type", copy(task).put("steps", "Open source"));
        rejected("bad-steps-null", copy(task).put("steps", JSONObject.NULL));
        rejected("bad-step-number", copy(task).put("steps", new JSONArray().put(42)));
        rejected("bad-step-empty", copy(task).put("steps", new JSONArray().put(" ")));
        rejected("bad-step-long", copy(task).put("steps", new JSONArray().put("x".repeat(161))));
        rejected("bad-step-newline", copy(task).put("steps", new JSONArray().put("First\nSecond")));
        JSONArray tooMany = new JSONArray(); for (int index = 0; index < 13; index++) tooMany.put("Step " + index);
        rejected("bad-steps-count", copy(task).put("steps", tooMany));
        assertTrue(planner.entries().isEmpty()); assertTrue(AgendaStore.list(context).isEmpty());
    }

    @Test public void appointmentTimeAndMinutesRejectCoercionAndMalformedIsoValues() throws Exception {
        JSONObject appointment = appointment();
        rejected("bad-minutes-string", copy(appointment).put("minutes", "60"));
        rejected("bad-minutes-fraction", copy(appointment).put("minutes", 60.5));
        rejected("bad-minutes-bool", copy(appointment).put("minutes", true));
        rejected("bad-minutes-short", copy(appointment).put("minutes", 14));
        rejected("bad-minutes-long", copy(appointment).put("minutes", 481));
        rejected("bad-minutes-null", copy(appointment).put("minutes", JSONObject.NULL));
        rejected("bad-when-no-zone", copy(appointment).put("when", "2026-10-09T10:30:00"));
        rejected("bad-when-date", copy(appointment).put("when", "2026-02-30T10:30:00Z"));
        rejected("bad-when-fraction", copy(appointment).put("when", "2026-10-09T10:30:00.123456Z"));
        rejected("bad-when-number", copy(appointment).put("when", 1791534600000L));
        JSONObject missing = copy(appointment); missing.remove("when"); rejected("missing-when", missing);
        assertTrue(AgendaStore.list(context).isEmpty()); assertTrue(planner.entries().isEmpty());
        assertEquals("/calendar/" + PipActions.id(CHAT, TURN, "default-duration"), apply("default-duration", appointment));
        assertEquals(60, onlyAppointment().minutes);
    }

    @Test public void reviewedChangesApplyOnceAndRemindersMoveWithTheirAppointment() throws Exception {
        context.getSharedPreferences("pocket_planner", 0).edit().putString("entries", new JSONArray()
                .put(new JSONObject().put("id", 1).put("kind", "note").put("text", "# Lisbon\n\nFerry before Friday.").put("created", 1))
                .put(new JSONObject().put("id", 2).put("kind", "task").put("text", "Book ferry tickets").put("created", 2)
                        .put("steps", new JSONArray().put(new JSONObject().put("text", "compare times").put("done", true)))).toString())
                .putString("task_uid_2", "task-portable-id").commit();
        JSONObject complete = new JSONObject().put("change", "complete_task").put("id", "task-portable-id");
        assertEquals("/tasks/task-portable-id", PipActions.applyChange(context, complete));
        assertTrue(planner.find(2).done);
        PipActions.applyChange(context, complete); assertTrue("Applying again must not reopen the task", planner.find(2).done);

        JSONObject update = new JSONObject().put("change", "update_task").put("id", "2").put("title", "Book the ferry").put("due", "2026-10-11")
                .put("add_steps", new JSONArray().put("compare times").put("pay online"));
        PipActions.applyChange(context, update); PipActions.applyChange(context, update);
        PlannerStore.Entry task = planner.find(2);
        assertEquals("Book the ferry", task.text); assertEquals("2026-10-11", task.due);
        assertEquals(2, task.steps.size()); assertEquals("pay online", task.steps.get(1).text);

        JSONObject append = new JSONObject().put("change", "append_note").put("id", "1").put("text", "Bring the camera.");
        assertEquals("/notes/1", PipActions.applyChange(context, append)); PipActions.applyChange(context, append);
        assertEquals("# Lisbon\n\nFerry before Friday.\n\nBring the camera.", planner.find(1).text);

        org.robolectric.shadows.ShadowAlarmManager.setCanScheduleExactAlarms(true);
        long when = System.currentTimeMillis() + 86400000L, later = when + 86400000L;
        ClockStore.Entry alarm = new ClockStore.Entry(); alarm.kind = "reminder"; alarm.title = "Dentist"; alarm.enabled = true; alarm.due = when - 900000L;
        AlarmScheduler.saveAndArm(context, alarm);
        AgendaStore.Event dentist = new AgendaStore.Event(); dentist.title = "Dentist"; dentist.when = when; dentist.minutes = 45; dentist.alarm = alarm.id;
        AgendaStore.save(context, dentist);
        JSONObject move = new JSONObject().put("change", "move_appointment").put("id", onlyAppointment().uid).put("when", java.time.Instant.ofEpochMilli(later).toString());
        assertEquals("/calendar/" + onlyAppointment().uid, PipActions.applyChange(context, move)); PipActions.applyChange(context, move);
        AgendaStore.Event moved = onlyAppointment();
        assertEquals(later, moved.when); assertEquals(45, moved.minutes);
        assertEquals("The reminder keeps its 15 minutes", later - 900000L, ClockStore.find(context, alarm.id).due); assertEquals(later - 900000L, moved.remindAt);

        for (JSONObject bad : new JSONObject[]{new JSONObject().put("change", "update_task").put("id", "2").put("add_steps", new JSONArray().put("a\nb")),
                new JSONObject().put("change", "delete_task").put("id", "2"), new JSONObject().put("change", "append_note").put("id", "99").put("text", "x"),
                new JSONObject().put("change", "move_appointment").put("id", moved.uid).put("when", "tomorrow")})
            try { PipActions.applyChange(context, bad); fail("Applied " + bad); } catch (IllegalArgumentException expected) { }
        assertEquals(later, onlyAppointment().when);
    }

    private String apply(String event, JSONObject value) throws Exception { return PipActions.apply(context, CHAT, TURN, event, value); }
    private void rejected(String event, JSONObject value) throws Exception {
        try { apply(event, value); fail("Malformed or deleted proposal was saved: " + event); }
        catch (IllegalArgumentException | JSONException expected) { }
    }
    private PlannerStore.Entry onlyEntry(String kind) { List<PlannerStore.Entry> entries = planner.entries(); assertEquals(1, entries.size()); assertEquals(kind, entries.get(0).kind); return entries.get(0); }
    private AgendaStore.Event onlyAppointment() { List<AgendaStore.Event> entries = AgendaStore.list(context); assertEquals(1, entries.size()); return entries.get(0); }
    private static JSONObject proposal(String kind, String title, String text) throws Exception { return new JSONObject().put("kind", kind).put("title", title).put("text", text); }
    private static JSONObject appointment() throws Exception { return proposal("appointment", "Review meeting", "").put("when", "2026-10-09T10:30:00+02:00"); }
    private static JSONObject copy(JSONObject value) throws Exception { return new JSONObject(value.toString()); }
}
