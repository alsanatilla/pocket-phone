package org.textphone.launcher;

import static org.junit.Assert.*;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.MotionEvent;
import android.view.View;
import android.widget.EditText;
import android.widget.ScrollView;
import android.widget.TextView;
import android.text.Spanned;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowAlertDialog;
import org.robolectric.util.ReflectionHelpers;

@RunWith(RobolectricTestRunner.class)
@Config(sdk={23,35})
public class OrganizerActivityTest {
    private Context context;
    @Before public void start() { context=RuntimeEnvironment.getApplication(); context.getSharedPreferences("pocket_planner",0).edit().clear().commit(); }
    private PlannerStore store() { return new PlannerStore(context.getSharedPreferences("pocket_planner",0)); }
    private View root(MainActivity activity) { return activity.findViewById(android.R.id.content); }
    private void click(MainActivity activity,String text) { View view=PocketAppsTest.find(root(activity),text);assertNotNull(text,view);while(!view.hasOnClickListeners()&&view.getParent() instanceof View)view=(View)view.getParent();assertTrue("Clickable "+text,view.performClick()); }
    private void chooseFormat(MainActivity activity,String label) {
        View format=root(activity).findViewWithTag("note_format_control"); assertNotNull(format);
        ReflectionHelpers.<PageMotion>getField(activity,"motion").settle(); layout(root(activity),360,800); format.performClick();
        View more=root(activity).findViewWithTag("note_wheel_more"); if(more!=null) more.performClick();
        AlertDialog dialog=ShadowAlertDialog.getLatestAlertDialog(); assertNotNull(dialog); assertTrue(dialog.isShowing());
        android.widget.ListAdapter choices=dialog.getListView().getAdapter();
        for(int index=0;index<choices.getCount();index++) if(label.equals(choices.getItem(index).toString())) {
            org.robolectric.Shadows.shadowOf(dialog).clickOnItem(index); return;
        }
        fail("Missing format option: "+label);
    }
    private ActivityController<MainActivity> today() { return Robolectric.buildActivity(MainActivity.class,new Intent().putExtra("pocket_screen","today")).setup(); }
    private void layout(View view, int width, int height) {
        view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY));
        view.layout(0, 0, width, height); view.getViewTreeObserver().dispatchOnGlobalLayout();
    }
    @Test public void noteWritingAreaGrowsWithTheWindowWithoutLosingTheDraftOrSelection() {
        ActivityController<MainActivity> controller=today(); try {
            MainActivity activity=controller.get(); click(activity,"Note"); PageMotion motion=ReflectionHelpers.getField(activity,"motion"); motion.settle();
            EditText editor=root(activity).findViewWithTag("capture_editor"); editor.setText("# Travel\n- Train"); editor.setSelection(4);
            layout(motion.host(),360,720); int firstHeight=editor.getHeight();
            View actions=motion.host().findViewWithTag("note_actions"); ScrollView viewport=(ScrollView)motion.host().getChildAt(0);
            assertEquals(360,viewport.getWidth()); assertEquals(720,viewport.getHeight());
            assertEquals(viewport.getHeight()-viewport.getPaddingBottom()-viewport.getPaddingTop(),actions.getBottom());
            layout(motion.host(),432,960);
            assertEquals(firstHeight+240,editor.getHeight()); assertEquals(4,editor.getSelectionStart()); assertEquals("# Travel\n- Train",editor.getText().toString());
            assertEquals(432,viewport.getWidth()); assertEquals(960,viewport.getHeight());
        } finally { controller.pause().stop().destroy(); }
    }
    @Test public void noteControlsRemainReachableInAShortWindow() {
        ActivityController<MainActivity> controller=today(); try {
            MainActivity activity=controller.get(); click(activity,"Note"); PageMotion motion=ReflectionHelpers.getField(activity,"motion"); motion.settle();
            EditText editor=root(activity).findViewWithTag("capture_editor"); editor.setText("Draft while the keyboard is open"); editor.setSelection(8);
            layout(motion.host(),360,220); ScrollView viewport=(ScrollView)motion.host().getChildAt(0);
            assertTrue(editor.getHeight()>0); assertTrue(viewport.getChildAt(0).getHeight()>viewport.getHeight());
            // Model touch scrolling to the end without fullScroll moving keyboard focus into the editor.
            viewport.setSmoothScrollingEnabled(false); viewport.scrollTo(0,viewport.getChildAt(0).getHeight());
            View actions=motion.host().findViewWithTag("note_actions");
            int visibleBottom=actions.getBottom()+viewport.getPaddingTop()-viewport.getScrollY();
            assertTrue("Footer bottom "+visibleBottom+" fits viewport "+viewport.getHeight()+" after scroll "+viewport.getScrollY()+"; content "+viewport.getChildAt(0).getHeight()+"; footer top "+actions.getTop()+"; editor "+editor.getTop()+"/"+editor.getHeight(),visibleBottom<=viewport.getHeight()-viewport.getPaddingBottom()); assertTrue(visibleBottom>0);
            viewport.fullScroll(View.FOCUS_UP); click(activity,"save"); assertEquals("Draft while the keyboard is open",store().entries().get(0).text);
        } finally { controller.pause().stop().destroy(); }
    }
    @Test public void taskCreationCompletionAndStepProgressUseSavedNativeState() {
        ActivityController<MainActivity> controller=today(); try { MainActivity activity=controller.get(); click(activity,"+ Task");
            ((EditText)root(activity).findViewWithTag("capture_editor")).setText("Prepare trip");
            ((EditText)root(activity).findViewWithTag("task_steps_editor")).setText("Reserve train\n- [x] Pack cable");
            root(activity).findViewWithTag("task_important").performClick(); root(activity).findViewWithTag("task_due").performClick();
            AlertDialog dialog=ShadowAlertDialog.getLatestAlertDialog(); dialog.getListView().performItemClick(null,0,0);
            click(activity,"save"); PlannerStore.Entry task=store().entries().get(0);
            assertEquals(PlannerDates.today(),task.due); assertTrue(task.important); assertEquals(1,task.completedSteps());
            assertNotNull(PocketAppsTest.find(root(activity),"Steps · 1/2")); root(activity).findViewWithTag("task_step_0").performClick();
            assertEquals(2,store().find(task.id).completedSteps()); assertFalse(store().find(task.id).done);
            click(activity,"Complete task"); assertTrue(store().find(task.id).done); assertEquals(2,store().find(task.id).completedSteps());
            activity.onBackPressed(); root(activity).findViewWithTag("task_filter_Done").performClick();
            root(activity).findViewWithTag("task_open_"+task.id).performClick(); assertTrue(store().find(task.id).done);
            click(activity,"Reopen task"); assertFalse(store().find(task.id).done); assertTrue(store().find(task.id).important);
        } finally { controller.pause().stop().destroy(); }
    }
    @Test public void clearingANoteThroughFormatNeedsConfirmationAndPreservesItsSavedEntry() {
        long id=store().save(0,"note","Saved note"); ActivityController<MainActivity> controller=today();
        try { MainActivity activity=controller.get(); click(activity,"Saved note");
            EditText editor=root(activity).findViewWithTag("capture_editor"); editor.setText("A newer draft");
            chooseFormat(activity,"Clear draft"); AlertDialog confirmation=ShadowAlertDialog.getLatestAlertDialog();
            assertEquals("A newer draft",editor.getText().toString());
            confirmation.getButton(AlertDialog.BUTTON_NEGATIVE).performClick();
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();
            assertEquals("A newer draft",editor.getText().toString());
            chooseFormat(activity,"Clear draft"); confirmation=ShadowAlertDialog.getLatestAlertDialog();
            confirmation.getButton(AlertDialog.BUTTON_POSITIVE).performClick();
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();
            assertEquals("",((EditText)root(activity).findViewWithTag("capture_editor")).getText().toString());
            assertEquals("Saved note",store().find(id).text);
        } finally { controller.pause().stop().destroy(); }
    }
    @Test public void filtersAndSearchFindRealTaskAndNoteTextIncludingSteps() {
        PlannerStore store=store(); long due=store.saveTask(0,"Due task",PlannerDates.today(),false,"Passport");
        long later=store.saveTask(0,"Later task","9999-01-01",true,""); long anytime=store.save(0,"task","Anytime task"); store.save(0,"note","# Travel note\nPlatform 4");
        ActivityController<MainActivity> controller=today();try { MainActivity activity=controller.get();root(activity).findViewWithTag("task_filter_Today").performClick();
            assertNotNull(root(activity).findViewWithTag("task_open_"+due)); assertNull(root(activity).findViewWithTag("task_open_"+later));assertNull(root(activity).findViewWithTag("task_open_"+anytime));
            root(activity).findViewWithTag("task_filter_Later").performClick();assertNotNull(root(activity).findViewWithTag("task_open_"+later));assertNull(root(activity).findViewWithTag("task_open_"+due));
            root(activity).findViewWithTag("task_filter_Open").performClick(); OrganizerSearchTestActions.find(activity,"passport");
            assertNotNull(root(activity).findViewWithTag("task_open_"+due));assertNull(root(activity).findViewWithTag("task_open_"+anytime));
            OrganizerSearchTestActions.find(activity,"platform");assertNotNull(CameraAlbumTest.findContaining(root(activity),"Travel note"));
        } finally { controller.pause().stop().destroy(); }
    }
    @Test public void taskDraftTextAndMetadataSurviveRecreationWithoutOverwritingTheSavedEntry() {
        long id=store().saveTask(0,"Saved",PlannerDates.today(),false,"Saved step");
        ActivityController<MainActivity> first=today(); MainActivity activity=first.get();root(activity).findViewWithTag("task_open_"+id).performClick();click(activity,"Edit task");
        ((EditText)root(activity).findViewWithTag("capture_editor")).setText("Unsaved title");
        ((EditText)root(activity).findViewWithTag("task_steps_editor")).setText("Unsaved step");root(activity).findViewWithTag("task_important").performClick();
        Bundle state=new Bundle();first.pause().saveInstanceState(state).stop().destroy();
        ActivityController<MainActivity> second=Robolectric.buildActivity(MainActivity.class).create(state).start().restoreInstanceState(state).resume().visible();
        try { activity=second.get();assertEquals("Unsaved title",((EditText)root(activity).findViewWithTag("capture_editor")).getText().toString());
            assertEquals("Unsaved step",((EditText)root(activity).findViewWithTag("task_steps_editor")).getText().toString());assertNotNull(PocketAppsTest.find(root(activity),"! Important · on"));
            assertEquals("Saved",store().find(id).text);assertFalse(store().find(id).important);click(activity,"save");assertEquals("Unsaved title",store().find(id).text);
        } finally { second.pause().stop().destroy(); }
    }
    @Test public void wheelProducesPortableMarkdownAndMarkwonPreviewsItWithoutChangingTheDraft() {
        ActivityController<MainActivity> controller=today();try { MainActivity activity=controller.get();click(activity,"Note");
            MarkdownEditor editor=(MarkdownEditor)root(activity).findViewWithTag("capture_editor");editor.setText("Trip\nTrain");editor.setSelection(4);
            chooseWheel(activity,"heading");assertEquals("# Trip\nTrain",editor.getText().toString());
            chooseWheel(activity,"heading");assertEquals("## Trip\nTrain",editor.getText().toString());
            editor.setSelection(editor.length());chooseWheel(activity,"bullets");assertEquals("## Trip\n- Train",editor.getText().toString());
            chooseWheel(activity,"checks");assertEquals("## Trip\n- [ ] Train",editor.getText().toString());
            chooseFormat(activity,"Undo");assertEquals("## Trip\n- Train",editor.getText().toString());click(activity,"Preview");
            TextView preview=(TextView)root(activity).findViewWithTag("note_markdown_preview");assertTrue(preview.getText() instanceof Spanned);
            assertEquals("Trip\n\nTrain",preview.getText().toString());assertTrue(((Spanned)preview.getText()).getSpans(0,4,Object.class).length>0);
            activity.onBackPressed();editor=(MarkdownEditor)root(activity).findViewWithTag("capture_editor");assertEquals("## Trip\n- Train",editor.getText().toString());
            click(activity,"save");assertEquals("## Trip\n- Train",store().entries().get(0).text);
        } finally { controller.pause().stop().destroy(); }
    }
    private void chooseWheel(MainActivity activity,String option) {
        ReflectionHelpers.<PageMotion>getField(activity,"motion").settle(); layout(root(activity),360,800);
        root(activity).findViewWithTag("note_format_control").performClick();
        View choice=root(activity).findViewWithTag("note_wheel_"+option); assertNotNull(option,choice); choice.performClick();
    }
    @Test public void listContinuationAndUndoNeverDiscardTextTypedAfterFormatting() {
        MarkdownEditor editor=new MarkdownEditor(context);editor.setText("- Item");editor.setSelection(editor.length());editor.getText().insert(editor.length(),"\n");
        assertEquals("- Item\n- ",editor.getText().toString());
        editor.setSelection(editor.length());editor.getText().insert(editor.length(),"\n");assertEquals("- Item\n\n",editor.getText().toString());
        editor.setText("Title");editor.setSelection(5);assertTrue(editor.format(NoteMarkdown.Style.H1));assertEquals("# Title",editor.getText().toString());
        editor.getText().append(" and more");assertFalse(editor.undoFormat());assertEquals("# Title and more",editor.getText().toString());
    }
}
