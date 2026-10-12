package org.textphone.launcher;

import static org.junit.Assert.*;
import android.content.Intent;
import android.os.Looper;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;
import android.widget.TextView;
import java.time.Duration;
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
import org.robolectric.shadows.ShadowLooper;

/** Live tiles with motion on: the press tilt and the rolling reading. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, qualifiers = "w360dp-h800dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class TileMotionTest {
    @Before public void clear() {
        for (String name : new String[]{"text_phone", "pocket_planner", "pocket_workspace_extras"})
            RuntimeEnvironment.getApplication().getSharedPreferences(name, 0).edit().clear().commit();
    }

    @Test public void aPressedTileLeansAwayFromTheFingerAndSettlesBack() {
        ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class, new Intent().putExtra("pocket_screen", "today")).setup().visible();
        try {
            ShadowLooper main = Shadows.shadowOf(Looper.getMainLooper()); main.idleFor(Duration.ofMillis(500));
            View tile = controller.get().findViewById(android.R.id.content).findViewWithTag("today_tile_tasks");
            assertTrue(tile.getWidth() > 0);
            long now = SystemClock.uptimeMillis();
            tile.dispatchTouchEvent(MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, tile.getWidth() * .9f, tile.getHeight() / 2f, 0));
            main.idleFor(Duration.ofMillis(400));
            assertTrue("A pressed tile dips", tile.getScaleX() < 1f);
            float[] corners = {tile.getWidth(), 0, tile.getWidth(), tile.getHeight(), 0, 0, 0, tile.getHeight()};
            tile.getMatrix().mapPoints(corners);
            assertTrue("The pressed edge leans away, so it looks shorter", corners[3] - corners[1] < corners[7] - corners[5]);
            tile.dispatchTouchEvent(MotionEvent.obtain(now, now + 50, MotionEvent.ACTION_CANCEL, tile.getWidth() * .9f, tile.getHeight() / 2f, 0));
            main.idleFor(Duration.ofMillis(400));
            assertEquals(1f, tile.getScaleX(), .001f); assertEquals(0f, tile.getRotationY(), .001f);

            // A new task rolls the headline count in and leaves it at rest.
            TextView value = controller.get().findViewById(android.R.id.content).findViewWithTag("live_value_tasks");
            int before = Integer.parseInt(value.getText().toString());
            new PlannerStore(RuntimeEnvironment.getApplication().getSharedPreferences("pocket_planner", 0)).saveTask(0, "Water the plants", PlannerDates.today(), false, "");
            main.idleFor(Duration.ofMillis(800));
            assertEquals(String.valueOf(before + 1), value.getText().toString());
            assertEquals(1f, value.getAlpha(), .001f); assertEquals(0f, value.getTranslationY(), .001f);
        } finally { controller.pause().stop().destroy(); }
    }
}
