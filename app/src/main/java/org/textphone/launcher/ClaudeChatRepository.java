package org.textphone.launcher;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/** Application-owned chat state; Activity recreation never starts a second request. */
final class ClaudeChatRepository {
    static final String MODEL = JournalReader.MODEL;
    static final int MAX_INPUT_CHARS = 12_000, MAX_OUTPUT_CHARS = 64_000;
    static final int MAX_TURNS = 40, MAX_HISTORY_CHARS = 180_000;
    private static ClaudeChatRepository instance;

    interface Observer { void changed(); }

    static final class Turn {
        final String id, role, text, state;
        Turn(String id, String role, String text, String state) {
            this.id = id;
            this.role = role;
            this.text = text;
            this.state = state;
        }
    }

    static final class Snapshot {
        final List<Turn> turns;
        final boolean running;
        final String error, model, status;
        final String provider;
        final long inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens;
        Snapshot(List<Turn> turns, boolean running, String error, String model,
                String provider, ClaudeChatClient.Usage usage, String status) {
            this.turns = Collections.unmodifiableList(new ArrayList<>(turns));
            this.running = running;
            this.error = error;
            this.model = model;
            this.provider = provider;
            this.status = status;
            inputTokens = usage.inputTokens;
            outputTokens = usage.outputTokens;
            cacheReadTokens = usage.cacheReadTokens;
            cacheWriteTokens = usage.cacheWriteTokens;
        }
    }

    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Set<Observer> observers = new LinkedHashSet<>();
    private final List<Turn> turns = new ArrayList<>();
    private final ExecutorService network = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "Pocket Claude reply");
        thread.setDaemon(true);
        return thread;
    });
    private final ClaudeChatStore store;
    private String conversation, draft = "", error = "", model = MODEL, status = "";
    private ChatProvider.Config provider;
    private ClaudeChatClient.Usage usage = ClaudeChatClient.Usage.EMPTY;
    private boolean running, notificationQueued, replaceOnDelta;
    private long generation, draftRevision, writeRevision, lastStreamSave;
    private ClaudeChatClient.Call active;
    private Future<?> activeTask;

    static synchronized ClaudeChatRepository get(Context context) {
        if (instance == null) instance = new ClaudeChatRepository(context.getApplicationContext());
        return instance;
    }

    private ClaudeChatRepository(Context context) {
        this.context = context;
        store = new ClaudeChatStore(context, revision -> main.post(() -> storageFailed(revision)));
        ClaudeChatStore.State saved = store.load();
        conversation = saved.conversation;
        draft = saved.draft;
        error = saved.error;
        model = saved.model;
        provider = saved.provider;
        usage = saved.usage;
        turns.addAll(saved.turns);
        if (saved.interrupted) persist();
    }

    synchronized void observe(Observer observer) {
        if (observer == null) return;
        observers.add(observer);
        changed();
    }

    synchronized void removeObserver(Observer observer) { observers.remove(observer); }
    synchronized Snapshot snapshot() {
        ChatProvider.Config configured = provider == null ? ChatProvider.get(context) : provider;
        return new Snapshot(turns, running, error, turns.isEmpty() ? configured.model : model,
                configured.provider, usage, status);
    }
    synchronized String draft() { return draft; }

    synchronized void draft(String text) {
        String value = text == null ? "" : text;
        if (value.length() > MAX_INPUT_CHARS)
            throw new IllegalArgumentException("Messages can contain up to 12,000 characters.");
        if (draft.equals(value)) return;
        draft = value;
        draftRevision++;
        persist();
        changed();
    }

    synchronized void send(String text) {
        String value = text == null ? "" : text;
        if (running) { reject("Wait for this reply or tap Stop first.", value); return; }
        if (value.trim().isEmpty()) { reject("Write a message first.", value); return; }
        if (value.length() > MAX_INPUT_CHARS) {
            reject("Messages can contain up to 12,000 characters.", "");
            return;
        }
        if (turns.size() + 2 > MAX_TURNS || characters() + value.length() >= MAX_HISTORY_CHARS) {
            reject("This chat is full. Clear the conversation to start a new chat.", value);
            return;
        }
        ChatProvider.Config selected = ChatProvider.get(context);
        if (!validProvider(selected, value)) return;
        if (!matchesProvider(selected, value)) return;
        if (provider == null) provider = selected;
        model = selected.model;
        turns.add(new Turn(UUID.randomUUID().toString(), "user", value, "complete"));
        turns.add(new Turn(UUID.randomUUID().toString(), "assistant", "", "pending"));
        start(value, false, selected);
    }

    synchronized void retry() {
        if (running) return;
        if (turns.size() < 2) { reject("There is no reply to retry.", ""); return; }
        Turn reply = turns.get(turns.size() - 1);
        if (!("failed".equals(reply.state) || "stopped".equals(reply.state))) return;
        ChatProvider.Config selected = ChatProvider.get(context);
        if (!validProvider(selected, "")) return;
        if (!matchesProvider(selected, "")) return;
        Turn user = turns.get(turns.size() - 2);
        // Keep an earlier partial until the retried request actually produces replacement text.
        turns.set(turns.size() - 1, new Turn(reply.id, "assistant", reply.text, "pending"));
        start(user.text, true, selected);
    }

    synchronized void stop() {
        if (!running) return;
        generation++;
        cancel();
        running = false;
        status = "";
        Turn reply = turns.get(turns.size() - 1);
        turns.set(turns.size() - 1, new Turn(reply.id, reply.role, reply.text, "stopped"));
        error = "";
        persist();
        changed();
    }

    /** Clear the conversation, retaining any unsent draft. */
    synchronized void clear() {
        generation++;
        cancel();
        running = false;
        status = "";
        turns.clear();
        conversation = UUID.randomUUID().toString();
        error = "";
        model = MODEL;
        provider = null;
        usage = ClaudeChatClient.Usage.EMPTY;
        persist();
        changed();
    }

    private void start(String original, boolean replacing, ChatProvider.Config selected) {
        final long request = ++generation;
        final String replyId = turns.get(turns.size() - 1).id;
        replaceOnDelta = replacing;
        if (draft.equals(original)) {
            draft = "";
            draftRevision++;
        }
        final long composerRevision = draftRevision;
        running = true;
        status = "thinking";
        error = "";
        usage = ClaudeChatClient.Usage.EMPTY;
        List<ClaudeChatClient.Message> messages = new ArrayList<>();
        // Only completed exchanges are context; unfinished answers and their questions stay local.
        for (int index = 0; index + 1 < turns.size() - 1; index += 2) {
            Turn user = turns.get(index), reply = turns.get(index + 1);
            if ("complete".equals(reply.state)) {
                messages.add(new ClaudeChatClient.Message("user", user.text));
                messages.add(new ClaudeChatClient.Message("assistant", reply.text));
            }
        }
        messages.add(new ClaudeChatClient.Message("user", original));
        int oldReplyLength = replacing ? turns.get(turns.size() - 1).text.length() : 0;
        int replyLimit = Math.min(MAX_OUTPUT_CHARS, MAX_HISTORY_CHARS - characters() + oldReplyLength);
        ClaudeChatClient.Listener listener = new ClaudeChatClient.Listener() {
            public boolean text(String delta) { return append(request, replyId, delta); }
            public void status(String value) { progress(request, replyId, value, null); }
            public void usage(ClaudeChatClient.Usage tokens) { progress(request, replyId, null, tokens); }
            public void done(String actualModel, ClaudeChatClient.Usage tokens) {
                finish(request, replyId, original, composerRevision, actualModel, "", tokens);
            }
            public void failed(String reason) {
                finish(request, replyId, original, composerRevision, "", reason, null);
            }
        };
        ClaudeChatClient.Call call = new ClaudeChatClient.Call(context, selected, conversation,
                messages, replyLimit, listener);
        active = call;
        long revision = persist();
        lastStreamSave = SystemClock.elapsedRealtime();
        changed();
        activeTask = network.submit(() -> {
            try {
                if (!store.awaitSaved(revision)) {
                    if (!call.cancelled()) listener.failed("Could not save this chat on the phone. Free some space, then retry.");
                    return;
                }
                if (!call.cancelled()) call.run();
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
        });
    }

    private synchronized void progress(long request, String replyId, String value, ClaudeChatClient.Usage tokens) {
        if (!current(request, replyId)) return;
        if (value != null) status = value;
        if (tokens != null) usage = tokens;
        changed();
    }

    private synchronized boolean append(long request, String replyId, String delta) {
        if (!current(request, replyId)) return false;
        Turn reply = turns.get(turns.size() - 1);
        String before = replaceOnDelta ? "" : reply.text;
        int total = characters() - (replaceOnDelta ? reply.text.length() : 0);
        if (before.length() + delta.length() > MAX_OUTPUT_CHARS
                || total + delta.length() > MAX_HISTORY_CHARS) return false;
        turns.set(turns.size() - 1, new Turn(reply.id, reply.role, before + delta, "pending"));
        replaceOnDelta = false;
        long now = SystemClock.elapsedRealtime();
        if (now - lastStreamSave >= 500) { persist(); lastStreamSave = now; }
        changed();
        return true;
    }

    private synchronized void finish(long request, String replyId, String original, long composerRevision,
            String actualModel, String reason, ClaudeChatClient.Usage tokens) {
        if (!current(request, replyId)) return;
        Turn reply = turns.get(turns.size() - 1);
        boolean failed = !reason.isEmpty();
        turns.set(turns.size() - 1, new Turn(reply.id, reply.role, reply.text, failed ? "failed" : "complete"));
        running = false;
        status = "";
        active = null;
        activeTask = null;
        error = reason;
        if (!actualModel.isEmpty()) model = actualModel;
        if (tokens != null) usage = tokens;
        if (failed && draft.isEmpty() && draftRevision == composerRevision) {
            draft = original;
            draftRevision++;
        }
        persist();
        changed();
    }

    private boolean current(long request, String replyId) {
        return running && request == generation && !turns.isEmpty()
                && replyId.equals(turns.get(turns.size() - 1).id);
    }

    private void cancel() {
        if (active != null) active.cancel();
        if (activeTask != null) activeTask.cancel(true);
        active = null;
        activeTask = null;
    }

    private int characters() {
        int count = 0;
        for (Turn turn : turns) count += turn.text.length();
        return count;
    }

    private boolean matchesProvider(ChatProvider.Config selected, String original) {
        if (provider == null || provider.identity.equals(selected.identity)) return true;
        reject("Provider settings changed. Start a new chat to use them.", original);
        return false;
    }

    private boolean validProvider(ChatProvider.Config selected, String original) {
        try { selected.validate(); return true; }
        catch (IllegalArgumentException invalid) {
            reject(invalid.getMessage(), original);
            return false;
        }
    }

    private void reject(String reason, String original) {
        error = reason;
        if (draft.isEmpty() && !original.isEmpty() && original.length() <= MAX_INPUT_CHARS) {
            draft = original;
            draftRevision++;
        }
        persist();
        changed();
    }

    private long persist() {
        long revision = ++writeRevision;
        store.save(new ClaudeChatStore.State(conversation, draft, error, model, turns, revision, false,
                provider, usage));
        return revision;
    }

    private synchronized void storageFailed(long revision) {
        if (revision != writeRevision) return;
        error = "Could not save this chat on the phone. Free some space, then retry.";
        changed();
    }

    /** Coalesce stream updates; observers always run on the main thread. */
    private void changed() {
        if (notificationQueued) return;
        notificationQueued = true;
        main.postDelayed(() -> {
            List<Observer> ready;
            synchronized (ClaudeChatRepository.this) {
                notificationQueued = false;
                ready = new ArrayList<>(observers);
            }
            for (Observer observer : ready) {
                synchronized (ClaudeChatRepository.this) { if (!observers.contains(observer)) continue; }
                observer.changed();
            }
        }, 40);
    }
}
