package org.textphone.launcher;

import static org.junit.Assert.*;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.os.Looper;
import android.view.View;
import android.widget.TextView;
import java.io.File;
import java.io.FileOutputStream;
import java.time.LocalDate;
import java.util.List;
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
import org.robolectric.util.ReflectionHelpers;

/** 0.5.21 design-system renders from explicit local fixtures; never a physical phone recording. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, qualifiers = "w360dp-h800dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class RedesignPreviewTest {
    private Context c; private PlannerStore planner;

    @Before public void clear() {
        c = RuntimeEnvironment.getApplication();
        for (String name : new String[]{"text_phone", "pocket_planner", "pocket_agenda", "pocket_parking", "pocket_movement", "pocket_coros_auth", "pocket_camera"})
            c.getSharedPreferences(name, 0).edit().clear().commit();
        ClockStore.prefs(c).edit().clear().commit();
        c.getSharedPreferences("text_phone", 0).edit().putBoolean("reduce_motion", true).putBoolean("twenty_four_hour", true).commit();
        planner = new PlannerStore(c.getSharedPreferences("pocket_planner", 0));
    }

    private void seedDay() throws Exception {
        long call = planner.saveTask(0, "Call the insurance", PlannerDates.today(), true, "");
        planner.saveTask(0, "Send the invoice", "", false, "- [x] Find the PDF\n- [ ] Attach and send");
        planner.saveTask(0, "Book the train to Hamburg", "", false, "");
        planner.makeNext(call);
        planner.save(0, "note", "# Groceries\nMilk, coffee and bread");
        planner.save(0, "note", "Weekend plan\nTrain at 09:30, bring the charger");
        for (int i = 0; i < 2; i++) { AgendaStore.Event e = new AgendaStore.Event(); e.title = i == 0 ? "Planning session" : "Pick up the parcel"; e.when = System.currentTimeMillis() + (i + 1) * 3600000L; e.minutes = 45; AgendaStore.save(c, e); }
    }
    private void seedMovement() throws Exception {
        String today = LocalDate.now().toString(); StringBuilder rest = new StringBuilder();
        for (int i = 0; i < 10; i++) rest.append(LocalDate.now().minusDays(i)).append(": 55 bpm\n");
        JSONObject raw = new JSONObject().put("updated", System.currentTimeMillis()).put("activities", "").put("resting", rest.toString())
                .put("hrv", today + ":\nHRV Avg: 60 ms\nNormal Range: 50 - 70\nBaseline: 60\n")
                .put("daily", today + ":\nSteps: 2400\nTotal: 7h 30min | Deep: 1h | Awake: 10min\n").put("profile", "Age: 40\nGender: Male");
        c.getSharedPreferences("pocket_coros_auth", 0).edit().putString("tokens", "fixture-presence").commit();
        c.getSharedPreferences("pocket_movement", 0).edit().putString("snapshot", raw.toString()).commit();
    }

    @Test public void homeAndTodayShareOneSystem() throws Exception {
        if (!c.getResources().getBoolean(R.bool.pocket_rom)) return;
        seedDay(); seedMovement();
        ParkingStore.park(c, "Ask about the van seats", System.currentTimeMillis() + 86_400_000L);
        ActivityController<MainActivity> home = Robolectric.buildActivity(MainActivity.class).setup();
        try {
            MainActivity a = home.get(); View root = save(a, 800, "pocket-21-home.png");
            // Health readings, quick actions and tiles share column centres.
            View reading = root.findViewWithTag("dashboard_movement_1"), quick = root.findViewWithTag("dashboard_quick_1"), tile = root.findViewWithTag("tile_messages");
            assertEquals(centre(reading), centre(quick), 2); assertEquals(centre(quick), centre(tile), 2);
            assertEquals(1,ParkingStore.open(c).size());
            ReflectionHelpers.callInstanceMethod(a, "navigate", ReflectionHelpers.ClassParameter.from(String.class, "tools")); save(a, 800, "pocket-21-tools.png");
            ReflectionHelpers.callInstanceMethod(a, "navigate", ReflectionHelpers.ClassParameter.from(String.class, "settings")); save(a, 800, "pocket-21-settings.png");
        } finally { home.pause().stop().destroy(); }
        ActivityController<MainActivity> today = Robolectric.buildActivity(MainActivity.class, new Intent().putExtra("pocket_screen", "today")).setup();
        try {
            MainActivity a = today.get(); View root = save(a, 800, "pocket-21-today.png");
            List<PlannerStore.Entry> entries = planner.entries(); long invoice = 0;
            for (PlannerStore.Entry e : entries) if (e.text.equals("Send the invoice")) invoice = e.id;
            root.findViewWithTag("workspace_tab_tasks").performClick();a.findViewById(android.R.id.content).findViewWithTag("task_open_" + invoice).performClick(); save(a, 800, "pocket-21-task.png");
            assertNotNull(PocketAppsTest.find(a.findViewById(android.R.id.content), "complete task"));
        } finally { today.pause().stop().destroy(); }
    }

    @Test public void chatReadsLikeAPocketPage() throws Exception {
        if (!c.getResources().getBoolean(R.bool.pocket_rom)) return;
        ClaudeChatRepository repository = ClaudeChatRepository.get(c);
        List<ClaudeChatRepository.Turn> turns = ReflectionHelpers.getField(ReflectionHelpers.getField(repository, "chat"), "turns");
        turns.clear();
        ActivityController<MainActivity> home = Robolectric.buildActivity(MainActivity.class).setup();
        try {
            MainActivity a = home.get(); ClaudeSidebar chat = ReflectionHelpers.getField(a, "claude");
            chat.open(); save(a, 800, "pocket-21-chat-empty.png");
            turns.add(new ClaudeChatRepository.Turn("1", "user", "How did I sleep this week?", "complete"));
            turns.add(new ClaudeChatRepository.Turn("2", "assistant", "You averaged **7 h 12 min**, a little above your usual.\n\n- Deepest: Tuesday, 1 h 40 min\n- Shortest: Friday, 6 h 05 min\n\nRecovery is at 65%, so a normal training day fits.", "complete"));
            turns.add(new ClaudeChatRepository.Turn("3", "user", "Plan a short run for tomorrow", "complete"));
            turns.add(new ClaudeChatRepository.Turn("4", "assistant", "An easy 30 minutes at conversational pace.", "stopped"));
            chat.close(); chat.open(); save(a, 800, "pocket-21-chat.png");
            View panel = a.findViewById(android.R.id.content).findViewWithTag("claude_sidebar");
            assertEquals(360, panel.getWidth());
        } finally { turns.clear(); home.pause().stop().destroy(); }
    }

    @Test public void appsUseTheSameChrome() throws Exception {
        ClockStore.Entry alarm = new ClockStore.Entry(); alarm.kind = "alarm"; alarm.title = "Train day"; alarm.hour = 7; alarm.minute = 30; alarm.enabled = true; alarm.daily = true;
        alarm.due = ClockStore.nextTime(7, 30, System.currentTimeMillis()); ClockStore.save(c, alarm);
        ActivityController<ClockActivity> clock = Robolectric.buildActivity(ClockActivity.class).setup();
        try { save(clock.get(), 800, "pocket-21-clock.png"); } finally { clock.pause().stop().destroy(); }
        seedDay();
        ActivityController<AgendaActivity> agenda = Robolectric.buildActivity(AgendaActivity.class).setup();
        try { save(agenda.get(), 800, "pocket-21-agenda.png"); } finally { agenda.pause().stop().destroy(); }
        ActivityController<ChatsActivity> messages = Robolectric.buildActivity(ChatsActivity.class).setup();
        try { save(messages.get(), 800, "pocket-21-messages.png"); } finally { messages.pause().stop().destroy(); }
        c.getSharedPreferences("pocket_camera", 0).edit().putString("aspect", "WIDE").commit();
        ActivityController<CompactCameraActivity> camera = Robolectric.buildActivity(CompactCameraActivity.class).setup();
        try {
            View root = save(camera.get(), 800, "pocket-21-camera.png");
            assertEquals("16:9", ((TextView) root.findViewWithTag("camera_aspect")).getText().toString());
            // The saved 16:9 photo is the 4:3 frame without its sides, so the viewfinder masks exactly those.
            View preview = root.findViewWithTag("camera_preview"); Bitmap frame = Bitmap.createBitmap(360, 800, Bitmap.Config.ARGB_8888); root.draw(new Canvas(frame));
            int[] at = new int[2]; preview.getLocationInWindow(at); int middle = at[1] + 24;
            assertEquals(0xFF000000, frame.getPixel(at[0] + 4, middle)); assertNotEquals(0xFF000000, frame.getPixel(at[0] + preview.getWidth() / 2, middle)); frame.recycle();
        } finally { camera.pause().stop().destroy(); }
    }

    @Test public void cameraFormatsCropAndLabelLikeTheOldMenus() {
        assertEquals(new android.util.Size(2048, 1152), CameraMath.outputSize(4000, 3000, CameraProfile.CYBER, CameraFormat.DEFAULT.aspect(CameraFormat.Aspect.WIDE), 0));
        assertEquals(new android.util.Size(1536, 1536), CameraMath.outputSize(4000, 3000, CameraProfile.CYBER, CameraFormat.DEFAULT.aspect(CameraFormat.Aspect.SQUARE), 0));
        assertEquals(new android.util.Size(480, 640), CameraMath.outputSize(4000, 3000, CameraProfile.FINE, CameraFormat.DEFAULT.size(640), 90));
        assertEquals("VGA", CameraFormat.megapixels(640, 480));
        assertEquals("3M", CameraFormat.megapixels(2048, 1536));
        assertArrayEquals(new int[]{2848, 2048, 1600, 1280, 640}, CameraFormat.sizes(CameraProfile.FINE));
        assertEquals(60, CameraFormat.Quality.BASIC.jpeg(CameraProfile.CYBER));
    }

    @Test public void parkedThoughtsBecomeTasksOnceAcrossCopies() {
        ParkingStore.Item item = ParkingStore.park(c, "Call Sam", System.currentTimeMillis() + 2 * 86_400_000L);
        assertEquals(0, ParkingStore.absorb(c));assertTrue(planner.entries().isEmpty());long id=ParkingStore.promote(c,item.id);assertEquals(id,ParkingStore.promote(c,item.id));
        PlannerStore.Entry task = planner.entries().get(0);
        assertEquals("Call Sam", task.text); assertTrue(task.due.isEmpty()); assertEquals(ParkingStore.TASK, ParkingStore.find(c, item.id).state);
        // The same thought arriving open again (for example from an older synced copy) finds its task instead of adding one.
        ParkingStore.parkFromNote(c, item.id, "Call Sam", System.currentTimeMillis(), "");
        ParkingStore.promote(c,item.id);
        assertEquals(1, planner.entries().size());
    }

    private static float centre(View view) { int[] xy = new int[2]; view.getLocationOnScreen(xy); return xy[0] + view.getWidth() / 2f; }
    private View save(Activity a, int height, String name) throws Exception {
        try { PageMotion motion = ReflectionHelpers.getField(a, "motion"); motion.settle(); } catch (RuntimeException none) { /* Camera has no page motion. */ }
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        View root = a.findViewById(android.R.id.content);
        // Twice: views that size themselves after layout (the camera's crop guide) settle on the second pass.
        for (int pass = 0; pass < 2; pass++) {
            root.measure(View.MeasureSpec.makeMeasureSpec(360, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY));
            root.layout(0, 0, 360, height); Shadows.shadowOf(Looper.getMainLooper()).idle();
        }
        Bitmap bitmap = Bitmap.createBitmap(360, height, Bitmap.Config.ARGB_8888); root.draw(new Canvas(bitmap));
        File target = new File("build/screenshots", name); assertTrue(target.getParentFile().isDirectory() || target.getParentFile().mkdirs());
        try (FileOutputStream out = new FileOutputStream(target)) { assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)); }
        bitmap.recycle(); return root;
    }
}
