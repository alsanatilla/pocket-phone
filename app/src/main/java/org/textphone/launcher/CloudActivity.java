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

/** Pocket accounts sync through the Astro API; existing Drive connections remain available. */
public final class CloudActivity extends PocketActivity {
    private static final int AUTHORIZE = 731;
    private boolean syncing;

    @Override protected void onCreate(Bundle state) { super.onCreate(state); render(); }
    @Override protected void onResume() { super.onResume(); render(); }
    @Override protected void onCloudSynced() { render(); }

    private void render() {
        screen("storage & devices");
        boolean on = CloudSync.enabled(this);
        long ok = CloudSync.prefs(this).getLong("last_ok", 0); String error = CloudSync.prefs(this).getString("last_error", "");
        String status = syncing ? "Syncing…" : !on ? "Off" : ok == 0 ? "On · waiting for the first sync" : "On · last synced " + DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(new Date(ok));
        body.addView(label((on ? (PocketCloud.selected(this) ? "Pocket · " : "Drive · ") : "") + status, PocketDesign.BODY, on ? PocketDesign.accent(this) : WHITE));
        if (!error.isEmpty()) body.addView(label(error, PocketDesign.SMALL, PocketDesign.WARNING));
        section("Pocket");
        if (!PocketCloud.email(this).isEmpty()) body.addView(label(PocketCloud.email(this), PocketDesign.SMALL, GRAY));
        if (PocketCloud.selected(this) && PocketCloud.saved(this)) {
            if (!on) action("turn on", () -> { CloudSync.enable(this); syncNow(); });
            else {
                android.widget.Button sync = action(syncing ? "Syncing…" : "Sync now", this::syncNow); sync.setEnabled(!syncing); sync.setTag("cloud_sync");
                action("turn off", () -> { CloudSync.disable(this); render(); }).setTag("cloud_off");
            }
            if (!error.isEmpty()) action("sign in again", this::pocketSignIn);
            action("sign out", () -> load(() -> { PocketCloud.signOut(getApplicationContext()); return true; }, done -> render(), reason -> failed(reason.getMessage())));
        } else action("sign in to Pocket", this::pocketSignIn);
        section("Drive");
        if (!on || PocketCloud.selected(this)) action("connect Drive", this::authorize).setTag("cloud_on");
        else {
            android.widget.Button sync = action(syncing ? "Syncing…" : "Sync now", this::syncNow); sync.setTag("cloud_sync"); sync.setEnabled(!syncing);
            action("sign in again", this::authorize);
            action("turn off", () -> confirm("Turn off cloud sync? The copy in Drive stays.", () -> { CloudSync.disable(this); render(); })).setTag("cloud_off");
        }
        action("open on the web\n" + CloudSync.WEB, () -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(CloudSync.WEB)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)));
    }
    private void pocketSignIn() {
        android.widget.LinearLayout fields = new android.widget.LinearLayout(this); fields.setOrientation(android.widget.LinearLayout.VERTICAL); fields.setPadding(dp(20), 0, dp(20), 0);
        android.widget.EditText email = input("email", android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS); email.setSingleLine(true); email.setText(PocketCloud.email(this));
        android.widget.EditText password = input("password", android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD); password.setSingleLine(true); password.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(128)});
        password.setSaveEnabled(false);
        fields.addView(email); fields.addView(password);
        android.app.AlertDialog dialog = new android.app.AlertDialog.Builder(this).setTitle("Pocket account").setView(fields).setPositiveButton("sign in", null).setNeutralButton("create account", null).setNegativeButton("cancel", null).create();
        dialog.setOnShowListener(ignored -> {
            dialog.getButton(android.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> pocketConnect(email, password, false, dialog));
            dialog.getButton(android.app.AlertDialog.BUTTON_NEUTRAL).setOnClickListener(view -> pocketConnect(email, password, true, dialog));
        });
        dialog.show();
    }
    private void pocketConnect(android.widget.EditText email, android.widget.EditText password, boolean create, android.app.AlertDialog dialog) {
        String address = email.getText().toString().trim(), secret = password.getText().toString();
        if (address.isEmpty() || secret.isEmpty()) { message("Enter your email and password."); return; }
        if (create && secret.length() < 12) { message("Use at least 12 characters for your password."); return; }
        dialog.dismiss(); message(create ? "Creating account…" : "Signing in…");
        android.content.Context app = getApplicationContext();
        load(() -> { PocketCloud.signIn(app, address, secret, create); return true; }, done -> syncNow(), error -> failed(error.getMessage()));
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
    private void connected() { CloudSync.prefs(this).edit().putString("transport", "drive").apply(); CloudSync.enable(this); syncNow(); }
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
