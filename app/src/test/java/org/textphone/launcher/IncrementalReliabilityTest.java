package org.textphone.launcher;

import static org.junit.Assert.*;
import android.Manifest;
import android.app.AlarmManager;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Looper;
import android.os.SystemClock;
import android.os.UserManager;
import android.telecom.TelecomManager;
import android.view.View;
import android.widget.EditText;
import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowAlarmManager;
import org.robolectric.shadows.ShadowContentResolver;
import org.robolectric.shadows.ShadowTelecomManager;
import org.robolectric.util.ReflectionHelpers;

/** Failure regressions for the installable 0.5.5 increment, using Android providers and activities. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = {23, 35})
public class IncrementalReliabilityTest {
    private Context context;
    @Before public void setup() {
        context = RuntimeEnvironment.getApplication();
        Shadows.shadowOf(context.getSystemService(UserManager.class)).setUserUnlocked(true);
        for (String key : new String[]{"pocket_clock", "pocket_planner", "pocket_agenda", "text_phone"})
            context.getSharedPreferences(key, 0).edit().clear().commit();
        ClockStore.prefs(context).edit().clear().commit();
        ShadowAlarmManager.setCanScheduleExactAlarms(true);
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(Manifest.permission.POST_NOTIFICATIONS);
    }
    public static class Harness extends PocketActivity {
        @Override public void onCreate(Bundle state) { super.onCreate(state); screen("first"); }
    }
    private void drain(ExecutorService executor) throws Exception {
        executor.submit(() -> {}).get(5, TimeUnit.SECONDS); Shadows.shadowOf(Looper.getMainLooper()).idle();
    }
    @Test public void aDelayedReadCannotWriteIntoTheNextPage() throws Exception {
        ActivityController<Harness> controller = Robolectric.buildActivity(Harness.class).setup(); Harness a = controller.get();
        CountDownLatch started = new CountDownLatch(1), release = new CountDownLatch(1); AtomicInteger results = new AtomicInteger();
        try {
            a.loadPage(() -> { started.countDown(); release.await(5, TimeUnit.SECONDS); return 42; }, value -> results.incrementAndGet());
            assertTrue(started.await(5, TimeUnit.SECONDS)); a.screen("second"); release.countDown();
            drain(ReflectionHelpers.getField(a, "worker")); assertEquals(0, results.get());
        } finally { release.countDown(); controller.pause().stop().destroy(); }
    }
    @Test public void permissionGrantCannotExecuteAnActionFromAnAbandonedPage() {
        ActivityController<Harness> controller = Robolectric.buildActivity(Harness.class).setup(); Harness a = controller.get();
        AtomicInteger accepted = new AtomicInteger(); Shadows.shadowOf(RuntimeEnvironment.getApplication()).denyPermissions(Manifest.permission.READ_CONTACTS);
        try {
            a.permissions(accepted::incrementAndGet, Manifest.permission.READ_CONTACTS); a.screen("second");
            a.onRequestPermissionsResult(410, new String[]{Manifest.permission.READ_CONTACTS}, new int[]{PackageManager.PERMISSION_GRANTED});
            assertEquals(0, accepted.get());
        } finally { controller.pause().stop().destroy(); }
    }
    @Test public void aBitmapAlreadyQueuedForDisplayIsReleasedWhenItsActivityCloses() throws Exception {
        ActivityController<Harness> controller = Robolectric.buildActivity(Harness.class).setup(); Harness a = controller.get();
        android.graphics.Bitmap bitmap = android.graphics.Bitmap.createBitmap(8, 8, android.graphics.Bitmap.Config.ARGB_8888); AtomicInteger displayed = new AtomicInteger();
        a.load(() -> bitmap, value -> displayed.incrementAndGet(), error -> fail(error.toString()), android.graphics.Bitmap::recycle);
        ExecutorService worker = ReflectionHelpers.getField(a, "worker"); worker.submit(() -> {}).get(5, TimeUnit.SECONDS);
        controller.pause().stop().destroy(); Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertEquals(0, displayed.get()); assertTrue(bitmap.isRecycled());
    }
    @Test public void anAcceptedSaveFinishesOnceAfterTheActivityIsDestroyed() throws Exception {
        ActivityController<Harness> controller = Robolectric.buildActivity(Harness.class).setup(); Harness a = controller.get();
        CountDownLatch started = new CountDownLatch(1), release = new CountDownLatch(1); AtomicInteger writes = new AtomicInteger(), results = new AtomicInteger();
        View control = a.button("save", () -> {});
        try {
            a.loadAction(control, () -> { started.countDown(); release.await(5, TimeUnit.SECONDS); writes.incrementAndGet(); return 1; }, value -> results.incrementAndGet());
            assertTrue(started.await(5, TimeUnit.SECONDS)); assertFalse(control.isEnabled());
            a.loadAction(control, () -> { writes.incrementAndGet(); return 2; }, value -> results.incrementAndGet());
            controller.pause().stop().destroy(); release.countDown(); drain(ReflectionHelpers.getStaticField(PocketActivity.class, "WRITES"));
            assertEquals(1, writes.get()); assertEquals(0, results.get());
        } finally { release.countDown(); }
    }
    @Test public void rapidCallTapsHandOnlyOneCallToTelecom() {
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(Manifest.permission.CALL_PHONE, Manifest.permission.READ_PHONE_STATE);
        ShadowTelecomManager telecom = Shadows.shadowOf(context.getSystemService(TelecomManager.class));
        telecom.setDefaultDialerPackage(context.getPackageName()); telecom.setCallPhonePermission(true); telecom.setReadPhoneStatePermission(true);
        ActivityController<PhoneActivity> controller = Robolectric.buildActivity(PhoneActivity.class, new Intent().putExtra("number", "+49305550100")).setup();
        try {
            View call = PocketAppsTest.find(controller.get().body, "call"); call.performClick(); call.performClick(); call.performClick();
            assertEquals(1, telecom.getAllOutgoingCalls().size());
        } finally { controller.pause().stop().destroy(); }
    }
    private ClockStore.Entry timer(long delay) {
        ClockStore.Entry e = new ClockStore.Entry(); e.kind = "timer"; e.title = "Test"; e.enabled = true;
        e.boot = ClockStore.boot(context); e.due = System.currentTimeMillis() + delay; e.elapsed = SystemClock.elapsedRealtime() + delay; return e;
    }
    @Test @Config(sdk = 35) public void failedSchedulingRollsBackTheNewOrEditedAlarmRecord() {
        ShadowAlarmManager.setCanScheduleExactAlarms(false); ClockStore.Entry e = timer(60000);
        try { AlarmScheduler.saveAndArm(context, e); fail("Denied exact alarms"); } catch (IllegalStateException expected) {}
        assertTrue(ClockStore.entries(context).isEmpty());
        ClockStore.Entry previous = timer(90000); ClockStore.save(context, previous);
        ClockStore.Entry edit = timer(120000); edit.id = previous.id;
        try { AlarmScheduler.saveAndArm(context, edit); fail("Denied exact alarms"); } catch (IllegalStateException expected) {}
        assertEquals(previous.due, ClockStore.find(context, previous.id).due); assertEquals(1, ClockStore.entries(context).size());
    }
    @Test public void anOldAlarmBroadcastCannotRingTheRescheduledAlarm() {
        ClockStore.Entry e = timer(60000); ClockStore.save(context, e);
        new AlarmReceiver().onReceive(context, new Intent().putExtra("id", e.id).putExtra("due", e.due - 60000));
        assertTrue(ClockStore.find(context, e.id).enabled); assertNull(Shadows.shadowOf(RuntimeEnvironment.getApplication()).getNextStartedService());
    }
    @Test public void aLongMissedOneShotIsReportedAndDisabledRatherThanMovedToTomorrow() {
        ClockStore.Entry e = timer(-360000); ClockStore.save(context, e); AlarmScheduler.restore(context, false);
        assertFalse(ClockStore.find(context, e.id).enabled); assertTrue(ClockStore.prefs(context).getString("last_issue", "").contains("Missed alarm"));
        assertTrue(Shadows.shadowOf(context.getSystemService(AlarmManager.class)).getScheduledAlarms().isEmpty());
    }
    @Test public void theTenSecondTestSchedulesTheRealAlarmReceiverPath() {
        ActivityController<ClockActivity> controller = Robolectric.buildActivity(ClockActivity.class).setup();
        try {
            controller.get().findViewById(android.R.id.content).findViewWithTag("app_settings").performClick(); controller.get().body.findViewWithTag("test_alarm").performClick();
            ClockStore.Entry e = ClockStore.entries(context).get(0); assertTrue(e.enabled); assertEquals("timer", e.kind);
            assertTrue(ClockStore.remaining(context, e) <= 10000); assertTrue(ClockStore.remaining(context, e) > 9000);
            assertEquals(1, Shadows.shadowOf(context.getSystemService(AlarmManager.class)).getScheduledAlarms().size());
        } finally { controller.pause().stop().destroy(); }
    }
    private PlannerStore planner() { return new PlannerStore(context.getSharedPreferences("pocket_planner", 0)); }
    private ActivityController<MainActivity> today() { return Robolectric.buildActivity(MainActivity.class, new Intent().putExtra("pocket_screen", "today")).setup(); }
    private EditText editor(MainActivity a) { return a.findViewById(android.R.id.content).findViewWithTag("capture_editor"); }
    @Test public void aForegroundNoteAutosavesAndAnIntentionallyEmptyDraftStaysEmpty() {
        long id = planner().save(0, "note", "Saved note"); ActivityController<MainActivity> controller = today(); MainActivity a = controller.get();
        try {
            ReflectionHelpers.callInstanceMethod(a, "openCapture", ReflectionHelpers.ClassParameter.from(String.class, "note"), ReflectionHelpers.ClassParameter.from(long.class, id), ReflectionHelpers.ClassParameter.from(String.class, "Saved note"));
            editor(a).setText("New draft"); Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(450));
            assertEquals("New draft", planner().draft("note", id)); assertEquals("Saved note", planner().find(id).text);
            editor(a).setText(""); Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(450)); assertTrue(planner().hasDraft("note", id));
            a.onBackPressed();
            ReflectionHelpers.callInstanceMethod(a, "openCapture", ReflectionHelpers.ClassParameter.from(String.class, "note"), ReflectionHelpers.ClassParameter.from(long.class, id), ReflectionHelpers.ClassParameter.from(String.class, "Saved note"));
            assertEquals("", editor(a).getText().toString());
        } finally { controller.pause().stop().destroy(); }
    }
    @Test public void sharingTextWhileTheNoteIsAlreadyOpenUpdatesTheVisibleEditor() {
        ActivityController<MainActivity> controller = today(); MainActivity a = controller.get();
        try {
            PocketAppsTest.find(a.findViewById(android.R.id.content), "Note").performClick(); editor(a).setText("Existing draft");
            controller.newIntent(new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "Shared text"));
            assertEquals("Existing draft\n\nShared text", editor(a).getText().toString());
        } finally { controller.pause().stop().destroy(); }
    }
    @Test public void aLateCalendarWriteMergesItsLinkWithoutOverwritingNewerLocalEdits() {
        AgendaStore.Event e = new AgendaStore.Event(); e.title = "Original"; e.when = System.currentTimeMillis(); e.syncPending = true; AgendaStore.save(context, e);
        AgendaStore.Event old = e.copy(); e.title = "Newer edit"; e.when += 3600000; AgendaStore.save(context, e);
        old.google = 42; old.calendar = 7; AgendaStore.syncResult(context, old, true);
        AgendaStore.Event current = AgendaStore.find(context, e.id); assertEquals("Newer edit", current.title); assertEquals(e.when, current.when);
        assertEquals(42, current.google); assertTrue(current.syncPending);
        AgendaStore.syncResult(context, current.copy(), true); assertFalse(AgendaStore.find(context, e.id).syncPending);
    }
    @Test public void aCalendarRetryFindsItsOwnPreviouslyInsertedAppointment() {
        SavingProvider provider = provider("com.android.calendar"); context.getSharedPreferences("pocket_agenda", 0).edit().putLong("google_calendar", 7).commit();
        AgendaStore.Event e = new AgendaStore.Event(); e.id = 100; e.title = "Review"; e.when = System.currentTimeMillis();
        assertTrue(CalendarBridge.write(context, e)); e.google = 0; e.calendar = 0; assertTrue(CalendarBridge.write(context, e));
        assertEquals(1, provider.inserts); assertEquals(1, provider.updates); assertEquals(42, e.google);
    }
    @Test public void repeatingAContactSaveWithTheSameEditorTokenUpdatesOneNativeContact() throws Exception {
        SavingProvider provider = provider("com.android.contacts");
        assertEquals(42, ContactBook.save(context.getContentResolver(), 0, "Ada", "+49305550100", "ada@example.test", "editor-token"));
        int inserts = provider.inserts; assertEquals(42, ContactBook.save(context.getContentResolver(), 0, "Ada updated", "+49305550200", "ada@example.test", "editor-token"));
        assertEquals(inserts, provider.inserts); assertEquals(1, provider.rawContacts); assertEquals(3, provider.updates);
    }
    @Test @Config(sdk = 35) public void existingClockDataMigratesAndRestoresBeforeTheFirstUnlock() {
        ClockStore.Entry e = timer(60000); ClockStore.save(context, e);
        String entries = ClockStore.prefs(context).getString("entries", ""); ClockStore.prefs(context).edit().clear().commit();
        context.getSharedPreferences("pocket_clock", 0).edit().putString("entries", entries).commit();
        assertEquals(e.id, ClockStore.entries(context).get(0).id);
        assertFalse(context.getSharedPreferences("pocket_clock", 0).contains("entries"));
        Shadows.shadowOf(context.getSystemService(UserManager.class)).setUserUnlocked(false);
        new AlarmReceiver().onReceive(context, new Intent("android.intent.action.LOCKED_BOOT_COMPLETED"));
        assertEquals(e.id, ClockStore.entries(context).get(0).id); assertEquals(1, Shadows.shadowOf(context.getSystemService(AlarmManager.class)).getScheduledAlarms().size());
        ActivityController<RingingActivity> ringing = Robolectric.buildActivity(RingingActivity.class).setup();
        try { assertFalse(PageMotion.enabled(ringing.get())); } finally { ringing.pause().stop().destroy(); }
    }
    private SavingProvider provider(String authority) {
        SavingProvider p = new SavingProvider(); ProviderInfo info = new ProviderInfo(); info.authority = authority; info.exported = true; p.attachInfo(context, info);
        ShadowContentResolver.registerProviderInternal(authority, p); return p;
    }
    @Test public void photoSaveForegroundLeaseLivesUntilAllAcceptedWritesFinish() {
        long first = PhotoSaveService.begin(context), second = PhotoSaveService.begin(context); assertTrue(first > 0); assertTrue(second > first);
        org.robolectric.android.controller.ServiceController<PhotoSaveService> controller = Robolectric.buildService(PhotoSaveService.class).create();
        PhotoSaveService service = controller.get();
        try {
            service.onStartCommand(new Intent(), 0, 1); assertEquals(722, Shadows.shadowOf(service).getLastForegroundNotificationId());
            android.os.PowerManager.WakeLock awake = ReflectionHelpers.getField(service, "awake"); assertTrue(awake.isHeld());
            PhotoSaveService.finish(first); Shadows.shadowOf(Looper.getMainLooper()).idle(); assertFalse(Shadows.shadowOf(service).isStoppedBySelf());
            PhotoSaveService.finish(second); Shadows.shadowOf(Looper.getMainLooper()).idle(); assertTrue(Shadows.shadowOf(service).isStoppedBySelf());
        } finally { PhotoSaveService.finish(first); PhotoSaveService.finish(second); controller.destroy(); }
    }
    @Test public void aPhotoFinishedBeforeServiceDeliveryStillMeetsTheForegroundDeadlineAndStops() {
        long token = PhotoSaveService.begin(context); PhotoSaveService.finish(token);
        org.robolectric.android.controller.ServiceController<PhotoSaveService> controller = Robolectric.buildService(PhotoSaveService.class).create();
        try {
            controller.get().onStartCommand(new Intent(), 0, 1);
            assertEquals(722, Shadows.shadowOf(controller.get()).getLastForegroundNotificationId()); assertTrue(Shadows.shadowOf(controller.get()).isStoppedBySelf());
        } finally { controller.destroy(); }
    }
    public static class SavingProvider extends ContentProvider {
        int inserts, updates, rawContacts; boolean markedContact, calendarEvent;
        public boolean onCreate() { return true; }
        public Uri insert(Uri uri, ContentValues values) {
            inserts++; if (uri.getPath().contains("raw_contacts")) rawContacts++;
            if ("vnd.android.cursor.item/vnd.org.textphone.save".equals(values.getAsString("mimetype"))) markedContact = true;
            if ("com.android.calendar".equals(uri.getAuthority())) calendarEvent = true;
            return uri.buildUpon().appendPath("42").build();
        }
        public int update(Uri uri, ContentValues values, String selection, String[] args) { updates++; return 1; }
        public int delete(Uri uri, String selection, String[] args) { return 1; }
        public String getType(Uri uri) { return "vnd.android.cursor.item"; }
        public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) {
            MatrixCursor rows = new MatrixCursor(projection);
            if ("com.android.calendar".equals(uri.getAuthority())) { if (calendarEvent) rows.addRow(new Object[]{42}); }
            else if ("raw_contact_id".equals(projection[0])) { if (markedContact) rows.addRow(new Object[]{42}); }
            else if (markedContact) rows.addRow(new Object[]{101});
            return rows;
        }
    }
}
