package org.textphone.launcher;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import java.io.File;
import java.io.FileNotFoundException;

/** The one file a camera app may write a journal photo into, granted explicitly for a single capture. */
public final class JournalFiles extends ContentProvider {
    static final String AUTHORITY = "org.textphone.launcher.journal";
    static Uri captureUri() { return Uri.parse("content://" + AUTHORITY + "/capture.jpg"); }
    static File capture(Context c) { return new File(c.getCacheDir(), "journal-capture.jpg"); }
    @Override public boolean onCreate() { return true; }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!captureUri().equals(uri)) throw new FileNotFoundException("Unknown journal file.");
        return ParcelFileDescriptor.open(capture(getContext()), ParcelFileDescriptor.parseMode(mode));
    }
    @Override public String getType(Uri uri) { return "image/jpeg"; }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        String[] columns = projection == null ? new String[]{"_display_name", "_size"} : projection; MatrixCursor cursor = new MatrixCursor(columns);
        Object[] values = new Object[columns.length]; File file = capture(getContext());
        for (int i = 0; i < columns.length; i++) values[i] = "_display_name".equals(columns[i]) ? "capture.jpg" : "_size".equals(columns[i]) ? file.length() : null;
        cursor.addRow(values); return cursor;
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String s, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String s, String[] args) { throw new UnsupportedOperationException(); }
}
