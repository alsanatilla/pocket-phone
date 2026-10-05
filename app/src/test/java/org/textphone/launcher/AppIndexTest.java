package org.textphone.launcher;

import static org.junit.Assert.*;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Looper;
import android.widget.EditText;
import android.widget.LinearLayout;
import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
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
import org.robolectric.annotation.Implements;
import org.robolectric.annotation.Implementation;
import org.robolectric.annotation.RealObject;
import org.robolectric.util.ReflectionHelpers;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {24, 35}, shadows = AppIndexTest.LabelShadow.class)
public class AppIndexTest {
    private static AppIndexTest active;
    private MainActivity activity; private ActivityController<MainActivity> controller;
    private final AtomicInteger reads = new AtomicInteger(); private final AtomicBoolean uiRead = new AtomicBoolean();
    private final CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1); private volatile boolean blocked;
    @Before public void setup() {
        active = this;
        RuntimeEnvironment.getApplication().getSharedPreferences("text_phone", 0).edit().clear().commit();
        controller = Robolectric.buildActivity(MainActivity.class).setup(); activity = controller.get();
        add("Calculator", 0); add("Calendar", 1); for (int i = 2; i < 98; i++) add("App " + i, i);
    }
    private void add(String label, int id) {
        ResolveInfo info = new ResolveInfo(); info.nonLocalizedLabel = label;
        info.activityInfo = new ActivityInfo(); info.activityInfo.name = "Main"; info.activityInfo.packageName = "fixture.app" + id;
        info.activityInfo.applicationInfo = new ApplicationInfo(); info.activityInfo.applicationInfo.packageName = info.activityInfo.packageName;
        Shadows.shadowOf(activity.getPackageManager()).addResolveInfoForIntent(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), info);
    }
    @After public void cleanup() throws Exception { release.countDown(); settle(activity); controller.pause().stop().destroy(); active = null; }
    @Implements(ResolveInfo.class) public static class LabelShadow {
        @RealObject private ResolveInfo info;
        @Implementation protected CharSequence loadLabel(PackageManager manager) {
            AppIndexTest test = active;
            if (test != null) {
                test.reads.incrementAndGet(); test.uiRead.compareAndSet(false, Looper.myLooper() == Looper.getMainLooper()); test.entered.countDown();
                if (test.blocked) try { if (!test.release.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Fixture label timeout"); } catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            }
            return info.nonLocalizedLabel == null ? info.activityInfo.name : info.nonLocalizedLabel;
        }
    }
    static void settle(MainActivity activity) throws Exception {
        ExecutorService worker = ReflectionHelpers.getField(activity, "appWorker");
        for (int i = 0; i < 3; i++) { worker.submit(() -> { }).get(5, TimeUnit.SECONDS); Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(600)); }
    }
    @Test public void labelsLoadOffTheUiThreadOnlyOnceAndTypingUsesTheCachedIndex() throws Exception {
        NavigationLifecycleTest.navigate(activity, "apps"); settle(activity);
        LinearLayout results = activity.findViewById(android.R.id.content).findViewWithTag("app_results"); assertEquals(98, results.getChildCount()); assertFalse(uiRead.get()); assertEquals(98, reads.get());
        EditText search = activity.findViewById(android.R.id.content).findViewWithTag("app_search"); search.setText("2252"); settle(activity);
        assertEquals(1, results.getChildCount()); assertNotNull(PocketAppsTest.find(results, "Calculator")); assertNull(PocketAppsTest.find(results, "Calendar"));
        search.setText("2253"); settle(activity); assertNotNull(PocketAppsTest.find(results, "Calendar")); assertEquals(98, reads.get());
    }
    @Test public void backingOutDuringALabelReadKeepsHomeResponsiveAndDoesNotWriteOldRowsIntoIt() throws Exception {
        blocked = true; NavigationLifecycleTest.navigate(activity, "apps"); assertTrue(entered.await(10, TimeUnit.SECONDS));
        assertNotNull(CameraAlbumTest.findContaining(activity.findViewById(android.R.id.content), "Loading apps")); activity.onBackPressed();
        assertEquals("home", ReflectionHelpers.getField(activity, "screen")); release.countDown(); settle(activity);
        assertNull(activity.findViewById(android.R.id.content).findViewWithTag("app_results"));
        NavigationLifecycleTest.navigate(activity, "apps"); settle(activity); assertEquals(98, ((LinearLayout) activity.findViewById(android.R.id.content).findViewWithTag("app_results")).getChildCount());
    }
}
