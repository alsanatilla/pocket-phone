package org.textphone.launcher;

import static org.junit.Assert.*;
import android.Manifest;
import android.app.AlarmManager;
import android.app.role.RoleManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.SystemClock;
import android.os.Looper;
import android.telecom.TelecomManager;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import android.widget.EditText;
import java.util.Calendar;
import java.util.TimeZone;
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
import org.robolectric.shadows.ShadowTelecomManager;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {24, 35})
public class PocketAppsTest {
    private Context context;
    @Before public void start() { context = RuntimeEnvironment.getApplication();
        for (String key : new String[]{"pocket_clock", "pocket_stopwatch", "pocket_agenda", "pocket_message_drafts"}) context.getSharedPreferences(key, 0).edit().clear().commit();
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(Manifest.permission.CALL_PHONE, Manifest.permission.READ_PHONE_STATE, Manifest.permission.POST_NOTIFICATIONS);
        ShadowAlarmManager.setCanScheduleExactAlarms(true);
    }
    static TextView find(View view, String text) { // Chrome labels are lowercase by design; tests name controls without depending on letter case.
        if (view instanceof TextView && text.equalsIgnoreCase(((TextView)view).getText().toString())) return (TextView)view;
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup)view).getChildCount(); i++) { TextView result = find(((ViewGroup)view).getChildAt(i), text); if (result != null) return result; } return null; }
    private static void click(PocketActivity activity, String text) { TextView view = find(activity.getWindow().getDecorView(), text); assertNotNull(text, view); view.performClick(); }
    @Test public void nativeDialpadDoesNotCallUntilTheUserPressesCall() {
        ShadowTelecomManager telecom = Shadows.shadowOf(context.getSystemService(TelecomManager.class)); telecom.setDefaultDialerPackage(context.getPackageName()); telecom.setReadPhoneStatePermission(true); telecom.setCallPhonePermission(true);
        ActivityController<PhoneActivity> controller = Robolectric.buildActivity(PhoneActivity.class, new Intent().putExtra("number", "+49 30 5550100")).setup();
        try { PhoneActivity activity = controller.get(); assertTrue(telecom.getAllOutgoingCalls().isEmpty()); click(activity, "call");
            assertEquals("tel", telecom.getOnlyOutgoingCall().address.getScheme()); assertEquals("+49305550100", telecom.getOnlyOutgoingCall().address.getSchemeSpecificPart());
        } finally { controller.pause().stop().destroy(); }
    }
    @Test @Config(sdk = 35) public void emergencyDialingAlwaysUsesTheSystemDialer() {
        ShadowTelecomManager telecom = Shadows.shadowOf(context.getSystemService(TelecomManager.class)); telecom.setSystemDialerPackage("android.system.dialer");
        ActivityController<PhoneActivity> controller = Robolectric.buildActivity(PhoneActivity.class, new Intent().putExtra("number", "112")).setup();
        try { click(controller.get(), "call"); Intent intent = Shadows.shadowOf(controller.get()).getNextStartedActivity();
            assertEquals("android.system.dialer", intent.getPackage()); assertEquals(Intent.ACTION_DIAL, intent.getAction()); assertTrue(telecom.getAllOutgoingCalls().isEmpty());
        } finally { controller.pause().stop().destroy(); }
    }
    @Test public void timerIsOwnedByPocketAndUsesTheMonotonicClock() {
        ActivityController<ClockActivity> controller = Robolectric.buildActivity(ClockActivity.class, new Intent().putExtra("seconds", 1500).putExtra("title", "Focus: Draft")).setup();
        try { Shadows.shadowOf(Looper.getMainLooper()).idle();
            ClockStore.Entry timer = ClockStore.entries(context).get(0); assertEquals("Focus: Draft", timer.title); assertEquals("timer", timer.kind);
            ShadowAlarmManager.ScheduledAlarm alarm = Shadows.shadowOf(context.getSystemService(AlarmManager.class)).peekNextScheduledAlarm();
            assertEquals(AlarmManager.ELAPSED_REALTIME_WAKEUP, alarm.type); assertTrue(alarm.allowWhileIdle); assertEquals(timer.elapsed, alarm.triggerAtTime);
            click(controller.get(), "pause"); assertFalse(ClockStore.find(context, timer.id).enabled); assertTrue(Shadows.shadowOf(context.getSystemService(AlarmManager.class)).getScheduledAlarms().isEmpty());
            click(controller.get(), "resume"); assertTrue(ClockStore.find(context, timer.id).enabled);
        } finally { controller.pause().stop().destroy(); }
    }
    @Test @Config(sdk = 35) public void deniedExactAlarmPermissionNeverCreatesASilentTimer() {
        ShadowAlarmManager.setCanScheduleExactAlarms(false);
        ActivityController<ClockActivity> controller = Robolectric.buildActivity(ClockActivity.class, new Intent().putExtra("seconds", 1500)).setup();
        try { Shadows.shadowOf(Looper.getMainLooper()).idle(); assertTrue(ClockStore.entries(context).isEmpty());
            assertEquals(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Shadows.shadowOf(controller.get()).getNextStartedActivity().getAction());
        } finally { controller.pause().stop().destroy(); }
    }
    @Test public void dailyAlarmsKeepLocalTimeAcrossDaylightSavingChanges() {
        TimeZone original = TimeZone.getDefault(); try { TimeZone.setDefault(TimeZone.getTimeZone("Europe/Berlin")); Calendar now = Calendar.getInstance(); now.set(2026, Calendar.MARCH, 28, 8, 0, 0); now.set(Calendar.MILLISECOND, 0);
            long next = ClockStore.nextTime(7, 30, now.getTimeInMillis()); Calendar day = Calendar.getInstance(); day.setTimeInMillis(next);
            assertEquals(29, day.get(Calendar.DAY_OF_MONTH)); assertEquals(7, day.get(Calendar.HOUR_OF_DAY)); assertEquals(30, day.get(Calendar.MINUTE));
        } finally { TimeZone.setDefault(original); }
    }
    @Test public void agendaStoresTheTaskLinkAndCancelingAnAppointmentCancelsItsAlarm() {
        ClockStore.Entry alarm = new ClockStore.Entry(); alarm.kind = "reminder"; alarm.title = "Review"; alarm.enabled = true; alarm.due = System.currentTimeMillis() + 60000;
        ClockStore.save(context, alarm); AlarmScheduler.arm(context, alarm);
        AgendaStore.Event event = new AgendaStore.Event(); event.title = "Review"; event.when = alarm.due; event.task = 42; event.alarm = alarm.id; AgendaStore.save(context, event);
        assertEquals(42, AgendaStore.list(context).get(0).task); AgendaStore.delete(context, event.id);
        assertNull(ClockStore.find(context, alarm.id)); assertTrue(Shadows.shadowOf(context.getSystemService(AlarmManager.class)).getScheduledAlarms().isEmpty());
    }
    @Test public void ownAppsLaunchWithoutNotificationListenerAccessAndRequestOnlyNeededAccess() {
        assertFalse(PhoneNotifications.connected()); Shadows.shadowOf(RuntimeEnvironment.getApplication()).denyPermissions(Manifest.permission.READ_CONTACTS);
        ActivityController<ContactsActivity> contacts = Robolectric.buildActivity(ContactsActivity.class).setup();
        try { assertNotNull(contacts.get().findViewById(android.R.id.content).findViewWithTag("app_settings"));assertNull(find(contacts.get().getWindow().getDecorView(),"Allow contacts")); assertNull(Shadows.shadowOf(contacts.get()).getLastRequestedPermission()); }
        finally { contacts.pause().stop().destroy(); }
        ActivityController<FilesActivity> files = Robolectric.buildActivity(FilesActivity.class).setup();
        try { assertNull(Shadows.shadowOf(files.get()).getLastRequestedPermission());
            assertNotNull(find(files.get().body, "Pocket Camera photos")); assertNull(find(files.get().body, "Choose folder")); assertNull(find(files.get().body, "Open file")); }
        finally { files.pause().stop().destroy(); }
        ActivityController<CalculatorActivity> calc = Robolectric.buildActivity(CalculatorActivity.class).setup();
        try { ((EditText)calc.get().body.findViewWithTag("calculator_input")).setText("0.1+0.2"); click(calc.get(), "=");
            assertEquals("0.3", ((EditText)calc.get().body.findViewWithTag("calculator_input")).getText().toString()); }
        finally { calc.pause().stop().destroy(); }
    }
}
