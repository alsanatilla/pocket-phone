package org.textphone.launcher;

import static org.junit.Assert.*;

import android.Manifest;
import android.app.Activity;
import android.graphics.Insets;
import android.os.Build;
import android.os.Looper;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {24, 28, 30, 35})
public class FullscreenTest {
    @Test public void launcherRestoresFullscreenAfterDialogsAndReturningFromAnotherApp() {
        verifyLifecycle(MainActivity.class);
    }

    @Test public void pocketScreensRestoreFullscreenAfterDialogsAndReturningFromAnotherApp() {
        verifyLifecycle(CalculatorActivity.class);
    }

    @Test public void cameraRestoresFullscreenAndStillKeepsTheScreenAwake() {
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).denyPermissions(Manifest.permission.CAMERA);
        verifyLifecycle(CompactCameraActivity.class);
    }

    private <T extends Activity> void verifyLifecycle(Class<T> type) {
        ActivityController<T> lifecycle = Robolectric.buildActivity(type).setup();
        T activity = lifecycle.get();
        try {
            assertFullscreen(activity);
            revealBars(activity);
            activity.onWindowFocusChanged(false);
            assertBarsVisible(activity);
            activity.onWindowFocusChanged(true);
            assertFullscreen(activity);
            lifecycle.pause().stop();
            revealBars(activity);
            lifecycle.restart().start().resume().visible();
            assertFullscreen(activity);
            if (type == CompactCameraActivity.class) assertNotEquals(0,
                    activity.getWindow().getAttributes().flags & WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        } finally { lifecycle.pause().stop().destroy(); }
    }

    private void revealBars(Activity activity) {
        if (Build.VERSION.SDK_INT >= 30) activity.getWindow().getInsetsController().show(WindowInsets.Type.systemBars());
        else {
            activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
            activity.getWindow().getDecorView().setSystemUiVisibility(0);
        }
        applyInsets(activity);
    }

    private void applyInsets(Activity activity) {
        activity.getWindow().getDecorView().requestApplyInsets();
        Shadows.shadowOf(Looper.getMainLooper()).idle();
    }

    private void assertBarsVisible(Activity activity) {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsets insets = activity.getWindow().getDecorView().getRootWindowInsets();
            assertNotNull(insets);
            assertTrue(insets.isVisible(WindowInsets.Type.statusBars()));
            assertTrue(insets.isVisible(WindowInsets.Type.navigationBars()));
        } else assertEquals(0, activity.getWindow().getDecorView().getSystemUiVisibility());
    }

    private void assertFullscreen(Activity activity) {
        applyInsets(activity);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsets insets = activity.getWindow().getDecorView().getRootWindowInsets();
            assertNotNull(insets);
            assertFalse(insets.isVisible(WindowInsets.Type.statusBars()));
            assertFalse(insets.isVisible(WindowInsets.Type.navigationBars()));
            assertEquals(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE,
                    activity.getWindow().getInsetsController().getSystemBarsBehavior());
            assertEquals(0, activity.getWindow().getAttributes().flags & WindowManager.LayoutParams.FLAG_FULLSCREEN);
        } else {
            int flags = activity.getWindow().getDecorView().getSystemUiVisibility();
            assertNotEquals(0, flags & View.SYSTEM_UI_FLAG_FULLSCREEN);
            assertNotEquals(0, flags & View.SYSTEM_UI_FLAG_HIDE_NAVIGATION);
            assertNotEquals(0, flags & View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
            assertNotEquals(0, activity.getWindow().getAttributes().flags & WindowManager.LayoutParams.FLAG_FULLSCREEN);
        }
        if (Build.VERSION.SDK_INT >= 28) assertEquals(Build.VERSION.SDK_INT >= 30
                        ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                        : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES,
                activity.getWindow().getAttributes().layoutInDisplayCutoutMode);
    }

    @Test @Config(sdk = {30, 35}) public void fullscreenKeepsCutoutAndKeyboardPaddingAndRemovesItWhenKeyboardCloses() {
        ActivityController<CalculatorActivity> lifecycle = Robolectric.buildActivity(CalculatorActivity.class).setup();
        CalculatorActivity activity = lifecycle.get();
        try {
            WindowInsets keyboard = new WindowInsets.Builder()
                    .setInsets(WindowInsets.Type.displayCutout(), Insets.of(11, 28, 7, 0))
                    .setInsets(WindowInsets.Type.ime(), Insets.of(0, 0, 0, 320))
                    .setVisible(WindowInsets.Type.ime(), true).build();
            activity.root.dispatchApplyWindowInsets(keyboard);
            assertEquals(activity.dp(PocketDesign.INSET) + 11, activity.root.getPaddingLeft());
            assertEquals(activity.dp(4) + 28, activity.root.getPaddingTop());
            assertEquals(activity.dp(PocketDesign.INSET) + 7, activity.root.getPaddingRight());
            assertEquals(activity.dp(4) + 320, activity.root.getPaddingBottom());
            WindowInsets closed = new WindowInsets.Builder(keyboard)
                    .setInsets(WindowInsets.Type.ime(), Insets.NONE)
                    .setVisible(WindowInsets.Type.ime(), false).build();
            activity.root.dispatchApplyWindowInsets(closed);
            assertEquals(activity.dp(4), activity.root.getPaddingBottom());
            assertEquals(activity.dp(4) + 28, activity.root.getPaddingTop());
        } finally { lifecycle.pause().stop().destroy(); }
    }

    @Test @Config(sdk = {30, 35}) public void fullscreenPipKeepsItsComposerAboveTheKeyboard() {
        ActivityController<MainActivity> lifecycle = Robolectric.buildActivity(MainActivity.class).setup();
        MainActivity activity = lifecycle.get();
        try {
            ClaudeSidebar sidebar = activity.findViewById(android.R.id.content).findViewWithTag("claude_sidebar_host");
            sidebar.open();
            View panel = sidebar.findViewWithTag("claude_sidebar");
            WindowInsets keyboard = new WindowInsets.Builder()
                    .setInsets(WindowInsets.Type.displayCutout(), Insets.of(0, 28, 0, 0))
                    .setInsets(WindowInsets.Type.ime(), Insets.of(0, 0, 0, 320))
                    .setVisible(WindowInsets.Type.ime(), true).build();
            sidebar.dispatchApplyWindowInsets(keyboard);
            assertEquals(320, panel.getPaddingBottom());
            assertEquals(28, panel.getPaddingTop());
            WindowInsets closed = new WindowInsets.Builder(keyboard)
                    .setInsets(WindowInsets.Type.ime(), Insets.NONE)
                    .setVisible(WindowInsets.Type.ime(), false).build();
            sidebar.dispatchApplyWindowInsets(closed);
            assertEquals(0, panel.getPaddingBottom());
            assertEquals(28, panel.getPaddingTop());
        } finally { lifecycle.pause().stop().destroy(); }
    }
}
