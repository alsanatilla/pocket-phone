package org.textphone.launcher;

import android.content.Intent;
import android.content.IntentSender;
import android.net.Uri;
import android.os.Bundle;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import java.text.DateFormat;
import java.util.Date;

/** Opt-in cloud sync of Pocket documents and journal pages into the user's own Drive. */
public final class CloudActivity extends PocketActivity {
    private static final int AUTHORIZE = 731;

    @Override protected void onCreate(Bundle state) { super.onCreate(state); render(); }
    @Override protected void onResume() { super.onResume(); render(); }
    @Override protected void onCloudSynced() { render(); }

    private void render() {
        screen("cloud sync");
        boolean on = CloudSync.enabled(this);
        long ok = CloudSync.prefs(this).getLong("last_ok", 0); String error = CloudSync.prefs(this).getString("last_error", "");
        String status = !on ? "Off" : ok == 0 ? "On · waiting for the first sync" : "On · last synced " + DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(new Date(ok));
        body.addView(label(status, PocketDesign.BODY, on ? PocketDesign.accent(this) : WHITE));
        if (on && !error.isEmpty()) body.addView(label(error, PocketDesign.SMALL, PocketDesign.WARNING));
        body.addView(label("Parking Lot, Receipt, Dice lists, notes and journal page photos are copied to a hidden Pocket folder in your Google Drive. "
                + "Changes sync once the phone is online, also from the web page. Tasks, messages and contacts stay on the phone.", PocketDesign.SMALL, GRAY));
        if (!on) action("Turn on with Google", this::authorize).setTag("cloud_on");
        else {
            action("Sync now", () -> { CloudSync.prefs(this).edit().remove("last_try").apply(); CloudSync.changed(this); message("Syncing when online…"); }).setTag("cloud_sync");
            action("Sign in again", this::authorize);
            action("Turn off", () -> confirm("Turn off cloud sync? The copy in Drive stays.", () -> { CloudSync.disable(this); render(); })).setTag("cloud_off");
        }
        action("Open on the web\n" + CloudSync.WEB, () -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(CloudSync.WEB)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)));
    }
    private void authorize() {
        message("Opening Google…");
        Identity.getAuthorizationClient(this).authorize(CloudSync.request()).addOnSuccessListener(result -> {
            if (closed) return;
            if (!result.hasResolution()) { connected(); return; }
            try { startIntentSenderForResult(result.getPendingIntent().getIntentSender(), AUTHORIZE, null, 0, 0, 0); }
            catch (IntentSender.SendIntentException | NullPointerException error) { message("Could not open Google sign-in."); }
        }).addOnFailureListener(error -> { if (!closed) message("Google sign-in is unavailable on this phone."); });
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != AUTHORIZE) return;
        try {
            AuthorizationResult granted = Identity.getAuthorizationClient(this).getAuthorizationResultFromIntent(data);
            if (granted.getAccessToken() != null) connected(); else message("Drive access was not granted.");
        } catch (ApiException error) { message("Drive access was not granted."); }
    }
    private void connected() { CloudSync.enable(this); render(); message("Connected. Syncing when online…"); }
}
