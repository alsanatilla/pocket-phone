package org.textphone.launcher;

import static org.junit.Assert.*;
import android.Manifest;
import android.app.AlarmManager;
import android.app.Application;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Looper;
import android.widget.EditText;
import org.junit.Before;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.Implements;
import org.robolectric.annotation.Implementation;
import org.robolectric.shadows.ShadowAlarmManager;
import org.robolectric.util.ReflectionHelpers;

@RunWith(RobolectricTestRunner.class)
@Config(sdk={23,35},shadows=TaskWorkflowTest.TaskAlarms.class)
public class TaskWorkflowTest {
    private Context context;private PlannerStore store;private final java.util.List<ActivityController<?>> controllers=new java.util.ArrayList<>();
    @Implements(AlarmManager.class) public static class TaskAlarms extends ShadowAlarmManager {static boolean fail;
        @Implementation protected void setAlarmClock(AlarmManager.AlarmClockInfo info,android.app.PendingIntent intent){if(fail)throw new SecurityException("Fixture scheduling denied");super.setAlarmClock(info,intent);}}
    @Before public void setup(){context=RuntimeEnvironment.getApplication();for(String p:new String[]{"pocket_planner","pocket_agenda","pocket_capture_drafts","text_phone"})context.getSharedPreferences(p,0).edit().clear().commit();ClockStore.prefs(context).edit().clear().commit();store=new PlannerStore(context.getSharedPreferences("pocket_planner",0));TaskAlarms.fail=false;ShadowAlarmManager.setCanScheduleExactAlarms(true);if(Build.VERSION.SDK_INT>=33)Shadows.shadowOf((Application)context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS);}
    @After public void cleanup(){for(ActivityController<?> c:controllers)c.pause().stop().destroy();}
    private <T extends android.app.Activity> ActivityController<T> open(Class<T> type,Intent i){ActivityController<T> c=Robolectric.buildActivity(type,i).setup();controllers.add(c);return c;}
    private void saved(TaskCaptureActivity a)throws Exception{long end=System.nanoTime()+5_000_000_000L;while(System.nanoTime()<end){Shadows.shadowOf(Looper.getMainLooper()).idle();if(PocketAppsTest.find(a.findViewById(android.R.id.content),"Task saved")!=null)return;Thread.sleep(10);}fail("Task capture did not finish");}
    private EditText title(TaskCaptureActivity a){return a.body.findViewWithTag("task_capture_title");}
    @Test public void aNoteBecomesATaskWithoutChangingTheNoteOrOtherDrafts()throws Exception{long note=store.save(0,"note","# Trip\nBuy a train ticket");store.draft("task",0,"Another unfinished task");TaskSource source=TaskSource.note(note,store.find(note).text);TaskCaptureActivity a=open(TaskCaptureActivity.class,TaskCaptureActivity.intent(context,source)).get();title(a).setText("Book train");a.findViewById(android.R.id.content).findViewWithTag("task_capture_save").performClick();saved(a);
        PlannerStore.Entry task=null;for(PlannerStore.Entry e:store.entries())if(e.kind.equals("task"))task=e;assertNotNull(task);assertEquals("Book train",task.text);assertEquals(note,task.source.note);assertEquals("# Trip\nBuy a train ticket",task.source.text);assertEquals("# Trip\nBuy a train ticket",store.find(note).text);assertEquals("Another unfinished task",store.draft("task",0));assertTrue(CaptureDrafts.list(context).isEmpty());}
    @Test public void nativeShareAcceptsOnlySharedTextAndKeepsTheLink()throws Exception{Intent i=new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,"Read this\nhttps://example.org/article").putExtra("task_source",TaskSource.note(72,"Private note injection").json().toString());TaskShareActivity a=open(TaskShareActivity.class,i).get();title(a).setText("Read article");a.findViewById(android.R.id.content).findViewWithTag("task_capture_save").performClick();saved(a);PlannerStore.Entry e=store.entries().get(0);assertEquals("shared",e.source.kind);assertEquals(0,e.source.note);assertEquals("https://example.org/article",e.source.link());assertFalse(e.source.text.contains("Private note"));}
    @Test public void backAndReopeningRecoverTheSameCaptureIndependentlyOfNoteDrafts(){store.draft("note",0,"Keep this draft");Intent i=TaskCaptureActivity.intent(context,TaskSource.shared("Article","https://example.org/a"));ActivityController<TaskCaptureActivity> first=open(TaskCaptureActivity.class,i);title(first.get()).setText("Review tomorrow");first.pause().stop();assertTrue(store.entries().isEmpty());TaskCaptureActivity again=open(TaskCaptureActivity.class,i).get();assertEquals("Review tomorrow",title(again).getText().toString());assertEquals(1,CaptureDrafts.list(context).size());assertEquals("Keep this draft",store.draft("note",0));}
    @Test public void aSavedCaptureCannotDuplicateOnRepeatedTapOrRotation()throws Exception{ActivityController<TaskCaptureActivity> c=open(TaskCaptureActivity.class,TaskCaptureActivity.intent(context,TaskSource.shared("Link","https://example.org")));TaskCaptureActivity a=c.get();android.view.View save=a.findViewById(android.R.id.content).findViewWithTag("task_capture_save");save.performClick();save.performClick();saved(a);c.recreate();assertEquals(1,store.entries().size());assertNotNull(PocketAppsTest.find(c.get().findViewById(android.R.id.content),"Task saved"));assertNull(c.get().body.findViewWithTag("task_capture_title"));}
    @Test public void sourceMetadataSurvivesEditingStepsAndCompletion(){TaskSource source=TaskSource.shared("Article","https://example.org/article").token("once");long id=store.captureTask("Read",source);store.saveTask(id,"Read tonight",PlannerDates.today(),true,"First step");store.toggleStep(id,0);store.toggle(id);assertEquals(source.text,store.find(id).source.text);assertEquals(source.token,store.find(id).source.token);assertEquals(id,store.captureTask("Retry",source));assertEquals(1,store.entries().size());}
    @Test public void saveWithReminderCreatesOneStableAlarmAndShowsTheTask()throws Exception{TaskCaptureActivity a=open(TaskCaptureActivity.class,TaskCaptureActivity.intent(context,TaskSource.shared("Meeting","Prepare meeting"))).get();CaptureDrafts.Draft d=ReflectionHelpers.getField(a,"draft");d.remind=System.currentTimeMillis()+600000;title(a).setText("Prepare slides");a.findViewById(android.R.id.content).findViewWithTag("task_capture_save").performClick();saved(a);PlannerStore.Entry e=store.entries().get(0);ClockStore.Entry alarm=TaskReminders.find(context,e.id);assertNotNull(alarm);assertEquals(d.remind,alarm.due);assertEquals("Prepare slides",alarm.title);assertEquals(1,ClockStore.entries(context).size());}
    @Test public void aReminderFailureKeepsTheSavedTaskAndOffersAnExplicitRetry()throws Exception{TaskAlarms.fail=true;TaskCaptureActivity a=open(TaskCaptureActivity.class,TaskCaptureActivity.intent(context,TaskSource.shared("Work","Prepare work"))).get();CaptureDrafts.Draft d=ReflectionHelpers.getField(a,"draft");d.remind=System.currentTimeMillis()+600000;a.findViewById(android.R.id.content).findViewWithTag("task_capture_save").performClick();saved(a);assertEquals(1,store.entries().size());assertTrue(ClockStore.entries(context).isEmpty());assertNotNull(CameraAlbumTest.findContaining(a.body,"Reminder needs attention"));assertNotNull(PocketAppsTest.find(a.body,"Open task"));}
    @Test public void fullDraftStorageDoesNotSilentlyDiscardEarlierCaptures(){for(int n=0;n<20;n++){CaptureDrafts.Draft d=new CaptureDrafts.Draft();d.source=TaskSource.shared("Work "+n,"Keep "+n);d.key=CaptureDrafts.key(d.source);d.token="token"+n;d.title="Draft "+n;CaptureDrafts.save(context,d);}TaskCaptureActivity a=open(TaskCaptureActivity.class,TaskCaptureActivity.intent(context,TaskSource.shared("New","Another capture"))).get();assertNull(a.body.findViewWithTag("task_capture_title"));assertEquals(20,CaptureDrafts.list(context).size());assertNotNull(CameraAlbumTest.findContaining(a.body,"20 unfinished"));}
    @Test public void markdownExportKeepsAnExplicitlyCapturedSource(){store.captureTask("Book tickets",TaskSource.shared("Train booking","https://example.org/tickets\nUse the 09:30 departure"));String exported=store.exportText();assertTrue(exported.contains("Source: Train booking"));assertTrue(exported.contains("https://example.org/tickets"));assertTrue(exported.contains("Use the 09:30 departure"));}
    @Test public void aFailedTaskWriteKeepsTheDraftAndReenablesEditing()throws Exception{TaskCaptureActivity a=open(TaskCaptureActivity.class,TaskCaptureActivity.intent(context,TaskSource.shared("Work","Do the work"))).get();context.getSharedPreferences("pocket_planner",0).edit().putString("entries","broken json").commit();android.view.View save=a.findViewById(android.R.id.content).findViewWithTag("task_capture_save");save.performClick();long end=System.nanoTime()+5_000_000_000L;while(!save.isEnabled()&&System.nanoTime()<end){Shadows.shadowOf(Looper.getMainLooper()).idle();Thread.sleep(10);}assertTrue(save.isEnabled());assertTrue(title(a).isEnabled());assertEquals(1,CaptureDrafts.list(context).size());}
}
