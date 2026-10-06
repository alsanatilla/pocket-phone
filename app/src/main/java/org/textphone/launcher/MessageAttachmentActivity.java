package org.textphone.launcher;

import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.widget.ImageView;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/** A read-only attachment page of Messages; it never adds attachments to Camera's album. */
public final class MessageAttachmentActivity extends PocketActivity {
    private Bitmap bitmap; private Uri uri; private String mime; private int page, generation;
    @Override protected void onCreate(Bundle state) { super.onCreate(state); uri = getIntent().getData(); mime = getIntent().getType(); if (state != null) page = state.getInt("page"); render(); }
    private void render() { int current = ++generation; screen("attachment"); releaseBitmap();
        boolean nativePart = uri != null && "content".equals(uri.getScheme()) && "mms".equals(uri.getAuthority()) && uri.getPath() != null && uri.getPath().matches("/part/[0-9]+");
        boolean localPart = uri != null && "content".equals(uri.getScheme()) && "org.textphone.launcher.mms".equals(uri.getAuthority());
        if (localPart) try { MmsFiles.file(this, uri); } catch (IllegalArgumentException e) { localPart = false; }
        if (!nativePart && !localPart) { body.addView(label("Attachment unavailable", 14, GRAY)); return; }
        if (mime == null) try { mime = getContentResolver().getType(uri); } catch (SecurityException e) { body.addView(label("Android blocked attachment access.", 14, GRAY)); return; }
        if (mime == null) mime = "application/octet-stream";
        action("share attachment", () -> { Intent share = new Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            share.setClipData(android.content.ClipData.newRawUri("attachment", uri)); startActivity(Intent.createChooser(share, "Share attachment")); });
        if (mime.startsWith("image/")) load(() -> FilesActivity.decode(uri, this), value -> { if (current != generation) { if (value != null) value.recycle(); return; } image(value); },
                error -> { if (current == generation) message("Attachment unavailable. Try again."); }, value -> { if (value != null) value.recycle(); });
        else if ("application/pdf".equals(mime)) load(() -> {
            try (ParcelFileDescriptor file = getContentResolver().openFileDescriptor(uri, "r"); PdfRenderer pdf = new PdfRenderer(file)) {
                int count = pdf.getPageCount(); if (count == 0) throw new java.io.IOException("Empty PDF");
                try (PdfRenderer.Page document = pdf.openPage(Math.min(page, count - 1))) {
                    float scale = Math.min(2f, 1200f / Math.max(document.getWidth(), document.getHeight()));
                    Bitmap image = Bitmap.createBitmap(Math.max(1, Math.round(document.getWidth() * scale)), Math.max(1, Math.round(document.getHeight() * scale)), Bitmap.Config.ARGB_8888);
                    try { image.eraseColor(Color.WHITE); document.render(image, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY); return new Object[]{image, count}; }
                    catch (RuntimeException | OutOfMemoryError failure) { image.recycle(); throw failure; }
                }
            }
        }, value -> { if (current != generation) { ((Bitmap)value[0]).recycle(); return; } int count = (int)value[1]; image((Bitmap)value[0]); body.addView(label("Page " + (page + 1) + " / " + count, 13, GRAY));
            softKeys(new String[]{"previous", "next"}, -1, () -> { if (page > 0) { page--; render(); } }, () -> { if (page + 1 < count) { page++; render(); } }); },
                error -> { if (current == generation) message("PDF unavailable. Try again."); }, value -> ((Bitmap)value[0]).recycle());
        else if (mime.startsWith("text/")) load(() -> { ByteArrayOutputStream text = new ByteArrayOutputStream(); try (InputStream input = getContentResolver().openInputStream(uri)) {
            if (input == null) throw new java.io.IOException(); byte[] buffer = new byte[8192]; int n; while ((n = input.read(buffer)) != -1) { if (text.size() + n > 256 * 1024) throw new java.io.IOException(); text.write(buffer, 0, n); }
            return java.nio.charset.StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(text.toByteArray())).toString(); }
        }, text -> { if (current != generation) return; android.widget.TextView view = label(text, 16, WHITE); view.setTextIsSelectable(true); body.addView(view); });
        else action("open with", () -> startActivity(Intent.createChooser(new Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "Open attachment")));
    }
    private void image(Bitmap image) { if (image == null) { message("Attachment unavailable"); return; } bitmap = image; ImageView view = new ImageView(this); view.setAdjustViewBounds(true); view.setImageBitmap(image); body.addView(view); }
    private void releaseBitmap() { if (bitmap != null) { releaseVisualHistory(); bitmap.recycle(); bitmap = null; } }
    @Override protected void onDestroy() { releaseBitmap(); super.onDestroy(); }
    @Override protected void onSaveInstanceState(Bundle state) { state.putInt("page", page); super.onSaveInstanceState(state); }
}
