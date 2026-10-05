package org.textphone.launcher;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import java.io.File;
import java.io.FileNotFoundException;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import org.junit.Before;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowContentResolver;

@RunWith(RobolectricTestRunner.class)
@Config(sdk={23,35})
public class FilesAndMmsTest {
    private Context c; private File file;
    @Before public void setup() throws Exception {c=RuntimeEnvironment.getApplication();file=File.createTempFile("pocket-native-data-",".txt");}
    @After public void cleanup(){file.delete();}
    @Test public void receivedMmsStoresNativePartsAndRollsBackAnIncompleteAttachment() throws Exception {
        MmsProvider provider=new MmsProvider(file);ProviderInfo info=new ProviderInfo();info.authority="mms";info.exported=true;provider.attachInfo(c,info);
        ShadowContentResolver.registerProviderInternal("mms",provider);ShadowContentResolver.registerProviderInternal("mms-sms",provider);
        MmsCodec.Pdu pdu=new MmsCodec.Pdu();pdu.from="+49305550100";MmsCodec.Part text=new MmsCodec.Part();text.mime="text/plain";text.data="Hello".getBytes(StandardCharsets.UTF_8);
        MmsCodec.Part image=new MmsCodec.Part();image.mime="image/jpeg";image.data=new byte[]{1,2,3,4};pdu.parts.add(text);pdu.parts.add(image);
        NativeMms.save(c,pdu,1);assertArrayEquals(image.data,Files.readAllBytes(file.toPath()));assertEquals(Integer.valueOf(132),provider.message.getAsInteger("m_type"));assertEquals(2,provider.parts);assertEquals(0,provider.deleted);
        provider.failWrite=true;try{NativeMms.save(c,pdu,1);fail();}catch(Exception expected){assertEquals(1,provider.deleted);}
    }
    static final class MmsProvider extends ContentProvider {
        final File file;int parts,deleted;ContentValues message;boolean failWrite;MmsProvider(File file){this.file=file;}
        public boolean onCreate(){return true;}public Uri insert(Uri uri,ContentValues values){if("/".equals(uri.getPath())||uri.getPath()==null||uri.getPath().isEmpty()){message=new ContentValues(values);return Uri.parse("content://mms/42");}
            if(uri.getPath().endsWith("part")){parts++;return Uri.parse("content://mms/part/"+parts);}return Uri.parse("content://mms/42/addr/1");}
        public Cursor query(Uri uri,String[] p,String s,String[] a,String order){MatrixCursor cursor=new MatrixCursor(new String[]{"_id"});cursor.addRow(new Object[]{7});return cursor;}
        public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException{if(failWrite)throw new FileNotFoundException("fixture write failure");return ParcelFileDescriptor.open(file,ParcelFileDescriptor.parseMode(mode));}
        public int delete(Uri uri,String s,String[] args){deleted++;return 1;}public int update(Uri uri,ContentValues values,String s,String[] args){return 1;}public String getType(Uri uri){return "image/jpeg";}
    }
}
