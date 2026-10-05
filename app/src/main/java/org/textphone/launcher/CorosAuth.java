package org.textphone.launcher;

import android.net.Uri;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import org.json.JSONException;
import org.json.JSONObject;

/** Public-client PKCE using the browser login/claim flow shipped by COROS's own coros-mcp CLI. */
final class CorosAuth {
    static final String DISCOVERY = "https://mcp.coros.com/.well-known/openid-configuration";
    static final String REDIRECT = "http://127.0.0.1:43123/callback", SCOPE = "openid offline_access mcp.tools";
    interface Store { String get(String name) throws IOException; void put(String name, String value) throws IOException; }
    interface Transport { Reply request(String method, String url, Map<String, String> headers, String body) throws IOException; }
    static final class Reply {
        final int status; final String body, location;
        Reply(int status, String body, String location) { this.status = status; this.body = body; this.location = location; }
    }
    static final class Expired extends IOException { Expired() { super("COROS sign-in expired. Connect again."); } }
    private final Store store; private final Transport http; private int next; private boolean ready;
    CorosAuth(Store store, Transport http) { this.store = store; this.http = http; }

    synchronized String begin() throws IOException {
        try {
            JSONObject meta = json(http.request("GET", DISCOVERY, Collections.emptyMap(), null));
            String issuer = endpoint(meta.getString("issuer")), token = endpoint(meta.getString("token_endpoint"));
            JSONObject registered = json(http.request("POST", endpoint(meta.getString("registration_endpoint")), jsonHeaders(),
                    new JSONObject().put("client_name", "pocket-android").put("redirect_uris", new org.json.JSONArray().put(REDIRECT))
                            .put("grant_types", new org.json.JSONArray().put("authorization_code").put("refresh_token"))
                            .put("response_types", new org.json.JSONArray().put("code")).put("scope", SCOPE)
                            .put("token_endpoint_auth_method", "none").toString()));
            String client = registered.getString("client_id"), verifier = random(32), state = random(24);
            String challenge = encoded(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));
            String authorize = endpoint(meta.getString("authorization_endpoint")) + "?" + form("response_type", "code", "client_id", client,
                    "redirect_uri", REDIRECT, "scope", SCOPE, "code_challenge", challenge, "code_challenge_method", "S256", "resource", issuer + "/mcp", "state", state);
            JSONObject session = json(http.request("POST", issuer + "/api/v1/cli/login-sessions", jsonHeaders(), new JSONObject().put("clientId", client).toString()));
            String login = endpoint(session.getString("loginUrl"));
            long expiry = System.currentTimeMillis() + 10 * 60_000;
            try { expiry = Math.min(expiry, java.time.Instant.parse(session.getString("expiresAt")).toEpochMilli()); } catch (RuntimeException | JSONException ignored) { }
            store.put("pending", new JSONObject().put("issuer", issuer).put("token", token).put("client", client).put("verifier", verifier)
                    .put("state", state).put("authorize", authorize).put("session", session.getString("sessionId"))
                    .put("poll", session.getString("pollToken")).put("login", login).put("expires", expiry).toString());
            return login;
        } catch (JSONException | java.security.GeneralSecurityException error) { throw new IOException("COROS could not start sign-in.", error); }
    }

    /** One claim per visit/short poll, so backgrounding or recreating the screen doesn't lose login. */
    synchronized boolean finish() throws IOException {
        try {
            String saved = store.get("pending"); if (saved == null) return false;
            JSONObject pending = new JSONObject(saved);
            if (System.currentTimeMillis() > pending.getLong("expires")) { store.put("pending", null); throw new IOException("COROS sign-in timed out. Connect again."); }
            JSONObject claim = json(http.request("POST", endpoint(pending.getString("issuer")) + "/api/v1/cli/login-sessions/"
                    + URLEncoder.encode(pending.getString("session"), "UTF-8") + "/claim", Collections.singletonMap("X-Poll-Token", pending.getString("poll")), null));
            String status = claim.optString("status");
            if ("pending".equalsIgnoreCase(status)) return false;
            if (!"authorized".equalsIgnoreCase(status)) { store.put("pending", null); throw new IOException("COROS sign-in ended. Connect again."); }
            Reply authorization = http.request("GET", endpoint(pending.getString("authorize")) + "&" + form("login_ticket", claim.getString("loginTicket")), Collections.emptyMap(), null);
            if ((authorization.status != 302 && authorization.status != 303) || authorization.location == null) throw new IOException("COROS did not finish sign-in.");
            Uri callback = Uri.parse(authorization.location);
            if (!REDIRECT.equals(callback.buildUpon().clearQuery().fragment(null).build().toString())
                    || !pending.getString("state").equals(callback.getQueryParameter("state")) || callback.getQueryParameter("code") == null)
                throw new IOException("COROS sign-in did not match this phone. Try again.");
            JSONObject tokens = json(http.request("POST", endpoint(pending.getString("token")), formHeaders(), form("grant_type", "authorization_code",
                    "client_id", pending.getString("client"), "redirect_uri", REDIRECT, "code_verifier", pending.getString("verifier"), "code", callback.getQueryParameter("code"))));
            save(tokens, pending); store.put("pending", null); ready = false;
            return true;
        } catch (JSONException error) { throw new IOException("COROS could not finish sign-in.", error); }
    }
    synchronized void disconnect() throws IOException { store.put("tokens", null); store.put("pending", null); ready = false; }
    private void save(JSONObject answer, JSONObject base) throws JSONException, IOException {
        String refresh = answer.optString("refresh_token", base.optString("refresh"));
        if (refresh.isEmpty()) throw new IOException("COROS did not grant continuing access. Connect again.");
        store.put("tokens", new JSONObject().put("issuer", base.getString("issuer")).put("token", base.getString("token"))
                .put("client", base.getString("client")).put("access", answer.getString("access_token")).put("refresh", refresh)
                .put("expires", System.currentTimeMillis() + answer.optLong("expires_in", 3600) * 1000).toString());
    }
    private JSONObject access(boolean force) throws IOException, JSONException {
        String saved = store.get("tokens"); if (saved == null) throw new Expired();
        JSONObject tokens = new JSONObject(saved);
        if (force || System.currentTimeMillis() >= tokens.getLong("expires") - 60_000) {
            Reply reply = http.request("POST", endpoint(tokens.getString("token")), formHeaders(), form("grant_type", "refresh_token",
                    "client_id", tokens.getString("client"), "refresh_token", tokens.getString("refresh")));
            if (reply.status == 400 || reply.status == 401) { disconnect(); throw new Expired(); }
            save(json(reply), tokens); tokens = new JSONObject(store.get("tokens"));
        }
        return tokens;
    }
    synchronized String tool(String name, JSONObject args) throws IOException {
        // Phone integration reads only the inputs shown here. No training-plan writes are exposed.
        if (!name.matches("querySportRecords|queryRestingHeartRate|querySleepHrv|queryDailyHealthData|queryUserInfo")) throw new IOException("Unsupported COROS request.");
        try {
            if (!ready) {
                rpc("initialize", new JSONObject().put("protocolVersion", "2025-06-18").put("capabilities", new JSONObject())
                        .put("clientInfo", new JSONObject().put("name", "pocket-android").put("version", "1.0")), true);
                ready = true;
            }
            JSONObject result = rpc("tools/call", new JSONObject().put("name", name).put("arguments", args), true);
            if (result.optBoolean("isError")) throw new IOException("COROS could not read " + name + ". Try again.");
            org.json.JSONArray content = result.optJSONArray("content"); StringBuilder text = new StringBuilder();
            if (content != null) for (int i = 0; i < content.length(); i++) {
                JSONObject part = content.getJSONObject(i); if ("text".equals(part.optString("type"))) text.append(part.optString("text")).append('\n');
            }
            return CorosData.unwrap(text.toString().trim());
        } catch (JSONException error) { throw new IOException("COROS returned an unreadable answer.", error); }
    }
    private JSONObject rpc(String method, JSONObject params, boolean retry) throws IOException, JSONException {
        JSONObject tokens = access(!retry); Map<String, String> headers = new LinkedHashMap<>(jsonHeaders());
        headers.put("Authorization", "Bearer " + tokens.getString("access")); headers.put("Accept", "application/json, text/event-stream");
        Reply reply = http.request("POST", endpoint(tokens.getString("issuer")) + "/mcp", headers,
                new JSONObject().put("jsonrpc", "2.0").put("id", ++next).put("method", method).put("params", params).toString());
        if (reply.status == 401 && retry) return rpc(method, params, false);
        if (reply.status == 401) { disconnect(); throw new Expired(); }
        String payload = reply.body.trim();
        if (payload.startsWith("event:") || payload.startsWith("data:")) {
            payload = "{}"; for (String line : reply.body.split("\\r?\\n")) if (line.startsWith("data:")) payload = line.substring(5).trim();
        }
        JSONObject parsed = json(new Reply(reply.status, payload, null));
        if (parsed.has("error")) throw new IOException("COROS refused the request. Try again.");
        return parsed.getJSONObject("result");
    }
    static String endpoint(String url) throws IOException {
        Uri uri = Uri.parse(url); String host = uri.getHost();
        if (!"https".equals(uri.getScheme()) || host == null || !(host.equals("coros.com") || host.endsWith(".coros.com")) || uri.getUserInfo() != null)
            throw new IOException("COROS returned an invalid service address.");
        return url;
    }
    private static JSONObject json(Reply reply) throws IOException, JSONException {
        if (reply.status < 200 || reply.status >= 300) throw new IOException("COROS answered " + reply.status + ". Try again.");
        return new JSONObject(reply.body);
    }
    private static Map<String, String> jsonHeaders() { return Collections.singletonMap("Content-Type", "application/json"); }
    private static Map<String, String> formHeaders() { return Collections.singletonMap("Content-Type", "application/x-www-form-urlencoded"); }
    static String form(String... fields) throws IOException {
        StringBuilder result = new StringBuilder();
        for (int i = 0; i < fields.length; i += 2) { if (i > 0) result.append('&'); result.append(URLEncoder.encode(fields[i], "UTF-8")).append('=').append(URLEncoder.encode(fields[i + 1], "UTF-8")); }
        return result.toString();
    }
    private static String random(int size) { byte[] bytes = new byte[size]; new SecureRandom().nextBytes(bytes); return encoded(bytes); }
    private static String encoded(byte[] bytes) { return Base64.encodeToString(bytes, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING); }

    static final class Http implements Transport {
        @Override public Reply request(String method, String url, Map<String, String> headers, String body) throws IOException {
            endpoint(url);
            HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setInstanceFollowRedirects(false); connection.setRequestMethod(method); connection.setConnectTimeout(15_000); connection.setReadTimeout(25_000);
            for (Map.Entry<String, String> header : headers.entrySet()) connection.setRequestProperty(header.getKey(), header.getValue());
            try {
                if (body != null) { connection.setDoOutput(true); try (OutputStream out = connection.getOutputStream()) { out.write(body.getBytes(StandardCharsets.UTF_8)); } }
                int status = connection.getResponseCode(); String location = connection.getHeaderField("Location");
                InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                if (input != null) try (InputStream in = input) {
                    byte[] bytes = new byte[8192]; int read;
                    while ((read = in.read(bytes)) != -1) { if (buffer.size() + read > 2_000_000) throw new IOException("COROS answer was too large."); buffer.write(bytes, 0, read); }
                }
                return new Reply(status, buffer.toString("UTF-8"), location);
            } finally { connection.disconnect(); }
        }
    }
}
