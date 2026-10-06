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

/** Phone transport for the same authenticated Astro API used by the browser. */
final class PocketCloud {
    private static final String ORIGIN = "https://pocket-phone.vercel.app";
    private static final OkHttpClient HTTP = new OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build();
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

    static void signIn(Context c, String email, String password, boolean create) throws IOException, JSONException {
        JSONObject body = new JSONObject().put("email", email).put("password", password);
        if (create) body.put("name", email.contains("@") ? email.substring(0, email.indexOf('@')) : email);
        Request request = new Request.Builder().url(ORIGIN + "/api/auth/" + (create ? "sign-up/email" : "sign-in/email"))
                .header("Origin", ORIGIN).post(RequestBody.create(body.toString(), MediaType.parse("application/json"))).build();
        try (Response response = HTTP.newCall(request).execute()) {
            String text = response.body() == null ? "" : response.body().string();
            if (!response.isSuccessful()) throw error(response.code(), text);
            JSONObject result = new JSONObject(text), user = result.getJSONObject("user");
            String id = user.getString("id"), previous = CloudSync.prefs(c).getString("pocket_id", "");
            if (!previous.isEmpty() && !previous.equals(id)) throw new IOException("Use the same Pocket account for this phone's workspace.");
            String token = response.header("set-auth-token", result.optString("token"));
            if (token == null || token.isEmpty()) throw new IOException("Pocket sign-in did not finish.");
            new PocketCloudVault(c).put(token);
            CloudSync.prefs(c).edit().putString("transport", "pocket").putString("pocket_id", id).putString("pocket_email", user.optString("email", email)).remove("last_error").apply();
            CloudSync.enable(c);
        }
    }
    static void signOut(Context c) throws IOException {
        String token = new PocketCloudVault(c).get();
        if (token != null) {
            try { raw("POST", "/api/auth/sign-out", token, "application/json", "{}".getBytes(StandardCharsets.UTF_8), ""); }
            catch (CloudSync.SignInNeeded ignored) { /* Already expired. */ }
        }
        CloudSync.disable(c); new PocketCloudVault(c).clear();
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
        Request.Builder request = new Request.Builder().url(ORIGIN + path).header("Authorization", "Bearer " + token);
        if (!account.isEmpty()) request.header("X-Pocket-Account", account);
        request.method(method, bytes == null ? null : RequestBody.create(bytes, MediaType.parse(type)));
        OkHttpClient client = path.equals("/api/coros/refresh") ? HTTP.newBuilder().readTimeout(240, TimeUnit.SECONDS).callTimeout(250, TimeUnit.SECONDS).build() : HTTP;
        try (Response response = client.newCall(request.build()).execute()) {
            if (response.code() == 401) throw new CloudSync.SignInNeeded("Sign in to Pocket again.");
            if (response.code() == 404) throw new Missing();
            if (!response.isSuccessful()) throw error(response.code(), response.body() == null ? "" : response.body().string());
            if (response.body() == null) return new byte[0];
            try (java.io.InputStream in = response.body().byteStream(); java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream()) {
                byte[] buffer = new byte[16384];
                for (int n; (n = in.read(buffer)) > 0;) { out.write(buffer, 0, n); if (out.size() > 4 * 1024 * 1024) throw new IOException("Pocket returned too much data."); }
                return out.toByteArray();
            }
        }
    }
    private static IOException error(int status, String body) {
        try { JSONObject value = new JSONObject(body); String message = value.optString("error", value.optString("message")); if (!message.isEmpty()) return new IOException(message); }
        catch (JSONException ignored) { }
        return new IOException("Pocket answered " + status + ".");
    }
    private PocketCloud() { }
}
