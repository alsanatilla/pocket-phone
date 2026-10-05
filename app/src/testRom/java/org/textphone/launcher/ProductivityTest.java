package org.textphone.launcher;

import static org.junit.Assert.*;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.provider.AlarmClock;
import android.provider.CalendarContract;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
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
import org.robolectric.shadows.ShadowAlertDialog;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class ProductivityTest {
    private ActivityController<MainActivity> controller;
    private MainActivity activity;
    private PlannerStore store;
    @Before public void start() {
        RuntimeEnvironment.getApplication().getSharedPreferences("text_phone", 0).edit().clear().commit();
        RuntimeEnvironment.getApplication().getSharedPreferences("pocket_planner", 0).edit().clear().commit();
        store = new PlannerStore(RuntimeEnvironment.getApplication().getSharedPreferences("pocket_planner", 0));
        controller = Robolectric.buildActivity(MainActivity.class).setup(); activity = controller.get();
    }
    @After public void stop() { controller.pause().stop().destroy(); }
    private TextView find(View view, String text) {
        if (view instanceof TextView && text.contentEquals(((TextView) view).getText())) return (TextView) view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                TextView result = find(group.getChildAt(i), text); if (result != null) return result;
            }
        }
        return null;
    }
    private TextView label(String text) {
        TextView result = find(activity.getWindow().getDecorView(), text);
        assertNotNull("Missing label: " + text, result); return result;
    }
    private void today() { NavigationLifecycleTest.navigate(activity, "today"); }
    private EditText editor() { return activity.findViewById(android.R.id.content).findViewWithTag("capture_editor"); }
    private void home() { activity.onNewIntent(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)); }

    @Test public void taskCaptureUpdatesStandbyAndCompletion() {
        today(); label("+ Task").performClick(); editor().setText("Send invoice"); label("save").performClick();
        assertEquals(1, store.openTasks()); label("Complete task"); long id = store.entries().get(0).id;
        home(); label("0 / 1"); label("Send invoice").performClick();
        label("Complete task");
        assertEquals(1, store.openTasks()); label("Complete task").performClick(); home();
        assertEquals(View.GONE,activity.findViewById(android.R.id.content).findViewWithTag("dashboard_next").getVisibility()); assertEquals(0, store.openTasks());
    }
    @Test public void sharedTextAndUnfinishedNotesSurviveLeavingTheScreen() {
        activity.onNewIntent(new Intent(Intent.ACTION_SEND).setType("text/plain")
                .putExtra(Intent.EXTRA_TEXT, "https://example.org/invoice"));
        assertEquals("https://example.org/invoice", editor().getText().toString());
        editor().append("\nReview on Friday"); home();
        today(); label("Note").performClick();
        assertEquals("https://example.org/invoice\nReview on Friday", editor().getText().toString());
        label("save").performClick();
        assertEquals("https://example.org/invoice\nReview on Friday", store.entries().get(0).text);
        assertEquals("", store.draft("note", 0));
    }
    @Test public void rotationKeepsEditedTextAndIdentity() {
        long id = store.save(0, "note", "Original"); today(); activity.findViewById(android.R.id.content).findViewWithTag("note_open_"+id).performClick();
        editor().setText("Edited\nSecond line");
        controller.recreate(); activity = controller.get();
        assertEquals("Edited\nSecond line", editor().getText().toString());
        label("save").performClick();
        assertEquals(1, store.entries().size()); assertEquals(id, store.entries().get(0).id);
        assertEquals("Edited\nSecond line", store.entries().get(0).text);
    }
    @Test public void switchingCaptureTypesDoesNotOverwriteOtherDrafts() {
        today(); label("+ Task").performClick(); editor().setText("Unfinished task"); home();
        today(); label("Note").performClick(); editor().setText("Unfinished note"); home();
        today(); label("+ Task").performClick(); assertEquals("Unfinished task", editor().getText().toString());
        home(); today(); label("Note").performClick(); assertEquals("Unfinished note", editor().getText().toString());
    }
    @Test public void focusAndSchedulingUsePocketAppsWithTheTaskTitle() {
        long id = store.save(0, "task", "Write proposal"); today(); SettingsTestActions.choose(activity,"Focus timer");
        label("Focus · 25 min").performClick();
        Intent timer = Shadows.shadowOf(activity).getNextStartedActivity();
        assertEquals(ClockActivity.class.getName(), timer.getComponent().getClassName());
        assertEquals(1500, timer.getIntExtra("seconds", 0));
        assertEquals("Focus: Write proposal", timer.getStringExtra("title"));
        activity.onBackPressed(); activity.findViewById(android.R.id.content).findViewWithTag("task_open_" + id).performLongClick();
        AlertDialog dialog = ShadowAlertDialog.getLatestAlertDialog();
        android.widget.ListAdapter choices=dialog.getListView().getAdapter();int schedule=-1;
        for(int i=0;i<choices.getCount();i++)if("Schedule reminder".equals(choices.getItem(i).toString()))schedule=i;
        assertTrue("Task menu offers a reminder",schedule>=0);dialog.getListView().performItemClick(null,schedule,schedule);
        Intent calendar = Shadows.shadowOf(activity).getNextStartedActivity();
        assertEquals(TaskReminderActivity.class.getName(), calendar.getComponent().getClassName());
        assertEquals(id,calendar.getLongExtra("task",0));
    }
    @Test public void numberKeysOpenTheMatchingHomeTile() {
        activity.onKeyDown(KeyEvent.KEYCODE_1, new KeyEvent(0, KeyEvent.KEYCODE_1));
        assertEquals(PhoneActivity.class.getName(), Shadows.shadowOf(activity).getNextStartedActivity().getComponent().getClassName());
        activity.onKeyDown(KeyEvent.KEYCODE_8, new KeyEvent(0, KeyEvent.KEYCODE_8));
        assertEquals(OrganizerActivity.class.getName(), Shadows.shadowOf(activity).getNextStartedActivity().getComponent().getClassName());
    }
    @Test public void t9SearchFiltersTheActualInstalledAppList() throws Exception {
        for (String name : new String[]{"Calculator", "Calendar"}) {
            ResolveInfo info = new ResolveInfo(); info.nonLocalizedLabel = name;
            info.activityInfo = new ActivityInfo(); info.activityInfo.name = "Main";
            info.activityInfo.packageName = "example." + name.toLowerCase();
            info.activityInfo.applicationInfo = new ApplicationInfo();
            info.activityInfo.applicationInfo.packageName = info.activityInfo.packageName;
            Shadows.shadowOf(activity.getPackageManager()).addResolveInfoForIntent(
                    new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), info);
        }
        label("all").performClick();
        EditText search = activity.findViewById(android.R.id.content).findViewWithTag("app_search");
        search.setText("2252"); AppIndexTest.settle(activity); label("Calculator");
        assertNull(find(activity.getWindow().getDecorView(), "Calendar"));
        search.setText("2253"); AppIndexTest.settle(activity); label("Calendar");
        assertNull(find(activity.getWindow().getDecorView(), "Calculator"));
    }
    @Test public void exportUsesTheSystemPickerAndWritesMarkdownSource() throws Exception {
        store.save(0, "task", "Book train"); store.save(0, "note", "Köln · 18:42");
        today(); SettingsTestActions.choose(activity,"Export Markdown");
        Intent request = Shadows.shadowOf(activity).getNextStartedActivityForResult().intent;
        assertEquals(Intent.ACTION_CREATE_DOCUMENT, request.getAction());
        assertEquals("text/markdown", request.getType()); assertEquals("pocket-notes.md", request.getStringExtra(Intent.EXTRA_TITLE));
        File file = File.createTempFile("pocket-export", ".md");
        try {
            activity.onActivityResult(72, MainActivity.RESULT_OK, new Intent().setData(Uri.fromFile(file)));
            String value = new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
            assertTrue(value.contains("[ ] Book train")); assertTrue(value.contains("Köln · 18:42"));
            assertEquals(2, store.entries().size());
        } finally { file.delete(); }
    }
    @Test
    @Config(sdk = 28, qualifiers = "w360dp-h720dp-mdpi")
    @GraphicsMode(GraphicsMode.Mode.NATIVE)
    public void nativeOrganizerRendersWithSampleData() throws Exception {
        long id = store.save(0, "task", "Finish draft"); store.save(0, "task", "Book train");
        store.save(0, "note", "Platform 4 · 18:42"); today();
        View root = activity.findViewById(android.R.id.content);
        root.measure(View.MeasureSpec.makeMeasureSpec(360, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(720, View.MeasureSpec.EXACTLY));
        root.layout(0, 0, 360, 720);
        assertTrue(root.findViewWithTag("task_open_" + id).getWidth() > 0);
        Bitmap bitmap = Bitmap.createBitmap(360, 720, Bitmap.Config.ARGB_8888); root.draw(new Canvas(bitmap));
        File output = new File("build/screenshots/pocket-today.png");
        assertTrue(output.getParentFile().isDirectory() || output.getParentFile().mkdirs());
        try (FileOutputStream file = new FileOutputStream(output)) {
            assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, file));
        }
    }
}
