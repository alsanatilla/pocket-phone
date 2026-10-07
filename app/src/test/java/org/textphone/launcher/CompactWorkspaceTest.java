package org.textphone.launcher;

import static org.junit.Assert.*;
import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.view.View;
import android.widget.EditText;
import android.widget.TextView;
import java.io.File;
import java.io.FileOutputStream;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import org.robolectric.util.ReflectionHelpers;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=28,qualifiers="w360dp-h800dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class CompactWorkspaceTest {
    private Context context;private PlannerStore store;
    @Before public void setup(){context=RuntimeEnvironment.getApplication();for(String p:new String[]{"text_phone","pocket_planner","pocket_agenda","pocket_capture_drafts","pocket_camera"})context.getSharedPreferences(p,0).edit().clear().commit();ClockStore.prefs(context).edit().clear().commit();context.getSharedPreferences("text_phone",0).edit().putBoolean("twenty_four_hour",true).commit();store=new PlannerStore(context.getSharedPreferences("pocket_planner",0));}
    @Test public void todayRefreshesTasksAndOpensTheActualAppointment()throws Exception{AgendaStore.Event e=new AgendaStore.Event();e.title="Review project proposal";e.when=System.currentTimeMillis()-900000;AgendaStore.save(context,e);long id=store.saveTask(0,"Send the invoice",PlannerDates.today(),false,"Check reference\nSend invoice");ActivityController<MainActivity> c=Robolectric.buildActivity(MainActivity.class,new Intent().putExtra("pocket_screen","today")).setup();try{MainActivity a=c.get();settle(a);View root=layout(a);TextView title=root.findViewWithTag("page_heading");assertTrue(title.getTextSize()>=32);assertTrue(root.findViewWithTag("page_header").getHeight()>=PocketDesign.HEADER);assertTrue(title.getWidth()>=150);assertTrue(root.findViewWithTag("app_settings").getWidth()>=48);assertNotNull(root.findViewWithTag("task_open_"+id));assertNotNull(root.findViewWithTag("today_event_"+e.id));assertNull(PocketAppsTest.find(root,"Connect Google Calendar"));assertNull(PocketAppsTest.find(root,"Export file"));save(a,"pocket-today-workspace.png");root.findViewWithTag("today_event_"+e.id).performClick();Intent next=Shadows.shadowOf(a).getNextStartedActivity();assertEquals(AgendaActivity.class.getName(),next.getComponent().getClassName());assertEquals(e.id,next.getLongExtra("appointment_id",0));long fresh=store.captureTask("Call Mira",TaskSource.shared("Message","Call Mira"));store.makeNext(fresh);c.pause().resume();assertNotNull(a.findViewById(android.R.id.content).findViewWithTag("task_open_"+fresh));}finally{c.pause().stop().destroy();}}
    @Test public void theChosenNextTaskIsIncludedInTheTodayFilterEvenWithoutADate(){long id=store.save(0,"task","Write the proposal");context.getSharedPreferences("pocket_planner",0).edit().putLong("next_task",id).commit();ActivityController<MainActivity> c=Robolectric.buildActivity(MainActivity.class,new Intent().putExtra("pocket_screen","today")).setup();try{MainActivity a=c.get();ReflectionHelpers.setField(a,"taskFilter","Today");ReflectionHelpers.callInstanceMethod(a,"render");assertNotNull(a.findViewById(android.R.id.content).findViewWithTag("task_open_"+id));}finally{c.pause().stop().destroy();}}
    @Test public void setupIsBehindTheAppSettingsButton()throws Exception{Class<?>[] types={PhoneActivity.class,MessagesActivity.class,ContactsActivity.class,ChatsActivity.class,ClockActivity.class,AgendaActivity.class};for(Class<?> type:types){@SuppressWarnings("unchecked") ActivityController<? extends PocketActivity> c=Robolectric.buildActivity((Class<? extends PocketActivity>)type).setup();try{PocketActivity a=c.get();ReflectionHelpers.<PageMotion>getField(a,"motion").settle();View root=layout(a);View control=root.findViewWithTag("app_settings");assertNotNull(type.getSimpleName(),control);assertTrue(control.getHeight()>=48);for(String text:new String[]{"Allow contacts","Allow messages","Enable notification access","Alarm setup / test","Use Pocket for SMS","Connect Google Calendar"})assertNull(type.getSimpleName()+": "+text,PocketAppsTest.find(root,text));if(type==AgendaActivity.class){AlertDialog dialog=SettingsTestActions.open(a);assertNull(dialog.getListView());assertNotNull(dialog.getButton(AlertDialog.BUTTON_POSITIVE));dialog.dismiss();}else if(type==ClockActivity.class){control.performClick();assertNotNull(PocketAppsTest.find(a.body,"Test alarm · 10 seconds"));}}finally{c.pause().stop().destroy();}}}
    @Test public void capturedTasksAndRemindersUseCompactHeaders()throws Exception{ActivityController<TaskCaptureActivity> capture=Robolectric.buildActivity(TaskCaptureActivity.class,TaskCaptureActivity.intent(context,TaskSource.shared("Train booking","Book the 09:30 train\nhttps://example.org/tickets"))).setup();TaskCaptureActivity a=capture.get();try{((EditText)a.body.findViewWithTag("task_capture_title")).setText("Book the train");ReflectionHelpers.<PageMotion>getField(a,"motion").settle();layout(a);assertEquals(PocketDesign.HEADER,a.findViewById(android.R.id.content).findViewWithTag("page_header").getHeight());save(a,"pocket-task-capture.png");}finally{capture.pause().stop().destroy();}long task=store.captureTask("Book the train",TaskSource.shared("Train booking","https://example.org/tickets"));ActivityController<TaskReminderActivity> c=Robolectric.buildActivity(TaskReminderActivity.class,new Intent().putExtra("task",task)).setup();try{ReflectionHelpers.<PageMotion>getField(c.get(),"motion").settle();layout(c.get());assertEquals(PocketDesign.HEADER,c.get().findViewById(android.R.id.content).findViewWithTag("page_header").getHeight());save(c.get(),"pocket-task-reminder.png");}finally{c.pause().stop().destroy();}}
    @Test public void theHeaderGrowsWithLargeFontsRatherThanClippingText(){float original=context.getResources().getDisplayMetrics().scaledDensity;try{context.getResources().getDisplayMetrics().scaledDensity=2f*context.getResources().getDisplayMetrics().density;assertTrue(PocketDesign.headerHeight(context)>48);TextView settings=new TextView(context);settings.setText("Settings");settings.setTextSize(28);assertTrue(PocketDesign.headerWidth(settings,96)>96);}finally{context.getResources().getDisplayMetrics().scaledDensity=original;}}
    private void settle(MainActivity a){ReflectionHelpers.<PageMotion>getField(a,"motion").settle();}
    private View layout(Activity a){View root=a.findViewById(android.R.id.content);root.measure(View.MeasureSpec.makeMeasureSpec(360,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(800,View.MeasureSpec.EXACTLY));root.layout(0,0,360,800);return root;}
    private void save(Activity a,String name)throws Exception{saveView(layout(a),name);}
    private void saveView(View root,String name)throws Exception{root.measure(View.MeasureSpec.makeMeasureSpec(360,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(800,View.MeasureSpec.EXACTLY));root.layout(0,0,360,800);Bitmap bitmap=Bitmap.createBitmap(360,800,Bitmap.Config.ARGB_8888);root.draw(new Canvas(bitmap));File path=new File("build/screenshots",name);assertTrue(path.getParentFile().isDirectory()||path.getParentFile().mkdirs());try(FileOutputStream out=new FileOutputStream(path)){assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG,100,out));}bitmap.recycle();}
}
