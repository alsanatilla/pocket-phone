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
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;

/** Pocket accounts sync through the Astro API; existing Drive connections remain available. */
public final class CloudActivity extends PocketActivity {
    private static final int AUTHORIZE = 731;
    private boolean syncing;
    private boolean foreground, linking;
    private PocketCloud.Link link;
    private String linkError = "";
    private int linkGeneration, deviceGeneration;
    /** Opened from setup: start the chosen sign-in once, then return to setup when this phone is signed in. */
    private String setup; private boolean setupStarted;
    private final Runnable poll = this::pollLink;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state); setup = getIntent().getStringExtra("setup"); setupStarted = state != null; render();
        if ("password".equals(setup) && !setupStarted && !PocketCloud.saved(this)) { setupStarted = true; pocketSignIn(); }
    }
    @Override protected void onResume() {
        super.onResume(); foreground = true; int generation = linkGeneration;
        load(() -> PocketCloud.pendingLink(getApplicationContext()), pending -> {
            if (generation != linkGeneration) return; link = pending; linkError = ""; render(); schedulePoll();
            if (pending == null && "link".equals(setup) && !setupStarted && !PocketCloud.saved(this)) { setupStarted = true; startLink(); }
        }, error -> { if (generation != linkGeneration) return; linkError = reason(error); render(); message(linkError); });
    }
    @Override protected void onPause() { foreground = false; ui.removeCallbacks(poll); super.onPause(); }
    @Override protected void onCloudSynced() { render(); }
    @Override protected String scene() { return PixelBackdrop.STARS; }

    private void render() {
        screen("account");
        appSettings(this::accountOptions);
        boolean on = CloudSync.enabled(this);
        long ok = CloudSync.prefs(this).getLong("last_ok", 0); String error = CloudSync.prefs(this).getString("last_error", "");
        if (link != null) {
            section("LINK THIS PHONE");
            TextView code = label(link.displayCode(), 52, PocketDesign.accent(this)); code.setTypeface(PocketFonts.pixel(this));
            code.setGravity(android.view.Gravity.CENTER); code.setPadding(0, dp(28), 0, dp(28)); code.setTextIsSelectable(true); body.addView(code);
            TextView address = label("pocket-phone.vercel.app/link", PocketDesign.SMALL, GRAY); address.setGravity(android.view.Gravity.CENTER); body.addView(address);
            action("open browser", () -> openWeb(link.browser));
            action("copy code", () -> { ((android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(android.content.ClipData.newPlainText("Pocket phone code", link.displayCode())); message("Copied."); });
            if (!linkError.isEmpty()) {
                body.addView(label(linkError, PocketDesign.SMALL, PocketDesign.WARNING));
                action("try again", this::pollLink).setEnabled(!linking);
            }
            action("cancel", this::cancelPhoneLink);
            return;
        }
        if (!PocketCloud.saved(this)) {
            body.addView(label("not signed in", PocketDesign.SMALL, GRAY));
            android.widget.Button primary = action(linking ? "connecting…" : "link this phone", this::startLink);
            primary.setEnabled(!linking); primary.setTag("pocket_link_phone"); primary.setTextSize(28); primary.setTypeface(PocketFonts.pixel(this)); primary.setTextColor(PocketDesign.accent(this));
            action("use a password", this::pocketSignIn);
            action("create account in browser", () -> openWeb(CloudSync.WEB + "#/account/new"));
            if (on && !PocketCloud.selected(this)) { section("DRIVE"); body.addView(label(status(ok), PocketDesign.SMALL, GRAY)); action("sync now", this::syncNow); }
            return;
        }
        TextView email = label(PocketCloud.email(this), PocketDesign.BODY, WHITE); email.setTextIsSelectable(true); body.addView(email);
        TextView state = label(syncing ? "syncing…" : !error.isEmpty() ? "sync failed" : !on ? "sync paused" : !PocketCloud.selected(this) ? "Drive connected" : status(ok), 25, !error.isEmpty() ? PocketDesign.WARNING : PocketDesign.accent(this));
        state.setTypeface(PocketFonts.pixel(this)); body.addView(state);
        if (!error.isEmpty()) body.addView(label(error, PocketDesign.SMALL, PocketDesign.WARNING));
        section("DEVICES"); LinearLayout devices = new LinearLayout(this); devices.setOrientation(LinearLayout.VERTICAL); body.addView(devices);
        drawDevices(devices);
        action("passkeys", () -> openWeb(CloudSync.WEB + "#/account"));
        softKeys(new String[]{syncing ? "syncing…" : "sync now", on && PocketCloud.selected(this) ? "pause" : "use Pocket", "sign out"}, 0,
                () -> { if (!PocketCloud.selected(this)) CloudSync.prefs(this).edit().putString("transport", "pocket").apply(); CloudSync.enable(this); syncNow(); },
                () -> { if (on && PocketCloud.selected(this)) CloudSync.disable(this); else { CloudSync.prefs(this).edit().putString("transport", "pocket").apply(); CloudSync.enable(this); } render(); },
                () -> confirm("Sign out of Pocket on this phone?", () -> load(() -> { PocketCloud.signOut(getApplicationContext()); return true; }, done -> render(), reason -> failed(reason.getMessage()))));
    }
    private String status(long ok) { return ok == 0 ? "waiting to sync" : "synced " + DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date(ok)); }
    private void openWeb(String url) { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
    private void accountOptions() {
        String[] choices = {"link with a new code", "password sign in", "Drive", "open web"};
        new android.app.AlertDialog.Builder(this).setTitle("Account").setItems(choices, (dialog, index) -> {
            if (index == 0) startLink(); else if (index == 1) pocketSignIn();
            else if (index == 2) new android.app.AlertDialog.Builder(this).setTitle("Drive").setItems(new String[]{"connect Drive", "pause sync"}, (d, i) -> { if (i == 0) authorize(); else { CloudSync.disable(this); render(); } }).show();
            else openWeb(CloudSync.WEB + "#/account");
        }).show();
    }
    private void startLink() {
        if (linking || syncing) return; linking = true; int generation = ++linkGeneration; message("Getting a code…");
        load(() -> PocketCloud.startLink(getApplicationContext()), pending -> { if (generation != linkGeneration) return; linking = false; link = pending; linkError = ""; render(); schedulePoll(); },
                error -> { if (generation == linkGeneration) recoverLink(generation, error); });
    }
    private void cancelPhoneLink() {
        linkGeneration++; ui.removeCallbacks(poll);
        try { PocketCloud.cancelLink(this); linking = false; link = null; linkError = ""; render(); }
        catch (IllegalStateException error) { linking = false; linkError = reason(error); render(); message(linkError); }
    }
    private static String reason(Exception error) { return error.getMessage() == null ? "Pocket could not connect. Try again." : error.getMessage(); }
    /** A network error does not invalidate an encrypted grant that can still finish linking. */
    private void recoverLink(int generation, Exception error) {
        ui.removeCallbacks(poll); String failure = reason(error);
        load(() -> PocketCloud.pendingLink(getApplicationContext()), pending -> {
            if (generation != linkGeneration) return; linking = false; link = pending; linkError = pending == null ? "" : failure; render();
            if (pending == null) message(failure);
        }, unreadable -> {
            if (generation != linkGeneration) return; linking = false; linkError = reason(unreadable); render(); message(linkError);
        });
    }
    private void schedulePoll() {
        ui.removeCallbacks(poll);
        if (foreground && link != null && !closed) ui.postDelayed(poll, Math.max(500, link.nextPoll - System.currentTimeMillis()));
    }
    private void pollLink() {
        if (!foreground || link == null || linking || closed) return;
        linking = true; int generation = linkGeneration;
        if (!linkError.isEmpty()) { linkError = ""; render(); message("Connecting…"); }
        load(() -> { boolean done = PocketCloud.pollLink(getApplicationContext()); return done ? null : PocketCloud.pendingLink(getApplicationContext()); }, pending -> {
            if (generation != linkGeneration) return; linking = false;
            link = pending;
            if (pending == null) { render(); if (PocketCloud.saved(this)) syncNow(); else message("That code expired. Show a new one."); }
            else schedulePoll();
        }, error -> { if (generation == linkGeneration) recoverLink(generation, error); });
    }
    private void drawDevices(LinearLayout host) {
        int generation = ++deviceGeneration;
        load(() -> new JSONObject().put("list", PocketCloud.authList(this, "/api/auth/list-sessions")).put("current", PocketCloud.api(this, "GET", "/api/auth/get-session", null).getJSONObject("session").getString("id")), value -> {
            if (generation != deviceGeneration || host.getParent() == null) return;
            JSONArray list = value.optJSONArray("list"); if (list == null) return;
            for (int i = 0; i < list.length(); i++) {
                JSONObject device = list.optJSONObject(i); if (device == null) continue;
                boolean mine = device.optString("id").equals(value.optString("current")); String name = mine ? "this phone" : deviceName(device.optString("userAgent"));
                LinearLayout line = row(); line.addView(label(name, PocketDesign.SMALL, mine ? PocketDesign.accent(this) : WHITE), new LinearLayout.LayoutParams(0, -2, 1));
                if (!mine) line.addView(button("sign out", () -> confirm("Sign out " + name + "?", () -> load(() -> PocketCloud.api(this, "POST", "/api/auth/revoke-session", new JSONObject().put("token", device.optString("token"))), result -> render(), reason -> message(reason.getMessage())))), new LinearLayout.LayoutParams(dp(92), -2));
                host.addView(line);
            }
        }, error -> { if (generation == deviceGeneration) { host.addView(label(error.getMessage(), PocketDesign.SMALL, PocketDesign.WARNING)); if (error.getCause() instanceof CloudSync.SignInNeeded) action("link again", this::startLink); } });
    }
    private static String deviceName(String agent) {
        if (agent.contains("Pocket Android")) return "Pocket phone";
        String os = agent.contains("Android") ? "Android" : agent.contains("iPhone") || agent.contains("iPad") ? "iPhone / iPad" : agent.contains("Windows") ? "Windows" : agent.contains("Mac") ? "Mac" : "browser";
        String browser = agent.contains("Edg/") ? "Edge" : agent.contains("Firefox/") ? "Firefox" : agent.contains("Chrome/") ? "Chrome" : agent.contains("Safari/") ? "Safari" : "";
        return os + (browser.isEmpty() ? "" : " · " + browser);
    }
    private void pocketSignIn() {
        android.widget.LinearLayout fields = new android.widget.LinearLayout(this); fields.setOrientation(android.widget.LinearLayout.VERTICAL); fields.setPadding(dp(20), 0, dp(20), 0);
        android.widget.EditText email = new android.widget.EditText(this); email.setHint("email"); email.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS); PocketDesign.input(email); email.setSingleLine(true); email.setText(PocketCloud.email(this));
        android.widget.EditText password = new android.widget.EditText(this); password.setHint("password"); password.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD); PocketDesign.input(password); password.setSingleLine(true); password.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(128)});
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
        int generation = ++linkGeneration; ui.removeCallbacks(poll);
        android.content.Context app = getApplicationContext();
        load(() -> { PocketCloud.signIn(app, address, secret, create); return true; }, done -> {
            if (generation != linkGeneration) return; linking = false; link = null; linkError = ""; syncNow();
        }, error -> { if (generation == linkGeneration) recoverLink(generation, error); });
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
        }, done -> { syncing = false; if (setup != null && PocketCloud.saved(this)) { finish(); return; } render(); message("Synced."); }, error -> { syncing = false; failed(error.getMessage()); });
    }
}
