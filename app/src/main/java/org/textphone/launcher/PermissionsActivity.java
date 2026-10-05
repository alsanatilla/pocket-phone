package org.textphone.launcher;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

/** Explains existing access without asking for any new permissions. */
public final class PermissionsActivity extends PocketActivity {
    @Override protected void onResume() { super.onResume(); render(); }
    private void render() {
        screen("permissions");
        body.addView(label("Allow only what you use", 18, WHITE));
        body.addView(label("Home, tasks, notes and calculator work without contact, message, calendar or notification access.", 13, GRAY));
        action("Manage Android permissions", () -> startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))));
        section("Phone", PhoneActivity.isDefault(this) ? "Pocket is the default phone app" : "Your existing phone app is the default",
                "Phone access places calls and selects a SIM. Call-log access shows recent calls; it does not record audio.");
        status("Place calls", Manifest.permission.CALL_PHONE); status("SIM / phone state", Manifest.permission.READ_PHONE_STATE); status("Call history", Manifest.permission.READ_CALL_LOG);
        section("Messages", MessagesActivity.isDefault(this) ? "Pocket is the default SMS app" : "Your existing SMS app is the default",
                "The default SMS app can read and receive messages, including verification codes. Sending happens when you tap Send. Your carrier delivers SMS/MMS.");
        status("Read messages", Manifest.permission.READ_SMS); status("Send SMS", Manifest.permission.SEND_SMS);
        action("Set up messages", () -> startActivity(new Intent(this, MessagesActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)));
        section("Contacts", permitted(Manifest.permission.READ_CONTACTS) ? "Read access allowed" : "Read access off",
                "Read your address book to show contacts. Edit access saves your changes in Android's address book; an existing account may sync those contacts.");
        status("Edit contacts", Manifest.permission.WRITE_CONTACTS);
        section("Calendar", CalendarBridge.selected(this) != 0 ? "A phone calendar is selected" : "No Google calendar selected",
                "Optional: read appointments and save them to a calendar you choose. Android's account sync can send them to Google. Tasks, notes and Pocket reminders stay local.");
        status("Read calendar", Manifest.permission.READ_CALENDAR); status("Edit calendar", Manifest.permission.WRITE_CALENDAR);
        section("Camera", permitted(Manifest.permission.CAMERA) ? "Allowed" : "Off", "Used for the camera and flashlight. Photos save to DCIM/Pocket.");
        section("Files", "Pocket Camera photos only", "Opens only photos taken with Pocket Camera. No folder picker or access to other files. Existing folder grants from the earlier browser are removed when Files first opens.");
        NotificationManager notices = getSystemService(NotificationManager.class);
        boolean alerts = Build.VERSION.SDK_INT < 24 || notices != null && notices.areNotificationsEnabled();
        if (Build.VERSION.SDK_INT >= 33) alerts &= permitted(Manifest.permission.POST_NOTIFICATIONS);
        section("Pocket alerts", alerts ? "Allowed" : "Off", "Shows Pocket's message and alarm alerts. This permission does not read other apps' notifications.");
        action("Manage Pocket alerts", () -> { if (Build.VERSION.SDK_INT >= 26) startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()));
            else startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))); });
        AlarmManager alarms = getSystemService(AlarmManager.class);
        section("Exact alarms", Build.VERSION.SDK_INT < 31 || alarms != null && alarms.canScheduleExactAlarms() ? "Allowed" : "Off",
                "Lets an alarm or timer ring at the requested time, including with the screen off. Clock asks when you set one.");
        section("Other apps' notifications", NotificationAccess.allowed(this) ? "Sensitive access enabled in Android" : "Off · optional",
                "This separate access can read banking notices and verification codes. Leave it off unless you want those notices in Pocket. Pocket's own alerts do not need it.");
        action("Manage notification access", () -> startActivity(new Intent(this, NotificationSetupActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)));
        section("Data", "No analytics or upload code", "Pocket has no Internet permission. Carrier messages, a calendar account or a file provider you select can transfer data through Android's services.");
        body.addView(label("Using Pocket every day", 18, WHITE));
        body.addView(label("Use Pocket as Home. Keep your current Phone and Messages as defaults while testing calls, texts and alarms. Hold their Home tiles to choose those installed apps.", 13, GRAY));
        action("Android default apps", () -> startActivity(new Intent(Build.VERSION.SDK_INT >= 24 ? Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS : Settings.ACTION_SETTINGS)));
    }
    private void section(String title, String state, String description) { body.addView(label(title + " · " + state, 16, WHITE)); body.addView(label(description, 13, GRAY)); }
    private void status(String title, String permission) { body.addView(label(title + ": " + (permitted(permission) ? "allowed" : "off"), 12, GRAY)); }
}
