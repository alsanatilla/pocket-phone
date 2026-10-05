package org.textphone.launcher;

import static org.junit.Assert.*;
import android.Manifest;
import android.app.role.RoleManager;
import android.content.Context;
import android.content.Intent;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.provider.Telephony;
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
import org.robolectric.shadows.ShadowContentResolver;
import org.robolectric.shadows.ShadowTelephony;

@RunWith(RobolectricTestRunner.class)
@Config(sdk={24,35})
public class MessageAccessTest{
    private Context c;private SmsStore provider;
    @Before public void start(){c=RuntimeEnvironment.getApplication();Shadows.shadowOf(RuntimeEnvironment.getApplication()).denyPermissions(Manifest.permission.READ_SMS);
        ShadowTelephony.ShadowSms.setDefaultSmsPackage("other.messenger");if(android.os.Build.VERSION.SDK_INT>=29)Shadows.shadowOf(c.getSystemService(RoleManager.class)).addAvailableRole(RoleManager.ROLE_SMS);
        provider=new SmsStore();ProviderInfo info=new ProviderInfo();info.authority="sms";info.exported=true;provider.attachInfo(c,info);ShadowContentResolver.registerProviderInternal("sms",provider);}
    @After public void cleanup(){provider.db.close();}
    @Test public void noSmsDataIsQueriedOrObservedBeforeTheRoleAndPermissionAreGranted()throws Exception{
        ActivityController<MessagesActivity> controller=Robolectric.buildActivity(MessagesActivity.class).setup();try{MessagesActivity activity=controller.get();CameraAlbumTest.settle(activity);
            assertEquals(0,provider.reads);assertTrue(Shadows.shadowOf(c.getContentResolver()).getContentObservers(Telephony.Sms.CONTENT_URI).isEmpty());
            if(android.os.Build.VERSION.SDK_INT>=29)Shadows.shadowOf(activity.getSystemService(RoleManager.class)).addAvailableRole(RoleManager.ROLE_SMS);
            SettingsTestActions.choose(activity,"Use Pocket for SMS");Intent role=Shadows.shadowOf(activity).getNextStartedActivity();assertNotNull(role);
            if(android.os.Build.VERSION.SDK_INT>=29){assertEquals("android.app.role.action.REQUEST_ROLE",role.getAction());boolean specifiesSms=false;for(String key:role.getExtras().keySet())specifiesSms|=RoleManager.ROLE_SMS.equals(role.getExtras().get(key));assertTrue(specifiesSms);}
            else assertEquals(Telephony.Sms.Intents.ACTION_CHANGE_DEFAULT,role.getAction());
        }finally{controller.pause().stop().destroy();}
    }
    @Test public void returningFromAndroidSettingsRefreshesMessagesAndRegistersTheObserver()throws Exception{
        ActivityController<MessagesActivity> controller=Robolectric.buildActivity(MessagesActivity.class).setup();try{MessagesActivity activity=controller.get();controller.pause().stop();
            ShadowTelephony.ShadowSms.setDefaultSmsPackage(c.getPackageName());Shadows.shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(Manifest.permission.READ_SMS);
            controller.restart().start().resume();CameraAlbumTest.settle(activity);assertTrue(provider.reads>0);assertNotNull(CameraAlbumTest.findContaining(activity.body,"Hello from Android's message store"));
            assertEquals(1,Shadows.shadowOf(c.getContentResolver()).getContentObservers(Telephony.Sms.CONTENT_URI).size());assertFalse(PhoneNotifications.connected());
            controller.pause().stop();Shadows.shadowOf(RuntimeEnvironment.getApplication()).denyPermissions(Manifest.permission.READ_SMS);controller.restart().start().resume();CameraAlbumTest.settle(activity);
            assertNotNull(activity.findViewById(android.R.id.content).findViewWithTag("app_settings"));assertNull(PocketAppsTest.find(activity.body,"Allow messages"));assertTrue(Shadows.shadowOf(c.getContentResolver()).getContentObservers(Telephony.Sms.CONTENT_URI).isEmpty());
        }finally{controller.pause().stop().destroy();}
    }
    @Test public void aProviderAccessFailureIsShownInsteadOfAnEmptyInbox()throws Exception{
        ShadowTelephony.ShadowSms.setDefaultSmsPackage(c.getPackageName());Shadows.shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(Manifest.permission.READ_SMS);provider.fail=true;
        ActivityController<MessagesActivity> controller=Robolectric.buildActivity(MessagesActivity.class).setup();try{CameraAlbumTest.settle(controller.get());
            assertNotNull(PocketAppsTest.find(controller.get().body,"Android blocked message access."));assertNotNull(PocketAppsTest.find(controller.get().body,"Open app info"));
        }finally{controller.pause().stop().destroy();}
    }
    static final class SmsStore extends ContentProvider{final SQLiteDatabase db=SQLiteDatabase.create(null);int reads;boolean fail;
        SmsStore(){db.execSQL("CREATE TABLE sms (_id INTEGER, thread_id INTEGER, address TEXT, body TEXT, date INTEGER, type INTEGER, read INTEGER)");db.execSQL("INSERT INTO sms VALUES (1,7,'+49305550100','Hello from Android''s message store',1000,1,0)");}
        public boolean onCreate(){return true;}public Cursor query(Uri uri,String[]p,String s,String[]a,String order){reads++;if(fail)throw new SecurityException("fixture access revoked");return db.query("sms",p,s,a,null,null,order);}
        public Uri insert(Uri uri,ContentValues v){return null;}public int update(Uri uri,ContentValues v,String s,String[]a){return db.update("sms",v,s,a);}public int delete(Uri uri,String s,String[]a){return db.delete("sms",s,a);}public String getType(Uri uri){return "vnd.android.cursor.item/sms";}
    }
}
