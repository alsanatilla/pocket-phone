package org.textphone.launcher;

import static org.junit.Assert.*;
import android.app.AlarmManager;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowAlarmManager;

@RunWith(RobolectricTestRunner.class) @Config(sdk={24,35})
public class TaskSyncTest {
    private Context phone, other; private PlannerStore store, second;
    @Before public void setup() {
        phone=RuntimeEnvironment.getApplication(); other=new ContextWrapper(phone) {
            @Override public SharedPreferences getSharedPreferences(String name,int mode){return super.getSharedPreferences("second_"+name,mode);}
        };
        for(Context c:new Context[]{phone,other}) for(String p:new String[]{"pocket_planner","pocket_agenda","pocket_clock"})c.getSharedPreferences(p,0).edit().clear().commit();
        ClockStore.prefs(phone).edit().clear().commit();ClockStore.prefs(other).edit().clear().commit();
        store=new PlannerStore(phone.getSharedPreferences("pocket_planner",0));second=new PlannerStore(other.getSharedPreferences("pocket_planner",0));
        ShadowAlarmManager.setCanScheduleExactAlarms(true);
    }
    @Test public void oldTasksMigrateAndRoundTripAcrossDifferentLocalIdsWithSourceAndNext() throws Exception {
        store.preferences().edit().putString("entries","[{\"id\":7,\"kind\":\"task\",\"text\":\"Book train\",\"created\":1234}]").putLong("next_id",8).commit();
        long sourced=store.captureTask("Download tickets",TaskSource.shared("Booking","https://example.org/tickets"));
        store.saveTask(sourced,"Download tickets",PlannerDates.today(),true,"- [x] Book seats\nSave PDF");store.makeNext(sourced);
        second.save(0,"note","Unrelated note");
        JSONObject doc=TaskSync.merge(phone,null);TaskSync.merge(other,doc);TaskSync.merge(other,doc);
        List<PlannerStore.Entry> tasks=second.entries();assertEquals(3,tasks.size());
        PlannerStore.Entry imported=second.nextTask();assertNotEquals(sourced,imported.id);assertEquals("Download tickets",imported.text);
        assertTrue(imported.important);assertEquals(PlannerDates.today(),imported.due);assertEquals(1,imported.completedSteps());
        assertEquals("https://example.org/tickets",imported.source.text);assertEquals("",imported.source.ref);
        second.toggleStep(imported.id,1);second.toggle(imported.id);
        TaskSync.merge(phone,TaskSync.merge(other,doc));assertEquals(2,store.find(sourced).completedSteps());assertTrue(store.find(sourced).done);
        second.makeNext(0);TaskSync.merge(phone,TaskSync.merge(other,null));assertEquals(0,store.preferences().getLong("next_task",-1));
        assertTrue(store.preferences().contains("task_uid_7"));assertEquals("Unrelated note",second.find(1).text);
    }
    @Test public void newerLocalEditsAndDeletionBeatAnOlderCloudCopyAndRetainDrafts() throws Exception {
        long id=store.saveTask(0,"Original",PlannerDates.today(),false,"First step");JSONObject old=TaskSync.merge(phone,null);
        store.draft(id,"Unsaved edit","",true,"Draft step");store.setDue(id,"2099-01-01");store.toggleImportant(id);store.addStep(id,"New step");
        TaskSync.merge(phone,old);assertEquals("2099-01-01",store.find(id).due);assertTrue(store.find(id).important);assertEquals(2,store.find(id).steps.size());
        store.delete(id);JSONObject deleted=TaskSync.merge(phone,old);assertNull(store.find(id));assertTrue(deleted.getJSONArray("tasks").getJSONObject(0).getBoolean("deleted"));
        TaskSync.merge(other,old);TaskSync.merge(other,deleted);TaskSync.merge(other,old);assertEquals(0,second.openTasks());
        assertEquals("Unsaved edit",store.draft("task",id));assertEquals("Draft step",store.taskDraft(id,null).steps);
    }
    @Test public void remoteCompletionOrRemovalCancelsAlarmsButDoesNotCreateThemOnReopen() throws Exception {
        long id=store.save(0,"task","Call Mira");TaskReminders.set(phone,id,System.currentTimeMillis()+600000);
        JSONObject doc=TaskSync.merge(phone,null),task=doc.getJSONArray("tasks").getJSONObject(0);
        task.put("text","Call Mira about tickets").put("updated",store.taskUpdated(store.find(id))+10);TaskSync.merge(phone,doc);
        assertEquals("Call Mira about tickets",TaskReminders.find(phone,id).title);
        task.put("done",true).put("updated",task.getLong("updated")+10);TaskSync.merge(phone,doc);
        assertTrue(store.find(id).done);assertNull(TaskReminders.find(phone,id));assertTrue(Shadows.shadowOf(phone.getSystemService(AlarmManager.class)).getScheduledAlarms().isEmpty());
        task.put("done",false).put("updated",task.getLong("updated")+10);TaskSync.merge(phone,doc);assertNull(TaskReminders.find(phone,id));
        TaskReminders.set(phone,id,System.currentTimeMillis()+600000);task.put("deleted",true).put("updated",task.getLong("updated")+10);TaskSync.merge(phone,doc);
        assertNull(store.find(id));assertNull(TaskReminders.find(phone,id));
    }
    @Test public void malformedRemoteChecklistDoesNotOverwriteSavedTasks() throws Exception {
        long id=store.save(0,"task","Keep this");JSONObject doc=TaskSync.merge(phone,null);
        JSONObject task=doc.getJSONArray("tasks").getJSONObject(0);task.put("text","Replacement").put("updated",store.taskUpdated(store.find(id))+10)
                .put("steps",new JSONArray().put(new JSONObject().put("text","Invalid\nstep")));
        assertThrows(JSONException.class,()->TaskSync.merge(phone,doc));assertEquals("Keep this",store.find(id).text);
    }
}
