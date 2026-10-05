package org.textphone.launcher;

import static org.junit.Assert.*;
import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.Settings;
import java.util.Arrays;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk={23,35})
public class PermissionsActivityTest {
    @Test public void explainsSensitiveAccessWithoutRequestingPermissionsAndOpensAndroidControls() {
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).denyPermissions(Manifest.permission.READ_CONTACTS,Manifest.permission.READ_SMS);
        ActivityController<PermissionsActivity> controller=Robolectric.buildActivity(PermissionsActivity.class).setup();
        try {PermissionsActivity activity=controller.get();assertNull(Shadows.shadowOf(activity).getLastRequestedPermission());assertNull(Shadows.shadowOf(activity).getNextStartedActivity());
            assertNotNull(PocketAppsTest.find(activity.body,"Contacts · Read access off"));assertNotNull(PocketAppsTest.find(activity.body,"Other apps' notifications · Off · optional"));
            assertNotNull(PocketAppsTest.find(activity.body,"Data · Online features are optional"));
            assertNull(PocketAppsTest.find(activity.body,"Data · No analytics or upload code"));
            PocketAppsTest.find(activity.body,"Manage Android permissions").performClick();Intent settings=Shadows.shadowOf(activity).getNextStartedActivity();
            assertEquals(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,settings.getAction());assertEquals(Uri.parse("package:"+activity.getPackageName()),settings.getData());
            assertNull(Shadows.shadowOf(activity).getLastRequestedPermission());
        }finally{controller.pause().stop().destroy();}
    }
    @Test public void bluetoothUsesAndroidControlsWhileInternetSupportsExplicitOnlineFeatures() throws Exception {
        android.content.Context c=RuntimeEnvironment.getApplication();String[] requests=c.getPackageManager().getPackageInfo(c.getPackageName(),PackageManager.GET_PERMISSIONS).requestedPermissions;
        assertTrue(Arrays.asList(requests).contains(Manifest.permission.INTERNET));
        assertTrue(Arrays.asList(requests).contains(Manifest.permission.ACCESS_NETWORK_STATE));
        assertFalse(CloudSync.enabled(c));assertFalse(ClaudeKey.present(c));
        assertFalse(Arrays.asList(requests).contains(Manifest.permission.BLUETOOTH_CONNECT));
        assertFalse(Arrays.asList(requests).contains(Manifest.permission.MANAGE_EXTERNAL_STORAGE));assertFalse(Arrays.asList(requests).contains(Manifest.permission.RECORD_AUDIO));
        ActivityController<DeviceSettingsActivity> controller=Robolectric.buildActivity(DeviceSettingsActivity.class).setup();
        try{DeviceSettingsActivity activity=controller.get();PocketAppsTest.find(activity.body,"Bluetooth").performClick();
            assertEquals(Settings.ACTION_BLUETOOTH_SETTINGS,Shadows.shadowOf(activity).getNextStartedActivity().getAction());assertNull(Shadows.shadowOf(activity).getLastRequestedPermission());
        }finally{controller.pause().stop().destroy();}
    }
}
