package org.textphone.launcher;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.EditText;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.util.ReflectionHelpers;

@RunWith(RobolectricTestRunner.class) @Config(sdk={24,35})
public class CoherentWorkflowTest {
    private Context context;private PlannerStore planner;
    @Before public void clear(){context=RuntimeEnvironment.getApplication();for(String p:new String[]{"text_phone","pocket_planner","pocket_parking","pocket_agenda","pocket_receipt","pocket_cloud"})context.getSharedPreferences(p,0).edit().clear().commit();ClockStore.prefs(context).edit().clear().commit();planner=new PlannerStore(context.getSharedPreferences("pocket_planner",0));}
    private View root(MainActivity a){return a.findViewById(android.R.id.content);}
    private void tab(MainActivity a,String tab){root(a).findViewWithTag("workspace_tab_"+tab).performClick();}
    @Test public void aNoteThoughtBecomesAnActionOnlyByChoiceAndKeepsItsRouteAndContext()throws Exception{
        String text="# Trip\n>> Book the train";long note=planner.save(0,"note",text);NoteThoughts.parkNew(context,planner,note,"",text);
        ParkingStore.Item thought=ParkingStore.open(context).get(0);assertEquals(0,thought.due);assertFalse(thought.back(System.currentTimeMillis()));
        ActivityController<OrganizerActivity> c=Robolectric.buildActivity(OrganizerActivity.class).setup();try{
            OrganizerActivity a=c.get();assertEquals(1,planner.entries().size());tab(a,"thoughts");root(a).findViewWithTag("thought_open_"+thought.id).performClick();root(a).findViewWithTag("thought_promote").performClick();
            long task=(long)ReflectionHelpers.getField(a,"captureId");assertEquals("Book the train",planner.find(task).text);assertEquals(note,planner.find(task).source.note);assertEquals("thought:"+thought.id,planner.find(task).source.token);
            assertEquals(2,planner.entries().size());a.onBackPressed();assertEquals("thought_detail",ReflectionHelpers.getField(a,"screen"));assertEquals(thought.id,(long)ReflectionHelpers.getField(a,"captureId"));
            PocketAppsTest.find(root(a),"open task").performClick();root(a).findViewWithTag("task_complete").performClick();assertTrue(planner.find(task).done);assertEquals(1,ReceiptTape.count(ReceiptTape.lines(context,System.currentTimeMillis()),ReceiptTape.DONE));
            assertEquals(task,ParkingStore.promote(context,thought.id));assertEquals(2,planner.entries().size());
        }finally{c.pause().stop().destroy();}
    }
    @Test public void taskFocusAndPlanningUseTheSelectedActionAndReturnToIt()throws Exception{
        long other=planner.save(0,"task","A different next task"),task=planner.save(0,"task","Write the proposal");planner.makeNext(other);
        ActivityController<OrganizerActivity> c=Robolectric.buildActivity(OrganizerActivity.class,new Intent().putExtra("pocket_task",task)).setup();try{
            OrganizerActivity a=c.get();root(a).findViewWithTag("task_focus").performClick();PocketAppsTest.find(root(a),"Focus · 25 min").performClick();Intent timer=Shadows.shadowOf(a).getNextStartedActivity();assertEquals("Focus: Write the proposal",timer.getStringExtra("title"));a.onBackPressed();assertEquals(task,(long)ReflectionHelpers.getField(a,"captureId"));
            root(a).findViewWithTag("task_plan_time").performClick();Intent plan=Shadows.shadowOf(a).getNextStartedActivity();assertEquals(AgendaActivity.class.getName(),plan.getComponent().getClassName());assertEquals(task,plan.getLongExtra("task",0));
            ActivityController<AgendaActivity> agenda=Robolectric.buildActivity(AgendaActivity.class,plan).setup();try{AgendaActivity calendar=agenda.get();assertEquals("Write the proposal",((EditText)calendar.body.findViewWithTag("appointment_title")).getText().toString());PocketAppsTest.find(calendar.body,"save").performClick();DailyPolishTest.settle(calendar);assertTrue(calendar.isFinishing());assertEquals(task,AgendaStore.list(context).get(0).task);}finally{agenda.pause().stop().destroy();}
            c.pause().resume();assertEquals("task_detail",ReflectionHelpers.getField(a,"screen"));assertNotNull(CameraAlbumTest.findContaining(root(a),"Write the proposal"));
        }finally{c.pause().stop().destroy();}
    }
    @Test public void aThoughtDraftAndItsWorkspaceSurviveRecreationAndSave()throws Exception{
        ActivityController<OrganizerActivity> c=Robolectric.buildActivity(OrganizerActivity.class).setup();try{OrganizerActivity a=c.get();tab(a,"thoughts");root(a).findViewWithTag("workspace_capture").performClick();((EditText)root(a).findViewWithTag("capture_editor")).setText("Try a different route");c.recreate();a=c.get();assertEquals("Try a different route",((EditText)root(a).findViewWithTag("capture_editor")).getText().toString());PocketAppsTest.find(root(a),"save").performClick();assertEquals("thoughts",ReflectionHelpers.getField(a,"workspaceTab"));assertEquals(1,ParkingStore.open(context).size());assertEquals(0,ParkingStore.open(context).get(0).due);assertTrue(planner.entries().isEmpty());assertFalse(planner.hasDraft("thought",0));}finally{c.pause().stop().destroy();}
    }
    @Test public void aWebPromotedTaskRetainsItsSourceTokenOnThePhone()throws Exception{
        ParkingStore.Item thought=ParkingStore.park(context,"Call Sam",0);long now=System.currentTimeMillis();JSONObject task=new JSONObject().put("uid","web-task").put("text","Call Sam").put("created",now).put("updated",now+1000).put("source",new JSONObject().put("kind","shared").put("name","Thought").put("text","Call Sam").put("token","thought:"+thought.id));
        TaskSync.merge(context,new JSONObject().put("tasks",new JSONArray().put(task)));long promoted=ParkingStore.promote(context,thought.id);assertEquals(1,planner.entries().size());assertEquals("web-task",TaskSync.uid(planner,promoted));assertEquals(ParkingStore.TASK,ParkingStore.find(context,thought.id).state);assertEquals("thought:"+thought.id,TaskSync.merge(context,null).getJSONArray("tasks").getJSONObject(0).getJSONObject("source").getString("token"));
    }
    @Test public void anUnsuccessfulPromotionLeavesTheThoughtAvailable(){
        ParkingStore.Item thought=ParkingStore.park(context,"Keep this idea",0);long first=0;for(int i=0;i<250;i++){long id=planner.save(0,"task","Task "+i);if(i==0)first=id;}
        try{ParkingStore.promote(context,thought.id);fail("A full workspace must report the failed save");}catch(IllegalStateException|IllegalArgumentException expected){assertTrue(ParkingStore.find(context,thought.id).open());}
        planner.delete(first);assertTrue(ParkingStore.promote(context,thought.id)>0);assertEquals(250,planner.entries().size());
    }
}
