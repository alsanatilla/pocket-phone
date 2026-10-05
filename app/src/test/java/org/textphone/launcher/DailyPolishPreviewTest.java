package org.textphone.launcher;

import static org.junit.Assert.*;
import android.Manifest;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ProviderInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
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
import org.robolectric.android.controller.ServiceController;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import org.robolectric.shadows.ShadowAlarmManager;
import org.robolectric.shadows.ShadowContentResolver;
import org.robolectric.util.ReflectionHelpers;

/** Native layouts with explicit local fixtures; never a physical phone recording. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk=28,qualifiers="w360dp-h800dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class DailyPolishPreviewTest {
    private Context c;
    @Before public void clear(){c=RuntimeEnvironment.getApplication();for(String p:new String[]{"text_phone","pocket_agenda","pocket_planner","pocket_contact_draft","CalculatorActivity"})c.getSharedPreferences(p,0).edit().clear().commit();ClockStore.prefs(c).edit().clear().commit();Shadows.shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(Manifest.permission.POST_NOTIFICATIONS,Manifest.permission.READ_CONTACTS,Manifest.permission.WRITE_CONTACTS);ShadowAlarmManager.setCanScheduleExactAlarms(true);}
    @Test public void clockAndCalculatorUseTheirWorkingControlsAndFitSmallWindows()throws Exception{
        ClockStore.Entry e=new ClockStore.Entry();e.kind="alarm";e.title="Train day";e.hour=7;e.minute=30;e.enabled=true;e.daily=true;e.due=ClockStore.nextTime(7,30,System.currentTimeMillis());ClockStore.save(c,e);
        ActivityController<ClockActivity> clock=Robolectric.buildActivity(ClockActivity.class).setup();try{ClockActivity a=clock.get();save(a,800,"pocket-polish-clock.png");a.body.findViewWithTag("clock_entry_"+e.id).performClick();save(a,800,"pocket-polish-alarm-edit.png");assertTrue(a.body.findViewWithTag("alarm_time").getHeight()>=56);a.onBackPressed();PocketAppsTest.find(a.body,"timer").performClick();((EditText)a.body.findViewWithTag("timer_label")).setText("Read chapter");save(a,800,"pocket-polish-timer.png");save(a,560,"pocket-polish-timer-short.png");assertTrue(a.body.findViewWithTag("timer_minutes").getHeight()>=48);for(String key:new String[]{"5 min","25 min","50 min"})assertTrue(PocketAppsTest.find(a.body,key).getHeight()>=48);}finally{clock.pause().stop().destroy();}
        ActivityController<CalculatorActivity> calc=Robolectric.buildActivity(CalculatorActivity.class).setup();try{CalculatorActivity a=calc.get();((EditText)a.body.findViewWithTag("calculator_input")).setText("(120+45)×0.8");PocketAppsTest.find(a.body,"=").performClick();save(a,800,"pocket-polish-calculator.png");assertEquals("132",((EditText)a.body.findViewWithTag("calculator_input")).getText().toString());for(String key:new String[]{"copy","history","="})assertTrue(PocketAppsTest.find(a.body,key).getHeight()>=48);}finally{calc.pause().stop().destroy();}
    }
    @Test public void contactsAndAppointmentEditorsShowContentInsteadOfSetup()throws Exception{
        DailyPolishTest.ContactsFixture provider=new DailyPolishTest.ContactsFixture();ProviderInfo info=new ProviderInfo();info.authority="com.android.contacts";provider.attachInfo(c,info);ShadowContentResolver.registerProviderInternal(info.authority,provider);
        ActivityController<ContactsActivity> contacts=Robolectric.buildActivity(ContactsActivity.class).setup();try{ContactsActivity a=contacts.get();DailyPolishTest.settle(a);PocketAppsTest.find(a.body,"Ada").performClick();DailyPolishTest.settle(a);save(a,800,"pocket-polish-contact.png");assertNull(PocketAppsTest.find(a.root,"Allow contacts"));PocketAppsTest.find(a.body,"edit").performClick();((EditText)a.body.findViewWithTag("contact_name")).setText("Ada revised");save(a,800,"pocket-polish-contact-edit.png");}finally{contacts.pause().stop().destroy();}
        AgendaStore.Event event=new AgendaStore.Event();event.title="Planning session with Mira";java.util.Calendar start=java.util.Calendar.getInstance();start.set(java.util.Calendar.HOUR_OF_DAY,10);start.set(java.util.Calendar.MINUTE,30);start.set(java.util.Calendar.SECOND,0);event.when=start.getTimeInMillis();event.minutes=45;AgendaStore.save(c,event);
        ActivityController<AgendaActivity> agenda=Robolectric.buildActivity(AgendaActivity.class).setup();try{AgendaActivity a=agenda.get();save(a,800,"pocket-polish-agenda.png");a.body.findViewWithTag("agenda_event_"+event.id).performClick();save(a,800,"pocket-polish-appointment.png");assertTrue(a.body.findViewWithTag("appointment_duration").getHeight()>=56);}finally{agenda.pause().stop().destroy();}
    }
    @Test public void notesRetainMarkdownWithReadablePreviewAndLargeCommands()throws Exception{
        PlannerStore store=new PlannerStore(c.getSharedPreferences("pocket_planner",0));long id=store.save(0,"note","# Weekend plan\n\n## Saturday\n- Train at **09:30**\n- [ ] Pack the camera\n- [x] Book tickets\n\n> Platform 4. Bring the charger.");store.pinNote(id,true);
        ActivityController<MainActivity> note=Robolectric.buildActivity(MainActivity.class,new Intent().putExtra("pocket_screen","today")).setup();try{MainActivity a=note.get();a.findViewById(android.R.id.content).findViewWithTag("note_open_"+id).performClick();save(a,800,"pocket-polish-note-edit.png");PocketAppsTest.find(a.findViewById(android.R.id.content),"Preview").performClick();View root=save(a,800,"pocket-polish-note.png");for(String text:new String[]{"Edit","Share","Task","More"}){View control=PocketAppsTest.find(root,text);assertTrue(control.getHeight()>=56);assertTrue(control.getWidth()>=48);}assertTrue(((TextView)root.findViewWithTag("note_markdown_preview")).getText().toString().contains("Weekend plan"));}finally{note.pause().stop().destroy();}
    }
    @Test public void messageFeedComesFirstAndTransportCommandsStayAtTheBottom()throws Exception{
        Shadows.shadowOf(c.getSystemService(NotificationManager.class)).setNotificationListenerAccessGranted(NotificationAccess.component(c),true);ServiceController<PhoneNotifications> service=Robolectric.buildService(PhoneNotifications.class).create();
        Notification notification=new Notification.Builder(c).setSmallIcon(android.R.drawable.ic_dialog_info).setCategory(Notification.CATEGORY_MESSAGE).setContentTitle("Mira").setContentText("Train is booked. Meet on platform 4 at 09:30?").setContentIntent(PendingIntent.getActivity(c,401,new Intent(c,CalculatorActivity.class),PendingIntent.FLAG_IMMUTABLE)).addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_send,"Reply",PendingIntent.getBroadcast(c,402,new Intent("fixture.REPLY"),PendingIntent.FLAG_UPDATE_CURRENT)).addRemoteInput(new RemoteInput.Builder("message").setLabel("Reply").build()).build()).build();
        Shadows.shadowOf(service.get()).addActiveNotification("com.whatsapp",401,notification);service.get().onListenerConnected();ActivityController<ChatsActivity> hub=Robolectric.buildActivity(ChatsActivity.class).setup();try{ChatsActivity a=hub.get();View root=save(a,800,"pocket-polish-messages.png");View feed=root.findViewWithTag("chat_feed"),commands=root.findViewWithTag("chat_commands");assertTrue(y(feed)<100);assertEquals(796,y(commands)+commands.getHeight());for(String label:new String[]{"Open","Reply","More","SMS inbox","Apps"})assertTrue(PocketAppsTest.find(root,label).getHeight()>=56);for(int i=0;i<20;i++)a.body.addView(a.label("Fixture conversation "+i,16,PocketDesign.WHITE));save(a,560,"pocket-polish-messages-short.png");int bottom=y(commands);((android.widget.ScrollView)a.body.getParent()).scrollTo(0,1000);assertEquals(bottom,y(commands));}finally{hub.pause().stop().destroy();service.get().onListenerDisconnected();service.destroy();}
    }
    private View save(android.app.Activity a,int height,String name)throws Exception{PageMotion motion=ReflectionHelpers.getField(a,"motion");motion.settle();Shadows.shadowOf(Looper.getMainLooper()).idle();View root=a.findViewById(android.R.id.content);root.measure(View.MeasureSpec.makeMeasureSpec(360,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(height,View.MeasureSpec.EXACTLY));root.layout(0,0,360,height);Bitmap bitmap=Bitmap.createBitmap(360,height,Bitmap.Config.ARGB_8888);root.draw(new Canvas(bitmap));File target=new File("build/screenshots",name);assertTrue(target.getParentFile().isDirectory()||target.getParentFile().mkdirs());try(FileOutputStream out=new FileOutputStream(target)){assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG,100,out));}bitmap.recycle();return root;}
    private int y(View view){int[] xy=new int[2];view.getLocationOnScreen(xy);return xy[1];}
}
