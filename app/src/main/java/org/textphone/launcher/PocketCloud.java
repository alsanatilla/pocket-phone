package org.textphone.launcher;

import android.content.Context;
import android.content.Intent;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONArray;

/** Phone transport for the same authenticated Astro API used by the browser. */
final class PocketCloud {
    private static final String ORIGIN = "https://pocket-phone.vercel.app";
    private static final OkHttpClient HTTP = new OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build();
    private static final String USER_AGENT = "Pocket Android (Android " + android.os.Build.VERSION.RELEASE + ")";
    private static final Object LINK_LOCK = new Object();
    // Only durable local transitions take this lock; provider requests never block cancellation.
    private static final Object LINK_COMMIT_LOCK = new Object();
    private static final java.util.concurrent.atomic.AtomicInteger LINK_REVISION = new java.util.concurrent.atomic.AtomicInteger();
    private static final java.util.concurrent.atomic.AtomicBoolean REVOKING = new java.util.concurrent.atomic.AtomicBoolean();
    private static final java.util.concurrent.ExecutorService REVOCATIONS = java.util.concurrent.Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "Pocket sign-out"); thread.setDaemon(true); return thread;
    });
    static boolean selected(Context c) { return "pocket".equals(CloudSync.prefs(c).getString("transport", "drive")); }
    static boolean saved(Context c) { return new PocketCloudVault(c).present(); }
    static String email(Context c) { return CloudSync.prefs(c).getString("pocket_email", ""); }
    static String accountId(Context c) { return CloudSync.prefs(c).getString("pocket_id", ""); }
    static JSONObject api(Context c, String method, String path, JSONObject body) throws IOException {
        try {
            if (body != null) body.put("accountId", accountId(c));
            byte[] value = raw(method, path, token(c), "application/json", body == null ? null : body.toString().getBytes(StandardCharsets.UTF_8), accountId(c));
            return new JSONObject(new String(value, StandardCharsets.UTF_8));
        } catch (JSONException error) { throw new IOException("Pocket returned unreadable data.", error); }
        catch (CloudSync.SignInNeeded error) { throw new IOException(error.getMessage(), error); }
    }
    static JSONArray authList(Context c, String path) throws IOException {
        try { return new JSONArray(new String(raw("GET", path, token(c), null, null, ""), StandardCharsets.UTF_8)); }
        catch (JSONException error) { throw new IOException("Pocket returned unreadable devices.", error); }
        catch (CloudSync.SignInNeeded error) { throw new IOException(error.getMessage(), error); }
    }

    static final class Link {
        final String code, browser, secret, candidate; final long expires, nextPoll; final int interval;
        Link(JSONObject value) throws JSONException {
            secret = value.getString("device_code"); code = value.getString("user_code");
            candidate = value.optString("candidate");
            browser = value.getString("browser"); expires = value.getLong("expires");
            interval = Math.max(5, value.optInt("interval", 5)); nextPoll = value.optLong("next_poll", 0);
        }
        String displayCode() { String plain = code.replace("-", ""); return plain.length() == 8 ? plain.substring(0, 4) + "-" + plain.substring(4) : code; }
    }
    static Link pendingLink(Context c) throws IOException {
        try {
            synchronized (LINK_COMMIT_LOCK) {
                String saved = new PocketCloudVault(c).get("phone_link"); if (saved == null) return null;
                try {
                    Link link = new Link(new JSONObject(saved));
                    if (link.expires > System.currentTimeMillis()) return link;
                    LINK_REVISION.incrementAndGet(); discardLinkLocked(c); return null;
                } catch (JSONException error) {
                    LINK_REVISION.incrementAndGet(); discardLinkLocked(c); throw new IOException("Show a new phone code.", error);
                }
            }
        } finally { retryRevocations(c); }
    }
    static Link startLink(Context c) throws IOException {
        final int revision;
        synchronized (LINK_COMMIT_LOCK) { revision = LINK_REVISION.incrementAndGet(); discardLinkLocked(c); }
        retryRevocations(c);
        synchronized (LINK_LOCK) {
            try {
                JSONObject result = authRequest("/api/auth/device/code", new JSONObject().put("client_id", "pocket-android"));
                String code = result.getString("user_code");
                if (!code.matches("[A-Za-z0-9-]{8,9}")) throw new IOException("Pocket returned an invalid phone code.");
                long now = System.currentTimeMillis(); int interval = Math.max(5, Math.min(60, result.optInt("interval", 5)));
                JSONObject grant = new JSONObject().put("device_code", result.getString("device_code")).put("user_code", code)
                        .put("browser", ORIGIN + "/link?user_code=" + UriCode(code))
                        .put("expires", now + Math.min(600, result.optInt("expires_in", 600)) * 1000L).put("interval", interval).put("next_poll", now + interval * 1000L);
                synchronized (LINK_COMMIT_LOCK) {
                    if (revision != LINK_REVISION.get()) return null;
                    new PocketCloudVault(c).put("phone_link", grant.toString()); return new Link(grant);
                }
            } catch (JSONException error) { throw new IOException("Pocket could not create a phone code.", error); }
        }
    }
    private static String UriCode(String code) { return android.net.Uri.encode(code); }
    static void cancelLink(Context c) {
        try { synchronized (LINK_COMMIT_LOCK) { LINK_REVISION.incrementAndGet(); discardLinkLocked(c); } }
        catch (IOException error) { throw new IllegalStateException("Could not save phone cancellation. Try again.", error); }
        finally { retryRevocations(c); }
    }
    private static void cancelLink(Context c, int revision) throws IOException {
        try {
            synchronized (LINK_COMMIT_LOCK) {
                if (revision == LINK_REVISION.get()) { LINK_REVISION.incrementAndGet(); discardLinkLocked(c); }
            }
        } finally { retryRevocations(c); }
    }
    /** False means approval is pending. Expired and denied codes are removed, never retried as a password. */
    static boolean pollLink(Context c) throws IOException {
        synchronized (LINK_LOCK) {
            Link link = pendingLink(c); if (link == null) return false;
            if (System.currentTimeMillis() < link.nextPoll) return false;
            final int revision;
            try {
                JSONObject grant;
                synchronized (LINK_COMMIT_LOCK) {
                    String saved = new PocketCloudVault(c).get("phone_link"); if (saved == null) return false;
                    grant = new JSONObject(saved);
                    if (!link.secret.equals(grant.optString("device_code"))) return false;
                    revision = LINK_REVISION.get();
                    grant.put("next_poll", System.currentTimeMillis() + link.interval * 1000L);
                    new PocketCloudVault(c).put("phone_link", grant.toString());
                }
                String session = grant.optString("candidate");
                if (session.isEmpty()) {
                    JSONObject result;
                    try { result = authRequest("/api/auth/device/token", new JSONObject().put("client_id", "pocket-android")
                            .put("device_code", link.secret).put("grant_type", "urn:ietf:params:oauth:grant-type:device_code")); }
                    catch (DeviceError error) {
                        if (error.status == 429 || error.status >= 500) throw new IOException("Pocket is busy. Try linking again in a moment.");
                        if ("authorization_pending".equals(error.code)) return false;
                        if ("slow_down".equals(error.code)) {
                            grant.put("interval", Math.min(60, link.interval + 5)).put("next_poll", System.currentTimeMillis() + Math.min(60, link.interval + 5) * 1000L);
                            synchronized (LINK_COMMIT_LOCK) { if (revision == LINK_REVISION.get()) new PocketCloudVault(c).put("phone_link", grant.toString()); }
                            return false;
                        }
                        cancelLink(c, revision);
                        throw new IOException("access_denied".equals(error.code) ? "Phone linking was declined." : "That code expired. Show a new one.");
                    }
                    session = result.optString("access_token");
                    if (session.isEmpty()) throw new IOException("Pocket sign-in did not finish.");
                    synchronized (LINK_COMMIT_LOCK) {
                        if (revision != LINK_REVISION.get()) { queueRevocationsLocked(c, new String[]{session}); retryRevocations(c); return false; }
                        grant.put("candidate", session);
                        try { new PocketCloudVault(c).put("phone_link", grant.toString()); }
                        catch (IOException error) { queueRevocationsLocked(c, new String[]{session}, "phone_link"); retryRevocations(c); throw error; }
                    }
                }
                JSONObject verified;
                try { verified = new JSONObject(new String(raw("GET", "/api/auth/get-session", session, null, null, ""), StandardCharsets.UTF_8)); }
                catch (CloudSync.SignInNeeded error) { cancelLink(c, revision); throw new IOException("Pocket sign-in expired. Show a new code.", error); }
                catch (IOException error) { throw new IOException("Pocket could not verify this phone yet. Try again when connected.", error); }
                synchronized (LINK_COMMIT_LOCK) {
                    if (revision != LINK_REVISION.get()) { queueRevocationsLocked(c, new String[]{session}); retryRevocations(c); return false; }
                    if (link.expires <= System.currentTimeMillis()) { LINK_REVISION.incrementAndGet(); discardLinkLocked(c); retryRevocations(c); return false; }
                    try { acceptSession(c, verified.getJSONObject("user"), session); }
                    catch (IOException | JSONException error) { LINK_REVISION.incrementAndGet(); discardLinkLocked(c); retryRevocations(c); throw error; }
                    LINK_REVISION.incrementAndGet(); return true;
                }
            } catch (JSONException error) { throw new IOException("Pocket sign-in did not finish. Show a new code.", error); }
        }
    }
    private static void acceptSession(Context c, JSONObject user, String session) throws IOException, JSONException {
        String id = user.getString("id"), previous = accountId(c);
        if (!previous.isEmpty() && !previous.equals(id)) throw new IOException("Use the same Pocket account for this phone's workspace.");
        if (id.isEmpty()) throw new IOException("Pocket returned an invalid account.");
        if (!CloudSync.prefs(c).edit().putString("transport", "pocket").putString("pocket_id", id).putString("pocket_email", user.optString("email")).remove("last_error").commit()) throw new IOException("Could not save the Pocket account.");
        new PocketCloudVault(c).put("session", session, "phone_link");
        CloudSync.enable(c);
    }
    /** Queue and grant removal commit together, so process death cannot strand a redeemed token. */
    private static void discardLinkLocked(Context c) throws IOException {
        String pending = new PocketCloudVault(c).get("phone_link"), candidate = "";
        if (pending != null) try { candidate = new JSONObject(pending).optString("candidate"); }
        catch (JSONException malformed) { /* A damaged grant cannot be used again. */ }
        queueRevocationsLocked(c, new String[]{candidate}, "phone_link");
    }
    private static JSONArray revocationsLocked(Context c) throws IOException {
        String pending = new PocketCloudVault(c).get("pending_revocations");
        try { return pending == null ? new JSONArray() : new JSONArray(pending); }
        catch (JSONException damaged) { throw new IOException("Could not read pending Pocket sign-outs.", damaged); }
    }
    private static void queueRevocationsLocked(Context c, String[] sessions, String... remove) throws IOException {
        JSONArray pending = revocationsLocked(c); java.util.Set<String> seen = new java.util.HashSet<>();
        for (int i = 0; i < pending.length(); i++) seen.add(pending.optString(i));
        for (String session : sessions) if (session != null && !session.isEmpty() && seen.add(session)) pending.put(session);
        new PocketCloudVault(c).put("pending_revocations", pending.toString(), remove);
    }
    private static void forgetRevocationLocked(Context c, String session) throws IOException {
        JSONArray pending = revocationsLocked(c), kept = new JSONArray();
        for (int i = 0; i < pending.length(); i++) if (!session.equals(pending.optString(i))) kept.put(pending.optString(i));
        new PocketCloudVault(c).put("pending_revocations", kept.toString());
    }
    private static void retryRevocations(Context c) {
        if (!REVOKING.compareAndSet(false, true)) return;
        Context app = c.getApplicationContext();
        REVOCATIONS.execute(() -> {
            try {
                synchronized (LINK_COMMIT_LOCK) {
                    String grant = new PocketCloudVault(app).get("phone_link");
                    if (grant != null) {
                        try {
                            if (new JSONObject(grant).optLong("expires") <= System.currentTimeMillis()) { LINK_REVISION.incrementAndGet(); discardLinkLocked(app); }
                        } catch (JSONException damaged) { LINK_REVISION.incrementAndGet(); discardLinkLocked(app); }
                    }
                }
                // A bounded drain leaves failures encrypted for the next account visit or sync.
                for (int n = 0; n < 32; n++) {
                    String session;
                    synchronized (LINK_COMMIT_LOCK) {
                        JSONArray pending = revocationsLocked(app); if (pending.length() == 0) return;
                        session = pending.optString(0);
                        // Acceptance writes the session and removes its pending grant atomically.
                        if (session.isEmpty() || session.equals(new PocketCloudVault(app).get())) { forgetRevocationLocked(app, session); continue; }
                    }
                    try { raw("POST", "/api/auth/sign-out", session, "application/json", "{}".getBytes(StandardCharsets.UTF_8), ""); }
                    catch (CloudSync.SignInNeeded expired) { /* Revoked or expired is already signed out. */ }
                    synchronized (LINK_COMMIT_LOCK) { forgetRevocationLocked(app, session); }
                }
            } catch (IOException | RuntimeException unavailable) { /* Keep encrypted tokens for a later retry. */ }
            finally { REVOKING.set(false); }
        });
    }
    private static final class DeviceError extends IOException {
        final String code; final int status; DeviceError(int status, String code, String message) { super(message); this.code = code; this.status = status; }
    }
    private static JSONObject authRequest(String path, JSONObject body) throws IOException {
        Request request = new Request.Builder().url(ORIGIN + path).header("Origin", ORIGIN).header("User-Agent", USER_AGENT)
                .post(RequestBody.create(body.toString(), MediaType.parse("application/json"))).build();
        try (Response response = HTTP.newCall(request).execute()) {
            JSONObject value = new JSONObject(new String(readBody(response, 1024 * 1024), StandardCharsets.UTF_8));
            if (!response.isSuccessful()) throw new DeviceError(response.code(), value.optString("error", value.optString("code")), value.optString("error_description", value.optString("message", "Pocket could not connect.")));
            return value;
        } catch (JSONException error) { throw new IOException("Pocket could not connect. Try again.", error); }
    }

    static void signIn(Context c, String email, String password, boolean create) throws IOException, JSONException {
        final int revision;
        synchronized (LINK_COMMIT_LOCK) { revision = LINK_REVISION.incrementAndGet(); discardLinkLocked(c); }
        retryRevocations(c);
        JSONObject body = new JSONObject().put("email", email).put("password", password);
        if (create) body.put("name", email.contains("@") ? email.substring(0, email.indexOf('@')) : email);
        Request request = new Request.Builder().url(ORIGIN + "/api/auth/" + (create ? "sign-up/email" : "sign-in/email"))
                .header("Origin", ORIGIN).header("User-Agent", USER_AGENT).post(RequestBody.create(body.toString(), MediaType.parse("application/json"))).build();
        try (Response response = HTTP.newCall(request).execute()) {
            String text = response.body() == null ? "" : response.body().string();
            if (!response.isSuccessful()) throw error(response.code(), text);
            JSONObject result = new JSONObject(text), user = result.getJSONObject("user");
            String token = response.header("set-auth-token", result.optString("token"));
            if (token == null || token.isEmpty()) throw new IOException("Pocket sign-in did not finish.");
            synchronized (LINK_COMMIT_LOCK) {
                if (revision != LINK_REVISION.get()) { queueRevocationsLocked(c, new String[]{token}); retryRevocations(c); throw new IOException("Pocket sign-in was cancelled."); }
                try { acceptSession(c, user, token); }
                catch (IOException | JSONException error) { queueRevocationsLocked(c, new String[]{token}); retryRevocations(c); throw error; }
                LINK_REVISION.incrementAndGet();
            }
        }
    }
    static void signOut(Context c) throws IOException {
        try {
            synchronized (LINK_COMMIT_LOCK) {
                LINK_REVISION.incrementAndGet();
                String token = new PocketCloudVault(c).get();
                discardLinkLocked(c);
                queueRevocationsLocked(c, new String[]{token}, "session");
                CloudSync.disable(c);
            }
        } finally { retryRevocations(c); }
    }
    private static String token(Context c) throws IOException, CloudSync.SignInNeeded {
        String token = new PocketCloudVault(c).get();
        if (token == null || token.isEmpty()) throw new CloudSync.SignInNeeded("Sign in to Pocket in Storage & devices.");
        return token;
    }
    private static JSONObject merge(Context c, String name, JSONObject remote) throws JSONException {
        if ("parking.json".equals(name)) return ParkingStore.merge(c, remote);
        if ("receipt.json".equals(name)) return ReceiptTape.merge(c, remote);
        if ("notes.json".equals(name)) return NoteSync.merge(c, remote);
        if ("tasks.json".equals(name)) return TaskSync.merge(c, remote);
        if ("journal.json".equals(name)) return JournalStore.merge(c, remote);
        if ("gym.json".equals(name)) return GymStore.merge(c, remote);
        return DiceActivity.merge(c, remote);
    }
    static void run(Context c) throws IOException, CloudSync.SignInNeeded {
        retryRevocations(c);
        try {
            String token = token(c), id = CloudSync.prefs(c).getString("pocket_id", "");
            JSONObject documents = new JSONObject();
            for (String name : CloudSync.FILES) documents.put(name, merge(c, name, null));
            JSONObject request = new JSONObject().put("accountId", id).put("documents", documents);
            byte[] bytes = request.toString().getBytes(StandardCharsets.UTF_8);
            if (bytes.length > 3 * 1024 * 1024) throw new IOException("The workspace is too large for one sync.");
            JSONObject response = new JSONObject(new String(raw("POST", "/api/sync", token, "application/json", bytes, id), StandardCharsets.UTF_8));
            if (!id.equals(response.optString("accountId"))) throw new IOException("Pocket returned another account's workspace.");
            JSONObject received = response.getJSONObject("documents");
            for (String name : CloudSync.FILES) {
                if (!CloudSync.enabled(c) || !selected(c)) return;
                // Each local store merges again so edits made during the HTTP request survive.
                merge(c, name, received.getJSONObject(name).getJSONObject("value"));
            }
            for (JSONObject page : JournalStore.pages(c)) {
                String uid = page.optString("uid"), marker = "pocket_uploaded_" + uid;
                if (page.optBoolean("deleted")) { CloudSync.prefs(c).edit().remove(marker).apply(); continue; }
                if (CloudSync.prefs(c).getBoolean(marker, false)) continue;
                java.io.File image = JournalStore.image(c, uid);
                if (!image.isFile()) continue;
                if (image.length() > 2 * 1024 * 1024) throw new IOException("Keep a Paper photo under 2 MB.");
                byte[] photo;
                try (java.io.FileInputStream in = new java.io.FileInputStream(image); java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream()) {
                    byte[] buffer = new byte[16384]; for (int n; (n = in.read(buffer)) > 0;) out.write(buffer, 0, n); photo = out.toByteArray();
                }
                raw("PUT", "/api/files/page-" + uid + ".jpg", token, "image/jpeg", photo, id);
                CloudSync.prefs(c).edit().putBoolean(marker, true).apply();
            }
            ParkingReceiver.arm(c);
            if (JournalStore.unread(c)) JournalJob.schedule(c);
            ClaudeChatRepository.get(c).syncCloud();
            CorosRepository.get(c).syncAccount(false);
            CloudSync.prefs(c).edit().putLong("last_ok", System.currentTimeMillis()).remove("last_error").apply();
            c.sendBroadcast(new Intent(CloudSync.ACTION_SYNCED).setPackage(c.getPackageName()));
        } catch (JSONException error) { throw new IOException("Pocket returned a damaged workspace.", error); }
    }
    static boolean downloadPageImage(Context c, String uid) throws IOException, CloudSync.SignInNeeded {
        if (!uid.matches("[a-zA-Z0-9_-]{1,100}")) throw new IOException("Invalid Paper photo id.");
        byte[] photo;
        try { photo = raw("GET", "/api/files/page-" + uid + ".jpg", token(c), null, null, ""); }
        catch (Missing missing) { return false; }
        java.io.File target = JournalStore.image(c, uid), partial = new java.io.File(target.getPath() + ".part");
        try (java.io.FileOutputStream out = new java.io.FileOutputStream(partial)) { out.write(photo); }
        if (!partial.renameTo(target)) throw new IOException("Could not save the Paper photo.");
        CloudSync.prefs(c).edit().putBoolean("pocket_uploaded_" + uid, true).apply(); return true;
    }
    private static final class Missing extends IOException { }
    private static byte[] raw(String method, String path, String token, String type, byte[] bytes, String account) throws IOException, CloudSync.SignInNeeded {
        Request.Builder request = new Request.Builder().url(ORIGIN + path).header("Authorization", "Bearer " + token).header("User-Agent", USER_AGENT);
        if (!account.isEmpty()) request.header("X-Pocket-Account", account);
        request.method(method, bytes == null ? null : RequestBody.create(bytes, MediaType.parse(type)));
        OkHttpClient client = path.equals("/api/coros/refresh") ? HTTP.newBuilder().readTimeout(240, TimeUnit.SECONDS).callTimeout(250, TimeUnit.SECONDS).build() : HTTP;
        try (Response response = client.newCall(request.build()).execute()) {
            if (response.code() == 401) throw new CloudSync.SignInNeeded("Sign in to Pocket again.");
            if (response.code() == 404) throw new Missing();
            if (!response.isSuccessful()) throw error(response.code(), response.body() == null ? "" : response.body().string());
            return readBody(response, 4 * 1024 * 1024);
        }
    }
    private static byte[] readBody(Response response, int limit) throws IOException {
        if (response.body() == null) return new byte[0];
        try (java.io.InputStream in = response.body().byteStream(); java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream()) {
            byte[] buffer = new byte[16384];
            for (int n; (n = in.read(buffer)) > 0;) { out.write(buffer, 0, n); if (out.size() > limit) throw new IOException("Pocket returned too much data."); }
            return out.toByteArray();
        }
    }
    private static IOException error(int status, String body) {
        try { JSONObject value = new JSONObject(body); String message = value.optString("error", value.optString("message")); if (!message.isEmpty()) return new IOException(message); }
        catch (JSONException ignored) { }
        return new IOException("Pocket answered " + status + ".");
    }
    private PocketCloud() { }
}
