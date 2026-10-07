package org.textphone.launcher;

import static org.junit.Assert.*;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.TextView;

import java.io.File;
import java.io.FileOutputStream;
import java.time.Duration;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;

import org.json.JSONArray;
import org.json.JSONObject;
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
import org.robolectric.util.ReflectionHelpers;

/** Actual Warm Console layouts from isolated fictional fixtures. No handset, account or network. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, qualifiers = "w360dp-h800dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class WarmConsolePreviewTest {
    private Context context;
    private PlannerStore planner;
    private long chosen, overdue, note, thought;

    @Before public void seedWorkspace() throws Exception {
        context = RuntimeEnvironment.getApplication();
        for (String name : new String[]{"text_phone", "pocket_planner", "pocket_agenda", "pocket_parking",
                "pocket_cloud", "pocket_movement", "pocket_coros_auth", "pocket_workspace_extras",
                "pocket_capture_drafts", "pocket_setup", "pocket_journal", "pocket_receipt"}) {
            context.getSharedPreferences(name, 0).edit().clear().commit();
        }
        ClockStore.prefs(context).edit().clear().commit();
        context.getSharedPreferences("text_phone", 0).edit().putBoolean("reduce_motion", true)
                .putBoolean("twenty_four_hour", true).commit();
        SetupActivity.hide(context);
        planner = new PlannerStore(context.getSharedPreferences("pocket_planner", 0));
        chosen = planner.saveTask(0, "Book ferry tickets for Saturday", PlannerDates.today(), true,
                "- [x] Pick the departure\n- [ ] Book the tickets");
        planner.makeNext(chosen);
        overdue = planner.saveTask(0, "Reply about the heating repair", LocalDate.now().minusDays(1).toString(), false, "");
        planner.saveTask(0, "Pack for the coast", LocalDate.now().plusDays(2).toString(), false, "");
        long done = planner.saveTask(0, "Call the dentist", "", false, "");
        planner.toggle(done);
        note = planner.save(0, "note", "# Winter gym split\n\nTwo upper days and two lower days.\n\n## Keep\nLeave one evening open.");
        planner.pinNote(note, true);
        planner.save(0, "note", "# Questions about the flat\n\nDeposit, heating repair and collecting the keys.");
        ParkingStore.Item ready = ParkingStore.parkFromNote(context, System.currentTimeMillis(),
                "Switch the gym split for winter?", System.currentTimeMillis() - 1000, NoteSync.uid(planner, note));
        thought = ready.id;
        ParkingStore.park(context, "A little photo zine from Saturday's trip.", 0);
        AgendaStore.Event appointment = new AgendaStore.Event();
        appointment.title = "Planning session"; appointment.when = System.currentTimeMillis() + 3600000;
        appointment.minutes = 45; AgendaStore.save(context, appointment);
        seedMovement();
        JSONArray tiles = new JSONArray();
        for (String kind : new String[]{"agenda", "thoughts", "tasks", "activity", "zines"})
            tiles.put(new JSONObject().put("uid", "preview-" + kind).put("kind", kind));
        WorkspaceExtras.preference(context, "today-tiles", tiles);
        for (String label : new String[]{"Authenticator", "COROS", "Firefox", "Signal", "Spotify", "VLC"})
            install("fixture.warm." + label.toLowerCase(java.util.Locale.ROOT), label);
    }

    private void seedMovement() throws Exception {
        String today = LocalDate.now().toString();
        StringBuilder resting = new StringBuilder();
        for (int i = 0; i < 14; i++) resting.append(LocalDate.now().minusDays(i)).append(": ").append(55 + i % 3).append(" bpm\n");
        String activity = "1. Run — " + today + "\nLabelId: 123456\nSportType: 100\nDistance: 6200 m\n"
                + "Duration: 00:38:00\nAvg HR: 145\nLocation: Fixture park\nstartTimestamp=" + System.currentTimeMillis() / 1000;
        JSONObject raw = new JSONObject().put("updated", System.currentTimeMillis()).put("activities", activity)
                .put("resting", resting.toString())
                .put("hrv", today + ":\nHRV Avg: 64 ms\nNormal Range: 50 - 70\nBaseline: 60\n")
                .put("daily", today + ":\nSteps: 8600\nTotal: 7h 40min | Deep: 1h | Awake: 10min\n")
                .put("profile", "Age: 40\nGender: Male");
        // A fresh cache returns before the repository needs a credential or HTTP request.
        context.getSharedPreferences("pocket_coros_auth", 0).edit().putString("tokens", "fixture-presence").commit();
        context.getSharedPreferences("pocket_movement", 0).edit().putString("snapshot", raw.toString()).commit();
        assertNotNull(new CorosRepository.Snapshot(raw).scores.recovery);
    }

    @Test public void rendersHomeTodayAndAllWorkspacePages() throws Exception {
        ActivityController<MainActivity> home = Robolectric.buildActivity(MainActivity.class).setup();
        try {
            View root = save(home.get(), "warm-home.png");
            assertNull("Daily brief has its own app", root.findViewWithTag("daily_brief"));
            assertScores(root);
            assertDock(root, 360);
        } finally { home.pause().stop().destroy(); }

        ActivityController<OrganizerActivity> controller = Robolectric.buildActivity(OrganizerActivity.class).setup();
        try {
            MainActivity activity = controller.get();
            View root = save(activity, "warm-today.png");
            assertEquals("The chosen task has one Today row", 1, tagCount(root, "task_open_" + chosen));
            assertNotNull(root.findViewWithTag("task_open_" + overdue));
            assertNull(root.findViewWithTag("daily_brief"));
            assertScores(root); assertDock(root, 360);
            assertTrue(ParkingStore.find(context, thought).open());
            int taskCount = taskCount();
            click(activity, "workspace_tab_tasks");
            root = save(activity, "warm-tasks.png");
            assertNotNull(root.findViewWithTag("task_filter_All"));
            click(activity, "task_steps_toggle_" + chosen);
            save(activity, "warm-tasks-steps.png");
            click(activity, "workspace_tab_notes");
            root = save(activity, "warm-notes.png");
            assertNotNull(root.findViewWithTag("note_open_" + note));
            EditText notesSearch = root.findViewWithTag("notes_search");
            notesSearch.setText("heating");
            assertNull(root.findViewWithTag("note_open_" + note));
            assertNotNull(root.findViewWithTag("notes_results"));
            click(activity, "workspace_tab_thoughts");
            save(activity, "warm-thoughts.png");
            assertEquals(taskCount, taskCount());
            assertTrue("Looking at a thought leaves it parked", ParkingStore.find(context, thought).open());
            click(activity, "workspace_tab_tasks");
            click(activity, "task_open_" + chosen);
            save(activity, "warm-task-detail.png");
            click(activity, "task_edit");
            save(activity, "warm-task-editor.png");
            select(activity, "notes");
            click(activity, "note_open_" + note);
            root = save(activity, "warm-note-detail.png");
            assertNotNull(root.findViewWithTag("note_ask_pip"));
            invoke(activity, "openCapture", ReflectionHelpers.ClassParameter.from(String.class, "note"),
                    ReflectionHelpers.ClassParameter.from(long.class, note),
                    ReflectionHelpers.ClassParameter.from(String.class, planner.find(note).text));
            root = save(activity, "warm-note-editor.png");
            assertNotNull(root.findViewWithTag("note_format_control"));
            assertTrue(((EditText) root.findViewWithTag("capture_editor")).getText().toString().contains("Winter gym split"));
        } finally { controller.pause().stop().destroy(); }
    }

    @Test public void nativeRowsPersistActionsAndTileEditingKeepsSyncedEntries() throws Exception {
        ActivityController<OrganizerActivity> controller = Robolectric.buildActivity(OrganizerActivity.class).setup();
        try {
            MainActivity activity = controller.get();
            save(activity, "warm-today-actions.png");
            int before = taskCount();
            click(activity, "workspace_tab_thoughts");
            assertEquals(before, taskCount());
            assertTrue(ParkingStore.find(context, thought).open());
            click(activity, "thought_promote_" + thought);
            long created = ParkingStore.task(context, thought);
            assertTrue(created > 0);
            assertEquals(before + 1, taskCount());
            assertFalse(ParkingStore.find(context, thought).open());
            assertEquals("thought:" + thought, planner.find(created).source.token);
            assertEquals(note, planner.find(created).source.note);
            assertEquals(created, ParkingStore.promote(context, thought));
            select(activity, "tasks");
            assertNull("Collapsed tasks do not construct step controls", root(activity).findViewWithTag("task_inline_step_" + chosen + "_1"));
            click(activity, "task_steps_toggle_" + chosen);
            assertNotNull(root(activity).findViewWithTag("task_inline_step_" + chosen + "_1"));
            click(activity, "task_steps_toggle_" + chosen);
            assertNull("Collapse releases step controls", root(activity).findViewWithTag("task_inline_step_" + chosen + "_1"));
            click(activity, "task_steps_toggle_" + chosen);
            click(activity, "task_inline_step_" + chosen + "_1");
            assertTrue(new PlannerStore(context.getSharedPreferences("pocket_planner", 0)).find(chosen).steps.get(1).done);
            click(activity, "task_check_" + chosen);
            assertTrue(new PlannerStore(context.getSharedPreferences("pocket_planner", 0)).find(chosen).done);
            select(activity, "today");
            save(activity, "warm-today-after-actions.png");
            click(activity, "today_add_tile");
            AlertDialog add = ShadowAlertDialog.getLatestAlertDialog();
            assertNotNull(add); assertTrue(add.isShowing());
            dialogChoice(add, "gym");
            assertTrue(TodayTiles.visible(context).contains("gym"));
            assertTrue("Phone edits retain browser-only tiles", TodayTiles.kinds(context).contains("zines"));
            View root = save(activity, "warm-today-added-tile.png");
            assertNotNull(root.findViewWithTag("today_edit_tiles"));
            assertNotNull(root.findViewWithTag("today_tile_gym"));
        } finally { controller.pause().stop().destroy(); }
    }

    @Test public void scopedAppsPreserveQueryAndLargeTextKeepsControlsReachable() throws Exception {
        ActivityController<OrganizerActivity> controller = Robolectric.buildActivity(OrganizerActivity.class).setup();
        try {
            MainActivity activity = controller.get();
            click(activity, "workspace_apps");
            View root = save(activity, "warm-apps-pocket.png");
            assertNotNull(root.findViewWithTag("pocket_app_brief"));
            assertNotNull(root.findViewWithTag("pocket_app_activity"));
            assertDock(root, 360);
            EditText search = root.findViewWithTag("app_search");
            search.setText("camera"); settle(activity);
            assertNotNull(root(activity).findViewWithTag("pocket_app_camera"));
            click(activity, "app_scope_installed"); settle(activity);
            assertEquals("camera", ((EditText) root(activity).findViewWithTag("app_search")).getText().toString());
            search = root(activity).findViewWithTag("app_search"); search.setText("fire"); settle(activity);
            assertNotNull(root(activity).findViewWithTag("installed_app_fixture.warm.firefox"));
            click(activity, "app_scope_pocket"); settle(activity);
            assertEquals("fire", ((EditText) root(activity).findViewWithTag("app_search")).getText().toString());
            assertNull(root(activity).findViewWithTag("pocket_app_camera"));
            click(activity, "app_scope_installed"); settle(activity);
            ((EditText) root(activity).findViewWithTag("app_search")).setText(""); settle(activity);
            root = save(activity, "warm-apps-installed.png");
            for (String label : Arrays.asList("authenticator", "coros", "firefox", "signal", "spotify", "vlc"))
                assertNotNull(root.findViewWithTag("installed_app_fixture.warm." + label));
            assertDock(root, 360);
            controller.pause().stop().destroy();
            context.getSharedPreferences("text_phone", 0).edit().putBoolean("large_text", true).commit();
            RuntimeEnvironment.setQualifiers("w320dp-h800dp-mdpi");
            org.robolectric.shadows.ShadowDisplayManager.changeDisplay(android.view.Display.DEFAULT_DISPLAY, "w320dp-h800dp-mdpi");
            controller = Robolectric.buildActivity(OrganizerActivity.class, new Intent().putExtra("workspace_tab", "tasks")).setup();
            activity = controller.get();
            select(activity, "tasks");
            root = save(activity, 320, "warm-tasks-large-320.png");
            assertDock(root, 320);
            for (String filter : new String[]{"All", "Open", "Today", "Later", "Done"}) {
                View control = root.findViewWithTag("task_filter_" + filter);
                assertNotNull(control); assertTrue(filter + " target width", control.getWidth() >= 48);
                assertTrue(filter + " target height", control.getHeight() >= 48);
            }
        } finally {
            controller.pause().stop().destroy();
            RuntimeEnvironment.setQualifiers("w360dp-h800dp-mdpi");
            org.robolectric.shadows.ShadowDisplayManager.changeDisplay(android.view.Display.DEFAULT_DISPLAY, "w360dp-h800dp-mdpi");
        }
    }

    private void install(String pkg, String label) {
        ApplicationInfo application = new ApplicationInfo(); application.packageName = pkg; application.nonLocalizedLabel = label;
        ActivityInfo activity = new ActivityInfo(); activity.name = pkg + ".Main"; activity.packageName = pkg;
        activity.applicationInfo = application; activity.nonLocalizedLabel = label; activity.exported = true;
        PackageInfo installed = new PackageInfo(); installed.packageName = pkg; installed.applicationInfo = application;
        installed.activities = new ActivityInfo[]{activity};
        org.robolectric.shadows.ShadowPackageManager manager = Shadows.shadowOf(context.getPackageManager());
        manager.installPackage(installed);
        ResolveInfo info = new ResolveInfo(); info.activityInfo = activity; info.nonLocalizedLabel = label;
        manager.addResolveInfoForIntent(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), info);
    }

    private void assertScores(View root) {
        CorosRepository.Snapshot snapshot = CorosRepository.get(context).cached();
        assertNotNull(snapshot); assertNotNull(snapshot.scores.recovery);
        ViewGroup first = root.findViewWithTag("dashboard_movement_0");
        ViewGroup strain = root.findViewWithTag("dashboard_movement_1");
        ViewGroup condition = root.findViewWithTag("dashboard_movement_2");
        assertEquals(snapshot.scores.recovery.score + "%", ((TextView) first.getChildAt(1)).getText().toString());
        assertEquals(snapshot.scores.strain.strain + "%", ((TextView) strain.getChildAt(1)).getText().toString());
        assertEquals(String.valueOf(snapshot.scores.conditioning.score), ((TextView) condition.getChildAt(1)).getText().toString());
        assertEquals(first.getWidth(), strain.getWidth(), 1);
        assertEquals(strain.getWidth(), condition.getWidth(), 1);
    }

    private void assertDock(View root, int width) {
        View dock = root.findViewWithTag("today_actions"); assertNotNull(dock);
        int[] at = new int[2]; dock.getLocationOnScreen(at);
        assertTrue("Dock fits the viewport", at[1] + dock.getHeight() <= 800);
        for (String tag : new String[]{"workspace_today", "today_search", "workspace_capture", "today_chat", "workspace_apps"}) {
            View control = dock.findViewWithTag(tag); assertNotNull(tag, control);
            assertTrue(tag + " width", control.getWidth() >= 48);
            assertTrue(tag + " height", control.getHeight() >= 48);
            control.getLocationOnScreen(at); assertTrue(tag + " stays in viewport", at[0] >= 0 && at[0] + control.getWidth() <= width);
        }
        View pip = dock.findViewWithTag("today_chat");
        assertEquals("Pip", pip.getContentDescription().toString());
        assertFalse("The mascot has no visible text label", pip instanceof TextView);
    }

    private int taskCount() { int count = 0; for (PlannerStore.Entry entry : planner.entries()) if ("task".equals(entry.kind)) count++; return count; }
    private int tagCount(View view, String tag) {
        int count = tag.equals(view.getTag()) ? 1 : 0;
        if (view instanceof ViewGroup) { ViewGroup group = (ViewGroup) view; for (int i = 0; i < group.getChildCount(); i++) count += tagCount(group.getChildAt(i), tag); }
        return count;
    }
    private View root(Activity activity) { return activity.findViewById(android.R.id.content); }
    private void click(MainActivity activity, String tag) throws Exception {
        View control = root(activity).findViewWithTag(tag); assertNotNull("Missing " + tag, control);
        assertTrue("Click " + tag, control.performClick()); settle(activity);
    }
    private void select(MainActivity activity, String tab) throws Exception {
        invoke(activity, "selectWorkspace", ReflectionHelpers.ClassParameter.from(String.class, tab)); settle(activity);
    }
    private void invoke(MainActivity activity, String method, ReflectionHelpers.ClassParameter<?>... args) {
        ReflectionHelpers.callInstanceMethod(activity, method, args);
    }
    private void dialogChoice(AlertDialog dialog, String label) {
        for (int i = 0; i < dialog.getListView().getAdapter().getCount(); i++)
            if (label.equals(dialog.getListView().getAdapter().getItem(i).toString())) { Shadows.shadowOf(dialog).clickOnItem(i); return; }
        fail("Missing dialog choice: " + label);
    }
    private void settle(MainActivity activity) throws Exception {
        ExecutorService worker = ReflectionHelpers.getField(activity, "appWorker");
        for (int i = 0; i < 3; i++) { worker.submit(() -> {}).get(5, TimeUnit.SECONDS); Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(200)); }
        ReflectionHelpers.<PageMotion>getField(activity, "motion").settle();
    }
    private View save(MainActivity activity, String name) throws Exception { return save(activity, 360, name); }
    private View save(MainActivity activity, int width, String name) throws Exception {
        settle(activity); View root = root(activity);
        for (int i = 0; i < 2; i++) { root.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(800, View.MeasureSpec.EXACTLY)); root.layout(0, 0, width, 800); Shadows.shadowOf(Looper.getMainLooper()).idle(); }
        assertEquals("The live viewport must match the screenshot width", width, root.getWidth());
        Bitmap image = Bitmap.createBitmap(width, 800, Bitmap.Config.ARGB_8888); root.draw(new Canvas(image));
        File target = new File("build/screenshots", name); assertTrue(target.getParentFile().isDirectory() || target.getParentFile().mkdirs());
        try (FileOutputStream stream = new FileOutputStream(target)) { assertTrue(image.compress(Bitmap.CompressFormat.PNG, 100, stream)); }
        image.recycle(); return root;
    }
}
