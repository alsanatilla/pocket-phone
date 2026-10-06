package org.textphone.launcher;

import static org.junit.Assert.*;
import android.app.job.JobScheduler;
import android.content.Context;
import android.widget.TextView;
import java.util.Calendar;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.util.ReflectionHelpers;
import org.robolectric.util.ReflectionHelpers.ClassParameter;

@RunWith(RobolectricTestRunner.class)
@Config(sdk={24, 35})
public class CloudAndJournalReleaseTest {
    private Context c;
    private PlannerStore planner;

    @Before public void clear() {
        c = RuntimeEnvironment.getApplication();
        for (String name : new String[]{"text_phone", "pocket_cloud", "pocket_planner", "pocket_parking",
                "pocket_receipt", "pocket_dice", "pocket_journal", "pocket_journal_key"})
            c.getSharedPreferences(name, 0).edit().clear().commit();
        c.getSharedPreferences("text_phone", 0).edit().putBoolean("reduce_motion", true).commit();
        c.getSystemService(JobScheduler.class).cancelAll();
        planner = new PlannerStore(c.getSharedPreferences("pocket_planner", 0));
    }

    @Test public void localAppUseDoesNotEnableOrScheduleCloudSync() throws Exception {
        assertFalse(CloudSync.enabled(c));
        planner.save(0, "note", "Local note");
        ParkingStore.park(c, "A thought", System.currentTimeMillis() + 3600000);
        ReceiptTape.log(c, ReceiptTape.MEMO, "A local line");
        CloudSync.changed(c); CloudSync.soon(c);
        ActivityController<CloudActivity> controller = Robolectric.buildActivity(CloudActivity.class).setup();
        try {
            assertNotNull(controller.get().root.findViewWithTag("cloud_on"));
            assertNull(controller.get().root.findViewWithTag("cloud_off"));
            assertTrue(c.getSystemService(JobScheduler.class).getAllPendingJobs().isEmpty());
            assertFalse(CloudSync.enabled(c));
        } finally { controller.pause().stop().destroy(); }
    }

    @Test public void newerRemoteNotesKeepTheirIdsPinsAndTasksAndDeletionCannotResurrectThem() throws Exception {
        long task = planner.save(0, "task", "Keep this task"), id = planner.save(0, "note", "# Before");
        String uid = NoteSync.uid(planner, id);
        long updated = planner.noteUpdated(planner.find(id)) + 1000;
        JSONObject note = new JSONObject().put("uid", uid).put("text", "# From web\nBody")
                .put("pinned", true).put("created", planner.find(id).created).put("updated", updated);
        JSONObject remote = new JSONObject().put("notes", new JSONArray().put(note));
        NoteSync.merge(c, remote);
        assertEquals(id, NoteSync.byUid(planner, uid).id);
        assertEquals("# From web\nBody", planner.find(id).text);
        assertTrue(planner.notePinned(id));
        assertEquals("Keep this task", planner.find(task).text);
        NoteSync.merge(c, new JSONObject().put("notes", new JSONArray().put(new JSONObject()
                .put("uid", uid).put("deleted", true).put("updated", updated + 1000))));
        assertNull(planner.find(id));
        NoteSync.merge(c, remote);
        assertNull(NoteSync.byUid(planner, uid));
        assertEquals(1, planner.entries().size());
        assertEquals("task", planner.entries().get(0).kind);
    }

