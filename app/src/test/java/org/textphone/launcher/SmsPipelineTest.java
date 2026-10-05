package org.textphone.launcher;

import static org.junit.Assert.*;
import android.app.Activity;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.Looper;
import android.provider.Telephony;
import android.telephony.SmsManager;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowContentResolver;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {23,35})
public class SmsPipelineTest {
    private Context c; private Provider provider;
    @Before public void setup() { c = RuntimeEnvironment.getApplication(); c.getSharedPreferences("pocket_sms_results",0).edit().clear().commit(); provider = new Provider();
        ProviderInfo info = new ProviderInfo(); info.authority = "sms"; info.exported = true; provider.attachInfo(c,info);
        ShadowContentResolver.registerProviderInternal("sms",provider); ShadowContentResolver.registerProviderInternal("mms-sms",provider); }
    @Test public void messageIsStoredAsPendingBeforeTheCarrierGetsItAndReceiptsDetermineSuccess() {
        MessageBook.send(c,"+49305550100","Hello",1); assertEquals(Integer.valueOf(Telephony.Sms.MESSAGE_TYPE_OUTBOX), provider.values.getAsInteger("type"));
        assertEquals("sending",MessagesActivity.sendState(provider.values.getAsInteger("type")));
        org.robolectric.shadows.ShadowSmsManager.TextMultipartParams sent = Shadows.shadowOf(android.os.Build.VERSION.SDK_INT >= 31 ? c.getSystemService(SmsManager.class).createForSubscriptionId(1) : SmsManager.getSmsManagerForSubscriptionId(1)).getLastSentMultipartTextMessageParams();
        assertEquals("+49305550100",sent.getDestinationAddress()); assertEquals("Hello",String.join("",sent.getParts())); assertEquals(1,sent.getSentIntents().size());
        receipt(Activity.RESULT_OK,0); assertEquals(Integer.valueOf(Telephony.Sms.MESSAGE_TYPE_SENT),provider.values.getAsInteger("type"));
        assertEquals("sent",MessagesActivity.sendState(provider.values.getAsInteger("type")));assertEquals("draft",MessagesActivity.sendState(Telephony.Sms.MESSAGE_TYPE_DRAFT));
    }
    @Test public void failedMultipartReceiptCannotBeTurnedIntoSuccessByAnotherPart() {
        MessageBook.send(c,"+49305550100","x".repeat(350),1);
        String key = "content://sms/42"; org.json.JSONArray states;
        try { states = new org.json.JSONArray(c.getSharedPreferences("pocket_sms_results",0).getString(key,"[]")); } catch(Exception e) { throw new AssertionError(e); }
        assertTrue(states.length() > 1); receipt(SmsManager.RESULT_ERROR_NO_SERVICE,0);
        for(int i=1;i<states.length();i++) receipt(Activity.RESULT_OK,i);
        assertEquals(Integer.valueOf(Telephony.Sms.MESSAGE_TYPE_FAILED),provider.values.getAsInteger("type"));
        assertEquals("failed",MessagesActivity.sendState(provider.values.getAsInteger("type")));
    }
    @Test public void nativeIncomingPduIsPersistedAsUnreadWithoutNotificationListenerAccess() {
        String hex="00040c9144770009103200006201402100000005e8329bfd06"; byte[] pdu=new byte[hex.length()/2]; for(int i=0;i<pdu.length;i++) pdu[i]=(byte)Integer.parseInt(hex.substring(i*2,i*2+2),16);
        new SmsReceiver().onReceive(c,new Intent(Telephony.Sms.Intents.SMS_DELIVER_ACTION).putExtra("pdus",new Object[]{pdu}).putExtra("format","3gpp"));
        assertNotNull(provider.values); assertEquals("hello",provider.values.getAsString("body")); assertEquals(Integer.valueOf(0),provider.values.getAsInteger("read")); assertFalse(PhoneNotifications.connected());
    }
    private void receipt(int code,int part) { c.sendOrderedBroadcast(new Intent("fixture.SMS_RESULT").setData(Uri.parse("content://sms/42")).putExtra("part",part),null,new SmsResultReceiver(),null,code,null,null); Shadows.shadowOf(Looper.getMainLooper()).idle(); }
    static final class Provider extends ContentProvider {
        ContentValues values;
        public boolean onCreate(){return true;} public Uri insert(Uri uri,ContentValues v){values=new ContentValues(v);return Uri.parse("content://sms/42");}
        public int update(Uri uri,ContentValues v,String s,String[] a){if(values==null)values=new ContentValues();values.putAll(v);return 1;}
        public int delete(Uri uri,String s,String[] a){return 1;} public String getType(Uri uri){return "vnd.android.cursor.item/sms";}
        public Cursor query(Uri uri,String[] p,String s,String[] a,String order){MatrixCursor c=new MatrixCursor(new String[]{"_id"});c.addRow(new Object[]{7});return c;}
    }
}
