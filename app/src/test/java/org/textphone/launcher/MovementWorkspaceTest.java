package org.textphone.launcher;
import static org.junit.Assert.*;
import android.content.Context;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.Collections;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class MovementWorkspaceTest {
    Context c;
    @Before public void reset(){c=RuntimeEnvironment.getApplication();for(String key:new String[]{"pocket_agenda","pocket_gym","pocket_cloud","pocket_planner","pocket_clock"})c.getSharedPreferences(key,0).edit().clear().commit();}
    JSONObject incoming()throws Exception{long now=System.currentTimeMillis();return new JSONObject().put("v",1).put("events",new JSONArray().put(new JSONObject().put("uid","plan-fixture").put("title","Strength").put("when",now+3600000).put("minutes",60).put("remindAt",0).put("created",now).put("updated",now).put("training",new JSONObject().put("sport","gym").put("exercises",new JSONArray().put("Squat").put("Row")))));}
    @Test public void webPlanSurvivesPhoneCalendarEditDraftAndReturnSync()throws Exception{
        AgendaCloud.merge(c,incoming());AgendaStore.Event e=AgendaStore.list(c).get(0);assertEquals(2,e.training.getJSONArray("exercises").length());
        AgendaStore.Event edit=e.copy();edit.title="Leg day";AgendaDraft.save(c,edit,false);edit=AgendaDraft.read(c).event;AgendaStore.save(c,edit);
        JSONObject returned=AgendaCloud.merge(c,null).getJSONArray("events").getJSONObject(0);assertEquals("Leg day",returned.getString("title"));assertEquals("Row",returned.getJSONObject("training").getJSONArray("exercises").getString(1));
        AgendaStore.delete(c,e.id);assertTrue(AgendaCloud.merge(c,null).getJSONArray("events").getJSONObject(0).getBoolean("deleted"));
    }
    @Test public void planStartsExactlyOnceCarriesExercisesAndDoesNotReplaceAnotherWorkout()throws Exception{
        AgendaCloud.merge(c,incoming());AgendaStore.Event e=AgendaStore.list(c).get(0);JSONObject w=GymStore.startPlan(c,e);
        assertEquals("plan-plan-fixture",w.getString("id"));assertEquals(Arrays.asList("Squat","Row"),GymStore.exerciseNames(w));assertEquals(w.getString("id"),GymStore.startPlan(c,e).getString("id"));
        AgendaStore.Event other=e.copy();other.uid="other";try{GymStore.startPlan(c,other);fail();}catch(IllegalStateException expected){}
        GymStore.addSet(c,w.getString("id"),"Squat",40,8);GymStore.finish(c,w.getString("id"));assertTrue(MovementData.done(e,GymStore.workouts(c)));assertEquals(1,GymStore.workouts(c).size());assertEquals(w.getString("id"),GymStore.startPlan(c,e).getString("id"));
    }
    @Test public void explicitLinkDeduplicatesAndUnlinkRestoresWatchRecording()throws Exception{
        long now=System.currentTimeMillis();JSONObject w=GymStore.start(c);GymStore.addSet(c,w.getString("id"),"Row",20,10);GymStore.finish(c,w.getString("id"));CorosData.Activity a=new CorosData.Activity("watch",402,"Strength",now,0,3600,120);
        assertEquals(2,MovementData.feed(Collections.singletonList(a),GymStore.workouts(c)).size());GymStore.update(c,w.getString("id"),x->x.put("coros_id","watch"));assertEquals(1,MovementData.feed(Collections.singletonList(a),GymStore.workouts(c)).size());GymStore.update(c,w.getString("id"),x->x.remove("coros_id"));assertEquals(2,MovementData.feed(Collections.singletonList(a),GymStore.workouts(c)).size());
    }
    @Test public void ninetyDayRecoveryPreservesMissingDaysAndCivilWeekStartsMonday(){
        Scores.Result s=Scores.compute(LocalDate.of(2026,10,25),java.time.ZoneId.of("Europe/Berlin"),Collections.emptyList(),Collections.emptyList(),Collections.emptyMap(),Collections.emptyMap(),0,false,0,0,90);
        assertEquals(90,s.recoveries.size());assertNull(s.recovery);assertEquals(LocalDate.of(2026,10,19),MovementData.monday(LocalDate.of(2026,10,25)));
    }
    @Test public void movementStartsPlannedGymInTheActualLogScreen()throws Exception{
        AgendaCloud.merge(c,incoming());AgendaStore.Event plan=AgendaStore.list(c).get(0);
        org.robolectric.android.controller.ActivityController<MovementActivity> ctl=org.robolectric.Robolectric.buildActivity(MovementActivity.class).setup();
        try{MovementActivity a=ctl.get();android.view.View start=a.root.findViewWithTag("movement_plan_start_"+plan.uid);assertNotNull(start);start.performClick();
            android.content.Intent intent=org.robolectric.Shadows.shadowOf(a).getNextStartedActivity();assertEquals(GymActivity.class.getName(),intent.getComponent().getClassName());assertTrue(intent.getBooleanExtra("pocket_resume",false));
            org.robolectric.android.controller.ActivityController<GymActivity> log=org.robolectric.Robolectric.buildActivity(GymActivity.class,intent).setup();try{assertEquals("log",org.robolectric.util.ReflectionHelpers.getField(log.get(),"page"));assertEquals("Squat",org.robolectric.util.ReflectionHelpers.getField(log.get(),"exercise"));}finally{log.pause().stop().destroy();}
        }finally{ctl.pause().stop().destroy();}
    }
}
