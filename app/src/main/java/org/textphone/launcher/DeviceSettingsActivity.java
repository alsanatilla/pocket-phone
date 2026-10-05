package org.textphone.launcher;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Intent;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.widget.SeekBar;

/** Pocket controls public device APIs; protected changes use Android's consent panels. */
public final class DeviceSettingsActivity extends PocketActivity {
    @Override protected void onCreate(Bundle state) { super.onCreate(state); screen("device settings");
        action("Wi-Fi / mobile data", () -> startActivity(new Intent(Build.VERSION.SDK_INT >= 29 ? Settings.Panel.ACTION_INTERNET_CONNECTIVITY : Settings.ACTION_WIRELESS_SETTINGS)));
        action("Bluetooth", () -> startActivity(new Intent(Settings.ACTION_BLUETOOTH_SETTINGS)));
        action("Permissions", () -> startActivity(new Intent(this, PermissionsActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)));
        body.addView(label("Brightness", 17, WHITE)); SeekBar brightness = new SeekBar(this); brightness.setMax(255); brightness.setMinimumHeight(dp(PocketDesign.CONTROL));
        brightness.setProgress(Settings.System.getInt(getContentResolver(), Settings.System.SCREEN_BRIGHTNESS, 128)); body.addView(brightness);
        brightness.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            public void onProgressChanged(SeekBar s, int value, boolean user) { if (user) { android.view.WindowManager.LayoutParams p = getWindow().getAttributes(); p.screenBrightness = Math.max(1, value) / 255f; getWindow().setAttributes(p); } }
            public void onStartTrackingTouch(SeekBar s) {}
            public void onStopTrackingTouch(SeekBar s) {
                if (!Settings.System.canWrite(DeviceSettingsActivity.this)) { message("Allow brightness changes, then adjust again."); startActivity(new Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:" + getPackageName()))); }
                else try { Settings.System.putInt(getContentResolver(), Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL);
                    Settings.System.putInt(getContentResolver(), Settings.System.SCREEN_BRIGHTNESS, Math.max(1, s.getProgress())); }
                catch (SecurityException denied) { message("Brightness access changed. Review Android settings and try again."); }
            }
        });
        AudioManager audio = getSystemService(AudioManager.class);
        if (audio != null) { volume("Ringtone", AudioManager.STREAM_RING, audio); volume("Media", AudioManager.STREAM_MUSIC, audio); volume("Alarms", AudioManager.STREAM_ALARM, audio); }
        action("Do not disturb", () -> { NotificationManager manager = getSystemService(NotificationManager.class);
            if (!manager.isNotificationPolicyAccessGranted()) startActivity(new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS));
            else { manager.setInterruptionFilter(manager.getCurrentInterruptionFilter() == NotificationManager.INTERRUPTION_FILTER_ALL ? NotificationManager.INTERRUPTION_FILTER_PRIORITY : NotificationManager.INTERRUPTION_FILTER_ALL); message("Do not disturb changed."); }
        });
        action("Default phone / SMS apps", () -> startActivity(new Intent(Build.VERSION.SDK_INT >= 24 ? Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS : Settings.ACTION_SETTINGS)));
        action("Alarm permissions", () -> { if (Build.VERSION.SDK_INT >= 31) startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getPackageName()))); else message("Exact alarms are available."); });
        if (Build.VERSION.SDK_INT >= 34) action("Incoming call / alarm screen", () -> startActivity(new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + getPackageName()))));
        if (Build.VERSION.SDK_INT >= 33) action("Allow Pocket alerts", () -> permissions(() -> message("Alerts enabled."), Manifest.permission.POST_NOTIFICATIONS));
        action("Lock / security", () -> startActivity(new Intent(Settings.ACTION_SECURITY_SETTINGS)));
        action("About Pocket", () -> message("Pocket 0.5.13 · local apps · Android system services"));
        action("Open source licenses", this::licenses);
    }
    private void licenses() {
        String[] names = {"Pocket · MIT", "VT323 · Open Font License", "Markwon · Apache 2.0", "commonmark-java · BSD", "AndroidX annotations · Apache 2.0"};
        String[] files = {"Pocket-MIT.txt", "VT323-OFL.txt", "Markwon-APACHE-2.0.txt", "CommonMark-BSD.txt", "Markwon-APACHE-2.0.txt"};
        new android.app.AlertDialog.Builder(this).setTitle("Open source licenses").setItems(names, (dialog, item) -> {
            try (java.io.InputStream input = getAssets().open("licenses/" + files[item])) {
                java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream(); byte[] buffer = new byte[4096]; int read;
                while ((read = input.read(buffer)) != -1) bytes.write(buffer, 0, read);
                android.widget.TextView text = label(new String(bytes.toByteArray(), java.nio.charset.StandardCharsets.UTF_8), 13, WHITE); text.setTextIsSelectable(true);
                android.widget.ScrollView scroll = new android.widget.ScrollView(this); scroll.addView(text);
                new android.app.AlertDialog.Builder(this).setTitle(names[item]).setView(scroll).setPositiveButton("Close", null).show();
            } catch (java.io.IOException error) { message("License text is unavailable."); }
        }).show();
    }
    private void volume(String name, int stream, AudioManager audio) { body.addView(label(name + " volume", 15, WHITE)); SeekBar slider = new SeekBar(this); slider.setMinimumHeight(dp(PocketDesign.CONTROL));
        slider.setMax(audio.getStreamMaxVolume(stream)); slider.setProgress(audio.getStreamVolume(stream)); body.addView(slider);
        slider.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            public void onProgressChanged(SeekBar s, int value, boolean user) { if (user) try { audio.setStreamVolume(stream, value, 0); } catch (SecurityException e) { message("Android requires Do not disturb access for this change."); } }
            public void onStartTrackingTouch(SeekBar s) {} public void onStopTrackingTouch(SeekBar s) {}
        });
    }
}