    @Test public void thoughtLinesBecomeOneLinkedTaskAndStayHandledOnSave() throws Exception {
        String text = "# Calls\n>> Call Sam @tomorrow";
        long id = planner.save(0, "note", text);
        assertEquals(1, NoteThoughts.parkNew(c, planner, id, text, text));
        String uid = NoteSync.uid(planner, id);
        long thought = NoteThoughts.id(uid, NoteThoughts.key("Call Sam"));
        assertEquals(uid, ParkingStore.find(c, thought).note);
        assertEquals(ParkingStore.PARKED, ParkingStore.find(c, thought).state);
        assertEquals(1,planner.entries().size());
        long promoted=ParkingStore.promote(c,thought);assertEquals(promoted,ParkingStore.promote(c,thought));
        assertEquals(ParkingStore.TASK,ParkingStore.find(c,thought).state);
        PlannerStore.Entry task = null; for (PlannerStore.Entry e : planner.entries()) if ("task".equals(e.kind)) task = e;
        assertEquals("Call Sam", task.text); assertEquals(id, task.source.note); assertTrue(task.due.isEmpty());
        assertEquals(0, NoteThoughts.parkNew(c, planner, id, text, text));
        planner.toggle(task.id);
        assertEquals(0, NoteThoughts.parkNew(c, planner, id, text, text));
        assertEquals(2, planner.entries().size());
        assertEquals(text, planner.find(id).text);
        assertTrue(NoteThoughts.annotate(c, planner, id, text).contains("task done"));
        assertEquals(1, ReceiptTape.count(ReceiptTape.lines(c, System.currentTimeMillis()), ReceiptTape.TASK));
    }

    @Test public void parkingMergeKeepsTheLaterCloseAndNewCaptureIdsStayDistinct() throws Exception {
        ParkingStore.Item item = ParkingStore.park(c, "Later", System.currentTimeMillis() + 3600000);
        JSONObject stale = ParkingStore.merge(c, null);
        ParkingStore.close(c, item.id, ParkingStore.KILLED);
        JSONObject oldItem = stale.getJSONArray("items").getJSONObject(0);
        oldItem.put("updated", item.updated - 1);
        ParkingStore.merge(c, stale);
        assertEquals(ParkingStore.KILLED, ParkingStore.find(c, item.id).state);
        ParkingStore.Item fresh = ParkingStore.park(c, "New thought", System.currentTimeMillis() + 3600000);
        assertNotEquals(item.id, fresh.id);
        assertEquals(1, ParkingStore.open(c).size());
    }

    @Test public void receiptSyncUnionsLinesWithoutDuplicatingLegacyEntries() throws Exception {
        long now = System.currentTimeMillis();
        c.getSharedPreferences("pocket_receipt", 0).edit().putString("day_" + ReceiptTape.day(now),
                new JSONArray().put(new JSONObject().put("t", now).put("k", "MEMO").put("x", "Before sync")).toString()).commit();
        JSONObject remote = ReceiptTape.merge(c, null);
        remote.getJSONObject("days").getJSONArray(ReceiptTape.day(now)).put(new JSONObject()
                .put("i", "web-line").put("t", now + 1).put("k", "DONE").put("x", "Invoice"));
        ReceiptTape.merge(c, remote); ReceiptTape.merge(c, remote);
        assertEquals(2, ReceiptTape.lines(c, now).size());
        assertEquals(1, ReceiptTape.count(ReceiptTape.lines(c, now), ReceiptTape.DONE));
        assertTrue(ReceiptTape.text(now, ReceiptTape.lines(c, now), true).contains("Invoice"));
    }

    @Test public void diceRollPersistsItsResultAndLogsOnlyOnceAcrossRecreation() throws Exception {
        ActivityController<DiceActivity> controller = Robolectric.buildActivity(DiceActivity.class).setup();
        try {
            controller.get().root.findViewWithTag("dice_roll").performClick();
            String result = ((TextView)controller.get().root.findViewWithTag("dice_result")).getText().toString();
            for (String face : result.split(" ")) assertTrue(Integer.parseInt(face) >= 1 && Integer.parseInt(face) <= 6);
            controller.recreate();
            assertEquals(result, ((TextView)controller.get().root.findViewWithTag("dice_result")).getText().toString());
            assertEquals(1, new JSONArray(c.getSharedPreferences("pocket_dice", 0).getString("history", "[]")).length());
            assertEquals(1, ReceiptTape.count(ReceiptTape.lines(c, System.currentTimeMillis()), ReceiptTape.ROLL));
        } finally { controller.pause().stop().destroy(); }
    }

