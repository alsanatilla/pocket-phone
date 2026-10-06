package org.textphone.launcher;

import static org.junit.Assert.*;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.database.sqlite.SQLiteOpenHelper;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.os.Looper;
import android.view.View;
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
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        for (int pass = 0; pass < 2; pass++) {
            root.measure(View.MeasureSpec.makeMeasureSpec(360, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(800, View.MeasureSpec.EXACTLY));
            root.layout(0, 0, 360, 800); Shadows.shadowOf(Looper.getMainLooper()).idle();
        }
        Bitmap bitmap = Bitmap.createBitmap(360, 800, Bitmap.Config.ARGB_8888); root.draw(new Canvas(bitmap));
        File target = new File("build/screenshots", name); assertTrue(target.getParentFile().isDirectory() || target.getParentFile().mkdirs());
        try (FileOutputStream stream = new FileOutputStream(target)) { assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)); }
        bitmap.recycle(); return root;
    }
}
