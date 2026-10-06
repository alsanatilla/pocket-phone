package org.textphone.launcher;

import android.content.Intent;
import android.os.Bundle;
import android.widget.TextView;
import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** Account note checkpoints and thirty-day deletion recovery, shared with the web. */
public final class NoteHistoryActivity extends PocketActivity {
    private long noteId;
    private String uid;
    private boolean deleted, saving;
    private JSONObject selected;
    private final List<JSONObject> versions = new ArrayList<>();
    private int generation;
    private PlannerStore planner;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state); planner = new PlannerStore(getSharedPreferences("pocket_planner", 0));
        noteId = getIntent().getLongExtra("note", 0); deleted = noteId == 0;
        uid = deleted ? "" : NoteSync.uid(planner, noteId); render(); refresh();
    }
    @Override protected boolean hasInternalBack() { return selected != null; }
    @Override public void onBackPressed() { if (selected != null && !saving) { back(() -> { selected = null; render(); }); } else if (!saving) super.onBackPressed(); }
    @Override protected void onCloudSynced() { if (selected == null && !saving) refresh(); }
    private void refresh() {
        if (!PocketCloud.selected(this) || !PocketCloud.saved(this)) { message("Sign in to Pocket to load history."); return; }
        int request = ++generation; String account = PocketCloud.accountId(this); message("Loading…");
        load(() -> PocketCloud.api(getApplicationContext(), "GET", deleted ? "/api/history/deleted" : "/api/history/notes/" + android.net.Uri.encode(uid), null), result -> {
            if (request != generation || selected != null) return;
            if(!account.equals(result.optString("accountId"))||!account.equals(PocketCloud.accountId(this))){message("Pocket account changed.");return;}
            JSONArray list = result.optJSONArray(deleted ? "notes" : "versions"); versions.clear();
            PlannerStore.Entry note = deleted ? null : planner.find(noteId); String current = note == null ? "" : note.text;
            if (list != null) for (int i = 0; i < list.length(); i++) {
                JSONObject version = list.optJSONObject(i); if (version == null || !deleted && version.optString("text").equals(current)) continue; versions.add(version);
            }
            render(); if (versions.isEmpty()) message(deleted ? "No recently deleted notes." : "No earlier versions yet.");
        }, error -> { if (request == generation) { render(); message(error.getMessage()); } });
    }
    private void render() {
        screen(deleted ? "recently deleted" : "history", selected == null ? "history" : "version");
        if (selected != null) {
            section(stamp(selected.optLong("updated")));
            TextView preview = label(selected.optString("text"), PocketDesign.BODY, WHITE); preview.setTextIsSelectable(true); body.addView(preview);
            softKeys(new String[]{"back", saving ? "restoring…" : "restore"}, 1, this::onBackPressed, this::restore);
            return;
        }
        for (JSONObject version : versions) {
            String title = deleted ? ReadableRows.excerpt(version.optString("text"))[0] : stamp(version.optLong("updated"));
            String sub = deleted ? "deleted " + stamp(version.optLong("updated")) : ReadableRows.excerpt(version.optString("text"))[0];
            body.addView(ReadableRows.item(this, title, sub, GRAY, "note_version_" + version.optLong("id"), () -> { selected = version; render(); }));
        }
        if (!versions.isEmpty()) softKeys(new String[]{"refresh"}, -1, this::refresh);
    }
    private void restore() {
        if (selected == null || saving) return;
        confirm(deleted ? "Restore this deleted note?" : "Restore this version?", () -> {
            if (selected == null || saving) return; saving = true; JSONObject version = selected; render();
            load(() -> {
                if (deleted) {
                    long restored = planner.save(0, "note", version.getString("text")); NoteSync.uid(planner, restored);
                    CloudSync.changed(getApplicationContext()); return restored;
                }
                PlannerStore.Entry note = planner.find(noteId); if (note == null) throw new java.io.IOException("This note was removed.");
                JSONObject current = new JSONObject().put("uid", uid).put("text", note.text).put("pinned", planner.notePinned(noteId))
                        .put("created", note.created).put("updated", planner.noteUpdated(note)).put("deleted", false);
                String draft = planner.hasDraft("note", noteId) ? planner.draft("note", noteId) : null;
                if (draft != null && !draft.trim().isEmpty() && !draft.equals(note.text)) current.put("text", draft).put("updated", Math.max(System.currentTimeMillis(), current.getLong("updated") + 1));
                JSONObject response = PocketCloud.api(getApplicationContext(), "POST", "/api/history/notes/" + android.net.Uri.encode(uid) + "/restore",
                        new JSONObject().put("version", version.getLong("id")).put("current", current));
                if (!PocketCloud.accountId(this).equals(response.optString("accountId"))) throw new java.io.IOException("Pocket account changed.");
                NoteSync.merge(getApplicationContext(), response.getJSONObject("document").getJSONObject("value"));
                if (draft != null && draft.equals(planner.draft("note", noteId))) planner.clearDraft("note", noteId);
                CloudSync.changed(getApplicationContext()); return noteId;
            }, restored -> { saving = false; setResult(RESULT_OK, new Intent().putExtra("note", restored)); finish(); }, error -> { saving = false; render(); message(error.getMessage()); });
        });
    }
    private static String stamp(long at) { return DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(new Date(at)); }
}
