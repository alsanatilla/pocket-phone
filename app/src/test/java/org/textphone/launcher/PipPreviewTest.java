package org.textphone.launcher;

import static org.junit.Assert.*;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.database.sqlite.SQLiteOpenHelper;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Rect;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewTreeObserver;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
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
import org.robolectric.util.ReflectionHelpers;

/** Native Pocket layouts from fictional local fixtures. No network, API key or handset capture. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, qualifiers = "w360dp-h800dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class PipPreviewTest {
    private Context context;
    private ClaudeChatRepository repository;
    private final List<ClaudeChatClient.Listener> listeners = new ArrayList<>();
    private final List<CountDownLatch> started = new ArrayList<>();
    private ActivityController<MainActivity> controller;
    private ClaudeSidebar sidebar;

    @Before public void setup() {
        context = RuntimeEnvironment.getApplication();
        context.getSharedPreferences("text_phone", 0).edit().putBoolean("reduce_motion", true).commit();
        repository = new ClaudeChatRepository(context, (c, config, id, history, limit, listener) -> {
            CountDownLatch latch = new CountDownLatch(1); started.add(latch); listeners.add(listener);
            return new ClaudeChatClient.Request() {
                boolean cancelled;
                public void run() { latch.countDown(); }
                public boolean cancelled() { return cancelled; }
                public void cancel() { cancelled = true; }
            };
        });
        ReflectionHelpers.setStaticField(ClaudeChatRepository.class, "instance", repository);
    }
    @After public void cleanup() throws Exception {
        if (controller != null) controller.pause().stop().destroy();
        repository.stopAll(); ExecutorService network = ReflectionHelpers.getField(repository, "network");
        network.shutdownNow(); assertTrue(network.awaitTermination(5, TimeUnit.SECONDS));
        ChatStore store = ReflectionHelpers.getField(repository, "store"); ExecutorService writer = ReflectionHelpers.getField(store, "writer");
        writer.shutdown(); assertTrue(writer.awaitTermination(5, TimeUnit.SECONDS));
        ((SQLiteOpenHelper) ReflectionHelpers.getField(store, "helper")).close();
        ReflectionHelpers.setStaticField(ClaudeChatRepository.class, "instance", null);
    }
    @Test public void emptyPage() throws Exception { open(); save(controller.get(), "pocket-22-pip-empty.png"); }
    @Test public void formattedReply() throws Exception {
        seed(); open(); View root = save(controller.get(), "pocket-22-pip-chat.png");
        assertNotNull(root.findViewWithTag("pip_title")); assertEquals(360, root.findViewWithTag("claude_sidebar").getWidth());
    }
    @Test public void reasoningAndLoading() throws Exception {
        seed(); open();
        String id = repository.snapshot().turns.get(1).id;
        controller.get().findViewById(android.R.id.content).findViewWithTag("pip_reasoning_" + id).performClick();
        save(controller.get(), "pocket-22-pip-reasoning.png");
        repository.send("What if I have only ten minutes?"); assertTrue(started.get(1).await(5, TimeUnit.SECONDS));
        listeners.get(1).reasoning("Keep just one small action.\n");
        sidebar.closeImmediately(); sidebar.open(); save(controller.get(), "pocket-22-pip-loading.png");
    }
    @Test public void differentChats() throws Exception {
        seed(); repository.rename(repository.currentId(), "A calmer morning"); repository.newChat();
        repository.draft("Ideas for the weekend"); open();
        controller.get().findViewById(android.R.id.content).findViewWithTag("pip_chats").performClick();
        AlertDialog picker = org.robolectric.shadows.ShadowAlertDialog.getLatestAlertDialog();
        saveView(picker.getWindow().getDecorView(), "pocket-22-pip-chats.png");
        assertEquals(2, repository.chats().size());
    }
    @Test public void keyboardComposerFitsThreeContextsWhileReplying() throws Exception {
        repository.send("Review the attached context."); assertTrue(started.get(0).await(5, TimeUnit.SECONDS));
        for (int i = 0; i < 3; i++) repository.attach(new ChatContext("note", i + 1,
                "A long attached note title that needs more than one line " + i, "Preview-only context."));
        listeners.get(0).status("reading a long source title while preparing the response");
        open();
        // Model the keyboard's remaining 450dp area directly; legacy Robolectric frames do not report a real IME.
        ViewTreeObserver.OnGlobalLayoutListener legacy = ReflectionHelpers.getField(sidebar, "legacyKeyboard");
        sidebar.getViewTreeObserver().removeOnGlobalLayoutListener(legacy);
        ReflectionHelpers.setField(sidebar, "keyboardVisible", true);
        ReflectionHelpers.callInstanceMethod(sidebar, "applyPanelPadding");
        View root = saveView(controller.get().findViewById(android.R.id.content), "pocket-warm-pip-keyboard.png", 450);
        View send = root.findViewWithTag("claude_chat_send"), composer = root.findViewWithTag("claude_chat_composer");
        Rect bounds = new Rect(); send.getDrawingRect(bounds); ((ViewGroup) root).offsetDescendantRectToMyCoords(send, bounds);
        assertTrue("Send stays inside the keyboard-visible area", bounds.bottom <= root.getHeight());
        assertTrue("Composer remains readable", composer.getHeight() >= 48);
        assertTrue("The thread can still scroll", root.findViewWithTag("claude_chat_scroll").getHeight() >= 80);
        LinearLayout attachments = root.findViewWithTag("pip_context"); assertEquals(3, attachments.getChildCount());
        assertTrue("Attachments scroll with the thread", attachments.getParent() != root.findViewWithTag("claude_sidebar"));
        ((ViewGroup) attachments.getChildAt(0)).getChildAt(1).performClick(); assertEquals(2, repository.context().size());
        assertEquals("stop", ((TextView) send).getText().toString());
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(400, TimeUnit.MILLISECONDS);
        send.performClick(); assertFalse(repository.snapshot().running);
    }
    @Test public void executionAndSourcesExpandAcrossCompletion() throws Exception {
        repository.send("Find the source."); assertTrue(started.get(0).await(5, TimeUnit.SECONDS));
        ChatActivity trace = new ChatActivity(listeners.get(0)::activity);
        trace.record("lookup", "search_web", new org.json.JSONObject().put("query", "test-only source query"), "running", null, null);
        open(); View root = save(controller.get(), "pocket-warm-pip-execution-running.png");
        String id = repository.snapshot().turns.get(1).id;
        TextView toggle = root.findViewWithTag("pip_activity_" + id); assertTrue(toggle.getText().toString().contains("running"));
        toggle.performClick();
        ViewGroup events = root.findViewWithTag("pip_tool_rows_" + id);
        assertEquals(View.VISIBLE, events.getVisibility()); assertEquals(1, events.getChildCount());
        org.json.JSONArray sources = new org.json.JSONArray().put(ChatActivity.source("https://example.com/source", "Preview source"));
        trace.record("lookup", "search_web", null, "done", "1 result", sources);
        listeners.get(0).text("A reply from the actual recorded event fixture.");
        listeners.get(0).done(ClaudeChatRepository.MODEL, ClaudeChatClient.Usage.EMPTY);
        sidebar.closeImmediately(); sidebar.open(); root = save(controller.get(), "pocket-warm-pip-execution-complete.png");
        toggle = root.findViewWithTag("pip_activity_" + id); assertTrue(toggle.getText().toString().contains("1 web search"));
        assertEquals(View.VISIBLE, events.getVisibility());
        TextView sourceToggle = root.findViewWithTag("pip_sources_" + id); assertEquals(View.VISIBLE, sourceToggle.getVisibility());
        sourceToggle.performClick(); assertTrue(sourceToggle.getText().toString().startsWith("1 source"));
        events.getChildAt(0).performClick(); AlertDialog details = org.robolectric.shadows.ShadowAlertDialog.getLatestAlertDialog();
        assertNotNull(details); assertTrue(details.isShowing());
        assertTrue("Execution preserves the actual query", containsText(details.getWindow().getDecorView(), "test-only source query"));
    }
    @Test public void proposalReviewRequiresExplicitSaveAndPersistsEditedTask() throws Exception {
        repository.send("Research and propose one chosen action."); assertTrue(started.get(0).await(5, TimeUnit.SECONDS));
        ChatActivity trace = new ChatActivity(listeners.get(0)::activity);
        trace.record("plan", "update_plan", new org.json.JSONObject(), "done", "1 step", null);
        trace.result("plan", new org.json.JSONObject().put("kind", "plan").put("plan", new org.json.JSONArray().put(new org.json.JSONObject().put("text", "Compare ferry options").put("status", "done"))).toString());
        org.json.JSONObject proposal = new org.json.JSONObject().put("kind", "task").put("title", "Book ferry").put("text", "Research source context").put("due", "2026-10-10").put("steps", new org.json.JSONArray().put("Check departure"));
        trace.record("proposal", "propose_action", new org.json.JSONObject(), "done", "Book ferry", null);
        trace.result("proposal", new org.json.JSONObject().put("kind", "proposal").put("proposal", proposal).put("requires_confirmation", true).toString());
        listeners.get(0).text("One proposal is ready."); listeners.get(0).done(ClaudeChatRepository.MODEL, ClaudeChatClient.Usage.EMPTY);
        open(); View root = save(controller.get(), "pocket-agent-proposal.png");
        assertTrue(containsText(root, "Compare ferry options"));
        assertFalse("Plans are not labelled as data reads", containsText(root, "Pocket read"));
        String reply = repository.snapshot().turns.get(1).id, uid = PipActions.id(repository.currentId(), repository.proposalUserId(reply), "proposal");
        PlannerStore planner = new PlannerStore(context.getSharedPreferences("pocket_planner", 0)); assertNull(TaskSync.byUid(planner, uid));
        root.findViewWithTag("pip_proposal_proposal").performClick();
        AlertDialog dialog = org.robolectric.shadows.ShadowAlertDialog.getLatestAlertDialog();
        dialog.getButton(AlertDialog.BUTTON_NEGATIVE).performClick(); assertNull(TaskSync.byUid(planner, uid));
        root.findViewWithTag("pip_proposal_proposal").performClick(); dialog = org.robolectric.shadows.ShadowAlertDialog.getLatestAlertDialog();
        ((android.widget.EditText) dialog.findViewById(android.R.id.content).findViewWithTag("pip_proposal_title")).setText("Book the morning ferry");
        ((android.widget.EditText) dialog.findViewById(android.R.id.content).findViewWithTag("pip_proposal_steps")).setText("Compare prices\nPay for ticket");
        saveView(dialog.getWindow().getDecorView(), "pocket-agent-review-task.png");
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).performClick();
        PlannerStore.Entry saved = TaskSync.byUid(planner, uid); assertNotNull(saved); assertEquals("Book the morning ferry", saved.text); assertEquals(2, saved.steps.size()); assertEquals("2026-10-10", saved.due);
        org.json.JSONObject event = ChatActivity.read(repository.snapshot().turns.get(1).activity).getJSONObject(1);
        assertEquals("/tasks/" + uid, event.getString("applied_href"));
        sidebar.closeImmediately(); sidebar.open(); root = save(controller.get(), "pocket-agent-proposal-saved.png");
        assertTrue(containsText(root, "open saved task"));
        root.findViewWithTag("pip_proposal_proposal").performClick();
        android.content.Intent opened = Shadows.shadowOf(controller.get()).getNextStartedActivity();
        assertNotNull(opened); assertEquals(saved.id, opened.getLongExtra("pocket_task", -1));
    }
    @Test public void changeReviewAppliesOnlyOnTapAndThenOpensTheTask() throws Exception {
        context.getSharedPreferences("pocket_planner", 0).edit().putString("entries", new org.json.JSONArray().put(new org.json.JSONObject().put("id", 4).put("kind", "task")
                .put("text", "Book ferry tickets").put("created", 4).put("steps", new org.json.JSONArray())).toString()).commit();
        repository.send("The ferry is booked."); assertTrue(started.get(0).await(5, TimeUnit.SECONDS));
        ChatActivity trace = new ChatActivity(listeners.get(0)::activity);
        trace.record("change", "propose_change", new org.json.JSONObject(), "done", "Book ferry tickets · ready to review", null);
        trace.result("change", new org.json.JSONObject().put("kind", "change").put("change", new org.json.JSONObject().put("change", "update_task").put("id", "4")
                .put("due", "2026-10-11").put("add_steps", new org.json.JSONArray().put("Print tickets")).put("reason", "Departure is on the 11th."))
                .put("before", new org.json.JSONObject().put("title", "Book ferry tickets").put("due", "").put("done", false).put("steps", 0)).put("requires_confirmation", true).toString());
        listeners.get(0).text("Ready for you to review."); listeners.get(0).done(ClaudeChatRepository.MODEL, ClaudeChatClient.Usage.EMPTY);
        open(); View root = save(controller.get(), "pocket-agent-change.png");
        assertTrue(containsText(root, "update task")); assertTrue(containsText(root, "Book ferry tickets"));
        PlannerStore planner = new PlannerStore(context.getSharedPreferences("pocket_planner", 0));
        root.findViewWithTag("pip_change_change").performClick();
        AlertDialog dialog = org.robolectric.shadows.ShadowAlertDialog.getLatestAlertDialog();
        assertTrue(containsText(dialog.getWindow().getDecorView(), "Departure is on the 11th."));
        dialog.getButton(AlertDialog.BUTTON_NEGATIVE).performClick(); assertEquals("", planner.find(4).due);
        root.findViewWithTag("pip_change_change").performClick(); dialog = org.robolectric.shadows.ShadowAlertDialog.getLatestAlertDialog();
        ((android.widget.EditText) dialog.findViewById(android.R.id.content).findViewWithTag("pip_change_due")).setText("2026-10-12");
        saveView(dialog.getWindow().getDecorView(), "pocket-agent-review-change.png");
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).performClick();
        PlannerStore.Entry task = planner.find(4); assertEquals("2026-10-12", task.due); assertEquals(1, task.steps.size()); assertEquals("Print tickets", task.steps.get(0).text);
        org.json.JSONObject event = ChatActivity.read(repository.snapshot().turns.get(1).activity).getJSONObject(0);
        assertEquals("/tasks/4", event.getString("applied_href"));
        sidebar.closeImmediately(); sidebar.open(); root = save(controller.get(), "pocket-agent-change-applied.png");
        assertTrue(containsText(root, "open task"));
        root.findViewWithTag("pip_change_change").performClick();
        android.content.Intent opened = Shadows.shadowOf(controller.get()).getNextStartedActivity();
        assertNotNull(opened); assertEquals(4L, opened.getLongExtra("pocket_task", -1));
    }
    private boolean containsText(View view, String value) {
        if (view instanceof TextView && ((TextView) view).getText().toString().contains(value)) return true;
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) view).getChildCount(); i++)
            if (containsText(((ViewGroup) view).getChildAt(i), value)) return true;
        return false;
    }
    private void seed() throws Exception {
        repository.send("Help me plan a calmer morning."); assertTrue(started.get(0).await(5, TimeUnit.SECONDS));
        ClaudeChatClient.Listener listener = listeners.get(0);
        listener.reasoning("Keep the plan short and leave some breathing room.\n");
        listener.text("## A calmer morning\n\nKeep the first **30 minutes** simple.\n\n- Water, then breakfast.\n- Ten minutes outside.\n- Pick one task before messages.\n\nNo need to fit everything in.");
        listener.done(ClaudeChatRepository.MODEL, new ClaudeChatClient.Usage(1400, 160, 1000, 0));
    }
    private void open() {
        controller = Robolectric.buildActivity(MainActivity.class).setup().visible();
        sidebar = ReflectionHelpers.getField(controller.get(), "claude"); sidebar.open();
    }
    private View save(Activity activity, String name) throws Exception { return saveView(activity.findViewById(android.R.id.content), name); }
    private View saveView(View root, String name) throws Exception {
        return saveView(root, name, 800);
    }
    private View saveView(View root, String name, int height) throws Exception {
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        for (int pass = 0; pass < 2; pass++) {
            root.measure(View.MeasureSpec.makeMeasureSpec(360, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY));
            root.layout(0, 0, 360, height); Shadows.shadowOf(Looper.getMainLooper()).idle();
        }
        Bitmap bitmap = Bitmap.createBitmap(360, height, Bitmap.Config.ARGB_8888); root.draw(new Canvas(bitmap));
        File target = new File("build/screenshots", name); assertTrue(target.getParentFile().isDirectory() || target.getParentFile().mkdirs());
        try (FileOutputStream stream = new FileOutputStream(target)) { assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)); }
        bitmap.recycle(); return root;
    }
}
