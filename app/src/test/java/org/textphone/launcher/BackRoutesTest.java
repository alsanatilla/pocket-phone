package org.textphone.launcher;

import static org.junit.Assert.*;
import android.content.Intent;
import android.os.Bundle;
import android.os.Looper;
import android.view.View;
import android.widget.EditText;
import org.junit.After;
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

@RunWith(RobolectricTestRunner.class)
@Config(sdk={24,35})
public class BackRoutesTest {
    private final java.util.List<ActivityController<? extends android.app.Activity>> controllers=new java.util.ArrayList<>();
    @Before public void clear(){RuntimeEnvironment.getApplication().getSharedPreferences("text_phone",0).edit().clear().commit();RuntimeEnvironment.getApplication().getSharedPreferences("pocket_planner",0).edit().clear().commit();RuntimeEnvironment.getApplication().getSharedPreferences("pocket_agenda",0).edit().clear().commit();}
    @After public void cleanup(){for(ActivityController<?> c:controllers)c.pause().stop().destroy();}
    private ActivityController<MainActivity> main(){ActivityController<MainActivity> c=Robolectric.buildActivity(MainActivity.class).setup();controllers.add(c);return c;}
    private String page(MainActivity a){return ReflectionHelpers.getField(a,"screen");}
    private void quickNote(MainActivity a){if(a.getResources().getBoolean(R.bool.pocket_rom))PocketAppsTest.find(a.findViewById(android.R.id.content),"+ note").performClick();
        else ReflectionHelpers.callInstanceMethod(a,"openCapture",ReflectionHelpers.ClassParameter.from(String.class,"note"),ReflectionHelpers.ClassParameter.from(long.class,0L),ReflectionHelpers.ClassParameter.from(String.class,""));}
    @Test public void quickNoteBackReturnsHomeAndSavingAlsoReturnsToItsOrigin(){MainActivity a=main().get();quickNote(a);
        ((EditText)a.findViewById(android.R.id.content).findViewWithTag("capture_editor")).setText("Quick draft");a.findViewById(android.R.id.content).findViewWithTag("navigation_back").performClick();assertEquals("home",page(a));
        quickNote(a);assertEquals("Quick draft",((EditText)a.findViewById(android.R.id.content).findViewWithTag("capture_editor")).getText().toString());
        PocketAppsTest.find(a.findViewById(android.R.id.content),"save").performClick();assertEquals("home",page(a));assertEquals("Quick draft",new PlannerStore(a.getSharedPreferences("pocket_planner",0)).entries().get(0).text);}
    @Test public void settingsToolsAppsBackFollowsTheActualRouteAndSurvivesRecreation(){ActivityController<MainActivity> c=main();MainActivity a=c.get();NavigationLifecycleTest.navigate(a,"settings");NavigationLifecycleTest.navigate(a,"tools");NavigationLifecycleTest.navigate(a,"apps");
        c.recreate();a=c.get();a.onBackPressed();assertEquals("tools",page(a));a.findViewById(android.R.id.content).findViewWithTag("navigation_back").performClick();assertEquals("settings",page(a));a.onBackPressed();assertEquals("home",page(a));a.onBackPressed();assertEquals("home",page(a));}
    @Test public void returningToAnAlreadyVisitedPageDoesNotEraseHowTheUserGotThere(){MainActivity a=main().get();NavigationLifecycleTest.navigate(a,"settings");NavigationLifecycleTest.navigate(a,"tools");NavigationLifecycleTest.navigate(a,"settings");
        a.onBackPressed();assertEquals("tools",page(a));a.onBackPressed();assertEquals("settings",page(a));a.onBackPressed();assertEquals("home",page(a));}
    @Test public void taskEditBackAndCommitReturnToTheSameTaskThenTheList(){MainActivity a=main().get();PlannerStore store=new PlannerStore(a.getSharedPreferences("pocket_planner",0));long id=store.save(0,"task","Write proposal");NavigationLifecycleTest.navigate(a,"today");a.findViewById(android.R.id.content).findViewWithTag("task_open_"+id).performClick();
        PocketAppsTest.find(a.findViewById(android.R.id.content),"Edit task").performClick();((EditText)a.findViewById(android.R.id.content).findViewWithTag("capture_editor")).setText("Revised proposal");a.onBackPressed();assertEquals("task_detail",page(a));assertEquals(id,(long)ReflectionHelpers.getField(a,"captureId"));
        PocketAppsTest.find(a.findViewById(android.R.id.content),"Edit task").performClick();PocketAppsTest.find(a.findViewById(android.R.id.content),"save").performClick();assertEquals("task_detail",page(a));assertEquals("Revised proposal",store.find(id).text);a.onBackPressed();assertEquals("today",page(a));a.onBackPressed();assertEquals("home",page(a));}
    @Test public void oldSavedStateWithoutHistoryFallsBackOnceWithoutLoopingIntoTheEditor(){Bundle old=new Bundle();old.putString("screen","capture");old.putString("capture_kind","note");old.putString("capture_text","Migrated draft");
        ActivityController<MainActivity> c=Robolectric.buildActivity(MainActivity.class).create(old).start().resume().visible();controllers.add(c);MainActivity a=c.get();a.onBackPressed();assertEquals("today",page(a));a.onBackPressed();assertEquals("home",page(a));a.onBackPressed();assertEquals("home",page(a));}
    @Test public void clockBackReturnsToThePreviousTabAndThenItsRoot(){ActivityController<ClockActivity> c=Robolectric.buildActivity(ClockActivity.class).setup();controllers.add(c);ClockActivity a=c.get();
        PocketAppsTest.find(a.body,"timer").performClick();((EditText)a.body.findViewWithTag("timer_minutes")).setText("37");PocketAppsTest.find(a.body,"stopwatch").performClick();a.onBackPressed();assertEquals("timer",ReflectionHelpers.getField(a,"page"));assertEquals("37",((EditText)a.body.findViewWithTag("timer_minutes")).getText().toString());a.onBackPressed();assertEquals("alarms",ReflectionHelpers.getField(a,"page"));}
    @Test public void linkedAppointmentOpensItsExactTaskInTheOrganizer(){ActivityController<OrganizerActivity> c=Robolectric.buildActivity(OrganizerActivity.class,new Intent().putExtra("pocket_task",123L)).setup();controllers.add(c);assertEquals("task_detail",page(c.get()));assertEquals(123L,(long)ReflectionHelpers.getField(c.get(),"captureId"));c.get().onBackPressed();assertEquals("today",page(c.get()));}
}
