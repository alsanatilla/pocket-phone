package org.textphone.launcher;

import static org.junit.Assert.*;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.provider.ContactsContract;
import android.provider.CalendarContract;
import java.util.ArrayList;
import java.util.List;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowContentResolver;

@RunWith(RobolectricTestRunner.class)
@Config(sdk={24,35})
public class NativeDataTest {
    private Context context; private Provider provider;
    @Before public void start() { context=RuntimeEnvironment.getApplication(); context.getSharedPreferences("pocket_agenda",0).edit().clear().commit(); provider=new Provider();
        ProviderInfo info=new ProviderInfo();info.authority="com.android.contacts";info.exported=true;provider.attachInfo(context,info);
        ShadowContentResolver.registerProviderInternal("com.android.contacts",provider);ShadowContentResolver.registerProviderInternal("com.android.calendar",provider); }
    @Test public void contactCreationUsesNativeRawContactBackReferencesAndStructuredData() throws Exception {
        ContactBook.save(context.getContentResolver(),0,"Ada","+49305550100","ada@example.test");
        assertEquals(4,provider.inserted.size());assertNull(provider.inserted.get(0).getAsString("account_name"));
        for(int i=1;i<provider.inserted.size();i++) assertEquals(Long.valueOf(42),provider.inserted.get(i).getAsLong("raw_contact_id"));
        assertEquals(ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE,provider.inserted.get(2).getAsString("mimetype"));
        assertEquals("+49305550100",provider.inserted.get(2).getAsString("data1"));
    }
    @Test public void editingAPrimaryContactFieldDoesNotDeleteSecondaryNumbers() throws Exception {
        ContactBook.save(context.getContentResolver(),42,"Ada","+49305550200","ada@example.test");
        assertEquals(0,provider.deletes);assertEquals(3,provider.updated.size());assertEquals("101",provider.selections.get(1));
        assertEquals("+49305550200",provider.updated.get(1).getAsString("data1"));
    }
    @Test public void calendarStaysLocalEvenWithALegacyGoogleSelection(){AgendaStore.Event event=new AgendaStore.Event();event.title="Review draft";event.when=System.currentTimeMillis()+3600000;context.getSharedPreferences("pocket_agenda",0).edit().putLong("google_calendar",7).commit();assertTrue(CalendarBridge.write(context,event));AgendaStore.save(context,event);assertEquals(0,event.google);assertEquals(0,event.calendar);assertEquals("Review draft",AgendaStore.find(context,event.id).title);assertTrue(provider.inserted.isEmpty());assertTrue(provider.updated.isEmpty());assertEquals(0,provider.deletes);}
    @Test public void attachmentProviderCannotExposeOtherPrivateFiles() {
        for(String value:new String[]{"content://org.textphone.launcher.mms/../secret.p12","content://org.textphone.launcher.mms/a/b.pdu","content://other.app/key.pdu"}) {
            try {MmsFiles.file(context,Uri.parse(value));fail(value);}catch(IllegalArgumentException expected){assertNotNull(expected.getMessage());}
        }
        assertEquals(new java.io.File(context.getFilesDir(),"mms/safe-file.pdu"),MmsFiles.file(context,MmsFiles.uri("safe-file.pdu")));
    }
    static final class Provider extends ContentProvider {
        List<ContentValues> inserted=new ArrayList<>(),updated=new ArrayList<>();List<String> selections=new ArrayList<>();int deletes;
        public boolean onCreate(){return true;}
        public Uri insert(Uri uri,ContentValues values){inserted.add(new ContentValues(values));return uri.buildUpon().appendPath("42").build();}
        public int update(Uri uri,ContentValues values,String s,String[] a){updated.add(new ContentValues(values));selections.add(a==null?"":a[0]);return 1;}
        public int delete(Uri uri,String s,String[] a){deletes++;return 1;}public String getType(Uri uri){return "vnd.android.cursor.item";}
        public Cursor query(Uri uri,String[] projection,String selection,String[] args,String order){MatrixCursor result=new MatrixCursor(projection==null?new String[]{"_id"}:projection);
            if("com.android.contacts".equals(uri.getAuthority())&&projection!=null&&projection.length==1){String type=args[1];long id=ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE.equals(type)?101:ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE.equals(type)?102:100;result.addRow(new Object[]{id});}return result;}
    }
}
