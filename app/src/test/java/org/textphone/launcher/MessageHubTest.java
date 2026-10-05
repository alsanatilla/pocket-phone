package org.textphone.launcher;

import static org.junit.Assert.*;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Looper;
import android.provider.Settings;
import android.widget.EditText;
import android.widget.TextView;
import java.util.List;
import org.junit.After;
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

@RunWith(RobolectricTestRunner.class)
@Config(sdk={23,35})
public class MessageHubTest {
    private Context context;private ServiceController<PhoneNotifications> service;
    private final java.util.ArrayList<ActivityController<? extends android.app.Activity>> activities=new java.util.ArrayList<>();
    @Before public void setup(){context=RuntimeEnvironment.getApplication();context.getSharedPreferences("pocket_reply_drafts",0).edit().clear().commit();allowed(true);service=Robolectric.buildService(PhoneNotifications.class).create();service.get().onListenerConnected();}
    @After public void cleanup(){for(ActivityController<?> a:activities)a.pause().stop().destroy();service.get().onListenerDisconnected();service.destroy();}
    private void allowed(boolean value){if(Build.VERSION.SDK_INT>=27)Shadows.shadowOf(context.getSystemService(NotificationManager.class)).setNotificationListenerAccessGranted(NotificationAccess.component(context),value);else Settings.Secure.putString(context.getContentResolver(),"enabled_notification_listeners",value?NotificationAccess.component(context).flattenToString():"");}
    private Notification notice(String title,String text,boolean reply){Notification.Builder builder=new Notification.Builder(context).setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(title).setContentText(text).setCategory(Notification.CATEGORY_MESSAGE)
                .setContentIntent(PendingIntent.getActivity(context,21,new Intent(context,CalculatorActivity.class),PendingIntent.FLAG_IMMUTABLE));
        if(reply){Intent delivery=new Intent("fixture.REPLY").setClassName(context.getPackageName(),"fixture.ReplyReceiver");PendingIntent action=PendingIntent.getBroadcast(context,22,delivery,PendingIntent.FLAG_UPDATE_CURRENT|(Build.VERSION.SDK_INT>=31?PendingIntent.FLAG_MUTABLE:0));
            builder.addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_send,"Reply",action).addRemoteInput(new RemoteInput.Builder("message").setLabel("Reply").build()).build());}return builder.build();}
    private String post(int id,Notification n){String key=Shadows.shadowOf(service.get()).addActiveNotification("com.whatsapp",id,n);service.get().onNotificationPosted(null);Shadows.shadowOf(Looper.getMainLooper()).idle();return key;}
    private <T extends android.app.Activity> ActivityController<T> open(Class<T> type,Intent intent){ActivityController<T> c=Robolectric.buildActivity(type,intent).setup();activities.add(c);return c;}
    @Test public void whatsappNeedsNoSmsRoleAndUpdatesWhenANativeMessageArrives(){ActivityController<ChatsActivity> c=open(ChatsActivity.class,new Intent());ChatsActivity hub=c.get();
        assertNotNull(PocketAppsTest.find(hub.root,"SMS inbox"));assertNull(Shadows.shadowOf(hub).getLastRequestedPermission());
        post(1,notice("Mira","Meet at 10:30",true));assertNotNull(PocketAppsTest.find(hub.body,"Mira"));assertNotNull(PocketAppsTest.find(hub.body,"Meet at 10:30"));assertNotNull(PocketAppsTest.find(hub.body,"Reply"));
        PocketAppsTest.find(hub.body,"Open").performClick();assertEquals(CalculatorActivity.class.getName(),Shadows.shadowOf(RuntimeEnvironment.getApplication()).getNextStartedActivity().getComponent().getClassName());}
    @Test @Config(sdk={24,28,29,35}) public void messagingStyleShowsSenderTextAndSuppressesTheDuplicateGroupSummary(){Notification.MessagingStyle style=new Notification.MessagingStyle("You").setConversationTitle("Weekend").addMessage("Train booked",1,"Mira").addMessage("See you at the station",2,"Jonas");if(Build.VERSION.SDK_INT>=28)style.setGroupConversation(true);
        Notification.Builder child=new Notification.Builder(context).setSmallIcon(android.R.drawable.ic_dialog_info).setGroup("weekend").setCategory(Notification.CATEGORY_MESSAGE).setStyle(style);
        post(1,child.build());post(2,new Notification.Builder(context).setSmallIcon(android.R.drawable.ic_dialog_info).setGroup("weekend").setGroupSummary(true).setContentTitle("2 new messages").build());
        List<NoticeFeed.Item> feed=NoticeFeed.read(true);assertEquals(1,feed.size());assertEquals("Weekend",feed.get(0).title);assertTrue(feed.get(0).body.contains("Mira: Train booked"));assertTrue(feed.get(0).body.contains("Jonas: See you at the station"));}
    @Test public void directReplyUsesAndroidRemoteInputOnceAndNeverPostsAutomatically(){String key=post(1,notice("Mira","Are you coming?",true));ActivityController<NotificationReplyActivity> c=open(NotificationReplyActivity.class,new Intent().putExtra("notice_key",key));NotificationReplyActivity editor=c.get();
        EditText input=editor.body.findViewWithTag("notification_reply");input.setText("Yes, at 10:30");assertEquals(0,replies().size());
        editor.body.findViewWithTag("notification_send").performClick();editor.body.findViewWithTag("notification_send").performClick();assertEquals(1,replies().size());
        assertEquals("Yes, at 10:30",RemoteInput.getResultsFromIntent(replies().get(0)).getCharSequence("message"));assertEquals("",input.getText().toString());assertFalse(editor.body.findViewWithTag("notification_send").isEnabled());
        assertTrue(context.getSharedPreferences("pocket_reply_drafts",0).getAll().isEmpty());}
    @Test public void oneUnreadableNoticeCannotHideTheOtherConversations(){Notification malformed=notice("Unreadable","",true);malformed.extras=null;String bad=post(1,malformed);post(2,notice("Mira","Train booked",true));
        ActivityController<ChatsActivity> c=open(ChatsActivity.class,new Intent());assertNotNull(PocketAppsTest.find(c.get().body,"Train booked"));assertEquals(1,NoticeFeed.read(true).size());assertNull(NoticeFeed.find(bad));}
    private List<Intent> replies(){List<Intent> found=new java.util.ArrayList<>();for(Intent i:Shadows.shadowOf(RuntimeEnvironment.getApplication()).getBroadcastIntents())if("fixture.REPLY".equals(i.getAction()))found.add(i);return found;}
    @Test public void changedConversationAndExpiredNotificationNeverSendTheOldComposition(){String key=post(1,notice("Mira","Hello",true));NoticeFeed.Item original=NoticeFeed.find(key);
        // Android replaces an existing key; Robolectric's fixture helper appends unless we remove it first.
        assertTrue(PhoneNotifications.dismiss(key));assertEquals(key,post(1,notice("Different conversation","Another chat",true)));assertEquals("Different conversation",NoticeFeed.find(key).title);
        try{NoticeActions.reply(open(ChatsActivity.class,new Intent()).get(),original,"Must not go there");fail();}catch(IllegalStateException expected){assertTrue(expected.getMessage().contains("conversation changed"));}catch(Exception e){throw new AssertionError(e);}assertEquals(0,replies().size());
        assertTrue(PhoneNotifications.dismiss(key));try{NoticeActions.reply(activities.get(0).get(),original,"Expired");fail();}catch(IllegalStateException expected){assertTrue(expected.getMessage().contains("no longer active"));}catch(Exception e){throw new AssertionError(e);}assertEquals(0,replies().size());}
    @Test public void accessRevocationClearsTheFeedAndStopsReplies(){String key=post(1,notice("Mira","Private active text",true));ActivityController<ChatsActivity> c=open(ChatsActivity.class,new Intent());NoticeFeed.Item target=NoticeFeed.find(key);allowed(false);c.pause().resume();
        assertNull(PocketAppsTest.find(c.get().body,"Private active text"));assertNotNull(c.get().findViewById(android.R.id.content).findViewWithTag("app_settings"));
        try{NoticeActions.reply(c.get(),target,"Blocked");fail();}catch(IllegalStateException expected){assertTrue(expected.getMessage().contains("access is off"));}catch(Exception e){throw new AssertionError(e);}assertEquals(0,replies().size());}
    @Test public void onlyUserAuthoredDraftsSurviveHomeAndReopening(){String key=post(1,notice("Mira","Received text must not be stored",true));ActivityController<NotificationReplyActivity> first=open(NotificationReplyActivity.class,new Intent().putExtra("notice_key",key));
        ((EditText)first.get().body.findViewWithTag("notification_reply")).setText("My unfinished reply");first.pause().stop();
        ActivityController<NotificationReplyActivity> second=open(NotificationReplyActivity.class,new Intent().putExtra("notice_key",key));assertEquals("My unfinished reply",((EditText)second.get().body.findViewWithTag("notification_reply")).getText().toString());
        String stored=context.getSharedPreferences("pocket_reply_drafts",0).getAll().toString();assertTrue(stored.contains("My unfinished reply"));assertFalse(stored.contains("Received text must not be stored"));assertFalse(stored.contains("Mira"));}
    @Test public void orphanSummaryAndLongTextRemainReadableWithoutInventedMessageHistory(){post(1,new Notification.Builder(context).setSmallIcon(android.R.drawable.ic_dialog_info).setGroup("solo").setGroupSummary(true).setContentTitle("Mira").setStyle(new Notification.BigTextStyle().bigText("Long native message text")).build());
        assertEquals(1,NoticeFeed.read(true).size());assertEquals("Long native message text",NoticeFeed.read(true).get(0).body);assertEquals(0,replies().size());}
    @Test public void aLockedPhoneDoesNotSendAReply(){String key=post(1,notice("Mira","Hello",true));Shadows.shadowOf(context.getSystemService(android.app.KeyguardManager.class)).setIsDeviceLocked(true);
        try{NoticeActions.reply(open(ChatsActivity.class,new Intent()).get(),NoticeFeed.find(key),"Wait until unlocked");fail();}catch(IllegalStateException e){assertTrue(e.getMessage().contains("Unlock"));}catch(Exception e){throw new AssertionError(e);}assertEquals(0,replies().size());}
}
