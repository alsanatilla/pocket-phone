package org.textphone.launcher;

import static org.junit.Assert.*;
import android.content.Intent;
import android.os.Looper;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.ViewGroup;
import android.widget.TextView;
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
import org.robolectric.shadows.ShadowAlertDialog;
import org.robolectric.util.ReflectionHelpers;

@RunWith(RobolectricTestRunner.class)
@Config(sdk={24,35},qualifiers="w360dp-h800dp-mdpi")
public class NoteWheelTest {
    private ActivityController<MainActivity> controller;
    private MainActivity activity;
    private MarkdownEditor editor;
    private ViewGroup root;
    @Before public void setup() {
        RuntimeEnvironment.getApplication().getSharedPreferences("pocket_planner",0).edit().clear().commit();
        controller=Robolectric.buildActivity(MainActivity.class,new Intent().putExtra("pocket_screen","today")).setup(); activity=controller.get();
        root=activity.findViewById(android.R.id.content); PocketAppsTest.find(root,"+ note").performClick();
        ReflectionHelpers.<PageMotion>getField(activity,"motion").settle(); layout(360,800);
        editor=root.findViewWithTag("capture_editor");editor.setText("Trip\nTrain");editor.setSelection(0,4);
    }
    @After public void cleanup() { controller.pause().stop().destroy(); }
    private void layout(int width,int height) {
        root.measure(View.MeasureSpec.makeMeasureSpec(width,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(height,View.MeasureSpec.EXACTLY));root.layout(0,0,width,height);
    }
    private void touch(View target,int action,float rawX,float rawY) {
        int[] at=new int[2];target.getLocationOnScreen(at);
        MotionEvent event=MotionEvent.obtain(SystemClock.uptimeMillis(),SystemClock.uptimeMillis(),action,rawX,rawY,0);event.offsetLocation(-at[0],-at[1]);
        try {target.dispatchTouchEvent(event);} finally {event.recycle();}
    }
    private void open() {root.findViewWithTag("note_format_control").performClick();assertTrue(editor.wheelShowing());layout(360,800);}
    @Test public void holdingInEditorOpensWheelAndReleaseThenTapFormatsTheTouchedLine() {
        int[] at=new int[2];editor.getLocationOnScreen(at);float x=at[0]+40,y=at[1]+24;
        touch(editor,MotionEvent.ACTION_DOWN,x,y);
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(ViewConfiguration.getLongPressTimeout()+40));
        assertTrue("Hold inside the actual editor opens the wheel",editor.wheelShowing());
        touch(editor,MotionEvent.ACTION_UP,x,y);assertTrue(editor.wheelShowing());layout(360,800);
        View bullets=root.findViewWithTag("note_wheel_bullets");int[] target=new int[2];bullets.getLocationOnScreen(target);
        float tx=target[0]+bullets.getWidth()/2f,ty=target[1]+bullets.getHeight()/2f;
        // Touch the wheel surface, exercising polar hit testing, rather than calling its option listener.
        View wheel=root.findViewWithTag("note_format_wheel");touch(wheel,MotionEvent.ACTION_DOWN,tx,ty);touch(wheel,MotionEvent.ACTION_UP,tx,ty);
        assertFalse(editor.wheelShowing());assertEquals("- Trip\nTrain",editor.getText().toString());
    }
    @Test public void holdMoveAndReleaseFormatsOnceAndSuppressesTheTrailingClick() {
        View control=root.findViewWithTag("note_format_control");int[] at=new int[2];control.getLocationOnScreen(at);
        float x=at[0]+control.getWidth()/2f,y=at[1]+control.getHeight()/2f;
        touch(control,MotionEvent.ACTION_DOWN,x,y);control.performLongClick();assertTrue(editor.wheelShowing());layout(360,800);
        View heading=root.findViewWithTag("note_wheel_heading");heading.getLocationOnScreen(at);float tx=at[0]+heading.getWidth()/2f,ty=at[1]+heading.getHeight()/2f;
        touch(control,MotionEvent.ACTION_MOVE,tx,ty);touch(control,MotionEvent.ACTION_UP,tx,ty);
        assertFalse(editor.wheelShowing());assertEquals("# Trip\nTrain",editor.getText().toString());
        assertTrue(editor.undoFormat());assertEquals("Trip\nTrain",editor.getText().toString());assertFalse(editor.undoFormat());
    }
    @Test public void cancelBackAndHomeCloseTheWheelWithoutChangingTextAndRestoreAccessibility() {
        View underlay=root.getChildAt(0);int original=underlay.getImportantForAccessibility();open();
        assertEquals(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS,underlay.getImportantForAccessibility());
        activity.onBackPressed();assertFalse(editor.wheelShowing());assertSame(editor,root.findViewWithTag("capture_editor"));assertEquals(original,underlay.getImportantForAccessibility());
        open();root.findViewWithTag("note_wheel_cancel").performClick();assertEquals("Trip\nTrain",editor.getText().toString());
        open();controller.newIntent(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME));assertNull(root.findViewWithTag("note_format_wheel"));
        assertEquals("Trip\nTrain",new PlannerStore(activity.getSharedPreferences("pocket_planner",0)).draft("note",0));
    }
    @Test public void wheelKeepsSelectionAndNativeTextChoiceDoesNotReopenIt() {
        open();assertEquals(0,editor.getSelectionStart());assertEquals(4,editor.getSelectionEnd());
        root.findViewWithTag("note_wheel_bold").performClick();assertEquals("**Trip**\nTrain",editor.getText().toString());
        open();root.findViewWithTag("note_wheel_select").performClick();assertFalse(editor.wheelShowing());assertEquals("**Trip**\nTrain",editor.getText().toString());
        // Native selection leaves the editor available for ordinary input and the accessible Format control.
        editor.getText().append(" today");assertTrue(editor.getText().toString().endsWith(" today"));open();assertTrue(editor.wheelShowing());
    }
    @Test public void shortWindowUsesTheFullNativeMenuWithoutReducingTouchTargets() {
        layout(360,220);assertFalse(editor.openWheel(180,100));assertFalse(editor.wheelShowing());
        android.app.AlertDialog menu=ShadowAlertDialog.getLatestAlertDialog();assertNotNull(menu);assertTrue(menu.isShowing());
        assertEquals("Heading 1",menu.getListView().getAdapter().getItem(0).toString());assertEquals("Trip\nTrain",editor.getText().toString());menu.dismiss();
    }
    @Test public void cancellationAndPauseDiscardOnlyTheTransientWheel() {
        open();View wheel=root.findViewWithTag("note_format_wheel");touch(wheel,MotionEvent.ACTION_CANCEL,180,400);
        assertFalse(editor.wheelShowing());open();controller.pause();assertFalse(editor.wheelShowing());
        assertEquals("Trip\nTrain",new PlannerStore(activity.getSharedPreferences("pocket_planner",0)).draft("note",0));controller.resume();
    }
}
