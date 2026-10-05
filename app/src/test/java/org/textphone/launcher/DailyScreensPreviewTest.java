package org.textphone.launcher;

import static org.junit.Assert.*;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.RemoteInput;
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
import org.robolectric.android.controller.ServiceController;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import org.robolectric.util.ReflectionHelpers;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=28,qualifiers="w360dp-h800dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class DailyScreensPreviewTest {
    @Before public void clear(){Context c=RuntimeEnvironment.getApplication();for(String p:new String[]{"text_phone","pocket_planner","pocket_agenda","pocket_reply_drafts"})c.getSharedPreferences(p,0).edit().clear().commit();}
    @Test public void renderReadableAgendaAndActiveWhatsAppMessageScreens() throws Exception {
        Context c=RuntimeEnvironment.getApplication();java.util.Calendar d=java.util.Calendar.getInstance();d.set(java.util.Calendar.HOUR_OF_DAY,10);d.set(java.util.Calendar.MINUTE,30);d.set(java.util.Calendar.SECOND,0);d.set(java.util.Calendar.MILLISECOND,0);
        AgendaStore.Event a=new AgendaStore.Event();a.title="Review project proposal";a.when=d.getTimeInMillis();AgendaStore.save(c,a);d.set(java.util.Calendar.HOUR_OF_DAY,14);AgendaStore.Event b=new AgendaStore.Event();b.title="Planning session with Mira";b.when=d.getTimeInMillis();AgendaStore.save(c,b);d.add(java.util.Calendar.DAY_OF_MONTH,1);d.set(java.util.Calendar.HOUR_OF_DAY,9);AgendaStore.Event next=new AgendaStore.Event();next.title="Book train tickets";next.when=d.getTimeInMillis();AgendaStore.save(c,next);
        c.getSharedPreferences("text_phone",0).edit().putBoolean("twenty_four_hour",true).commit();ActivityController<AgendaActivity> agenda=Robolectric.buildActivity(AgendaActivity.class).setup();
        try{save(agenda.get(),"pocket-agenda.png");TextView title=agenda.get().body.findViewWithTag("agenda_event_"+a.id+"_title");assertTrue(title.getWidth()>180);assertEquals(18,title.getTextSize(),0);}
        finally{agenda.pause().stop().destroy();}
        Shadows.shadowOf(c.getSystemService(NotificationManager.class)).setNotificationListenerAccessGranted(NotificationAccess.component(c),true);ServiceController<PhoneNotifications> service=Robolectric.buildService(PhoneNotifications.class).create();
        Intent delivery=new Intent("fixture.REPLY").setClassName(c.getPackageName(),"fixture.ReplyReceiver");PendingIntent reply=PendingIntent.getBroadcast(c,42,delivery,PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notice=new Notification.Builder(c).setSmallIcon(android.R.drawable.ic_dialog_info).setCategory(Notification.CATEGORY_MESSAGE).setContentIntent(PendingIntent.getActivity(c,43,new Intent(c,CalculatorActivity.class),PendingIntent.FLAG_IMMUTABLE))
                .setStyle(new Notification.MessagingStyle("You").setConversationTitle("Weekend plan").addMessage("Train is booked.",1,"Mira").addMessage("Meet at the station at 09:30?",2,"Mira"))
                .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_send,"Reply",reply).addRemoteInput(new RemoteInput.Builder("message").setLabel("Reply").build()).build()).build();
        String key=Shadows.shadowOf(service.get()).addActiveNotification("com.whatsapp",42,notice);service.get().onListenerConnected();ActivityController<ChatsActivity> hub=Robolectric.buildActivity(ChatsActivity.class).setup();
        try{save(hub.get(),"pocket-chats.png");for(String label:new String[]{"Open","Reply","More"}){TextView control=PocketAppsTest.find(hub.get().body,label);assertTrue(control.getWidth()>=56);assertTrue(control.getHeight()>=56);}
            ActivityController<NotificationReplyActivity> editor=Robolectric.buildActivity(NotificationReplyActivity.class,new Intent().putExtra("notice_key",key)).setup();
            try{((EditText)editor.get().body.findViewWithTag("notification_reply")).setText("Yes, see you there.");save(editor.get(),"pocket-chat-reply.png");}finally{editor.pause().stop().destroy();}
        }finally{hub.pause().stop().destroy();service.get().onListenerDisconnected();service.destroy();}
    }
    private void save(PocketActivity activity,String name) throws Exception {
        ReflectionHelpers.<PageMotion>getField(activity,"motion").settle();View root=activity.findViewById(android.R.id.content);root.measure(View.MeasureSpec.makeMeasureSpec(360,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(800,View.MeasureSpec.EXACTLY));root.layout(0,0,360,800);
        Bitmap image=Bitmap.createBitmap(360,800,Bitmap.Config.ARGB_8888);root.draw(new Canvas(image));File path=new File("build/screenshots",name);assertTrue(path.getParentFile().isDirectory()||path.getParentFile().mkdirs());try(FileOutputStream out=new FileOutputStream(path)){assertTrue(image.compress(Bitmap.CompressFormat.PNG,100,out));}image.recycle();
    }
}
