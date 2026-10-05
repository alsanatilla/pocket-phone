package org.textphone.launcher;

import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapRegionDecoder;
import android.graphics.Rect;
import android.os.Bundle;
import android.view.View;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** One journal page: its text, and your handwriting behind it. Tap a line to see that strip of the photo. */
public final class JournalPageActivity extends PocketActivity {
    private static final float STRIP_PADDING = 0.012f;
    private String uid;
    private boolean paper;
    private final List<Bitmap> bitmaps = new ArrayList<>();

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state); uid = getIntent().getStringExtra("page");
        paper = state != null && state.getBoolean("paper"); render();
    }
    @Override protected void onSaveInstanceState(Bundle out) { out.putBoolean("paper", paper); super.onSaveInstanceState(out); }
    @Override protected void onCloudSynced() { render(); }
    @Override protected void onDestroy() { release(); super.onDestroy(); }
    private void release() { for (Bitmap b : bitmaps) b.recycle(); bitmaps.clear(); }

    private void render() {
        JSONObject page = JournalStore.find(this, uid);
        if (page == null || page.optBoolean("deleted")) { screen("page"); body.addView(label("This page was removed.", PocketDesign.BODY, GRAY)); return; }
        release();
        screen(JournalActivity.title(page)); headerAction(paper ? "text" : "paper", () -> { paper = !paper; render(); }, false).setTag("page_mode");
        body.addView(label(JournalActivity.subtitle(page), PocketDesign.META, GRAY));
        File image = JournalStore.image(this, uid);
        if (paper) showPaper(image);
        else {
            JSONArray lines = page.optJSONArray("lines");
            if (lines == null || lines.length() == 0) body.addView(label(JournalStore.DONE.equals(page.optString("state")) ? "No text on this page." : "The text appears here once the page is read.", PocketDesign.SMALL, GRAY));
            for (int i = 0; lines != null && i < lines.length(); i++) line(lines.optJSONObject(i), image);
        }
        String note = page.optString("note", "");
        PlannerStore planner = new PlannerStore(getSharedPreferences("pocket_planner", 0));
        PlannerStore.Entry entry = NoteSync.byUid(planner, note);
        keys(new String[]{"open note", "read again", "delete"},
                () -> { if (entry == null) message("The note appears once the page is read."); else startActivity(new Intent(this, OrganizerActivity.class).putExtra("pocket_note", entry.id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); },
                () -> confirm("Read the page again? The note's text is replaced by the new reading.", () -> {
                    JournalStore.update(this, uid, p -> p.put("state", JournalStore.WAITING).put("error", "")); JournalJob.schedule(this); render(); message("Reading again once online."); }),
                () -> confirm("Delete this page and its photo? The note stays.", () -> { JournalStore.delete(this, uid); finish(); }));
    }
    /** A line of text; tapping it unfolds the strip of the photo where it was written. */
    private void line(JSONObject line, File image) {
        if (line == null) return;
        String text = line.optString("note_line", ""); if (text.isEmpty()) text = line.optString("text", ""); if (text.isEmpty()) return;
        TextView row = label(text.replaceFirst("^- \\[ \\] ", "☐ ").replaceFirst("^- ", "· ").replaceFirst("^# ", ""), PocketDesign.BODY, "blue".equals(line.optString("ink")) ? 0xFF8FB8FF : WHITE);
        PocketDesign.row(row, WHITE); row.setMinHeight(dp(48)); body.addView(row);
        JSONArray uncertain = line.optJSONArray("uncertain");
        if (uncertain != null && uncertain.length() > 0) {
            StringBuilder words = new StringBuilder(); for (int i = 0; i < uncertain.length(); i++) { if (i > 0) words.append(", "); words.append(uncertain.optString(i)); }
            body.addView(label("unsure: " + words, PocketDesign.META, PocketDesign.WARNING));
        }
        ImageView strip = new ImageView(this); strip.setAdjustViewBounds(true); strip.setVisibility(View.GONE); strip.setContentDescription("Handwriting of this line");
        body.addView(strip, new LinearLayout.LayoutParams(-1, -2));
        row.setOnClickListener(v -> {
            if (strip.getVisibility() == View.VISIBLE) { strip.setVisibility(View.GONE); return; }
            Bitmap cut = strip(image, line.optDouble("top", 0), line.optDouble("bottom", 0));
            if (cut == null) { message("No photo strip for this line."); return; }
            bitmaps.add(cut); strip.setImageBitmap(cut); strip.setVisibility(View.VISIBLE);
        });
    }
    private Bitmap strip(File image, double top, double bottom) {
        if (!image.isFile() || bottom <= top) return null;
        try {
            BitmapRegionDecoder decoder = BitmapRegionDecoder.newInstance(image.getPath(), false);
            try {
                int h = decoder.getHeight(), w = decoder.getWidth();
                int y0 = (int) Math.max(0, (top - STRIP_PADDING) * h), y1 = (int) Math.min(h, (bottom + STRIP_PADDING) * h);
                if (y1 - y0 < 4) return null;
                return decoder.decodeRegion(new Rect(0, y0, w, y1), new BitmapFactory.Options());
            } finally { decoder.recycle(); }
        } catch (java.io.IOException | RuntimeException e) { return null; }
    }
    private void showPaper(File image) {
        if (!image.isFile()) { body.addView(label("The photo is not on this phone.", PocketDesign.SMALL, GRAY)); return; }
        BitmapFactory.Options options = new BitmapFactory.Options(); options.inSampleSize = 1;
        BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true; BitmapFactory.decodeFile(image.getPath(), bounds);
        while (bounds.outWidth / (options.inSampleSize * 2) >= getResources().getDisplayMetrics().widthPixels) options.inSampleSize *= 2;
        Bitmap whole = BitmapFactory.decodeFile(image.getPath(), options); if (whole == null) return;
        bitmaps.add(whole); ImageView view = new ImageView(this); view.setAdjustViewBounds(true); view.setImageBitmap(whole); view.setContentDescription("Journal page photo");
        body.addView(view, new LinearLayout.LayoutParams(-1, -2));
    }
}
