package org.textphone.launcher;

import android.Manifest;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.text.InputType;
import android.widget.EditText;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.text.DateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import org.json.JSONObject;

/** Your paper journal in Pocket: photograph a page, keep the photo, get its text as a note with thoughts and tasks. */
public final class JournalActivity extends PocketActivity {
    private static final int CAPTURE = 811, IMPORT = 812;

    @Override protected void onCreate(Bundle state) { super.onCreate(state); render(); }
    @Override protected void onResume() { super.onResume(); render(); }
    @Override protected void onCloudSynced() { render(); }

    private void render() {
        screen("journal"); appSettings(this::settings);
        keys(new String[]{"photo", "import"}, this::photo, this::importPhoto).setTag("journal_add");
        if (!ClaudeKey.present(this)) body.addView(label("Add your Claude API key in Settings to read pages. Photos are kept and read once a key is set.", PocketDesign.SMALL, PocketDesign.WARNING));
        List<JSONObject> pages = JournalStore.visible(this);
        if (pages.isEmpty()) { body.addView(label("No pages yet. Photograph a journal page: Pocket keeps the photo and turns it into a note.", PocketDesign.SMALL, GRAY)); return; }
        body.addView(label("PAGES [" + pages.size() + "]", PocketDesign.META, GRAY));
        for (JSONObject page : pages) {
            String uid = page.optString("uid");
            action(title(page) + "\n" + subtitle(page), () -> startActivity(new Intent(this, JournalPageActivity.class).putExtra("page", uid))).setTag("page_" + uid);
        }
    }
    static String title(JSONObject page) {
        String title = page.optString("title", "");
        return !title.isEmpty() ? title : JournalStore.FAILED.equals(page.optString("state")) ? "Unread page" : "Reading…";
    }
    static String subtitle(JSONObject page) {
        String when = DateFormat.getDateInstance(DateFormat.MEDIUM).format(new Date(page.optLong("created")));
        switch (page.optString("state")) {
            case JournalStore.DONE: return when + " · " + page.optJSONArray("lines").length() + " lines" + (page.has("cents") ? String.format(Locale.ROOT, " · %.1f¢", page.optDouble("cents")) : "");
            case JournalStore.FAILED: return when + " · " + page.optString("error", "not read");
            default: return when + " · " + (page.optString("error", "").isEmpty() ? "waiting to be read" : page.optString("error"));
        }
    }

    private void photo() {
        permissions(() -> {
            Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, JournalFiles.captureUri())
                    .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            camera.setClipData(ClipData.newRawUri("", JournalFiles.captureUri()));
            JournalFiles.capture(this).delete();
            try { startActivityForResult(camera, CAPTURE); } catch (android.content.ActivityNotFoundException e) { message("No camera app can take the photo. Use import."); }
        }, Manifest.permission.CAMERA);
    }
    private void importPhoto() {
        try { startActivityForResult(new Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE), IMPORT); }
        catch (android.content.ActivityNotFoundException e) { message("No app can pick a photo."); }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (result != RESULT_OK) return;
        if (request == CAPTURE) keep(JournalFiles.capture(this), null);
        else if (request == IMPORT && data != null && data.getData() != null) keep(null, data.getData());
    }
    /** Copies the photo in, keeps it as a page and asks for it to be read once the phone is online. */
    private void keep(File photo, Uri picked) {
        message("Keeping the page…");
        load(() -> {
            File source = photo;
            if (picked != null) {
                source = new File(getCacheDir(), "journal-import.jpg");
                try (InputStream in = getContentResolver().openInputStream(picked); OutputStream out = new FileOutputStream(source)) {
                    if (in == null) throw new java.io.IOException("The photo could not be opened.");
                    byte[] buffer = new byte[16384]; for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
                }
            }
            String uid = JournalStore.add(getApplicationContext(), source); source.delete(); return uid;
        }, uid -> {
            JournalJob.schedule(this);
            message(ClaudeKey.present(this) ? "Page kept. Reading it…" : "Page kept. Add your Claude API key in Settings to read it.");
            render();
        });
    }

    private void settings() {
        boolean present = ClaudeKey.present(this);
        String[] items = present ? new String[]{"Claude API key · set (" + ClaudeKey.hint(this) + ")", "Remove key", "Read waiting pages now"} : new String[]{"Claude API key · not set", "Read waiting pages now"};
        new AlertDialog.Builder(this).setTitle("Journal settings").setItems(items, (d, which) -> {
            if (closed) return;
            if (which == 0) enterKey();
            else if (present && which == 1) confirm("Remove the API key from this phone?", () -> { ClaudeKey.clear(this); render(); message("Key removed."); });
            else { JournalJob.schedule(this); message("Reading waiting pages once online…"); }
        }).show();
    }
    private void enterKey() {
        EditText field = new EditText(this); field.setTag("claude_key_field"); PocketDesign.input(field); field.setSingleLine(true);
        field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD); field.setHint("sk-ant-…");
        new AlertDialog.Builder(this).setTitle("Claude API key")
                .setMessage("Stored only on this phone, encrypted by Android's Keystore. Pages are read with Claude Sonnet 5.5, about 1–2¢ each, billed to your Anthropic account.")
                .setView(field).setNegativeButton("Cancel", null).setPositiveButton("Save", (d, w) -> {
                    if (closed) return;
                    try { ClaudeKey.save(this, field.getText().toString()); JournalJob.schedule(this); render(); message("Key saved. Waiting pages are read once online."); }
                    catch (IllegalArgumentException | IllegalStateException e) { message(e.getMessage()); }
                }).show();
    }
}
