package org.textphone.launcher;

import static org.junit.Assert.*;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowContentResolver;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {29, 35})
public class PhotoStoreTest {
    private Library provider;
    private File source, destination;
    @Before public void setup() throws Exception {
        source = File.createTempFile("pocket-source-", ".jpg");
        destination = File.createTempFile("pocket-destination-", ".jpg");
        Files.write(source.toPath(), new byte[]{(byte)255, (byte)216, 1, 2, 3, (byte)255, (byte)217});
        provider = new Library(destination);
        ProviderInfo info = new ProviderInfo(); info.authority = "media"; info.exported = true;
        provider.attachInfo(RuntimeEnvironment.getApplication(), info);
        ShadowContentResolver.registerProviderInternal("media", provider);
    }
    @After public void cleanup() { source.delete(); destination.delete(); }
    @Test public void savesOnlyCompleteJpegsInTheNativeDcimAlbum() throws Exception {
        Uri uri = PhotoStore.save(RuntimeEnvironment.getApplication(), source, "DSC_test.JPG", 2048, 1536, 123456L);
        assertEquals(Uri.parse("content://media/external/images/media/42"), uri);
        assertEquals(List.of("insert", "write", "publish"), provider.events);
        assertArrayEquals(Files.readAllBytes(source.toPath()), Files.readAllBytes(destination.toPath()));
        assertEquals("DCIM/Pocket", provider.values.getAsString(MediaStore.Images.Media.RELATIVE_PATH));
        assertEquals("image/jpeg", provider.values.getAsString(MediaStore.Images.Media.MIME_TYPE));
        assertEquals(Integer.valueOf(2048), provider.values.getAsInteger(MediaStore.Images.Media.WIDTH));
        assertFalse(provider.values.containsKey(MediaStore.Images.Media.DATA));
    }
    @Test public void failedWritesAndFailedPublishingRemoveThePendingPhoto() throws Exception {
        provider.failWrite = true;
        try { PhotoStore.save(RuntimeEnvironment.getApplication(), source, "bad.JPG", 1, 1, 0); fail(); }
        catch (IOException expected) { assertEquals(List.of("insert", "write", "delete"), provider.events); }
        provider.events.clear(); provider.failWrite = false; provider.failPublish = true;
        try { PhotoStore.save(RuntimeEnvironment.getApplication(), source, "bad.JPG", 1, 1, 0); fail(); }
        catch (IOException expected) { assertEquals(List.of("insert", "write", "publish", "delete"), provider.events); }
    }
    static final class Library extends ContentProvider {
        final File destination;
        final List<String> events = new ArrayList<>();
        ContentValues values;
        boolean failWrite, failPublish;
        Library(File destination) { this.destination = destination; }
        @Override public boolean onCreate() { return true; }
        @Override public Uri insert(Uri uri, ContentValues supplied) {
            values = new ContentValues(supplied); events.add("insert");
            assertEquals(Integer.valueOf(1), supplied.getAsInteger(MediaStore.Images.Media.IS_PENDING));
            return Uri.parse("content://media/external/images/media/42");
        }
        @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
            events.add("write");
            if (failWrite) throw new FileNotFoundException("fixture storage failure");
            return ParcelFileDescriptor.open(destination, ParcelFileDescriptor.MODE_WRITE_ONLY | ParcelFileDescriptor.MODE_TRUNCATE);
        }
        @Override public int update(Uri uri, ContentValues values, String selection, String[] args) {
            events.add("publish"); assertEquals(Integer.valueOf(0), values.getAsInteger(MediaStore.Images.Media.IS_PENDING));
            return failPublish ? 0 : 1;
        }
        @Override public int delete(Uri uri, String selection, String[] args) { events.add("delete"); return 1; }
        @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) { return new MatrixCursor(new String[]{"_id"}); }
        @Override public String getType(Uri uri) { return "image/jpeg"; }
    }
}
