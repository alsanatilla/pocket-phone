package org.textphone.launcher;

import static org.junit.Assert.*;
import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.os.Bundle;
import android.os.Looper;
import android.provider.Settings;
import android.view.View;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import java.time.Duration;
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

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {23, 35})
public class PageMotionTest {
    private ActivityController<Activity> controller; private Activity activity; private PageMotion motion;
    @Before public void setup() {
        RuntimeEnvironment.getApplication().getSharedPreferences("text_phone", 0).edit().clear().commit();
        controller = Robolectric.buildActivity(Activity.class).setup(); activity = controller.get();
        Settings.Global.putFloat(activity.getContentResolver(), Settings.Global.ANIMATOR_DURATION_SCALE, 1);
        motion = new PageMotion(activity); activity.setContentView(motion.host());
    }
    @After public void cleanup() { motion.destroy(); controller.pause().stop().destroy(); }
    private ScrollView page(int height) {
        ScrollView viewport = new ScrollView(activity); LinearLayout body = new LinearLayout(activity); body.setOrientation(LinearLayout.VERTICAL);
        View content = new View(activity); body.addView(content, new LinearLayout.LayoutParams(-1, height)); viewport.addView(body); return viewport;
    }
    private void layout() {
        motion.host().measure(View.MeasureSpec.makeMeasureSpec(360, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(640, View.MeasureSpec.EXACTLY));
        motion.host().layout(0, 0, 360, 640); motion.host().getViewTreeObserver().dispatchOnGlobalLayout();
    }
    private void finish() { Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(400)); motion.settle(); }
    @Test public void cancelledBackKeepsTheEditorAndItsSelectionAndWorksFromBothEdges() {
        ScrollView parent = page(2400); motion.show(parent, "list"); layout(); parent.scrollTo(0, 480);
        LinearLayout detail = new LinearLayout(activity); EditText editor = new EditText(activity); editor.setText("Keep this draft"); editor.setSelection(5, 9); detail.addView(editor);
        motion.show(detail, "editor"); layout(); motion.startBack("list", true); motion.progressBack(.7f);
        assertNotNull(parent.getParent()); assertTrue(detail.getTranslationX() > 0); assertEquals(2, motion.host().getChildCount());
        motion.cancelBack(); finish(); assertSame(detail, motion.host().getChildAt(0));
        assertEquals(0, detail.getTranslationX(), .01f); assertEquals(1, detail.getScaleX(), .01f); assertEquals("Keep this draft", editor.getText().toString()); assertEquals(5, editor.getSelectionStart());
        motion.startBack("list", false); motion.progressBack(.7f); assertTrue(detail.getTranslationX() < 0); motion.cancelBack(); finish();
        assertEquals(1, motion.host().getChildCount()); assertEquals(480, parent.getScrollY());
    }
    @Test public void committedBackRebuildsOnlyTheDestinationAndRestoresTheListPosition() {
        ScrollView list = page(2400); motion.show(list, "list"); layout(); list.scrollTo(0, 480);
        ScrollView child = page(1000); motion.show(child, "child"); layout(); motion.startBack("list", true); motion.progressBack(.8f);
        ScrollView restored = page(2400); motion.back(() -> motion.show(restored, "list")); motion.dataReady(); layout(); finish();
        assertSame(restored, motion.host().getChildAt(0)); assertEquals(480, restored.getScrollY()); assertEquals(1, motion.host().getChildCount());
        assertEquals(0, restored.getTranslationX(), .01f); assertEquals(1, restored.getAlpha(), .01f);
    }
    @Test public void backAnimationEndsAtFullWindowSizeWithoutManualSettling() {
        motion.show(page(2400), "list"); layout(); View child=page(1000); motion.show(child,"child"); layout();
        motion.startBack("list",true); motion.progressBack(.7f); assertTrue(child.getScaleX()<1); assertEquals(1,child.getAlpha(),0);
        motion.cancelBack(); Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(400));
        assertEquals(1,motion.host().getChildCount()); assertEquals(1,child.getScaleX(),.001f); assertEquals(1,child.getScaleY(),.001f); assertEquals(0,child.getTranslationX(),.01f);
        assertTrue(motion.host().getWidth()>0); assertTrue(motion.host().getHeight()>0);
        assertEquals(motion.host().getWidth(),child.getWidth()); assertEquals(motion.host().getHeight(),child.getHeight());
        motion.startBack("list",false); motion.progressBack(.8f); View restored=page(2400); motion.back(()->motion.show(restored,"list")); layout();
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(400));
        assertEquals(1,motion.host().getChildCount()); assertSame(restored,motion.host().getChildAt(0));
        assertEquals(motion.host().getWidth(),restored.getWidth()); assertEquals(motion.host().getHeight(),restored.getHeight()); assertEquals(1,restored.getScaleX(),.001f); assertEquals(1,restored.getScaleY(),.001f); assertEquals(0,restored.getTranslationX(),.01f);
    }
    @Test public void scrollRestorationWaitsForAsyncContentInsteadOfClampingToTheLoadingRow() {
        ScrollView list = page(2400); motion.show(list, "list"); layout(); list.scrollTo(0, 900);
        motion.show(page(1000), "child"); layout();
        ScrollView loading = page(20); motion.back(() -> motion.show(loading, "list")); layout(); assertEquals(0, loading.getScrollY());
        View loaded = ((LinearLayout) loading.getChildAt(0)).getChildAt(0); loaded.getLayoutParams().height = 2400; loaded.requestLayout(); motion.dataReady(); layout();
        assertEquals(900, loading.getScrollY());
    }
    @Test public void rapidNavigationAndGestureInterruptionLeaveOneCleanActivePage() {
        motion.show(page(2400), "list"); layout(); View first = page(1000); motion.show(first, "first"); layout();
        motion.startBack("list", true); motion.progressBack(.6f); motion.cancelBack();
        View second = page(1200); motion.show(second, "second"); layout(); finish();
        assertEquals(1, motion.host().getChildCount()); assertSame(second, motion.host().getChildAt(0));
        assertEquals(0, second.getTranslationX(), .01f); assertEquals(1, second.getAlpha(), .01f); assertEquals(1, second.getScaleX(), .01f);
    }
    @Test public void androidAndPocketReducedMotionDisablePageAndGestureAnimation() {
        motion.show(page(2400), "list"); layout(); Settings.Global.putFloat(activity.getContentResolver(), Settings.Global.ANIMATOR_DURATION_SCALE, 0);
        View child = page(1000); motion.show(child, "child"); layout(); motion.startBack("list", true); motion.progressBack(.8f);
        assertFalse(PageMotion.enabled(activity)); assertEquals(0, child.getTranslationX(), 0); assertEquals(1, motion.host().getChildCount());
        Settings.Global.putFloat(activity.getContentResolver(), Settings.Global.ANIMATOR_DURATION_SCALE, 1);
        activity.getSharedPreferences("text_phone", 0).edit().putBoolean("reduce_motion", true).commit(); assertFalse(PageMotion.enabled(activity));
    }
    @Test public void savedPositionsSurviveControllerRecreationWithoutSerializingAnyViews() {
        ScrollView list = page(2400); motion.show(list, "list"); layout(); list.scrollTo(0, 700);
        Bundle positions = new Bundle(); motion.save(positions::putInt); motion.destroy(); motion = new PageMotion(activity); motion.restore(positions); activity.setContentView(motion.host());
        ScrollView restored = page(2400); motion.show(restored, "list"); motion.dataReady(); layout(); assertEquals(700, restored.getScrollY()); assertEquals(1, positions.size());
    }
    @Test @Config(sdk = 35) @GraphicsMode(GraphicsMode.Mode.NATIVE)
    public void discardedPhotoHistoryCannotDrawARecycledBitmap() {
        Bitmap bitmap = Bitmap.createBitmap(20, 10, Bitmap.Config.ARGB_8888); ImageView photo = new ImageView(activity); photo.setImageBitmap(bitmap);
        motion.show(photo, "photo"); layout(); motion.show(page(1200), "album"); layout(); motion.discardHistory(); bitmap.recycle();
        Bitmap frame = Bitmap.createBitmap(360, 640, Bitmap.Config.ARGB_8888); motion.host().draw(new Canvas(frame)); frame.recycle();
        assertNull(photo.getParent()); assertEquals(1, motion.host().getChildCount());
    }
}
