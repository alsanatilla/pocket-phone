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
    private boolean syncing;

    @Override protected void onCreate(Bundle state) { super.onCreate(state); render(); }
    @Override protected void onResume() { super.onResume(); render(); }
    @Override protected void onCloudSynced() { render(); }

    private void render() {
        screen("cloud sync");
        boolean on = CloudSync.enabled(this);
        long ok = CloudSync.prefs(this).getLong("last_ok", 0); String error = CloudSync.prefs(this).getString("last_error", "");
        String status = syncing ? "Syncing…" : !on ? "Off" : ok == 0 ? "On · waiting for the first sync" : "On · last synced " + DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(new Date(ok));
        body.addView(label(status, PocketDesign.BODY, on ? PocketDesign.accent(this) : WHITE));
        if (!error.isEmpty()) body.addView(label(error, PocketDesign.SMALL, PocketDesign.WARNING));
        body.addView(label("Tasks, notes, Parking Lot, Receipt, Dice lists and journal page photos sync to a hidden Pocket folder in your Google Drive. "
                + "Task reminders, drafts, messages and contacts stay on this phone.", PocketDesign.SMALL, GRAY));
        if (!on) action("Turn on with Google", this::authorize).setTag("cloud_on");
        else {
            android.widget.Button sync = action(syncing ? "Syncing…" : "Sync now", this::syncNow); sync.setTag("cloud_sync"); sync.setEnabled(!syncing);
            action("Sign in again", this::authorize);
            action("Turn off", () -> confirm("Turn off cloud sync? The copy in Drive stays.", () -> { CloudSync.disable(this); render(); })).setTag("cloud_off");
        }
        action("Open on the web\n" + CloudSync.WEB, () -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(CloudSync.WEB)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)));
    }
    private void authorize() {
        message("Opening Google…");
        Identity.getAuthorizationClient(this).authorize(CloudSync.request()).addOnSuccessListener(result -> {
            if (closed) return;
            if (!result.hasResolution()) { authorized(result); return; }
            try { startIntentSenderForResult(result.getPendingIntent().getIntentSender(), AUTHORIZE, null, 0, 0, 0); }
            catch (IntentSender.SendIntentException | NullPointerException error) { failed("Could not open Google sign-in. Try again."); }
        }).addOnFailureListener(error -> { if (!closed) failed(CloudSync.explain(this, error)); });
    }
    /** Keeps the reason on the page, not only in a passing message, so it can be read and acted on. */
    private void failed(String reason) {
        CloudSync.prefs(this).edit().putString("last_error", reason).apply();
        render(); message(reason);
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != AUTHORIZE) return;
        if (data == null) { failed("Google returned without completing sign-in. Try again; if you selected an account, check Pocket's Android OAuth client in Google Cloud."); return; }
        try {
            // Google can return the actual failure status even when Android reports RESULT_CANCELED.
            AuthorizationResult granted = Identity.getAuthorizationClient(this).getAuthorizationResultFromIntent(data);
            authorized(granted);
        } catch (ApiException error) { failed(CloudSync.explain(this, error)); }
    }
    private void authorized(AuthorizationResult granted) {
        if (granted.getAccessToken() == null || granted.getAccessToken().isEmpty()
                || !granted.getGrantedScopes().contains(CloudSync.SCOPE)) {
            failed("Drive access was not granted. Try again and allow Pocket to store its data in Google Drive."); return;
        }
        connected();
    }
    private void connected() { CloudSync.enable(this); syncNow(); }
    /** Explicit sync runs now, rather than waiting for Android to admit a background job. */
    private void syncNow() {
        if (syncing || !CloudSync.enabled(this)) return;
        syncing = true; render();
        android.content.Context app = getApplicationContext();
        load(() -> {
            android.app.job.JobScheduler jobs = app.getSystemService(android.app.job.JobScheduler.class);
            if (jobs != null) jobs.cancel(CloudSync.JOB_SOON);
            CloudSync.run(app); return true;
        }, done -> { syncing = false; render(); message("Synced."); }, error -> { syncing = false; failed(error.getMessage()); });
    }
}
