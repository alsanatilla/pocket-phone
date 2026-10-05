package org.textphone.launcher;

import android.content.Context;
import android.util.AtomicFile;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** One private, atomic chat file. It is neither backed up nor included in Pocket cloud sync. */
final class ClaudeChatStore {
    private static final int MAX_FILE_BYTES = 2_000_000;
    interface Failure { void failed(long revision); }

    static final class State {
        final String conversation, draft, error, model;
        final List<ClaudeChatRepository.Turn> turns;
        final long revision;
        final boolean interrupted;

        State(String conversation, String draft, String error, String model,
                List<ClaudeChatRepository.Turn> turns, long revision, boolean interrupted) {
            this.conversation = conversation;
            this.draft = draft;
            this.error = error;
            this.model = model;
            this.turns = Collections.unmodifiableList(new ArrayList<>(turns));
            this.revision = revision;
            this.interrupted = interrupted;
        }

        static State empty(String error) {
            return new State(UUID.randomUUID().toString(), "", error, ClaudeChatRepository.MODEL,
                    Collections.emptyList(), 0, false);
        }
    }

    private final AtomicFile file;
    private final Failure failure;
    private final ExecutorService writer = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "Pocket Claude save");
        thread.setDaemon(true);
        return thread;
    });
    private State queued;
    private boolean writing;
    private long writtenRevision, failedRevision;

    ClaudeChatStore(Context context, Failure failure) {
        file = new AtomicFile(new File(context.getNoBackupFilesDir(), "claude-chat.json"));
        this.failure = failure;
    }

    State load() {
        if (!file.getBaseFile().exists()
                && !new File(file.getBaseFile().getPath() + ".bak").exists()) return State.empty("");
        String recoveredDraft = "";
        try (FileInputStream input = file.openRead()) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (bytes.size() + count > MAX_FILE_BYTES) throw new IOException();
                bytes.write(buffer, 0, count);
            }
            JSONObject json = new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
            if (json.getInt("version") != 1) throw new JSONException("Unsupported chat format");
            recoveredDraft = json.optString("draft", "");
            if (recoveredDraft.length() > ClaudeChatRepository.MAX_INPUT_CHARS) recoveredDraft = "";
            String conversation = json.getString("conversation");
            UUID.fromString(conversation);
            String model = json.optString("model", ClaudeChatRepository.MODEL);
            if (!model.matches("[a-zA-Z0-9][a-zA-Z0-9._-]{1,80}")) model = ClaudeChatRepository.MODEL;
            String error = json.optString("error", "");
            if (error.length() > 300) error = "";
            JSONArray rows = json.getJSONArray("turns");
            if (rows.length() > ClaudeChatRepository.MAX_TURNS || rows.length() % 2 != 0)
                throw new JSONException("Invalid chat history");
            List<ClaudeChatRepository.Turn> turns = new ArrayList<>();
            boolean interrupted = false;
            int total = 0;
            for (int index = 0; index < rows.length(); index++) {
                JSONObject row = rows.getJSONObject(index);
                String id = row.getString("id"), role = row.getString("role");
                String text = row.getString("text"), state = row.getString("state");
                UUID.fromString(id);
                boolean user = index % 2 == 0;
                if (!(user ? "user" : "assistant").equals(role)
                        || text.length() > (user ? ClaudeChatRepository.MAX_INPUT_CHARS
                                : ClaudeChatRepository.MAX_OUTPUT_CHARS)
                        || (user && (!"complete".equals(state) || text.trim().isEmpty()))
                        || !("complete".equals(state) || "pending".equals(state)
                                || "failed".equals(state) || "stopped".equals(state)))
                    throw new JSONException("Invalid chat turn");
                if ("pending".equals(state)) {
                    state = "failed";
                    interrupted = true;
                }
                total += text.length();
                if (total > ClaudeChatRepository.MAX_HISTORY_CHARS) throw new JSONException("Chat too large");
                turns.add(new ClaudeChatRepository.Turn(id, role, text, state));
            }
            if (interrupted) {
                error = "The last reply was interrupted. Tap Retry to try again.";
                if (recoveredDraft.isEmpty() && turns.size() >= 2)
                    recoveredDraft = turns.get(turns.size() - 2).text;
            }
            return new State(conversation, recoveredDraft, error, model, turns, 0, interrupted);
        } catch (IOException | JSONException | RuntimeException damaged) {
            State empty = State.empty("The saved chat could not be read. Start a new conversation.");
            return new State(empty.conversation, recoveredDraft, empty.error, empty.model,
                    empty.turns, 0, false);
        }
    }

    /** Coalesce frequent draft and stream updates while keeping writes in revision order. */
    synchronized void save(State state) {
        queued = state;
        if (writing) return;
        writing = true;
        writer.execute(this::drain);
    }

    /** A paid request starts only after its user turn is safely on disk. Never call on the UI thread. */
    synchronized boolean awaitSaved(long revision) throws InterruptedException {
        while (writtenRevision < revision && failedRevision < revision) wait();
        return writtenRevision >= revision;
    }

    private void drain() {
        while (true) {
            State next;
            synchronized (this) {
                next = queued;
                queued = null;
                if (next == null) {
                    writing = false;
                    return;
                }
            }
            boolean saved = write(next);
            synchronized (this) {
                if (saved) writtenRevision = Math.max(writtenRevision, next.revision);
                else failedRevision = Math.max(failedRevision, next.revision);
                notifyAll();
            }
            if (!saved) failure.failed(next.revision);
        }
    }

    private boolean write(State state) {
        FileOutputStream output = null;
        try {
            JSONArray rows = new JSONArray();
            for (ClaudeChatRepository.Turn turn : state.turns)
                rows.put(new JSONObject().put("id", turn.id).put("role", turn.role)
                        .put("text", turn.text).put("state", turn.state));
            JSONObject json = new JSONObject().put("version", 1).put("conversation", state.conversation)
                    .put("draft", state.draft).put("error", state.error).put("model", state.model)
                    .put("turns", rows);
            byte[] bytes = json.toString().getBytes(StandardCharsets.UTF_8);
            if (bytes.length > MAX_FILE_BYTES) return false;
            output = file.startWrite();
            output.write(bytes);
            file.finishWrite(output);
            return true;
        } catch (IOException | JSONException | RuntimeException unavailable) {
            if (output != null) {
                try { file.failWrite(output); } catch (RuntimeException ignored) { }
            }
            return false;
        }
    }
}
