package org.textphone.launcher;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.UserManager;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Tasks;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Opt-in sync of Parking Lot, Receipt and Dice lists to the hidden Drive app folder of the user's own Google account.
 * Every local write asks for a sync; Android runs it once any network is available. The web page reads the same files.
 */
final class CloudSync {
    static final String SCOPE = "https://www.googleapis.com/auth/drive.appdata";
    static final String WEB = "https://alsanatilla.github.io/pocket-phone/";
    static final String ACTION_SYNCED = "org.textphone.launcher.SYNCED";
    static final String[] FILES = {"parking.json", "receipt.json", "dice.json"};
    static final int JOB_SOON = 7301, JOB_PERIODIC = 7302;
    private static final String DRIVE = "https://www.googleapis.com/drive/v3/files", UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
    private static final Object RUN = new Object();

    /** Google needs the user to choose an account or grant access on screen. */
    static final class SignInNeeded extends Exception { SignInNeeded() { super("Sign in again in Settings → Cloud sync."); } }

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("pocket_cloud", 0); }
    static boolean enabled(Context c) {
        if (Build.VERSION.SDK_INT >= 24) { UserManager user = c.getSystemService(UserManager.class); if (user != null && !user.isUserUnlocked()) return false; }
        return prefs(c).getBoolean("enabled", false);
    }
    static AuthorizationRequest request() {
        return AuthorizationRequest.builder().setRequestedScopes(Collections.singletonList(new Scope(SCOPE))).build();
    }

    /** After a local edit: sync a few seconds later, or as soon as the phone is back online. */
    static void changed(Context c) { schedule(c, 3_000); }
    /** When a Pocket page opens: pick up web edits, at most every two minutes. */
    static void soon(Context c) {
        try { if (!enabled(c) || System.currentTimeMillis() - prefs(c).getLong("last_try", 0) < 120_000) return; } catch (RuntimeException locked) { return; }
        schedule(c, 0);
    }
    private static void schedule(Context c, long delay) {
        try {
            if (!enabled(c)) return;
            JobScheduler jobs = c.getSystemService(JobScheduler.class); if (jobs == null) return;
            jobs.schedule(new JobInfo.Builder(JOB_SOON, new ComponentName(c, SyncJob.class)).setMinimumLatency(delay)
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true).build());
        } catch (RuntimeException ignored) { /* The periodic job still syncs later. */ }
    }
    static void enable(Context c) {
        prefs(c).edit().putBoolean("enabled", true).remove("last_error").apply();
        JobScheduler jobs = c.getSystemService(JobScheduler.class);
        if (jobs != null) jobs.schedule(new JobInfo.Builder(JOB_PERIODIC, new ComponentName(c, SyncJob.class)).setPeriodic(TimeUnit.HOURS.toMillis(1))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true).build());
        schedule(c, 0);
    }
    /** Turning sync off stops uploads; the copy in Drive stays until the user removes Pocket's access to Drive. */
    static void disable(Context c) {
        prefs(c).edit().putBoolean("enabled", false).apply();
        JobScheduler jobs = c.getSystemService(JobScheduler.class);
        if (jobs != null) { jobs.cancel(JOB_SOON); jobs.cancel(JOB_PERIODIC); }
    }

    /** Download, merge into local storage, upload the merged copy. Runs on a job thread, never on the UI thread. */
    static void run(Context c) throws IOException, SignInNeeded {
        synchronized (RUN) {
            prefs(c).edit().putLong("last_try", System.currentTimeMillis()).apply();
            String token = token(c);
            try {
                for (String name : FILES) {
                    JSONObject remote = download(c, token, name), merged;
                    if ("parking.json".equals(name)) { merged = ParkingStore.merge(c, remote); ParkingReceiver.arm(c); }
                    else if ("receipt.json".equals(name)) merged = ReceiptTape.merge(c, remote);
                    else merged = DiceActivity.merge(c, remote);
                    upload(c, token, name, merged.toString());
                }
            } catch (JSONException error) { throw new IOException("A synced file is damaged.", error); }
            catch (Unauthorized expired) { throw new SignInNeeded(); }
            prefs(c).edit().putLong("last_ok", System.currentTimeMillis()).remove("last_error").apply();
            c.sendBroadcast(new Intent(ACTION_SYNCED).setPackage(c.getPackageName()));
        }
    }
    private static String token(Context c) throws IOException, SignInNeeded {
        try {
            AuthorizationResult result = Tasks.await(Identity.getAuthorizationClient(c).authorize(request()), 30, TimeUnit.SECONDS);
            if (result.hasResolution() || result.getAccessToken() == null) throw new SignInNeeded();
            return result.getAccessToken();
        } catch (ExecutionException | TimeoutException error) { throw new IOException("Google sign-in is unavailable.", error); }
        catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new IOException("Sync was interrupted.", error); }
    }

    private static final class Unauthorized extends IOException { Unauthorized() { super("Access expired."); } }
    private static String fileId(Context c, String token, String name) throws IOException, JSONException {
        // Always look up and use the oldest copy: if the phone and the web both created one, they agree on the same file.
        String query = URLEncoder.encode("name='" + name + "'", "UTF-8");
        JSONArray files = new JSONObject(http("GET", DRIVE + "?spaces=appDataFolder&orderBy=createdTime&fields=files(id)&q=" + query, token, null, null)).optJSONArray("files");
        return files == null || files.length() == 0 ? null : files.getJSONObject(0).getString("id");
    }
    private static JSONObject download(Context c, String token, String name) throws IOException, JSONException {
        String id = fileId(c, token, name); if (id == null) return null;
        try { String body = http("GET", DRIVE + "/" + id + "?alt=media", token, null, null); return body.trim().isEmpty() ? null : new JSONObject(body); }
        catch (NotFound gone) { return null; }
    }
    private static void upload(Context c, String token, String name, String json) throws IOException, JSONException {
        String id = fileId(c, token, name);
        if (id != null) {
            try { http("PATCH", UPLOAD + "/" + id + "?uploadType=media", token, "application/json; charset=UTF-8", json); return; }
            catch (NotFound gone) { /* Removed meanwhile; create it again below. */ }
        }
        String boundary = "pocket" + System.nanoTime();
        String body = "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"
                + new JSONObject().put("name", name).put("parents", new JSONArray().put("appDataFolder")) + "\r\n--" + boundary
                + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + json + "\r\n--" + boundary + "--\r\n";
        http("POST", UPLOAD + "?uploadType=multipart&fields=id", token, "multipart/related; boundary=" + boundary, body);
    }

    private static final class NotFound extends IOException { NotFound() { super("Not found."); } }
    /** HttpURLConnection has no PATCH; Google APIs accept POST with a method override. */
    private static String http(String method, String address, String token, String type, String body) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        try {
            connection.setConnectTimeout(15_000); connection.setReadTimeout(30_000);
            connection.setRequestMethod("PATCH".equals(method) ? "POST" : method);
            if ("PATCH".equals(method)) connection.setRequestProperty("X-HTTP-Method-Override", "PATCH");
            connection.setRequestProperty("Authorization", "Bearer " + token);
            if (body != null) {
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                connection.setDoOutput(true); connection.setRequestProperty("Content-Type", type); connection.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream out = connection.getOutputStream()) { out.write(bytes); }
            }
            int status = connection.getResponseCode();
            if (status == 401 || status == 403) throw new Unauthorized();
            if (status == 404) throw new NotFound();
            if (status < 200 || status >= 300) throw new IOException("Drive answered " + status + ".");
            try (InputStream in = connection.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] buffer = new byte[8192];
                for (int read; (read = in.read(buffer)) > 0; ) { out.write(buffer, 0, read); if (out.size() > 4_000_000) throw new IOException("Synced file is too large."); }
                return out.toString("UTF-8");
            }
        } finally { connection.disconnect(); }
    }
    private CloudSync() { }
}
