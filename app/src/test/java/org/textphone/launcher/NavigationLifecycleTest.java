package org.textphone.launcher;

import static org.junit.Assert.*;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Looper;
import android.provider.Settings;
import android.view.View;
import android.widget.EditText;
import android.window.BackEvent;
import android.window.OnBackAnimationCallback;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
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
import org.robolectric.util.ReflectionHelpers;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {23, 35})
public class NavigationLifecycleTest {
    private final List<ActivityController<? extends Activity>> controllers = new ArrayList<>();
    @Before public void setup() {
        RuntimeEnvironment.getApplication().getSharedPreferences("text_phone", 0).edit().clear().commit();
        RuntimeEnvironment.getApplication().getSharedPreferences("pocket_clock", 0).edit().clear().commit();
        RuntimeEnvironment.getApplication().getSharedPreferences("pocket_planner", 0).edit().clear().commit();
        Settings.Global.putFloat(RuntimeEnvironment.getApplication().getContentResolver(), Settings.Global.ANIMATOR_DURATION_SCALE, 1);
    }
    @After public void cleanup() { for (ActivityController<? extends Activity> controller : controllers) controller.pause().stop().destroy(); }
    private <T extends Activity> ActivityController<T> open(Class<T> type) {
        ActivityController<T> controller = Robolectric.buildActivity(type).setup(); controllers.add(controller); return controller;
    }
    static void navigate(MainActivity activity, String page) {
        ReflectionHelpers.callInstanceMethod(activity, "navigate", ReflectionHelpers.ClassParameter.from(String.class, page));
    }
    @Test public void anEmptyPhoneLaunchKeepsHistoryWhileAnExplicitNumberOpensTheDialpad() {
        ActivityController<PhoneActivity> controller = open(PhoneActivity.class); PhoneActivity activity = controller.get();
        PocketAppsTest.find(activity.body, "history").performClick(); View history = activity.body;
        controller.pause().stop().newIntent(new Intent(activity, PhoneActivity.class)); controller.restart().start().resume();
        assertSame(history, activity.body); assertTrue(ReflectionHelpers.getField(activity, "history"));
        controller.newIntent(new Intent(activity, PhoneActivity.class).putExtra("number", "+49305550100"));
        EditText number = activity.body.findViewWithTag("phone_number"); assertEquals("+49305550100", number.getText().toString());
    }
    @Test public void resumingClockKeepsTheTimerEditorAndCaretWhenStoredEntriesDidNotChange() {
        ActivityController<ClockActivity> controller = open(ClockActivity.class); ClockActivity activity = controller.get();
        PocketAppsTest.find(activity.body, "timer").performClick(); EditText minutes = activity.body.findViewWithTag("timer_minutes"); minutes.setText("37"); minutes.setSelection(1);
        View body = activity.body; controller.pause().stop().newIntent(new Intent(activity, ClockActivity.class)); controller.restart().start().resume();
        assertSame(body, activity.body); assertSame(minutes, activity.body.findViewWithTag("timer_minutes")); assertEquals("37", minutes.getText().toString()); assertEquals(1, minutes.getSelectionStart());
    }
    @Test public void repeatedHomeIntentsUpdateStatusWithoutRebuildingTheGrid() {
        ActivityController<MainActivity> controller = open(MainActivity.class); MainActivity activity = controller.get(); View grid = ReflectionHelpers.getField(activity, "content");
        controller.newIntent(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME));
        controller.newIntent(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME));
        assertSame(grid, ReflectionHelpers.getField(activity, "content")); assertFalse(activity.isFinishing());
    }
    @Test public void nativeHomeIntentPresentsAnOpaqueDashboardImmediatelyAndKeepsDraft() {
        MainActivity activity=open(MainActivity.class).get();navigate(activity,"today");PocketAppsTest.find(activity.findViewById(android.R.id.content),"Note").performClick();
        EditText editor=activity.findViewById(android.R.id.content).findViewWithTag("capture_editor");editor.setText("Draft before Home");
        PageMotion motion=ReflectionHelpers.getField(activity,"motion");motion.host().measure(View.MeasureSpec.makeMeasureSpec(360,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(800,View.MeasureSpec.EXACTLY));motion.host().layout(0,0,360,800);
        activity.onNewIntent(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME));View dashboard=motion.host().getChildAt(0);
        assertEquals("home",ReflectionHelpers.getField(activity,"screen"));assertEquals(1f,dashboard.getAlpha(),0);assertEquals(0f,dashboard.getTranslationX(),0);assertNull(ReflectionHelpers.getField(motion,"outgoing"));
        assertEquals("Draft before Home",new PlannerStore(activity.getSharedPreferences("pocket_planner",0)).draft("note",0));
        android.content.res.TypedArray theme=activity.obtainStyledAttributes(new int[]{android.R.attr.windowIsTranslucent,android.R.attr.windowShowWallpaper});
        try {assertFalse(theme.getBoolean(0,true));assertFalse(theme.getBoolean(1,true));}finally{theme.recycle();}
    }
    @Test @Config(sdk=35) public void homeStatusReflectsAndroidRoleOnReturnFromSettings() {
        ActivityController<MainActivity> controller=open(MainActivity.class);MainActivity activity=controller.get();android.app.role.RoleManager roles=activity.getSystemService(android.app.role.RoleManager.class);
        org.robolectric.shadows.ShadowRoleManager system=Shadows.shadowOf(roles);system.addAvailableRole(android.app.role.RoleManager.ROLE_HOME);navigate(activity,"settings");
        android.widget.TextView state=activity.findViewById(android.R.id.content).findViewWithTag("home_default_status");assertEquals("Choose Pocket",state.getText().toString());
        controller.pause();system.addHeldRole(android.app.role.RoleManager.ROLE_HOME);controller.resume();assertSame(state,activity.findViewById(android.R.id.content).findViewWithTag("home_default_status"));assertEquals("Active",state.getText().toString());
        system.removeHeldRole(android.app.role.RoleManager.ROLE_HOME);assertFalse(HomeChoice.active(activity));
    }
    @Test public void recreatingForAHomeIntentShowsHomeInsteadOfTheLastInternalPage() {
        ActivityController<MainActivity> first=Robolectric.buildActivity(MainActivity.class).setup();MainActivity activity=first.get();navigate(activity,"today");
        PocketAppsTest.find(activity.findViewById(android.R.id.content),"Note").performClick();((EditText)activity.findViewById(android.R.id.content).findViewWithTag("capture_editor")).setText("Survives recreation");
        android.os.Bundle state=new android.os.Bundle();first.pause().saveInstanceState(state).stop().destroy();
        ActivityController<MainActivity> restored=Robolectric.buildActivity(MainActivity.class,new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)).create(state).start().resume().visible();controllers.add(restored);
        assertEquals("home",ReflectionHelpers.getField(restored.get(),"screen"));assertNull(restored.get().findViewById(android.R.id.content).findViewWithTag("capture_editor"));
        assertEquals("Survives recreation",new PlannerStore(restored.get().getSharedPreferences("pocket_planner",0)).draft("note",0));
    }
    @Test public void organizerTaskKeepsItsEditorAcrossHomeAndReopeningAndReleasesRootBackToAndroid() {
        ActivityController<OrganizerActivity> controller = open(OrganizerActivity.class); OrganizerActivity activity = controller.get();
        NativeNavigation navigation = ReflectionHelpers.getField(activity, "navigation"); assertNull(ReflectionHelpers.getField(navigation, "callback"));
        PocketAppsTest.find(activity.findViewById(android.R.id.content), "Note").performClick(); EditText editor = activity.findViewById(android.R.id.content).findViewWithTag("capture_editor");
        editor.setText("# Independent task"); editor.setSelection(7); controller.pause().stop().newIntent(new Intent(activity, OrganizerActivity.class)); controller.restart().start().resume();
        assertSame(editor, activity.findViewById(android.R.id.content).findViewWithTag("capture_editor")); assertEquals(7, editor.getSelectionStart());
        controller.pause().stop(); new PlannerStore(activity.getSharedPreferences("pocket_planner", 0)).draft("note", 0, "# Updated in another Pocket editor");
        controller.restart().start().resume(); assertEquals("# Updated in another Pocket editor", editor.getText().toString());
        activity.onBackPressed(); assertEquals("today", ReflectionHelpers.getField(activity, "screen")); assertNull(ReflectionHelpers.getField(navigation, "callback"));
    }
    @Test public void reopeningFilesKeepsTheOpenPhotoViewInsteadOfResettingTheAlbum() throws Exception {
        ActivityController<FilesActivity> controller = open(FilesActivity.class); FilesActivity activity = controller.get(); CameraAlbumTest.settle(activity);
        controller.newIntent(new Intent(activity, FilesActivity.class).setData(Uri.parse("content://media/external/images/media/999"))); CameraAlbumTest.settle(activity);
        View photo = activity.body; controller.pause().stop().newIntent(new Intent(activity, FilesActivity.class)); controller.restart().start().resume(); CameraAlbumTest.settle(activity);
        assertSame(photo, activity.body); assertTrue(ReflectionHelpers.getField(activity, "viewing"));
    }
    @Test public void launchUsesAndroidOptionsAndReusesOwnTasksWithoutClearingTheirStack() {
        Activity activity = open(Activity.class).get(); View source = new View(activity); activity.setContentView(source);
        source.measure(View.MeasureSpec.makeMeasureSpec(360, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(640, View.MeasureSpec.EXACTLY)); source.layout(0, 0, 360, 640);
        Intent request = new Intent(activity, CalculatorActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("seed", "kept"); PocketLaunch.open(activity, request, source);
        org.robolectric.shadows.ShadowActivity.IntentForResult launch = Shadows.shadowOf(activity).getNextStartedActivityForResult();
        assertTrue((launch.intent.getFlags() & Intent.FLAG_ACTIVITY_SINGLE_TOP) != 0); assertEquals(0, launch.intent.getFlags() & (Intent.FLAG_ACTIVITY_CLEAR_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_MULTIPLE_TASK));
        assertEquals("kept", launch.intent.getStringExtra("seed")); assertNotNull(launch.options);
        activity.getSharedPreferences("text_phone", 0).edit().putBoolean("reduce_motion", true).commit(); PocketLaunch.open(activity, request, source);
        assertNull(Shadows.shadowOf(activity).getNextStartedActivityForResult().options);
    }
    @Test @Config(sdk = 35) public void nativeBackCallbackCancelsWithoutLosingNoteTextThenCommitsToToday() {
        MainActivity activity = open(MainActivity.class).get(); navigate(activity, "today");
        android.widget.TextView note = PocketAppsTest.find(activity.findViewById(android.R.id.content), "Note"); assertNotNull(note); note.performClick();
        EditText editor = activity.findViewById(android.R.id.content).findViewWithTag("capture_editor"); assertNotNull(editor); editor.setText("# Keep me\n- next"); editor.setSelection(4);
        NativeNavigation navigation = ReflectionHelpers.getField(activity, "navigation"); OnBackAnimationCallback callback = ReflectionHelpers.getField(navigation, "callback");
        callback.onBackStarted(new BackEvent(0, 0, 0, BackEvent.EDGE_LEFT)); callback.onBackProgressed(new BackEvent(0, 0, .6f, BackEvent.EDGE_LEFT)); callback.onBackCancelled();
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(400));
        assertSame(editor, activity.findViewById(android.R.id.content).findViewWithTag("capture_editor")); assertEquals("# Keep me\n- next", editor.getText().toString()); assertEquals(4, editor.getSelectionStart());
        callback.onBackStarted(new BackEvent(0, 0, 0, BackEvent.EDGE_RIGHT)); callback.onBackProgressed(new BackEvent(0, 0, .8f, BackEvent.EDGE_RIGHT)); callback.onBackInvoked();
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(400)); assertEquals("today", ReflectionHelpers.getField(activity, "screen"));
        assertEquals("# Keep me\n- next", new PlannerStore(activity.getSharedPreferences("pocket_planner", 0)).draft("note", 0));
    }
}