    @Test public void clockTaggedThoughtComesBackAtTheNextLocalTime() {
        Calendar now = Calendar.getInstance(); now.set(2026, Calendar.OCTOBER, 5, 15, 0, 0); now.set(Calendar.MILLISECOND, 0);
        Calendar due = (Calendar)now.clone(); due.set(Calendar.HOUR_OF_DAY, 16); due.set(Calendar.MINUTE, 30);
        assertEquals(due.getTimeInMillis(), ParkingStore.when("16:30", now.getTimeInMillis()));
        now.set(Calendar.HOUR_OF_DAY, 17); due.add(Calendar.DAY_OF_MONTH, 1);
        assertEquals(due.getTimeInMillis(), ParkingStore.when("16:30", now.getTimeInMillis()));
        assertEquals("16:30", NoteThoughts.parse(">> Send invoice @16:30").get(0).delay);
    }

    @Test public void journalTranscriptCreatesALinkedNoteAndTimeTaggedThoughtWithoutNetwork() throws Exception {
        long now = System.currentTimeMillis();
        JournalStore.merge(c, new JSONObject().put("pages", new JSONArray().put(new JSONObject()
                .put("uid", "test-page").put("created", now).put("updated", now).put("state", "waiting"))));
        JSONObject answer = JournalReader.parse("```json\n{\"pages\":[{\"cut_off\":true,\"title\":\"Edge\"},"
                + "{\"title\":\"Todos\",\"lines\":[{\"text\":\"Send invoice\",\"sign\":\"dash\",\"top\":0.2,\"bottom\":0.3}],"
                + "\"groups\":[{\"lines\":[0],\"note\":\"ab 16:30\"}]}]}\n```");
        assertEquals("Todos", JournalReader.mainPage(answer).getString("title"));
        ReflectionHelpers.callStaticMethod(JournalReader.class, "apply", ClassParameter.from(Context.class, c),
                ClassParameter.from(String.class, "test-page"), ClassParameter.from(JSONObject.class, answer),
                ClassParameter.from(double.class, 1.25));
        JSONObject page = JournalStore.find(c, "test-page");
        assertEquals(JournalStore.DONE, page.getString("state"));
        PlannerStore.Entry note = NoteSync.byUid(planner, page.getString("note"));
        assertNotNull(note);
        assertTrue(note.text.contains("- [ ] Send invoice"));
        assertTrue(note.text.contains(">> Send invoice @16:30"));
        assertEquals("- [ ] Send invoice", page.getJSONArray("lines").getJSONObject(0).getString("note_line"));
        // A page captures an undecided thought; the user chooses whether it becomes an action.
        assertEquals(1,ParkingStore.open(c).size());
        assertTrue(ParkingStore.open(c).get(0).due>0);
        ParkingStore.promote(c,ParkingStore.open(c).get(0).id);
        PlannerStore.Entry task = null; for (PlannerStore.Entry e : planner.entries()) if ("task".equals(e.kind)) task = e;
        assertEquals("Send invoice", task.text); assertEquals(note.id, task.source.note);
        assertFalse(ClaudeKey.present(c));
        assertFalse(CloudSync.enabled(c));
        JournalStore.delete(c, "test-page");
        JournalStore.merge(c, new JSONObject().put("pages", new JSONArray().put(new JSONObject()
                .put("uid", "test-page").put("updated", now - 1).put("state", "waiting"))));
        assertTrue(JournalStore.find(c, "test-page").getBoolean("deleted"));
        assertTrue(JournalStore.visible(c).isEmpty());
    }

    @Test public void journalPagesWaitForAKeyInsteadOfBecomingFailedOrStartingAJob() throws Exception {
        long now = System.currentTimeMillis();
        JournalStore.merge(c, new JSONObject().put("pages", new JSONArray().put(new JSONObject()
                .put("uid", "no-key-page").put("created", now).put("updated", now).put("state", JournalStore.WAITING))));
        JournalJob.schedule(c);
        assertTrue(c.getSystemService(JobScheduler.class).getAllPendingJobs().isEmpty());
        JournalReader.read(c, "no-key-page");
        assertEquals(JournalStore.WAITING, JournalStore.find(c, "no-key-page").getString("state"));
        assertTrue(JournalStore.unread(c));
        assertTrue(planner.entries().isEmpty());
        assertFalse(ClaudeKey.present(c));
    }
}
