package org.textphone.launcher;

import static org.junit.Assert.*;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;
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
import org.robolectric.shadows.ShadowNotificationListenerService;

@RunWith(RobolectricTestRunner.class)
@Config(sdk={24,35})
public class NotificationAccessTest{
    private Context c;
    @Before public void start(){c=RuntimeEnvironment.getApplication();setAllowed(false);}
    private void setAllowed(boolean allowed){if(android.os.Build.VERSION.SDK_INT>=27)Shadows.shadowOf(c.getSystemService(NotificationManager.class)).setNotificationListenerAccessGranted(NotificationAccess.component(c),allowed);
        else Settings.Secure.putString(c.getContentResolver(),"enabled_notification_listeners",allowed?NotificationAccess.component(c).flattenToString():"");}
    @Test public void restrictedAccessShowsAppInfoHelpAndOpensTheActualAndroidConsentScreen(){
        ActivityController<NotificationSetupActivity> controller=Robolectric.buildActivity(NotificationSetupActivity.class).setup();try{NotificationSetupActivity activity=controller.get();
            assertNotNull(PocketAppsTest.find(activity.body,"Notification access is off"));assertNotNull(PocketAppsTest.find(activity.body,"Android says Restricted setting?"));
            assertNull(Shadows.shadowOf(activity).getLastRequestedPermission());assertFalse(NotificationAccess.allowed(activity));
            PocketAppsTest.find(activity.body,"Enable notification access").performClick();Intent settings=Shadows.shadowOf(activity).getNextStartedActivity();
            if(android.os.Build.VERSION.SDK_INT>=30){assertEquals(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS,settings.getAction());assertEquals(NotificationAccess.component(c).flattenToString(),settings.getStringExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME));}
            else assertEquals(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS,settings.getAction());
            PocketAppsTest.find(activity.body,"Open app info").performClick();assertEquals(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Shadows.shadowOf(activity).getNextStartedActivity().getAction());
            assertFalse(NotificationAccess.allowed(activity));
        }finally{controller.pause().stop().destroy();}
    }
    @Test @Config(sdk=35) public void approvedButUnboundAccessRequestsAndroidToReconnectAndShowsItsActualState(){
        setAllowed(true);int before=ShadowNotificationListenerService.getRebindRequestCount();ActivityController<NotificationSetupActivity> controller=Robolectric.buildActivity(NotificationSetupActivity.class).setup();
        try{assertNotNull(PocketAppsTest.find(controller.get().body,"Access allowed · waiting for Android"));assertTrue(ShadowNotificationListenerService.getRebindRequestCount()>before);}
        finally{controller.pause().stop().destroy();}
    }
    @Test public void activeNotificationsAppearAfterTheNativeListenerConnectsAndDisappearOnDisconnect(){
        setAllowed(true);ServiceController<PhoneNotifications> service=Robolectric.buildService(PhoneNotifications.class).create();
        ActivityController<MainActivity> controller=Robolectric.buildActivity(MainActivity.class,new Intent().putExtra("pocket_screen","notifications")).setup();
        try{PhoneNotifications listener=service.get();Notification notice=new Notification.Builder(c).setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("A real listener fixture").setContentText("Native notification text").build();
            Shadows.shadowOf(listener).addActiveNotification("fixture.other.app",7,notice);listener.onListenerConnected();Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();
            assertNotNull(CameraAlbumTest.findContaining(controller.get().findViewById(android.R.id.content),"Native notification text"));assertTrue(PhoneNotifications.connected());
            listener.onListenerDisconnected();Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();assertFalse(PhoneNotifications.connected());
            assertNotNull(controller.get().findViewById(android.R.id.content).findViewWithTag("app_settings"));
        }finally{controller.pause().stop().destroy();service.destroy();}
    }
    @Test public void notificationControlsHaveFingerSizedBoundsAndDismissThroughAndroid(){
        setAllowed(true);ServiceController<PhoneNotifications> service=Robolectric.buildService(PhoneNotifications.class).create();
        ActivityController<MainActivity> controller=Robolectric.buildActivity(MainActivity.class,new Intent().putExtra("pocket_screen","notifications")).setup();
        try{PhoneNotifications listener=service.get();PendingIntent open=PendingIntent.getActivity(c,91,new Intent(c,CalculatorActivity.class),PendingIntent.FLAG_IMMUTABLE);
            Notification notice=new Notification.Builder(c).setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("Hit target check").setContentText("Native notice").setContentIntent(open).build();
            Shadows.shadowOf(listener).addActiveNotification("fixture.other.app",8,notice);listener.onListenerConnected();Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();
            android.view.View root=controller.get().findViewById(android.R.id.content);int width=(int)(360*c.getResources().getDisplayMetrics().density),height=(int)(800*c.getResources().getDisplayMetrics().density);
            root.measure(android.view.View.MeasureSpec.makeMeasureSpec(width,android.view.View.MeasureSpec.EXACTLY),android.view.View.MeasureSpec.makeMeasureSpec(height,android.view.View.MeasureSpec.EXACTLY));root.layout(0,0,width,height);
            android.widget.TextView openButton=PocketAppsTest.find(root,"Open"),dismiss=PocketAppsTest.find(root,"More");
            int minimum=(int)(56*c.getResources().getDisplayMetrics().density);
            assertTrue(openButton.getHeight()>=minimum);assertTrue(dismiss.getHeight()>=minimum);assertTrue(openButton.getWidth()>=minimum);assertTrue(dismiss.getWidth()>=minimum);
            openButton.performClick();assertEquals(CalculatorActivity.class.getName(),Shadows.shadowOf(RuntimeEnvironment.getApplication()).getNextStartedActivity().getComponent().getClassName());
            dismiss.performClick();SettingsTestActions.item(org.robolectric.shadows.ShadowAlertDialog.getLatestAlertDialog(),"Dismiss");assertEquals(0,PhoneNotifications.active().length);
            assertNotNull(PocketAppsTest.find(controller.get().findViewById(android.R.id.content),"No active notifications"));
        }finally{controller.pause().stop().destroy();service.destroy();}
    }
    @Test public void ongoingNotificationsDoNotOfferAnEnabledDismissAction(){
        setAllowed(true);ServiceController<PhoneNotifications> service=Robolectric.buildService(PhoneNotifications.class).create();
        ActivityController<MainActivity> controller=Robolectric.buildActivity(MainActivity.class,new Intent().putExtra("pocket_screen","notifications")).setup();
        try{PhoneNotifications listener=service.get();Notification notice=new Notification.Builder(c).setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("Ongoing").setOngoing(true).build();
            String key=Shadows.shadowOf(listener).addActiveNotification("fixture.other.app",9,notice);listener.onListenerConnected();Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();
            PocketAppsTest.find(controller.get().findViewById(android.R.id.content),"More").performClick();assertEquals(1,org.robolectric.shadows.ShadowAlertDialog.getLatestAlertDialog().getListView().getCount());assertEquals("Make task",org.robolectric.shadows.ShadowAlertDialog.getLatestAlertDialog().getListView().getAdapter().getItem(0));
            assertFalse(PhoneNotifications.dismiss(key));assertEquals(1,PhoneNotifications.active().length);
        }finally{controller.pause().stop().destroy();service.destroy();}
    }
}
