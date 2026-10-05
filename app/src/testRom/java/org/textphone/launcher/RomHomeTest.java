package org.textphone.launcher;

import static org.junit.Assert.*;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.provider.AlarmClock;
import android.provider.MediaStore;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import android.widget.EditText;

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
import java.util.Calendar;
import java.util.Locale;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {23, 35})
public class RomHomeTest {
    private ActivityController<MainActivity> controller;
    private MainActivity activity;

    @Before public void start() {
        RuntimeEnvironment.getApplication().getSharedPreferences("text_phone", 0).edit().clear().commit();
        RuntimeEnvironment.getApplication().getSharedPreferences("pocket_planner", 0).edit().clear().commit();
        controller = Robolectric.buildActivity(MainActivity.class).setup();
        activity = controller.get();
    }
    @After public void stop() { controller.pause().stop().destroy(); }

    private TextView find(View view, String text) {
        if (view instanceof TextView && text.contentEquals(((TextView) view).getText())) return (TextView) view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                TextView match = find(group.getChildAt(i), text);
                if (match != null) return match;
            }
        }
        return null;
    }
    private TextView label(String text) {
        TextView match = find(activity.getWindow().getDecorView(), text);
        assertNotNull("Missing label: " + text, match);
        return match;
    }
    private void shortcut(String text) { ((View) label(text).getParent()).performClick(); }

    @Test public void essentialsGridHasNoMissingOptionalAppTiles() {
        assertTrue(activity.getResources().getBoolean(R.bool.pocket_rom));
        for (String text : new String[]{"phone", "messages", "contacts", "clock", "camera",
                "calculator", "files", "today", "settings", "notifs", "select", "all"}) label(text);
        assertNull(find(activity.getWindow().getDecorView(), "whatsapp"));
        assertTrue(((View) label("phone").getParent()).isSelected());
    }
    @Test public void phoneMessagesAndCameraOpenPocketApps() {
        shortcut("phone");
        assertEquals(PhoneActivity.class.getName(), Shadows.shadowOf(activity).getNextStartedActivity().getComponent().getClassName());
        shortcut("messages");
        assertEquals(ChatsActivity.class.getName(), Shadows.shadowOf(activity).getNextStartedActivity().getComponent().getClassName());
        shortcut("camera");
        assertEquals(CompactCameraActivity.class.getName(),
                Shadows.shadowOf(activity).getNextStartedActivity().getComponent().getClassName());
    }
    @Test public void clockCalculatorAndCalendarHaveTheirOwnApps() {
        shortcut("clock");
        assertEquals(ClockActivity.class.getName(), Shadows.shadowOf(activity).getNextStartedActivity().getComponent().getClassName());
        shortcut("calculator");
        assertEquals(CalculatorActivity.class.getName(), Shadows.shadowOf(activity).getNextStartedActivity().getComponent().getClassName());
        shortcut("today");
        Intent today = Shadows.shadowOf(activity).getNextStartedActivity(); assertEquals(OrganizerActivity.class.getName(), today.getComponent().getClassName());
        ActivityController<OrganizerActivity> organizer = Robolectric.buildActivity(OrganizerActivity.class, today).setup();
        try { find(organizer.get().getWindow().getDecorView(), "Calendar").performClick();
            assertEquals(AgendaActivity.class.getName(), Shadows.shadowOf(organizer.get()).getNextStartedActivity().getComponent().getClassName());
        } finally { organizer.pause().stop().destroy(); }
    }
    @Test public void filesOpensTheOwnCameraAlbum() {
        shortcut("files");
        Intent intent = Shadows.shadowOf(activity).getNextStartedActivity();
        assertEquals(FilesActivity.class.getName(), intent.getComponent().getClassName());
    }
    @Test public void navigationAndHomeReturnWorkInTheRomGrid() {
        activity.onKeyDown(KeyEvent.KEYCODE_DPAD_DOWN, new KeyEvent(0, KeyEvent.KEYCODE_DPAD_DOWN));
        assertTrue(((View) label("clock").getParent()).isSelected());
        shortcut("settings");
        label("Use as home screen");
        activity.onNewIntent(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME));
        label("phone");
        activity.onBackPressed();
        assertFalse(activity.isFinishing());
        assertTrue(((View) label("settings").getParent()).performLongClick());
        org.robolectric.shadows.ShadowAlertDialog.getLatestAlertDialog().dismiss();
        assertTrue(((View) label("calculator").getParent()).performLongClick());
        Shadows.shadowOf(org.robolectric.shadows.ShadowAlertDialog.getLatestAlertDialog()).clickOnItem(0);
        label("Choose an installed app for this shortcut.");
    }
    @Test public void dashboardCaptureKeepsSeparateDraftsAndFocusUsesClock() {
        label("NEXT [0]");
        label("Set alarm").performClick();
        assertEquals(ClockActivity.class.getName(), Shadows.shadowOf(activity).getNextStartedActivity().getComponent().getClassName());
        label("No open tasks").performClick();
        EditText editor = activity.findViewById(android.R.id.content).findViewWithTag("capture_editor");
        editor.setText("Write proposal");
        activity.onNewIntent(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME));
        label("+ note").performClick();
        editor = activity.findViewById(android.R.id.content).findViewWithTag("capture_editor");
        assertEquals("", editor.getText().toString());
        editor.setText("Meeting notes");
        activity.onNewIntent(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME));
        label("+ task").performClick();
        editor = activity.findViewById(android.R.id.content).findViewWithTag("capture_editor");
        assertEquals("Write proposal", editor.getText().toString());
        label("save").performClick();
        activity.onNewIntent(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME));
        label("NEXT [1]"); label("Write proposal");
        label("focus").performClick(); label("Focus · 25 min").performClick();
        Intent timer = Shadows.shadowOf(activity).getNextStartedActivity();
        assertEquals(ClockActivity.class.getName(), timer.getComponent().getClassName());
        assertEquals(1500, timer.getIntExtra("seconds", 0));
        assertEquals("Focus: Write proposal", timer.getStringExtra("title"));
    }
    @Test
    @Config(sdk = 28, qualifiers = "w360dp-h720dp-mdpi")
    @GraphicsMode(GraphicsMode.Mode.NATIVE)
    public void nativeRomHomeFitsAndRenders() throws Exception {
        PlannerStore store = new PlannerStore(activity.getSharedPreferences("pocket_planner", 0));
        long task = store.save(0, "task", "Finish draft");
        store.save(0, "task", "Book train");
        activity.getSharedPreferences("text_phone", 0).edit().putBoolean("twenty_four_hour", true).commit();
        Calendar tomorrow = Calendar.getInstance();
        tomorrow.add(Calendar.DAY_OF_MONTH, 1);
        tomorrow.set(Calendar.HOUR_OF_DAY, 7); tomorrow.set(Calendar.MINUTE, 30);
        tomorrow.set(Calendar.SECOND, 0); tomorrow.set(Calendar.MILLISECOND, 0);
        AlarmManager alarms = (AlarmManager) activity.getSystemService(Context.ALARM_SERVICE);
        PendingIntent show = PendingIntent.getActivity(activity, 0, new Intent(AlarmClock.ACTION_SHOW_ALARMS),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent fire = PendingIntent.getBroadcast(activity, 1, new Intent("pocket.test.ALARM"),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        alarms.setAlarmClock(new AlarmManager.AlarmClockInfo(tomorrow.getTimeInMillis(), show), fire);
        activity.onNewIntent(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME));
        label("NEXT [2]"); label("Finish draft");
        label(StatusText.alarm(tomorrow.getTimeInMillis(), Locale.getDefault(), true)).performClick();
        assertEquals(ClockActivity.class.getName(), Shadows.shadowOf(activity).getNextStartedActivity().getComponent().getClassName());
        View root = activity.findViewById(android.R.id.content);
        root.measure(View.MeasureSpec.makeMeasureSpec(360, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(720, View.MeasureSpec.EXACTLY));
        root.layout(0, 0, 360, 720);
        for (String text : new String[]{"phone", "messages", "contacts", "clock", "camera",
                "calculator", "files", "today", "settings", "NEXT [2]", "Finish draft",
                "+ task", "+ note", "focus"}) {
            TextView tile = label(text);
            int[] position = new int[2]; tile.getLocationInWindow(position);
            assertTrue(tile.getWidth() > 0 && tile.getHeight() > 0);
            assertTrue(text + " fits", position[1] >= 28 && position[1] + tile.getHeight() < 680);
        }
        Bitmap bitmap = Bitmap.createBitmap(360, 720, Bitmap.Config.ARGB_8888);
        root.draw(new Canvas(bitmap));
        File output = new File("build/screenshots/pocket-rom-home.png");
        assertTrue(output.getParentFile().isDirectory() || output.getParentFile().mkdirs());
        try (FileOutputStream file = new FileOutputStream(output)) {
            assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, file));
        }
        new DashboardTiles(activity.getSharedPreferences("text_phone", 0)).assign("phone", "fixture.chatgpt", "ChatGPT");
        activity.onNewIntent(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME));
        root.measure(View.MeasureSpec.makeMeasureSpec(360, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(720, View.MeasureSpec.EXACTLY)); root.layout(0, 0, 360, 720);
        assertEquals("ChatGPT", ((TextView)root.findViewWithTag("tile_label_phone")).getText().toString());
        bitmap.eraseColor(android.graphics.Color.BLACK); root.draw(new Canvas(bitmap));
        try (FileOutputStream file = new FileOutputStream(new File("build/screenshots/pocket-edited-home.png"))) {
            assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, file));
        }
        new DashboardTiles(activity.getSharedPreferences("text_phone", 0)).reset("phone");
        bitmap.recycle();
        // A long task and larger text must leave all three softkeys on the screen.
        store.save(task, "task", "Review the project proposal and send the revised document before the next meeting");
        activity.getSharedPreferences("text_phone", 0).edit().putBoolean("large_text", true).commit();
        activity.onNewIntent(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME));
        root = activity.findViewById(android.R.id.content);
        root.measure(View.MeasureSpec.makeMeasureSpec(360, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(720, View.MeasureSpec.EXACTLY));
        root.layout(0, 0, 360, 720);
        TextView next = root.findViewWithTag("dashboard_next");
        assertEquals(2, next.getMaxLines());
        for (String text : new String[]{"notifs", "select", "all"}) {
            TextView key = label(text); int[] position = new int[2]; key.getLocationInWindow(position);
            assertTrue(text + " remains visible", position[1] >= 0 && position[1] + key.getHeight() <= 720);
            assertTrue(text + " touch target", key.getHeight() >= 48);
        }
    }
}
