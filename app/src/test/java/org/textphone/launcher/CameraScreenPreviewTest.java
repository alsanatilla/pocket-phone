package org.textphone.launcher;

import static org.junit.Assert.assertTrue;

import android.Manifest;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.util.Range;
import android.util.Rational;
import android.util.Size;
import android.view.View;
import java.io.File;
import java.io.FileOutputStream;
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

/** Renders the shipped native layout with a ready-camera fixture, without a camera feed. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, qualifiers = "w360dp-h800dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class CameraScreenPreviewTest {
    @Test public void renderCameraScreen() throws Exception {
        RuntimeEnvironment.getApplication().getSharedPreferences("pocket_camera", 0).edit()
                .clear().putBoolean("permission_asked", true).commit();
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).denyPermissions(Manifest.permission.CAMERA);
        ActivityController<CompactCameraActivity> controller =
                Robolectric.buildActivity(CompactCameraActivity.class).setup();
        try {
            CompactCameraActivity activity = controller.get();
            CameraEngine engine = ReflectionHelpers.getField(activity, "engine");
            // Fixture state only: no CameraDevice or capture session is opened.
            ReflectionHelpers.setField(engine, "ready", true);
            ReflectionHelpers.setField(engine, "running", true);
            activity.ready(new CameraEngine.Info(false, true, true, true, 90,
                    new Size(640, 480), new Size(2048, 1536),
                    new Range<>(-6, 6), new Rational(1, 3)));

            View root = activity.findViewById(android.R.id.content);
            root.measure(View.MeasureSpec.makeMeasureSpec(360, View.MeasureSpec.EXACTLY),
                    View.MeasureSpec.makeMeasureSpec(800, View.MeasureSpec.EXACTLY));
            root.layout(0, 0, 360, 800);
            org.junit.Assert.assertEquals(48,root.findViewWithTag("page_header").getHeight());
            // 0.5.21: profile, size, aspect and quality are an on-screen menu; flash and exposure stay in Settings.
            for (String tag : new String[]{"camera_profile", "camera_size", "camera_aspect", "camera_quality"}) org.junit.Assert.assertNotNull(tag, root.findViewWithTag(tag));
            org.junit.Assert.assertNull(root.findViewWithTag("camera_flash"));
            View finder=(View)root.findViewWithTag("camera_preview").getParent();
            assertTrue("Setup rows leave at least 600 dp for the finder",finder.getHeight()>=600);
            root.findViewWithTag("app_settings").performClick();
            android.app.AlertDialog settings=org.robolectric.shadows.ShadowAlertDialog.getLatestAlertDialog();
            org.junit.Assert.assertNotNull(settings.findViewById(android.R.id.content).findViewWithTag("camera_flash"));
            settings.dismiss();
            Bitmap bitmap = Bitmap.createBitmap(360, 800, Bitmap.Config.ARGB_8888);
            root.draw(new Canvas(bitmap));
            File output = new File("build/screenshots/pocket-camera.png");
            assertTrue(output.getParentFile().isDirectory() || output.getParentFile().mkdirs());
            try (FileOutputStream file = new FileOutputStream(output)) {
                assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, file));
            }
            bitmap.recycle();
        } finally {
            controller.pause().stop().destroy();
        }
    }
}
