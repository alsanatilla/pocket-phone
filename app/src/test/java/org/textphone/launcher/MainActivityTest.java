package org.textphone.launcher;

import static org.junit.Assert.*;

import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.os.Bundle;
import android.provider.CallLog;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

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
import org.robolectric.annotation.GraphicsMode;

import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.List;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {24, 35})
public class MainActivityTest {
    private ActivityController<MainActivity> controller;
    private MainActivity activity;

    @Before public void start() {
        RuntimeEnvironment.getApplication().getSharedPreferences("text_phone", 0).edit().clear().commit();
        RuntimeEnvironment.getApplication().getSharedPreferences("pocket_planner", 0).edit().clear().commit();
        controller = Robolectric.buildActivity(MainActivity.class).setup();
        activity = controller.get();
    }

    @After public void stop() { controller.pause().stop().destroy(); }

    private void collect(View view, List<TextView> result) {
        if (view instanceof TextView) result.add((TextView) view);
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) collect(group.getChildAt(i), result);
        }
    }

    private TextView label(String label) {
        List<TextView> views = new ArrayList<>();
        collect(activity.getWindow().getDecorView(), views);
        for (TextView text : views) if (label.equalsIgnoreCase(text.getText().toString())) return text;
        throw new AssertionError("Missing text: " + label);
    }

    private void shortcut(String label) { ((View) label(label).getParent()).performClick(); }

    @Test public void homeHasTheNineReferenceShortcutsAndSoftKeys() {
        for (String label : new String[]{"smart txt", "whatsapp", "dumb txt", "contacts",
                "call history", "settings", "maps", "camera", "rides", "capture", "today", "pip", "all"}) {
            assertNotNull(label(label));
        }
        assertTrue(((View) label("smart txt").getParent()).isSelected());
        assertEquals(0xFF000000, label("smart txt").getCurrentTextColor());
        assertEquals(0xFFFFFFFF, label("camera").getCurrentTextColor());
    }

    @Test public void callHistoryOpensThePocketPhoneApp() {
        shortcut("call history");
        Intent launched = Shadows.shadowOf(activity).getNextStartedActivity();
        assertNotNull(launched);
        assertEquals(PhoneActivity.class.getName(), launched.getComponent().getClassName());
    }

    @Test public void notificationsStayOptionalAndGiveAnEnableAction() {
        org.robolectric.util.ReflectionHelpers.<View>getField(activity,"notificationCount").performClick();
        assertNotNull(activity.findViewById(android.R.id.content).findViewWithTag("app_settings"));
        activity.onBackPressed();
        assertNotNull(label("smart txt"));
        assertFalse(PhoneNotifications.connected());
    }

    @Test public void missingSmartMessagingAppOpensTheShortcutPicker() {
        shortcut("smart txt");
        assertNotNull(label("Choose an installed app for this shortcut."));
        label("Use default").performClick();
        assertNotNull(label("capture"));
    }

    @Test public void homeIntentAlwaysReturnsToTheGrid() {
        shortcut("settings");
        assertNotNull(label("home screen"));
        activity.onNewIntent(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME));
        assertNotNull(label("smart txt"));
        activity.onBackPressed();
        assertNotNull(label("smart txt"));
        assertFalse(activity.isFinishing());
    }

    @Test public void dpadSelectionMovesThroughTheGrid() {
        activity.onKeyDown(KeyEvent.KEYCODE_DPAD_RIGHT, new KeyEvent(0, KeyEvent.KEYCODE_DPAD_RIGHT));
        assertTrue(((View) label("whatsapp").getParent()).isSelected());
        activity.onKeyDown(KeyEvent.KEYCODE_DPAD_DOWN, new KeyEvent(0, KeyEvent.KEYCODE_DPAD_DOWN));
        assertTrue(((View) label("call history").getParent()).isSelected());
        assertFalse(((View) label("smart txt").getParent()).isSelected());
    }

    @Test public void colourPreferencePersistsAndRepaintsTheSelectedTile() {
        shortcut("settings");
        ((View) label("Colour").getParent()).performClick();
        assertEquals(1, activity.getSharedPreferences("text_phone", 0).getInt("accent", -1));
        activity.onBackPressed();
        assertEquals(0xFF9BE564, label("capture").getCurrentTextColor());
    }

    @Test public void allAppsReturnsToTheScreenThatOpenedIt() {
        label("all").performClick();
        assertNotNull(label("apps"));
        activity.onBackPressed();
        assertNotNull(label("smart txt"));
        shortcut("settings");
        NavigationLifecycleTest.navigate(activity,"apps");
        activity.onBackPressed();
        assertNotNull(label("home screen"));
    }

    @Test
    @Config(sdk = 28, qualifiers = "w360dp-h720dp-mdpi")
    @GraphicsMode(GraphicsMode.Mode.NATIVE)
    public void renderRealNativeHomeAndCheckEveryTileFits() throws Exception {
        View root = activity.findViewById(android.R.id.content);
        root.measure(View.MeasureSpec.makeMeasureSpec(360, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(720, View.MeasureSpec.EXACTLY));
        root.layout(0, 0, 360, 720);
        for (String shortcut : new String[]{"smart txt", "whatsapp", "dumb txt", "contacts",
                "call history", "settings", "maps", "camera", "rides"}) {
            TextView text = label(shortcut);
            assertTrue(shortcut + " has width", text.getWidth() > 0);
            assertTrue(shortcut + " has height", text.getHeight() > 0);
            int[] position = new int[2];
            text.getLocationInWindow(position);
            assertTrue(shortcut + " is below the status bar", position[1] >= 28);
            assertTrue(shortcut + " is above the footer", position[1] + text.getHeight() < 680);
        }
        int[] first = new int[2];
        int[] last = new int[2];
        label("smart txt").getLocationInWindow(first);
        label("maps").getLocationInWindow(last);
        assertTrue("Rows form a compact panel", last[1] - first[1] < 260);
        Bitmap bitmap = Bitmap.createBitmap(360, 720, Bitmap.Config.ARGB_8888);
        root.draw(new Canvas(bitmap));
        File output = new File("build/screenshots/pocket-phone-home.png");
        assertTrue(output.getParentFile().isDirectory() || output.getParentFile().mkdirs());
        try (FileOutputStream file = new FileOutputStream(output)) {
            assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, file));
        }
    }
}
