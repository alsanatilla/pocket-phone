package org.textphone.launcher;

import static org.junit.Assert.*;

import android.app.Activity;
import android.os.Looper;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;
import android.widget.FrameLayout;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;

/** The board's editing gestures: long press, drag to reorder, corner resize, unpin badge and ending the mode. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class LiveTileBoardTest {
    private ActivityController<Activity> controller;
    private Activity activity;
    private LiveTileBoard board;
    private final List<String> events = new ArrayList<>();
    private boolean mode;

    @Before public void setUp() {
        controller = Robolectric.buildActivity(Activity.class).setup();
        activity = controller.get();
        TodayTiles.saveVisible(activity, new ArrayList<>(Arrays.asList("activity", "tasks", "notes")));
        PlannerStore planner = new PlannerStore(activity.getSharedPreferences("pocket_planner", 0));
        board = new LiveTileBoard(activity, planner, new LiveTileBoard.Actions() {
            public void open(String kind) { events.add("open:" + kind); }
            public void edit(String kind) { events.add("edit:" + kind); }
            public void changed() { events.add("changed"); }
            public void editing(boolean on) { mode = on; events.add("editing:" + on); }
            public void failed(RuntimeException error) { events.add("failed:" + error.getMessage()); }
        });
        FrameLayout frame = new FrameLayout(activity);
        frame.addView(board);
        activity.setContentView(frame);
        settle();
        layout();
    }
    @After public void tearDown() { controller.pause().stop().destroy(); }

    private void settle() { Shadows.shadowOf(Looper.getMainLooper()).idle(); }
    private void layout() {
        board.measure(View.MeasureSpec.makeMeasureSpec(360, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(800, View.MeasureSpec.AT_MOST));
        board.layout(0, 0, 360, board.getMeasuredHeight());
        settle();
    }
    private View tile(String kind) { return board.findViewWithTag("today_tile_" + kind); }
    private List<String> visible() { return TodayTiles.visible(activity); }
    private void touch(int action, float x, float y) {
        long now = SystemClock.uptimeMillis();
        MotionEvent event = MotionEvent.obtain(now, now, action, x, y, 0);
        board.dispatchTouchEvent(event);
        event.recycle();
        settle();
    }
    private void editing() { board.editing(true); layout(); settle(); }

    @Test public void aLongPressStartsEditingAndLiftsTheTile() {
        View tasks = tile("tasks"); assertNotNull(tasks);
        assertTrue("the tile answers a long press", tasks.performLongClick());
        assertTrue("the board is editing", board.editing());
        assertTrue("the button follows the board", mode);
        assertEquals("editing:true", events.get(events.size() - 1));
        assertTrue("editing shrinks borderless tiles", tile("tasks").getScaleX() < 1f);
    }

    @Test public void draggingPastAnotherTileReordersAndSaves() {
        editing();
        assertEquals(Arrays.asList("activity", "tasks", "notes"), visible());
        View notes = tile("notes"); assertNotNull(notes);
        float x = notes.getLeft() + notes.getWidth() / 2f, y = notes.getTop() + notes.getHeight() / 2f;
        touch(MotionEvent.ACTION_DOWN, x, y);
        // Move to the top-left slot: clearly nearer the first position than where it was.
        touch(MotionEvent.ACTION_MOVE, 12f, 12f);
        touch(MotionEvent.ACTION_UP, 12f, 12f);
        settle(); layout();
        assertTrue("the new order is saved", events.contains("changed"));
        assertEquals(Arrays.asList("notes", "activity", "tasks"), visible());
        assertTrue("a dragged tile does not leave editing", board.editing());
        assertEquals("the dragged tile returns to its slot", 0f, tile("notes").getTranslationX(), 0.5f);
    }

    @Test public void aCancelledDragPutsTheOrderBack() {
        editing();
        List<String> before = visible();
        int changed = 0; for (String event : events) if ("changed".equals(event)) changed++;
        View notes = tile("notes"); assertNotNull(notes);
        touch(MotionEvent.ACTION_DOWN, notes.getLeft() + 4f, notes.getTop() + 4f);
        touch(MotionEvent.ACTION_MOVE, 12f, 12f);
        touch(MotionEvent.ACTION_CANCEL, 12f, 12f);
        assertEquals("a cancelled drag keeps the saved order", before, visible());
        int after = 0; for (String event : events) if ("changed".equals(event)) after++;
        assertEquals("a cancelled drag saves nothing", changed, after);
    }

    @Test public void theCornerHandleResizesAndSaves() {
        editing();
        View activityTile = tile("activity"); assertNotNull(activityTile);
        assertEquals("small", TodayTiles.size(activity, "activity"));
        float unit = activityTile.getWidth(), rowUnit = activityTile.getHeight(), gap = 8f;
        float x = activityTile.getRight() - 8f, y = activityTile.getBottom() - 8f;
        touch(MotionEvent.ACTION_DOWN, x, y);
        // Drag the handle to four columns by two rows.
        touch(MotionEvent.ACTION_MOVE, activityTile.getLeft() + 4 * unit + 3 * gap, activityTile.getTop() + 2 * rowUnit + gap);
        touch(MotionEvent.ACTION_UP, activityTile.getLeft() + 4 * unit + 3 * gap, activityTile.getTop() + 2 * rowUnit + gap);
        assertEquals("the resize is saved", "wide", TodayTiles.size(activity, "activity"));
        assertTrue(events.contains("changed"));
        layout();
        assertTrue("the resized tile spans the board", tile("activity").getWidth() >= board.getWidth() - 2);
    }

    @Test public void theBadgeUnpinsTheTile() {
        editing();
        View tasks = tile("tasks"); assertNotNull(tasks);
        float x = tasks.getLeft() + 8f, y = tasks.getTop() + 8f;
        touch(MotionEvent.ACTION_DOWN, x, y);
        touch(MotionEvent.ACTION_UP, x, y);
        assertFalse("the unpinned tile is gone from Today", visible().contains("tasks"));
        assertTrue("the change is saved", events.contains("changed"));
        board.refresh(); layout();
        assertNull("and its view is removed", tile("tasks"));
    }

    @Test public void tappingEmptySpaceEndsEditing() {
        editing();
        int bottom = 0;
        for (String kind : visible()) { View view = tile(kind); if (view != null) bottom = Math.max(bottom, view.getBottom()); }
        touch(MotionEvent.ACTION_DOWN, 20f, bottom + 20f);
        touch(MotionEvent.ACTION_UP, 20f, bottom + 20f);
        assertFalse("a tap on empty board space ends the mode", board.editing());
        assertFalse(mode);
        assertEquals("editing:false", events.get(events.size() - 1));
        assertEquals("tiles stop shrinking", 1f, tile("tasks").getScaleX(), 0f);
    }

    @Test public void leavingTheBoardMidGestureChangesNothing() {
        editing();
        List<String> before = visible();
        View notes = tile("notes"); assertNotNull(notes);
        touch(MotionEvent.ACTION_DOWN, notes.getLeft() + 4f, notes.getTop() + 4f);
        touch(MotionEvent.ACTION_MOVE, 12f, 12f);
        controller.pause().stop();
        assertEquals("detaching abandons an unfinished drag", before, visible());
    }
}
