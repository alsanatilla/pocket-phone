package org.textphone.launcher;

import static org.junit.Assert.*;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.view.View;
import android.widget.EditText;
import android.widget.ScrollView;
import java.io.File;
import java.io.FileOutputStream;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import org.robolectric.util.ReflectionHelpers;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=28,qualifiers="w360dp-h800dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class PlanningLayoutTest {
    private Context context;private PlannerStore store;
    @Before public void clear(){context=RuntimeEnvironment.getApplication();for(String p:new String[]{"text_phone","pocket_planner","pocket_agenda","pocket_capture_drafts"})context.getSharedPreferences(p,0).edit().clear().commit();store=new PlannerStore(context.getSharedPreferences("pocket_planner",0));context.getSharedPreferences("text_phone",0).edit().putBoolean("twenty_four_hour",true).commit();}
    private long appointment(){AgendaStore.Event e=new AgendaStore.Event();e.title="Planning session with Mira";e.when=System.currentTimeMillis()-900000;AgendaStore.save(context,e);return e.id;}
    private ActivityController<MainActivity> today(){return Robolectric.buildActivity(MainActivity.class,new Intent().putExtra("pocket_screen","today")).setup();}
    @Test public void theCurrentAppointmentLeadsTheCommandsAndTasksWithoutAVisibleSearchField()throws Exception{long first=store.saveTask(0,"Send the invoice",PlannerDates.today(),false,"Check reference\nSend invoice");store.saveTask(0,"Prepare the proposal",PlannerDates.today(),false,"");store.save(0,"task","Book train tickets");long event=appointment();ActivityController<MainActivity> c=today();try{MainActivity a=c.get();View root=layout(a,800);View tabs=root.findViewWithTag("workspace_tabs"),task=root.findViewWithTag("task_open_"+first),calendar=root.findViewWithTag("today_event_"+event),actions=root.findViewWithTag("today_actions");assertNull(root.findViewWithTag("workspace_search"));assertTrue(y(calendar)>=y(tabs)+tabs.getHeight());assertNull(root.findViewWithTag("today_filters"));View commands=root.findViewWithTag("today_commands");assertTrue(y(commands)>y(calendar));assertTrue(y(task)>y(commands));assertEquals(796,y(actions)+actions.getHeight());for(String tag:new String[]{"today_add_task","today_add_note","today_focus","today_search","today_calendar"}){View control=root.findViewWithTag(tag);assertTrue(control.getHeight()>=56);assertTrue(control.getWidth()>=48);}save(root,800,"pocket-today-layout.png");}finally{c.pause().stop().destroy();}}
    @Test public void headerAndTabsStayFixedWhileTheTasksScroll(){for(int i=0;i<30;i++)store.saveTask(0,"Task "+i,PlannerDates.today(),false,"");ActivityController<MainActivity> c=today();try{View root=layout(c.get(),800);View tabs=root.findViewWithTag("workspace_tabs"),actions=root.findViewWithTag("today_actions");int top=y(root.findViewWithTag("page_header")),tabsTop=y(tabs),bottom=y(actions);((ScrollView)root.findViewWithTag("today_scroll")).scrollTo(0,600);assertEquals(top,y(root.findViewWithTag("page_header")));assertEquals(tabsTop,y(tabs));assertEquals(bottom,y(actions));assertTrue(((ScrollView)root.findViewWithTag("today_scroll")).getScrollY()>0);}finally{c.pause().stop().destroy();}}
    @Test public void aShortWindowStillShowsTasksAndTheNavigationActions()throws Exception{long id=store.saveTask(0,"Call Mira",PlannerDates.today(),false,"");appointment();ActivityController<MainActivity> c=today();try{View root=layout(c.get(),560);View task=root.findViewWithTag("task_open_"+id),actions=root.findViewWithTag("today_actions");assertTrue(y(task)<420);assertEquals(1,((android.widget.LinearLayout)root.findViewWithTag("today_tasks")).getChildCount());assertTrue(y(task)+task.getHeight()<y(actions));assertEquals(556,y(actions)+actions.getHeight());save(root,560,"pocket-today-short.png");}finally{c.pause().stop().destroy();}}
    @Test public void liveSearchFindsStepsAndBackRestoresTheUnfilteredDay(){long task=store.saveTask(0,"Buy train tickets",PlannerDates.today(),false,"Passport"),other=store.saveTask(0,"Send invoice",PlannerDates.today(),false,"");long event=appointment();ActivityController<MainActivity> c=today();try{MainActivity a=c.get();OrganizerSearchTestActions.find(a,"passport");View root=a.findViewById(android.R.id.content);assertNotNull(root.findViewWithTag("search_entry_"+task));assertNull(root.findViewWithTag("search_entry_"+other));c.recreate();a=c.get();assertEquals("passport",OrganizerSearchTestActions.open(a).getText().toString());assertNotNull(a.findViewById(android.R.id.content).findViewWithTag("search_entry_"+task));a.onBackPressed();root=a.findViewById(android.R.id.content);assertNotNull(root.findViewWithTag("task_open_"+other));assertNotNull(root.findViewWithTag("today_event_"+event));}finally{c.pause().stop().destroy();}}
    @Test public void agendaPlacesItsFiltersAboveTheTimelineAndCaptureBelowIt()throws Exception{long id=appointment();ActivityController<AgendaActivity> c=Robolectric.buildActivity(AgendaActivity.class).setup();try{AgendaActivity a=c.get();View root=layout(a,800);View filter=root.findViewWithTag("agenda_filters"),event=root.findViewWithTag("agenda_event_"+id),actions=root.findViewWithTag("agenda_actions");assertTrue(y(event)>=y(filter)+filter.getHeight());assertTrue(y(event)<160);assertEquals(796,y(actions)+actions.getHeight());save(root,800,"pocket-agenda-layout.png");PocketAppsTest.find(root,"+ appointment").performClick();((EditText)a.body.findViewWithTag("appointment_title")).setText("Draft meeting");a.onBackPressed();layout(a,800);assertNotNull(a.root.findViewWithTag("agenda_continue_draft"));a.root.findViewWithTag("agenda_continue_draft").performClick();assertEquals("Draft meeting",((EditText)a.body.findViewWithTag("appointment_title")).getText().toString());}finally{c.pause().stop().destroy();}}
    private View layout(Activity a,int height){PageMotion motion=ReflectionHelpers.getField(a,"motion");motion.settle();View root=a.findViewById(android.R.id.content);root.measure(View.MeasureSpec.makeMeasureSpec(360,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(height,View.MeasureSpec.EXACTLY));root.layout(0,0,360,height);return root;}
    private int y(View v){int[] xy=new int[2];v.getLocationOnScreen(xy);return xy[1];}
    private void save(View root,int height,String name)throws Exception{Bitmap bitmap=Bitmap.createBitmap(360,height,Bitmap.Config.ARGB_8888);root.draw(new Canvas(bitmap));File path=new File("build/screenshots",name);assertTrue(path.getParentFile().isDirectory()||path.getParentFile().mkdirs());try(FileOutputStream out=new FileOutputStream(path)){assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG,100,out));}bitmap.recycle();}
    @Test public void focusUsesTheShownAppointmentAfterActivityRecreation(){appointment();store.save(0,"task","An unrelated task");ActivityController<MainActivity> c=today();try{MainActivity a=c.get();a.findViewById(android.R.id.content).findViewWithTag("today_focus").performClick();c.recreate();a=c.get();PocketAppsTest.find(a.findViewById(android.R.id.content),"Focus · 25 min").performClick();Intent timer=org.robolectric.Shadows.shadowOf(a).getNextStartedActivity();assertEquals(ClockActivity.class.getName(),timer.getComponent().getClassName());assertEquals("Focus: Planning session with Mira",timer.getStringExtra("title"));assertEquals(1500,timer.getIntExtra("seconds",0));}finally{c.pause().stop().destroy();}}
}
