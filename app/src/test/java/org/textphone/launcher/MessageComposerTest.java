package org.textphone.launcher;

import static org.junit.Assert.*;
import android.Manifest;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.provider.Telephony;
import android.widget.Button;
import android.widget.EditText;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowContentResolver;
import org.robolectric.shadows.ShadowTelephony;
import org.robolectric.shadows.ShadowSubscriptionManager;
import org.robolectric.shadows.ShadowAlertDialog;
import org.robolectric.util.ReflectionHelpers;

/** Exercise the actual send button/provider handoff while the user keeps navigating. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = {24, 35})
public class MessageComposerTest {
    private static final String NUMBER = "+49305550100", OTHER = "+491705550200";
    private Context context; private SmsStore store; private ActivityController<MessagesActivity> controller;
    @Before public void setup() throws Exception {
        context = RuntimeEnvironment.getApplication(); context.getSharedPreferences("pocket_message_drafts", 0).edit().clear().commit();
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(Manifest.permission.READ_SMS, Manifest.permission.SEND_SMS, Manifest.permission.READ_PHONE_STATE);
        ShadowTelephony.ShadowSms.setDefaultSmsPackage(context.getPackageName());
        ShadowSubscriptionManager.setDefaultSmsSubscriptionId(1);
        store = new SmsStore(); ProviderInfo info = new ProviderInfo(); info.authority = "sms"; info.exported = true; store.attachInfo(context, info);
        ShadowContentResolver.registerProviderInternal("sms", store); ShadowContentResolver.registerProviderInternal("mms-sms", store);
        controller = Robolectric.buildActivity(MessagesActivity.class, new Intent(context, MessagesActivity.class).putExtra("address", NUMBER)).setup();
        CameraAlbumTest.settle(controller.get());
    }
    @After public void cleanup() throws Exception {
        store.release.countDown(); CameraAlbumTest.settle(controller.get()); controller.pause().stop().destroy(); store.db.close();
    }
    private EditText message() { return controller.get().body.findViewWithTag("message_body"); }
    private EditText recipient() { return controller.get().body.findViewWithTag("message_address"); }
    private Button send() { return controller.get().body.findViewWithTag("message_send"); }
    private String saved(String to) { return context.getSharedPreferences("pocket_message_drafts", 0).getString(to, ""); }
    private void startBlockedSend() throws Exception {
        store.blockInsert = true; message().setText("First message"); send().performClick();
        assertTrue("SMS insert did not start", store.entered.await(10, TimeUnit.SECONDS));
    }
    private void completeSend() throws Exception { store.release.countDown(); CameraAlbumTest.settle(controller.get()); }
    @Test public void acceptedSendClearsItsDraftAndDoesNotQueryAnotherThreadAfterSending() throws Exception {
        message().setText("First message"); send().performClick(); CameraAlbumTest.settle(controller.get());
        assertEquals("", message().getText().toString()); assertEquals("", saved(NUMBER)); assertTrue(send().isEnabled());
        assertEquals(1, store.inserts); assertEquals(2, store.threadLookups);
        try (Cursor result = store.db.query("sms", new String[]{"address", "body", "type"}, null, null, null, null, null)) {
            assertTrue(result.moveToFirst()); assertEquals(NUMBER, result.getString(0)); assertEquals("First message", result.getString(1));
            assertEquals(Telephony.Sms.MESSAGE_TYPE_OUTBOX, result.getInt(2));
        }
    }
    // A conversation opened with an address returns to where it came from on Back (0.5.21), and the send still finishes once.
    @Test public void backDuringSendingReturnsToItsOriginAndCannotQueueADuplicate() throws Exception {
        startBlockedSend(); assertFalse(send().isEnabled()); send().performClick(); controller.get().onBackPressed(); completeSend();
        assertTrue(controller.get().isFinishing()); assertEquals(1, store.inserts); assertEquals("", saved(NUMBER));
    }
    @Test public void aConversationStartedFromTheInboxReturnsToTheInbox() throws Exception {
        ActivityController<MessagesActivity> inbox = Robolectric.buildActivity(MessagesActivity.class, new Intent(context, MessagesActivity.class)).setup();
        try {
            MessagesActivity a = inbox.get(); CameraAlbumTest.settle(a);
            PocketAppsTest.find(a.root, "+ message").performClick(); assertNotNull(a.body.findViewWithTag("message_body"));
            a.onBackPressed(); CameraAlbumTest.settle(a);
            assertFalse(a.isFinishing()); assertNotNull(PocketAppsTest.find(a.root, "+ message"));
        } finally { inbox.pause().stop().destroy(); }
    }
    @Test public void aNewlyTypedDraftSurvivesTheEarlierSendAndAnActivityRestart() throws Exception {
        startBlockedSend(); message().setText("Next message"); controller.pause().stop(); completeSend();
        assertEquals("Next message", message().getText().toString()); assertEquals("Next message", saved(NUMBER));
        controller.restart().start().resume(); CameraAlbumTest.settle(controller.get());
        assertEquals("Next message", message().getText().toString()); assertTrue(send().isEnabled());
    }
    @Test public void openingAnotherConversationWhileSendingPreservesItsRecipientAndDraft() throws Exception {
        context.getSharedPreferences("pocket_message_drafts", 0).edit().putString(OTHER, "Other person's draft").commit();
        startBlockedSend(); controller.newIntent(new Intent(context, MessagesActivity.class).putExtra("address", OTHER)); completeSend();
        assertEquals(OTHER, recipient().getText().toString()); assertEquals("Other person's draft", message().getText().toString());
        assertEquals("Other person's draft", saved(OTHER)); assertEquals("", saved(NUMBER));
        controller.get().onBackPressed(); assertTrue(controller.get().isFinishing());
    }
    @Test public void reopeningTheSendingConversationDoesNotRestoreASentMessageAsADraft() throws Exception {
        startBlockedSend(); controller.get().onBackPressed();
        controller.newIntent(new Intent(context, MessagesActivity.class).putExtra("address", NUMBER)); completeSend();
        assertEquals(NUMBER, recipient().getText().toString()); assertEquals("", message().getText().toString()); assertEquals("", saved(NUMBER));
        controller.pause().stop().restart().start().resume(); CameraAlbumTest.settle(controller.get()); assertEquals("", saved(NUMBER));
    }
    @Test public void stoppingAfterCarrierHandoffButBeforeTheUiCallbackDoesNotResaveTheSentDraft() throws Exception {
        startBlockedSend(); store.release.countDown();
        java.util.concurrent.ExecutorService worker = ReflectionHelpers.getField(controller.get(), "worker"); worker.submit(() -> { }).get(5, TimeUnit.SECONDS);
        controller.pause().stop().destroy(); assertEquals("", saved(NUMBER));
        controller = Robolectric.buildActivity(MessagesActivity.class, new Intent(context, MessagesActivity.class).putExtra("address", NUMBER)).setup(); CameraAlbumTest.settle(controller.get());
        assertEquals("", message().getText().toString()); assertEquals(1, store.inserts);
    }
    @Test public void changingTheRecipientCannotAttachTheOldMessagesToTheNewDraft() throws Exception {
        startBlockedSend(); recipient().setText(OTHER); message().setText("New recipient's message"); completeSend();
        assertEquals(OTHER, recipient().getText().toString()); assertEquals("New recipient's message", message().getText().toString());
        assertEquals("New recipient's message", saved(OTHER)); assertNull(CameraAlbumTest.findContaining(controller.get().body, "First message"));
        android.os.Bundle state = new android.os.Bundle(); controller.saveInstanceState(state); assertEquals(0, state.getLong("thread")); assertEquals(OTHER, state.getString("address"));
    }
    @Test public void failedSubmissionKeepsTheDraftAndAllowsAnExplicitRetry() throws Exception {
        store.failInsert = true; message().setText("Do not lose this"); send().performClick(); CameraAlbumTest.settle(controller.get());
        assertEquals("Do not lose this", message().getText().toString()); assertEquals("Do not lose this", saved(NUMBER)); assertTrue(send().isEnabled());
        assertNotNull(CameraAlbumTest.findContaining(controller.get().root, "Could not send. Your draft is saved."));
        store.failInsert = false; send().performClick(); CameraAlbumTest.settle(controller.get()); assertEquals("", message().getText().toString()); assertEquals(2, store.inserts);
    }
    @Test public void deniedSendPermissionReleasesTheButtonWithoutSendingOrLosingTheDraft() throws Exception {
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).denyPermissions(Manifest.permission.SEND_SMS); message().setText("Keep me"); send().performClick(); assertFalse(send().isEnabled());
        controller.get().onRequestPermissionsResult(410, new String[]{Manifest.permission.SEND_SMS}, new int[]{PackageManager.PERMISSION_DENIED});
        assertTrue(send().isEnabled()); assertEquals("Keep me", saved(NUMBER)); assertEquals(0, store.inserts);
    }
    @Test public void backingOutOfAPermissionRequestCannotSendAfterItsLateResult() throws Exception {
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).denyPermissions(Manifest.permission.SEND_SMS); message().setText("Unsent"); send().performClick(); controller.get().onBackPressed();
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(Manifest.permission.SEND_SMS);
        controller.get().onRequestPermissionsResult(410, new String[]{Manifest.permission.SEND_SMS}, new int[]{PackageManager.PERMISSION_GRANTED}); CameraAlbumTest.settle(controller.get());
        assertEquals(0, store.inserts); assertEquals("Unsent", saved(NUMBER)); assertTrue(controller.get().isFinishing());
    }
    @Test public void textChangedDuringAPermissionRequestRequiresAnotherExplicitSend() throws Exception {
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).denyPermissions(Manifest.permission.SEND_SMS); message().setText("Earlier text"); send().performClick(); message().setText("Revised text");
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(Manifest.permission.SEND_SMS);
        controller.get().onRequestPermissionsResult(410, new String[]{Manifest.permission.SEND_SMS}, new int[]{PackageManager.PERMISSION_GRANTED}); CameraAlbumTest.settle(controller.get());
        assertEquals(0, store.inserts); assertEquals("Revised text", saved(NUMBER)); assertTrue(send().isEnabled());
    }
    @Test public void cancelingTheSimChoiceKeepsTheDraftAndReleasesTheButton() throws Exception {
        Shadows.shadowOf(context.getSystemService(android.telephony.SubscriptionManager.class)).setActiveSubscriptionInfos(
            ShadowSubscriptionManager.SubscriptionInfoBuilder.newBuilder().setId(1).setDisplayName("SIM 1").buildSubscriptionInfo(),
            ShadowSubscriptionManager.SubscriptionInfoBuilder.newBuilder().setId(2).setDisplayName("SIM 2").buildSubscriptionInfo());
        message().setText("Choose later"); send().performClick(); android.app.AlertDialog dialog = ShadowAlertDialog.getLatestAlertDialog(); assertTrue(dialog.isShowing());
        assertFalse(send().isEnabled()); dialog.getButton(android.app.AlertDialog.BUTTON_NEGATIVE).performClick(); CameraAlbumTest.settle(controller.get());
        assertTrue(send().isEnabled()); assertEquals("Choose later", saved(NUMBER)); assertEquals(0, store.inserts);
        send().performClick(); ShadowAlertDialog.getLatestAlertDialog().getListView().performItemClick(null, 1, 1); CameraAlbumTest.settle(controller.get());
        assertEquals(1, store.inserts); assertEquals("", message().getText().toString());
        try (Cursor result = store.db.query("sms", new String[]{"sub_id"}, null, null, null, null, null)) { assertTrue(result.moveToFirst()); assertEquals(2, result.getInt(0)); }
    }
    @Test public void returningAfterReadAccessIsRevokedPreservesTheTypedRecipientAndDraft() throws Exception {
        recipient().setText(OTHER); message().setText("Keep on permission return"); controller.pause().stop();
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).denyPermissions(Manifest.permission.READ_SMS); controller.restart().start().resume(); CameraAlbumTest.settle(controller.get());
        assertNotNull(controller.get().findViewById(android.R.id.content).findViewWithTag("app_settings"));assertNull(PocketAppsTest.find(controller.get().body,"Allow messages"));
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(Manifest.permission.READ_SMS);
        controller.get().onRequestPermissionsResult(410, new String[]{Manifest.permission.READ_SMS}, new int[]{PackageManager.PERMISSION_GRANTED});
        controller.pause().stop().restart().start().resume(); CameraAlbumTest.settle(controller.get());
        assertEquals(OTHER, recipient().getText().toString()); assertEquals("Keep on permission return", message().getText().toString());
    }
    static final class SmsStore extends ContentProvider {
        final SQLiteDatabase db = SQLiteDatabase.create(null); final CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        volatile boolean blockInsert, failInsert; volatile int inserts, threadLookups;
        SmsStore() { db.execSQL("CREATE TABLE sms (_id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id INTEGER, address TEXT, body TEXT, date INTEGER, type INTEGER, read INTEGER, seen INTEGER, sub_id INTEGER)"); }
        public boolean onCreate() { return true; }
        public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) {
            if ("mms-sms".equals(uri.getAuthority())) { threadLookups++; MatrixCursor result = new MatrixCursor(new String[]{"_id"}); result.addRow(new Object[]{OTHER.equals(uri.getQueryParameter("recipient")) ? 8 : 7}); return result; }
            return db.query("sms", projection, selection, args, null, null, order);
        }
        public Uri insert(Uri uri, ContentValues values) {
            inserts++; entered.countDown(); if (blockInsert) try { if (!release.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Fixture SMS insert timed out"); }
            catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new IllegalStateException(error); }
            if (failInsert) throw new IllegalStateException("Fixture SMS store unavailable");
            return android.content.ContentUris.withAppendedId(Telephony.Sms.CONTENT_URI, db.insertOrThrow("sms", null, values));
        }
        public int update(Uri uri, ContentValues values, String selection, String[] args) { return db.update("sms", values, selection, args); }
        public int delete(Uri uri, String selection, String[] args) { return db.delete("sms", selection, args); }
        public String getType(Uri uri) { return "vnd.android.cursor.item/sms"; }
    }
}
