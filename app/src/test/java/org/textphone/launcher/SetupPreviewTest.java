package org.textphone.launcher;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.view.View;
import android.view.ViewGroup;
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
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import org.robolectric.util.ReflectionHelpers;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=28,qualifiers="w360dp-h800dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class SetupPreviewTest {
    @Before public void clear() {
        Context c = RuntimeEnvironment.getApplication();
        for (String p : new String[]{"pocket_setup", "pocket_journal_key", "pocket_chat_provider", "pocket_movement", "text_phone"}) c.getSharedPreferences(p, 0).edit().clear().commit();
    }

    @Test public void walksAccountCorosAndPipInOrderAndRemembersSkips() throws Exception {
        Context c = RuntimeEnvironment.getApplication();
        assertEquals(3, SetupActivity.open(c)); assertEquals("account", SetupActivity.next(c));
        ActivityController<SetupActivity> page = Robolectric.buildActivity(SetupActivity.class).setup();
        try {
            SetupActivity a = page.get(); save(a, "pocket-setup-account.png");
            View link = a.body.findViewWithTag("setup_link_phone"); assertNotNull(link); assertTrue(link.getHeight() >= 48);
            link.performClick(); Intent opened = Shadows.shadowOf(a).getNextStartedActivity();
            assertEquals(CloudActivity.class.getName(), opened.getComponent().getClassName()); assertEquals("link", opened.getStringExtra("setup"));

            find(a, "use pocket without an account").performClick();
            assertEquals("COROS", SetupActivity.next(c)); assertNotNull(find(a, "connect COROS")); save(a, "pocket-setup-coros.png");
            find(a, "no COROS watch").performClick();
            assertEquals("pip", SetupActivity.next(c)); assertNotNull(find(a, "save key")); save(a, "pocket-setup-pip.png");
            find(a, "Claude").performClick(); assertNotNull(find(a, "get a Claude key ↗"));
            find(a, "save key").performClick(); assertEquals(1, SetupActivity.open(c)); // An empty key saves nothing.

            // A skipped step can be reopened and asked again.
            ((View) find(a, "account").getParent()).performClick(); find(a, "ask again").performClick(); assertEquals("account", SetupActivity.next(c));
        } finally { page.pause().stop().destroy(); }

        // With every step connected or skipped the page offers the way home, and Home stops reminding.
        c.getSharedPreferences("pocket_setup", 0).edit().putBoolean("skipped_account", true).putBoolean("skipped_coros", true).commit();
        c.getSharedPreferences("pocket_journal_key", 0).edit().putString("value", "fixture").putString("last4", "abcd").commit();
        assertEquals(0, SetupActivity.open(c)); assertEquals(1, SetupActivity.doneCount(c));
        page = Robolectric.buildActivity(SetupActivity.class).setup();
        try { assertNotNull(find(page.get(), "home")); save(page.get(), "pocket-setup-finished.png"); }
        finally { page.pause().stop().destroy(); }
    }

    @Test public void homeAndSettingsLeadIntoSetup() throws Exception {
        Context c = RuntimeEnvironment.getApplication();
        ActivityController<MainActivity> home = Robolectric.buildActivity(MainActivity.class).setup();
        try {
            View root = home.get().findViewById(android.R.id.content);
            TextView reminder = root.findViewWithTag("pocket_setup"); assertNotNull(reminder);
            assertTrue(reminder.getText().toString().contains("account ›")); save(home.get(), "pocket-setup-home.png");
            reminder.performClick();
            assertEquals(SetupActivity.class.getName(), Shadows.shadowOf(home.get()).getNextStartedActivity().getComponent().getClassName());
            SetupActivity.hide(c); ReflectionHelpers.callInstanceMethod(home.get(), "render");
            assertNull(home.get().findViewById(android.R.id.content).findViewWithTag("pocket_setup"));
        } finally { home.pause().stop().destroy(); }
    }

    private static TextView find(SetupActivity a, String text) {
        TextView found = find(a.findViewById(android.R.id.content), text); assertNotNull("Missing " + text, found); return found;
    }
    private static TextView find(View view, String text) {
        if (view instanceof TextView && text.equals(((TextView) view).getText().toString()) && view.isShown()) return (TextView) view;
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) view).getChildCount(); i++) { TextView child = find(((ViewGroup) view).getChildAt(i), text); if (child != null) return child; }
        return null;
    }
    private static void save(android.app.Activity activity, String name) throws Exception {
        if (activity instanceof PocketActivity) ReflectionHelpers.<PageMotion>getField(activity, "motion").settle();
        View root = activity.findViewById(android.R.id.content);
        root.measure(View.MeasureSpec.makeMeasureSpec(360, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(800, View.MeasureSpec.EXACTLY)); root.layout(0, 0, 360, 800);
        Bitmap image = Bitmap.createBitmap(360, 800, Bitmap.Config.ARGB_8888); root.draw(new Canvas(image));
        File path = new File("build/screenshots", name); assertTrue(path.getParentFile().isDirectory() || path.getParentFile().mkdirs());
        try (FileOutputStream out = new FileOutputStream(path)) { assertTrue(image.compress(Bitmap.CompressFormat.PNG, 100, out)); } image.recycle();
    }
}
