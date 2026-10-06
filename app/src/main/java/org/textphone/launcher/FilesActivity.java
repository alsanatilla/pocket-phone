package org.textphone.launcher;

import android.Manifest;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.widget.ImageView;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/** Files is Pocket Camera's own album, not a device file browser. */
public final class FilesActivity extends PocketActivity {
    private List<CameraAlbum.Photo> photos = new ArrayList<>();
    private Bitmap bitmap; private Uri opened; private boolean viewing, direct; private int generation, page;
    private android.widget.LinearLayout albumRows; private boolean resumedOnce, albumLoaded;
    private static final int PAGE_SIZE = 60;
    @Override protected void onCreate(Bundle state) { super.onCreate(state); releaseOldFolderAccess();
        page = state == null ? 0 : state.getInt("page");
        if (state != null && state.getString("photo") != null) opened = Uri.parse(state.getString("photo"));
        else { opened = getIntent().getData(); direct = opened != null; }
        if (state != null) direct = state.getBoolean("direct");
        if (opened != null) open(opened); else album();
    }
    private void releaseOldFolderAccess() {
        if (getPreferences(0).getBoolean("camera_album_only", false)) return;
        for (android.content.UriPermission grant : new ArrayList<>(getContentResolver().getPersistedUriPermissions())) try {
            int flags = (grant.isReadPermission() ? Intent.FLAG_GRANT_READ_URI_PERMISSION : 0) | (grant.isWritePermission() ? Intent.FLAG_GRANT_WRITE_URI_PERMISSION : 0);
            getContentResolver().releasePersistableUriPermission(grant.getUri(), flags);
        } catch (SecurityException ignored) { }
        getPreferences(0).edit().remove("tree").remove("tree_write").putBoolean("camera_album_only", true).apply();
    }
    @Override protected void onResume() { super.onResume(); if (resumedOnce && !viewing) { if (albumRows == null) album(); else refreshAlbum(); } resumedOnce = true; }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); if (intent.getData() != null) { direct = true; open(intent.getData()); } }
    private boolean access(Runnable ready) {
        if (Build.VERSION.SDK_INT <= 28 && !permitted(Manifest.permission.READ_EXTERNAL_STORAGE)) {
            body.addView(label("Older Android needs storage permission to read saved camera photos. This album still shows only Pocket captures.", 13, GRAY));
            action("allow saved photos", () -> permissions(ready, Manifest.permission.READ_EXTERNAL_STORAGE)); return false;
        } return true;
    }
    private void album() { viewing = false; direct = false; opened = null; ++generation; screen("photos", "files:" + page); releaseBitmap(); albumRows = null;
        section("pocket camera photos");
        softKeys(new String[]{"camera", "refresh"}, -1, () -> startActivity(new Intent(this, CompactCameraActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)), this::refreshAlbum);
        if (!access(this::album)) return;
        albumRows = new android.widget.LinearLayout(this); albumRows.setOrientation(android.widget.LinearLayout.VERTICAL); body.addView(albumRows);
        if (albumLoaded) fillAlbum(); else albumRows.addView(label("Loading photos…", 13, GRAY)); refreshAlbum();
    }
    private void refreshAlbum() { if (viewing) return; if (albumRows == null) { album(); return; } int current = ++generation;
        load(() -> CameraAlbum.list(this), values -> { if (current != generation || viewing) return;
            boolean changed = !albumLoaded || !samePhotos(photos, values); photos = values; albumLoaded = true; if (changed) fillAlbum();
        }, error -> { if (current != generation || viewing) return;
            if (!albumLoaded) { albumRows.removeAllViews(); albumRows.addView(label("Could not read Pocket's photo album. Tap Refresh to retry.", 14, GRAY)); }
            else message("Could not read Pocket's photo album. Tap Refresh to retry."); });
    }
    private static boolean samePhotos(List<CameraAlbum.Photo> a, List<CameraAlbum.Photo> b) {
        if (a.size() != b.size()) return false; for (int i = 0; i < a.size(); i++) if (!a.get(i).uri.equals(b.get(i).uri) || a.get(i).taken != b.get(i).taken || !a.get(i).name.equals(b.get(i).name)) return false; return true;
    }
    private void fillAlbum() { albumRows.removeAllViews();
        if (photos.isEmpty()) { albumRows.addView(label("No Pocket photos yet. Take a picture with Pocket Camera and it will appear here.", 14, GRAY)); return; }
        albumRows.addView(label(photos.size() + (photos.size() == 1 ? " photo" : " photos") + (photos.size() == 2000 ? " · newest 2,000" : ""), 13, GRAY));
        page = Math.min(page, (photos.size() - 1) / PAGE_SIZE); int end = Math.min(photos.size(), (page + 1) * PAGE_SIZE);
        for (int i = page * PAGE_SIZE; i < end; i++) { CameraAlbum.Photo p = photos.get(i); albumRows.addView(item(p.name + "\n" + date(p.taken), () -> open(p.uri)), new android.widget.LinearLayout.LayoutParams(-1, -2)); }
        if (photos.size() > PAGE_SIZE) { android.widget.LinearLayout controls = row();
            controls.addView(button("previous", () -> { if (page > 0) back(() -> { page--; album(); }); }), new android.widget.LinearLayout.LayoutParams(0, dp(56), 1));
            controls.addView(button("next", () -> { if ((page + 1) * PAGE_SIZE < photos.size()) { page++; album(); } }), new android.widget.LinearLayout.LayoutParams(0, dp(56), 1)); albumRows.addView(controls); }
    }
    private String date(long taken) { return taken > 0 ? java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT, java.text.DateFormat.SHORT).format(new java.util.Date(taken)) : "Pocket Camera"; }
    private void open(Uri uri) { viewing = true; opened = uri; int current = ++generation; screen("photo","photo:"+uri); releaseBitmap(); headerAction("album",this::album,false);
        if (!access(() -> open(uri))) return;
        if (!CameraAlbum.mediaUri(uri)) { body.addView(label("This photo was not taken with Pocket Camera.", 14, GRAY)); return; }
        load(() -> CameraAlbum.list(this), album -> {
            if (current != generation) return;
            CameraAlbum.Photo photo=null;int index=-1;for(int i=0;i<album.size();i++)if(album.get(i).uri.equals(uri)){photo=album.get(i);index=i;break;}
            if (photo == null) { body.addView(label("This photo is unavailable or was not taken with Pocket Camera.", 14, GRAY)); return; }
            final CameraAlbum.Photo selected=photo;final int position=index;
            body.addView(label(date(photo.taken)+" · "+(index+1)+" / "+album.size(),13,GRAY));
            android.widget.LinearLayout controls=softKeys(new String[]{"previous","share","next"},-1,()->open(album.get(position-1).uri),()->{Intent send=new Intent(Intent.ACTION_SEND).setType("image/jpeg").putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);send.setClipData(android.content.ClipData.newRawUri("Pocket photo",uri));startActivity(Intent.createChooser(send,"Share photo"));},()->open(album.get(position+1).uri));
            controls.setTag("photo_controls");android.view.View previous=controls.getChildAt(0),share=controls.getChildAt(1),next=controls.getChildAt(2);
            previous.setTag("photo_previous");previous.setEnabled(index>0);share.setEnabled(false);share.setContentDescription("Share photo");next.setTag("photo_next");next.setEnabled(index<album.size()-1);
            load(() -> decode(uri), image -> { if (current != generation) { if (image != null) image.recycle(); return; }
                if (image == null) { body.addView(label("Photo unavailable. It may have been removed.", 14, GRAY)); return; }
                bitmap = image; ImageView view = new ImageView(this); view.setAdjustViewBounds(true); view.setImageBitmap(image); view.setContentDescription(selected.name); body.addView(view);share.setEnabled(true);
            }, error -> { if (current == generation) body.addView(label("Photo unavailable. It may have been removed.", 14, GRAY)); }, image -> { if (image != null) image.recycle(); });
        }, error -> { if (current == generation) body.addView(label("Could not open this Pocket photo. Return to All photos and refresh.", 14, GRAY)); });
    }
    static Bitmap decode(Uri uri, android.content.Context c) throws Exception { BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
        try (InputStream input = c.getContentResolver().openInputStream(uri)) { if (input == null) throw new java.io.IOException(); BitmapFactory.decodeStream(input, null, bounds); }
        if (bounds.outWidth < 1 || bounds.outHeight < 1) throw new java.io.IOException("Photo unavailable");
        BitmapFactory.Options options = new BitmapFactory.Options(); options.inSampleSize = 1;
        while (bounds.outWidth / options.inSampleSize > 1600 || bounds.outHeight / options.inSampleSize > 1600) options.inSampleSize *= 2;
        try (InputStream input = c.getContentResolver().openInputStream(uri)) { return BitmapFactory.decodeStream(input, null, options); }
    }
    private Bitmap decode(Uri uri) throws Exception { return decode(uri, this); }
    private void releaseBitmap() { if (bitmap != null) { releaseVisualHistory(); bitmap.recycle(); bitmap = null; } }
    @Override protected void onDestroy() { releaseBitmap(); super.onDestroy(); }
    @Override protected void onSaveInstanceState(Bundle state) { state.putInt("page", page); state.putBoolean("direct", direct); if (viewing && opened != null) state.putString("photo", opened.toString()); super.onSaveInstanceState(state); }
    // A photo opened from Camera returns to Camera; one opened from the album returns to the album.
    @Override protected boolean hasInternalBack() { return viewing && !direct; }
    @Override public void onBackPressed() { if (hasInternalBack()) back(this::album); else super.onBackPressed(); }
}
