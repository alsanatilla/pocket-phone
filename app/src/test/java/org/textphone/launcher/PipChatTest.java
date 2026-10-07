package org.textphone.launcher;

import static org.junit.Assert.*;
import android.content.Context;
import android.database.sqlite.SQLiteOpenHelper;
import android.os.Looper;
import android.text.Spanned;
import android.view.View;
import android.widget.TextView;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;
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

/** Real persistence and repository callbacks, with a controlled request instead of a paid provider. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = {24, 35}, qualifiers = "w360dp-h800dp-mdpi")
public class PipChatTest {
    private Context context;
    private ClaudeChatRepository repository;
    private final List<FakeRequest> requests = new ArrayList<>();
    private final List<ChatStore> stores = new ArrayList<>();

    @Before public void setup() {
        context = RuntimeEnvironment.getApplication();
        context.getSharedPreferences("text_phone", 0).edit().putBoolean("reduce_motion", true).commit();
        repository = new ClaudeChatRepository(context, (c, config, id, history, limit, listener) -> {
            FakeRequest request = new FakeRequest(history, listener); requests.add(request); return request;
        });
        stores.add(ReflectionHelpers.getField(repository, "store"));
        ReflectionHelpers.setStaticField(ClaudeChatRepository.class, "instance", repository);
    }

    @After public void cleanup() throws Exception {
        repository.stopAll();
        ExecutorService network = ReflectionHelpers.getField(repository, "network");
        network.shutdownNow(); assertTrue(network.awaitTermination(5, TimeUnit.SECONDS));
        for (ChatStore store : stores) {
            ExecutorService writer = ReflectionHelpers.getField(store, "writer");
            writer.shutdown(); assertTrue(writer.awaitTermination(5, TimeUnit.SECONDS));
            SQLiteOpenHelper helper = ReflectionHelpers.getField(store, "helper"); helper.close();
        }
        ReflectionHelpers.setStaticField(ClaudeChatRepository.class, "instance", null);
    }

    @Test public void onlyFinalAnswersReturnAsHistory() throws Exception {
        repository.draft("What is in my notes?"); repository.send(repository.draft());
        FakeRequest first = request(0);
        first.listener.reasoning("I should search for the relevant passage.\n");
        first.listener.text("I'll look in your notes."); first.listener.interim();
        first.listener.step("searched notes · 1 match");
        first.listener.text("The meeting is at **10:00**."); first.listener.done(ClaudeChatRepository.MODEL, ClaudeChatClient.Usage.EMPTY);
        ClaudeChatRepository.Turn reply = repository.snapshot().turns.get(1);
        assertEquals("The meeting is at **10:00**.", reply.text);
        assertTrue(reply.reasoning.contains("I'll look in your notes.")); assertEquals(1, reply.lookups());
        repository.send("And tomorrow?"); FakeRequest next = request(1);
        assertEquals(3, next.history.size()); assertEquals(reply.text, next.history.get(1).text);
        for (ClaudeChatClient.Message message : next.history) {
            assertFalse(message.text.contains("I'll look")); assertFalse(message.text.contains("searched notes"));
        }
        next.listener.done(ClaudeChatRepository.MODEL, ClaudeChatClient.Usage.EMPTY);
    }

    @Test public void stoppedAndFailedRepliesAreNotReplayedAndRetryReplacesPartialText() throws Exception {
        repository.send("First question"); FakeRequest first = request(0); first.listener.text("Partial answer"); repository.stop();
        assertTrue(first.cancelled()); assertFalse(first.listener.text(" late text"));
        repository.retry(); FakeRequest retry = request(1); assertEquals(1, retry.history.size());
        retry.listener.text("Replacement"); retry.listener.failed("The connection ended.");
        assertEquals("Replacement", repository.snapshot().turns.get(1).text);
        repository.send("A different question"); FakeRequest next = request(2);
        assertEquals(1, next.history.size()); assertEquals("A different question", next.history.get(0).text);
    }

    @Test public void switchingChatsKeepsReplyAndComposerWithTheirOriginalChat() throws Exception {
        repository.send("Plan my morning"); FakeRequest first = request(0); String replying = repository.currentId();
        repository.newChat(); String drafting = repository.currentId(); repository.draft("A separate question");
        assertTrue(repository.snapshot().busyElsewhere);
        first.listener.text("Start with breakfast."); first.listener.done(ClaudeChatRepository.MODEL, ClaudeChatClient.Usage.EMPTY);
        assertEquals(drafting, repository.currentId()); assertEquals("A separate question", repository.draft());
        assertTrue(repository.snapshot().turns.isEmpty());
        repository.open(replying); assertEquals("Start with breakfast.", repository.snapshot().turns.get(1).text);
        repository.open(drafting); assertEquals("A separate question", repository.draft());
        assertEquals(2, repository.chats().size());
    }

    @Test public void failureRestoresOriginalDraftEvenWhenAnotherChatWasEdited() throws Exception {
        repository.draft("Original prompt"); repository.send(repository.draft()); FakeRequest request = request(0);
        String original = repository.currentId(); repository.newChat(); repository.draft("Other chat draft");
        request.listener.failed("No connection."); repository.open(original);
        assertEquals("Original prompt", repository.draft());
    }

    @Test public void draftsAndRenamesAreVisibleBeforeBackgroundWritesFinish() throws Exception {
        ChatStore store = stores.get(0);
        CountDownLatch release = new CountDownLatch(1), occupied = new CountDownLatch(1);
        ExecutorService writer = ReflectionHelpers.getField(store, "writer");
        writer.submit(() -> { occupied.countDown(); try { release.await(5, TimeUnit.SECONDS); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); } });
        assertTrue(occupied.await(5, TimeUnit.SECONDS));
        try {
            repository.draft("Unsent idea"); String first = repository.currentId();
            repository.newChat(); repository.draft("Second idea"); String second = repository.currentId();
            assertNotEquals(first, second); assertEquals(2, repository.chats().size());
            repository.open(first); assertEquals("Unsent idea", repository.draft());
            repository.rename(first, "My ideas"); repository.open(second); repository.open(first);
            assertEquals("My ideas", repository.snapshot().title);
            repository.delete(first); assertEquals(second, repository.currentId());
            assertEquals(1, repository.chats().size()); repository.open(first); assertEquals(second, repository.currentId());
        } finally { release.countDown(); }
    }

    @Test public void deletingAnotherChatDoesNotInterruptTheReplyingChat() throws Exception {
        repository.draft("Unsent draft"); String draft = repository.currentId(); repository.newChat();
        repository.send("Keep replying"); FakeRequest request = request(0); String replying = repository.currentId();
        repository.open(draft); repository.delete(draft);
        assertEquals(replying, repository.currentId()); assertTrue(repository.snapshot().running);
        assertFalse(request.cancelled()); request.listener.done(ClaudeChatRepository.MODEL, ClaudeChatClient.Usage.EMPTY);
    }

    @Test public void providerIdentitySurvivesACanonicalModelNameAndRefusesOtherProviders() throws Exception {
        repository.send("Remember this conversation"); FakeRequest request = request(0);
        request.listener.text("A completed answer"); request.listener.done("claude-sonnet-5-5-20261001", ClaudeChatClient.Usage.EMPTY);
        ChatStore store = stores.get(0); assertTrue(store.awaitSaved(repository.currentId(), ReflectionHelpers.getField(repository, "writeRevision")));
        ChatStore.Record saved = store.read(repository.currentId());
        assertNotNull(saved); assertEquals(ClaudeChatRepository.MODEL, saved.provider.model);
        assertEquals("claude-sonnet-5-5-20261001", saved.model);
        context.getSharedPreferences("pocket_chat_provider", 0).edit().putString("provider", "compatible")
                .putString("model", "different-model").putString("base_url", "https://example.invalid/v1").commit();
        repository.send("Continue elsewhere?");
        assertEquals(1, requests.size()); assertTrue(repository.snapshot().error.contains("Start a new chat"));
    }

    @Test public void aFailedSaveCannotBeApprovedByASuccessfulSaveInAnotherChat() throws Exception {
        ChatStore store = stores.get(0); String bad = UUID.randomUUID().toString(), good = UUID.randomUUID().toString();
        List<ClaudeChatRepository.Turn> invalid = List.of(new ClaudeChatRepository.Turn("duplicate", "user", "Prompt", "complete"),
                new ClaudeChatRepository.Turn("duplicate", "assistant", "Answer", "complete"));
        store.save(record(bad, 100, invalid));
        assertFalse(store.awaitSaved(bad, 100));
        store.save(record(good, 101, Collections.emptyList())); assertTrue(store.awaitSaved(good, 101));
        assertFalse(store.awaitSaved(bad, 100)); assertNull(store.read(good).provider);
    }

    @Test public void aPendingReplyRecoversAsInterruptedWithoutResending() throws Exception {
        ChatStore store = stores.get(0); String id = UUID.randomUUID().toString();
        store.save(record(id, 100, List.of(new ClaudeChatRepository.Turn("user", "user", "Try this", "complete"),
                new ClaudeChatRepository.Turn("reply", "assistant", "Partial", "pending", "Reading a note", 1))));
        assertTrue(store.awaitSaved(id, 100));
        ChatStore restored = new ChatStore(context, revision -> { }); stores.add(restored);
        ChatStore.Record saved = restored.read(id); assertTrue(saved.interrupted);
        assertEquals("failed", saved.turns.get(1).state); assertEquals("Partial", saved.turns.get(1).text);
        assertEquals("Reading a note", saved.turns.get(1).reasoning); assertEquals("Try this", saved.draft);
        assertTrue(requests.isEmpty());
    }

    @Test public void migratesTheOldSingleChatAndKeepsDamagedFilesForRecovery() throws Exception {
        String id = UUID.randomUUID().toString(); File legacy = new File(context.getNoBackupFilesDir(), "claude-chat.json");
        JSONObject json = new JSONObject().put("version", 1).put("conversation", id).put("draft", "Unsent draft")
                .put("turns", new JSONArray().put(new JSONObject().put("id", UUID.randomUUID().toString()).put("role", "user").put("text", "Question").put("state", "complete"))
                        .put(new JSONObject().put("id", UUID.randomUUID().toString()).put("role", "assistant").put("text", "Answer").put("state", "complete")));
        Files.write(legacy.toPath(), json.toString().getBytes(StandardCharsets.UTF_8));
        ChatStore migrated = new ChatStore(context, revision -> { }); stores.add(migrated);
        assertFalse(legacy.exists()); assertEquals("Unsent draft", migrated.read(id).draft); assertEquals("Answer", migrated.read(id).turns.get(1).text);
        Files.write(legacy.toPath(), "{broken".getBytes(StandardCharsets.UTF_8));
        ChatStore damaged = new ChatStore(context, revision -> { }); stores.add(damaged);
        assertTrue(legacy.exists()); assertEquals(1, damaged.list().size());
    }

    @Test public void sidebarNamesPipFormatsAnswersAndOffersReasoningAndChats() throws Exception {
        repository.send("A test prompt"); FakeRequest request = request(0);
        request.listener.reasoning("Check the numbers.\n"); request.listener.step("read COROS · 7 days");
        request.listener.text("## A small plan\n\nRun for **30 minutes**.\n\n- Easy pace\n- Short route");
        request.listener.done(ClaudeChatRepository.MODEL, ClaudeChatClient.Usage.EMPTY);
        ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class).setup();
        try {
            MainActivity activity = controller.get(); ClaudeSidebar sidebar = ReflectionHelpers.getField(activity, "claude"); sidebar.open();
            View root = activity.findViewById(android.R.id.content);
            assertEquals("pip", ((TextView) root.findViewWithTag("pip_title")).getText().toString());
            ClaudeChatRepository.Turn answer = repository.snapshot().turns.get(1);
            View reasoning = root.findViewWithTag("pip_reasoning_text_" + answer.id); assertEquals(View.GONE, reasoning.getVisibility());
            root.findViewWithTag("pip_reasoning_" + answer.id).performClick(); assertEquals(View.VISIBLE, reasoning.getVisibility());
            LinearAssertions.formatted(root.findViewWithTag("claude_turn_" + answer.id));
            root.findViewWithTag("pip_new_chat").performClick(); assertTrue(repository.snapshot().turns.isEmpty());
            root.findViewWithTag("pip_chats").performClick();
            android.app.AlertDialog picker = org.robolectric.shadows.ShadowAlertDialog.getLatestAlertDialog();
            assertNotNull(picker.findViewById(android.R.id.content).findViewWithTag("pip_chat_" + answerChatId()));
        } finally { controller.pause().stop().destroy(); }
    }

    @Test public void loaderRespectsReducedMotionAndStopsWorkWhenHidden() throws Exception {
        repository.send("Think for a moment"); request(0);
        Shadows.shadowOf(context.getSystemService(android.os.UserManager.class)).setUserUnlocked(true);
        android.provider.Settings.Global.putFloat(context.getContentResolver(), android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1);
        ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class).setup().visible();
        try {
            MainActivity activity = controller.get(); ClaudeSidebar sidebar = ReflectionHelpers.getField(activity, "claude"); sidebar.open();
            PixelLoadingView loader = activity.findViewById(android.R.id.content).findViewWithTag("pip_loading");
            View root = activity.findViewById(android.R.id.content);
            root.measure(View.MeasureSpec.makeMeasureSpec(360, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(800, View.MeasureSpec.EXACTLY));
            root.layout(0, 0, 360, 800);
            // Robolectric attaches this window while leaving its framework visibility as GONE.
            ReflectionHelpers.setField(ReflectionHelpers.getField(loader, "mAttachInfo"), "mWindowVisibility", View.VISIBLE);
            loader.dispatchWindowVisibilityChanged(View.VISIBLE);
            assertFalse(ReflectionHelpers.getField(loader, "scheduled"));
            context.getSharedPreferences("text_phone", 0).edit().putBoolean("reduce_motion", false).commit();
            loader.refresh();
            assertTrue(PageMotion.enabled(activity)); assertTrue(loader.isShown());
            assertTrue("attached=" + ReflectionHelpers.getField(loader, "attached") + ", running=" + ReflectionHelpers.getField(loader, "running")
                    + ", paused=" + ReflectionHelpers.getField(loader, "paused") + ", window=" + loader.getWindowVisibility(), ReflectionHelpers.getField(loader, "scheduled"));
            sidebar.close(); assertFalse(ReflectionHelpers.getField(loader, "scheduled"));
        } finally { controller.pause().stop().destroy(); }
    }

    private String answerChatId() { return repository.chats().get(0).id; }
    private FakeRequest request(int index) throws InterruptedException {
        FakeRequest request = requests.get(index); assertTrue("Saved request didn't start", request.started.await(5, TimeUnit.SECONDS)); return request;
    }
    private ChatStore.Record record(String id, long revision, List<ClaudeChatRepository.Turn> turns) {
        return new ChatStore.Record(id, "test", "", "", ClaudeChatRepository.MODEL, turns.isEmpty() ? null : ChatProvider.defaults("anthropic"),
                ClaudeChatClient.Usage.EMPTY, turns, 1, 2, revision, false, false);
    }
    private static final class FakeRequest implements ClaudeChatClient.Request {
        final List<ClaudeChatClient.Message> history; final ClaudeChatClient.Listener listener;
        final CountDownLatch started = new CountDownLatch(1); boolean cancelled;
        FakeRequest(List<ClaudeChatClient.Message> history, ClaudeChatClient.Listener listener) { this.history = history; this.listener = listener; }
        public void run() { started.countDown(); }
        public void cancel() { cancelled = true; }
        public boolean cancelled() { return cancelled; }
    }
    private static final class LinearAssertions {
        static void formatted(View root) {
            // Find the answer by its text: activity, reasoning and sources sit above it in the turn.
            TextView body = CameraAlbumTest.findContaining(root, "30 minutes"); assertNotNull(body);
            assertTrue(body.getText() instanceof Spanned); assertFalse(body.getText().toString().contains("**"));
            assertFalse(body.getText().toString().contains("##"));
        }
    }
}
