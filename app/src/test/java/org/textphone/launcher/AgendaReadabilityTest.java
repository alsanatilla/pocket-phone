package org.textphone.launcher;

import static org.junit.Assert.*;
import android.widget.EditText;
import android.widget.TextView;
import android.view.View;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk={23,35})
public class AgendaReadabilityTest {
    private ActivityController<AgendaActivity> controller;private AgendaActivity activity;
    @Before public void setup(){RuntimeEnvironment.getApplication().getSharedPreferences("pocket_agenda",0).edit().clear().commit();RuntimeEnvironment.getApplication().getSharedPreferences("text_phone",0).edit().clear().commit();controller=Robolectric.buildActivity(AgendaActivity.class).setup();activity=controller.get();}
    @After public void cleanup(){controller.pause().stop().destroy();}
    private long event(String title,int offset){java.util.Calendar d=java.util.Calendar.getInstance();d.add(java.util.Calendar.DAY_OF_MONTH,offset);d.set(java.util.Calendar.HOUR_OF_DAY,10);d.set(java.util.Calendar.MINUTE,30);AgendaStore.Event e=new AgendaStore.Event();e.title=title;e.when=d.getTimeInMillis();AgendaStore.save(activity,e);return e.id;}
    @Test public void upcomingAndPastUseReadableIndependentTimeAndTitleViews(){long today=event("Review the project proposal before the planning meeting",0),past=event("Earlier appointment",-2);controller.recreate();activity=controller.get();
        View timeline=activity.body.findViewWithTag("agenda_timeline");assertNotNull(timeline.findViewWithTag("agenda_event_"+today));assertNull(timeline.findViewWithTag("agenda_event_"+past));TextView title=timeline.findViewWithTag("agenda_event_"+today+"_title");assertEquals(18f,title.getTextSize()/activity.getResources().getDisplayMetrics().scaledDensity,.01f);
        assertTrue(timeline.findViewWithTag("agenda_event_"+today).isClickable());assertTrue(timeline.findViewWithTag("agenda_event_"+today).getContentDescription().toString().contains("Review the project"));PocketAppsTest.find(activity.root,"Past").performClick();timeline=activity.body.findViewWithTag("agenda_timeline");assertNotNull(timeline.findViewWithTag("agenda_event_"+past));assertNull(timeline.findViewWithTag("agenda_event_"+today));}
    @Test public void backingOutKeepsTheAppointmentDraftWithoutSavingOrSchedulingIt(){PocketAppsTest.find(activity.root,"+ appointment").performClick();((EditText)activity.body.findViewWithTag("appointment_title")).setText("Unfinished plan");activity.onBackPressed();
        assertTrue(AgendaStore.list(activity).isEmpty());assertNotNull(PocketAppsTest.find(activity.root,"Continue draft"));PocketAppsTest.find(activity.root,"Continue draft").performClick();assertEquals("Unfinished plan",((EditText)activity.body.findViewWithTag("appointment_title")).getText().toString());
        controller.recreate();activity=controller.get();assertEquals("Unfinished plan",((EditText)activity.body.findViewWithTag("appointment_title")).getText().toString());assertTrue(AgendaStore.list(activity).isEmpty());}
    @Test public void editingSavedAppointmentAndBackingOutPreservesTheSavedRecord(){long id=event("Saved title",1);controller.recreate();activity=controller.get();activity.body.findViewWithTag("agenda_event_"+id).performClick();((EditText)activity.body.findViewWithTag("appointment_title")).setText("Draft revision");activity.onBackPressed();assertEquals("Saved title",AgendaStore.find(activity,id).title);assertEquals("Draft revision",AgendaDraft.read(activity).event.title);}
    @Test public void openingAnUnchangedAppointmentDoesNotCreateADraft(){long id=event("Already saved",1);controller.recreate();activity=controller.get();activity.body.findViewWithTag("agenda_event_"+id).performClick();activity.onBackPressed();assertNull(AgendaDraft.read(activity));}
}
