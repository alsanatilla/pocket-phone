package org.textphone.launcher;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import java.io.File;
import java.io.FileNotFoundException;

/** Private, explicitly granted carrier-download and attachment URIs. */
public final class MmsFiles extends ContentProvider {
    static Uri uri(String name) { return Uri.parse("content://org.textphone.launcher.mms/" + name); }
    static File file(android.content.Context c, Uri uri) {
        if (!"org.textphone.launcher.mms".equals(uri.getAuthority()) || uri.getPathSegments().size() != 1) throw new IllegalArgumentException("Invalid attachment URI.");
        String name = uri.getLastPathSegment(); if (name == null || !name.matches("[a-zA-Z0-9_-]+\\.[a-zA-Z0-9]+")) throw new IllegalArgumentException("Invalid attachment path.");
        File directory = new File(c.getFilesDir(), "mms"); if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("Attachment storage unavailable."); return new File(directory, name);
    }
    @Override public boolean onCreate() { return true; }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File file = file(getContext(), uri); if (!"r".equals(mode) && !uri.getLastPathSegment().endsWith(".pdu")) throw new FileNotFoundException("Attachment is read only.");
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.parseMode(mode));
    }
    @Override public String getType(Uri uri) { return getContext().getSharedPreferences("pocket_mms_types", 0).getString(uri.toString(), "application/vnd.wap.mms"); }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        File file = file(getContext(), uri); String[] columns = projection == null ? new String[]{"_display_name", "_size"} : projection; MatrixCursor cursor = new MatrixCursor(columns); Object[] values = new Object[columns.length];
        for (int i = 0; i < columns.length; i++) values[i] = "_display_name".equals(columns[i]) ? file.getName() : "_size".equals(columns[i]) ? file.length() : null; cursor.addRow(values); return cursor;
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String s, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String s, String[] args) { throw new UnsupportedOperationException(); }
}
