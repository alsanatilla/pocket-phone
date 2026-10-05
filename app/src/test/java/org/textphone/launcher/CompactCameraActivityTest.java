package org.textphone.launcher;

import static org.junit.Assert.*;
import android.Manifest;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import android.util.Range;
import android.util.Rational;
import android.util.Size;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowAlertDialog;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {23, 35})
public class CompactCameraActivityTest {
    private ActivityController<CompactCameraActivity> controller;
    private CompactCameraActivity activity;
    @Before public void setup() {
        RuntimeEnvironment.getApplication().getSharedPreferences("pocket_camera", 0).edit().clear().commit();
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).denyPermissions(Manifest.permission.CAMERA);
        controller = Robolectric.buildActivity(CompactCameraActivity.class).setup(); activity = controller.get();
    }
    @After public void cleanup() { controller.pause().stop().destroy(); }
    private View tagged(String tag) { View found=activity.findViewById(android.R.id.content).findViewWithTag(tag);if(found==null){SettingsTestActions.open(activity);found=ShadowAlertDialog.getLatestAlertDialog().findViewById(android.R.id.content).findViewWithTag(tag);}return found; }
    private TextView find(View view, String value) {
        if (view instanceof TextView && value.contentEquals(((TextView) view).getText())) return (TextView) view;
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup)view).getChildCount(); i++) {
            TextView result = find(((ViewGroup)view).getChildAt(i), value); if (result != null) return result;
        }
        return null;
    }
    @Test public void permissionIsNativeAndDeniedCameraCannotShoot() {
        assertEquals(PackageManager.PERMISSION_DENIED, activity.checkSelfPermission(Manifest.permission.CAMERA));
        assertNull(Shadows.shadowOf(activity).getLastRequestedPermission());
        assertNotNull(find(activity.getWindow().getDecorView(), activity.getString(R.string.camera_permission_needed)));
        assertFalse(tagged("camera_shutter").isEnabled());
        tagged("camera_allow").performClick();
        assertArrayEquals(new String[]{Manifest.permission.CAMERA}, Shadows.shadowOf(activity).getLastRequestedPermission().requestedPermissions);
        activity.onRequestPermissionsResult(81, new String[]{Manifest.permission.CAMERA}, new int[]{PackageManager.PERMISSION_DENIED});
        assertFalse(tagged("camera_shutter").isEnabled());
        tagged("camera_allow").performClick();
        assertEquals(81, Shadows.shadowOf(activity).getLastRequestedPermission().requestCode);
    }
    @Test public void choosingAProfilePersistsWithoutAnEditorAndGalleryUsesANativeViewer() {
        assertNull(Shadows.shadowOf(activity).getNextStartedActivity());
        tagged("camera_profile").setEnabled(true); tagged("camera_profile").performClick();
        AlertDialog dialog = ShadowAlertDialog.getLatestAlertDialog();
        assertEquals(6, dialog.getListView().getCount());
        dialog.getListView().performItemClick(null, CameraProfile.POWER.ordinal(), CameraProfile.POWER.ordinal());
        assertEquals("POWER", activity.getSharedPreferences("pocket_camera", 0).getString("profile", ""));
        assertTrue(((TextView) tagged("camera_profile")).getText().toString().startsWith("Power '05"));
        assertNull(Shadows.shadowOf(activity).getNextStartedActivity());
        Uri photo = Uri.parse("content://media/external/images/media/42");
        activity.getSharedPreferences("pocket_camera", 0).edit().putString("last_photo", photo.toString()).commit();
        controller.pause().stop().restart().start().resume();
        tagged("camera_gallery").performClick();
        Intent view = Shadows.shadowOf(activity).getNextStartedActivity();
        assertEquals(Intent.ACTION_VIEW, view.getAction()); assertEquals(photo, view.getData());
        assertEquals("image/jpeg", view.getType());
        assertTrue((view.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0);
    }
    @Test public void usingAFrontCameraWithoutFlashPreservesTheRearAutoFlashChoice() {
        Size live = new Size(640, 480), capture = new Size(2048, 1536);
        activity.ready(new CameraEngine.Info(true, false, false, true, 270, live, capture,
                new Range<>(-6, 6), new Rational(1, 3)));
        TextView flash = (TextView) tagged("camera_flash");
        assertEquals("FLASH —", flash.getText().toString()); assertFalse(flash.isEnabled());
        activity.ready(new CameraEngine.Info(false, true, true, true, 90, live, capture,
                new Range<>(-6, 6), new Rational(1, 3)));
        assertEquals("FLASH AUTO", flash.getText().toString());
    }
}
