package org.textphone.launcher;

import static org.junit.Assert.*;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.drawable.Drawable;
import android.os.Looper;
import android.view.View;
import android.view.WindowInsets;
import java.time.Duration;
import java.util.Arrays;
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
@Config(sdk = {30, 35})
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class EdgeBoardLayoutTest {
    @Before public void start() {
        RuntimeEnvironment.getApplication().getSharedPreferences("text_phone", 0).edit()
                .clear().putBoolean("reduce_motion", true).commit();
        RuntimeEnvironment.getApplication().getSharedPreferences("pocket_workspace_extras", 0).edit().clear().commit();
        TodayTiles.saveVisible(RuntimeEnvironment.getApplication(), Arrays.asList("agenda", "tasks", "thoughts"));
    }

    @Test public void homeArtworkAndTilesReachTheEdgesWhileControlsAvoidTheCutout() {
        verify(MainActivity.class, "home_workspace", "home_hero");
    }

    @Test public void todayArtworkAndTilesReachTheEdgesWhileControlsAvoidTheCutout() {
        verify(OrganizerActivity.class, "today_workspace", "page_header");
    }

    private <T extends MainActivity> void verify(Class<T> type, String pageTag, String headerTag) {
        ActivityController<T> controller = Robolectric.buildActivity(type).setup();
        T activity = controller.get();
        try {
            Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100));
            ReflectionHelpers.<PageMotion>getField(activity, "motion").settle();
            View root = activity.findViewById(android.R.id.content);
            View page = root.findViewWithTag(pageTag);
            assertNotNull(page);
            page.dispatchApplyWindowInsets(new WindowInsets.Builder()
                    .setInsets(WindowInsets.Type.displayCutout(), Insets.of(11, 28, 7, 0)).build());
            for (int i = 0; i < 2; i++) {
                root.measure(View.MeasureSpec.makeMeasureSpec(360, View.MeasureSpec.EXACTLY),
                        View.MeasureSpec.makeMeasureSpec(800, View.MeasureSpec.EXACTLY));
                root.layout(0, 0, 360, 800);
            }
            assertEquals(0, page.getPaddingLeft());
            assertEquals(0, page.getPaddingTop());
            assertEquals(0, page.getPaddingRight());
            assertEquals(0, page.getPaddingBottom());
            assertTrue(page.getBackground() instanceof PixelBackdrop);
            View header = page.findViewWithTag(headerTag);
            assertEquals(PocketDesign.dp(activity, PocketDesign.INSET) + 11, header.getPaddingLeft());
            assertEquals(PocketDesign.dp(activity, 4) + 28, header.getPaddingTop());
            View tile = page.findViewWithTag("today_tile_agenda");
            assertNotNull(tile);
            int[] outer = new int[2], card = new int[2];
            page.getLocationOnScreen(outer); tile.getLocationOnScreen(card);
            assertEquals(outer[0], card[0]);
            assertEquals(page.getWidth(), tile.getWidth());
            View tasks = page.findViewWithTag("today_tile_tasks");
            View thoughts = page.findViewWithTag("today_tile_thoughts");
            int[] first = new int[2], second = new int[2];
            tasks.getLocationOnScreen(first); thoughts.getLocationOnScreen(second);
            assertEquals(PocketDesign.dp(activity, 8), second[0] - first[0] - tasks.getWidth());
        } finally { controller.pause().stop().destroy(); }
    }

    @Test public void notificationCounterKeepsItsTouchTargetWithoutAnOpaqueBlackBlock() {
        ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class).setup();
        try {
            View button = controller.get().findViewById(android.R.id.content).findViewWithTag("home_notifications");
            assertNotNull(button);
            assertTrue(button.isClickable());
            ReflectionHelpers.<PageMotion>getField(controller.get(), "motion").settle();
            View root = controller.get().findViewById(android.R.id.content);
            root.measure(View.MeasureSpec.makeMeasureSpec(360, View.MeasureSpec.EXACTLY),
                    View.MeasureSpec.makeMeasureSpec(800, View.MeasureSpec.EXACTLY));
            root.layout(0, 0, 360, 800);
            assertTrue(button.getHeight() >= PocketDesign.dp(controller.get(), 48));
            Drawable background = button.getBackground();
            background.setState(new int[]{android.R.attr.state_enabled});
            background.setBounds(0, 0, 64, 64);
            Bitmap bitmap = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888);
            background.draw(new Canvas(bitmap));
            assertEquals(0, Color.alpha(bitmap.getPixel(32, 32)));
            bitmap.recycle();
        } finally { controller.pause().stop().destroy(); }
    }
}
