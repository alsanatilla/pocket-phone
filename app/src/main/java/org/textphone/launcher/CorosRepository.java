package org.textphone.launcher;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import java.io.IOException;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.ArrayList;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Health and bounded activity-detail caches. Home and Movement never need a network to draw. */
final class CorosRepository {
    static final String ACTION_UPDATED = "org.textphone.launcher.MOVEMENT_UPDATED";
    private static CorosRepository instance;
    private final Context context; private final SharedPreferences prefs; private final CorosVault vault; private final CorosAuth auth;
    interface DetailIO { JSONObject api(String method, String path, JSONObject body) throws IOException; String tool(String name, JSONObject args) throws IOException; byte[] download(String url) throws IOException; }
    private final DetailIO detailIO;
    static synchronized CorosRepository get(Context context) {
        if (instance == null || instance.context != context.getApplicationContext()) instance = new CorosRepository(context.getApplicationContext());
        return instance;
    }
    private CorosRepository(Context context) {
        this(context, null);
    }
    CorosRepository(Context context, DetailIO io) {
        this.context = context; prefs = context.getSharedPreferences("pocket_movement", 0); vault = new CorosVault(context); auth = new CorosAuth(vault, new CorosAuth.Http());
        detailIO = io != null ? io : new DetailIO() {
            public JSONObject api(String method, String path, JSONObject body) throws IOException { return PocketCloud.api(context, method, path, body); }
            public String tool(String name, JSONObject args) throws IOException { return auth.tool(name, args); }
            public byte[] download(String url) throws IOException { return downloadFit(url); }
        };
    }
    boolean connected() { return prefs.getBoolean("cloud_owned", false) ? prefs.getBoolean("cloud_connected", false) && !prefs.getBoolean("cloud_disconnect", false) : vault.present("tokens"); }
    boolean pending() { return prefs.getBoolean("cloud_pending", false) || vault.present("pending"); }
    synchronized String begin() throws IOException {
        if (PocketCloud.selected(context) && PocketCloud.saved(context)) {
            try {
                JSONObject answer = PocketCloud.api(context, "POST", "/api/coros/start", new JSONObject().put("zone", ZoneId.systemDefault().getId()));
                prefs.edit().putBoolean("cloud_owned", true).putBoolean("cloud_pending", true).remove("cloud_disconnect").commit();
                return answer.getString("url");
            } catch (JSONException error) { throw new IOException("COROS sign-in could not start.", error); }
        }
        if (prefs.getBoolean("cloud_owned", false)) throw new IOException("Sign in to Pocket to reconnect COROS.");
        return auth.begin();
    }
    synchronized boolean finish() throws IOException {
        if (prefs.getBoolean("cloud_pending", false)) {
            boolean complete = PocketCloud.api(context, "POST", "/api/coros/claim", new JSONObject()).optBoolean("complete");
            if (complete) { accept(PocketCloud.api(context, "GET", "/api/coros/state", null)); CorosJob.ensure(context); }
            return complete;
        }
        boolean complete = auth.finish(); if (complete) CorosJob.ensure(context); return complete;
    }
    synchronized void disconnect() {
        if (prefs.getBoolean("cloud_owned", false)) { prefs.edit().putBoolean("cloud_disconnect", true).putBoolean("cloud_pending", false).putBoolean("cloud_connected", false).commit(); CloudSync.soon(context); }
        vault.clear();
        try { auth.disconnect(); } catch (IOException ignored) { }
        broadcast();
    }
    void accept(JSONObject state) throws IOException {
        if (!PocketCloud.accountId(context).equals(state.optString("accountId"))) throw new IOException("Pocket account changed.");
        try {
            SharedPreferences.Editor edit = prefs.edit().putBoolean("cloud_owned", true).putBoolean("cloud_connected", state.optBoolean("connected"))
                    .putBoolean("cloud_pending", state.optBoolean("pending")).putString("error", state.optString("error"));
            JSONObject data = state.optJSONObject("data"), raw = data == null ? null : data.optJSONObject("native");
            if (raw == null && data != null && data.optLong("updated") > 0) raw = new JSONObject().put("updated", data.optLong("updated"));
            if (raw != null && data != null) {
                raw = new JSONObject(raw.toString());
                if (data.optJSONObject("cockpit") != null) raw.put("cockpit", data.getJSONObject("cockpit"));
                JSONObject records = data.optJSONObject("activities"); if (records != null && records.optJSONArray("list") != null) raw.put("records", records.getJSONArray("list"));
            }
            if (raw != null) { new Snapshot(raw); edit.putString("snapshot", raw.toString()); }
            if (!edit.commit()) throw new IOException("Could not save movement data.");
            broadcast();
        } catch (JSONException error) { throw new IOException("COROS readings could not be read.", error); }
    }
    synchronized Snapshot syncAccount(boolean force) throws IOException {
        if (!PocketCloud.selected(context) || !PocketCloud.saved(context)) return cached();
        try {
            if (prefs.getBoolean("cloud_disconnect", false)) {
                accept(PocketCloud.api(context, "POST", "/api/coros/disconnect", new JSONObject()));
                prefs.edit().remove("cloud_disconnect").commit(); return cached();
            }
            if (vault.present("tokens")) {
                JSONObject data = new JSONObject(), raw = new JSONObject(prefs.getString("snapshot", "{}"));
                if (raw.has("updated")) data.put("updated", raw.getLong("updated")).put("native", raw);
                if (raw.optJSONObject("cockpit") != null) data.put("cockpit", raw.getJSONObject("cockpit"));
                if (raw.optJSONArray("records") != null) data.put("activities", new JSONObject().put("at", raw.optLong("updated")).put("list", raw.getJSONArray("records")));
                accept(PocketCloud.api(context, "POST", "/api/coros/import", new JSONObject().put("credentials", new JSONObject(vault.get("tokens")))
                        .put("zone", ZoneId.systemDefault().getId()).put("data", data)));
                vault.put("tokens", null); // Server acknowledgement precedes removal of phone credentials.
            }
            JSONObject state = PocketCloud.api(context, "GET", "/api/coros/state", null); accept(state);
            if (state.optBoolean("connected") && (force || System.currentTimeMillis() >= state.optLong("next")))
                accept(PocketCloud.api(context, "POST", "/api/coros/refresh", new JSONObject().put("force", force)));
            if (state.optBoolean("connected")) uploadDetails();
            CorosJob.ensure(context); return cached();
        } catch (JSONException error) { throw new IOException("COROS connection could not be saved.", error); }
    }
    static final class Snapshot {
        final long updated; final LocalDate date; final Scores.Result scores; final List<CorosData.Activity> activities;
        final List<CorosData.Hrv> hrv; final Map<LocalDate, Integer> resting; final Map<LocalDate, CorosData.Day> daily;
        final JSONObject cockpit;
        Snapshot(JSONObject raw) throws JSONException {
            this(raw, 0);
        }
        Snapshot(JSONObject raw, int observedMax) throws JSONException {
            updated = raw.getLong("updated"); ZoneId zone = ZoneId.systemDefault(); date = java.time.Instant.ofEpochMilli(updated).atZone(zone).toLocalDate();
            cockpit = CorosData.cockpit(raw);
            activities = raw.optJSONArray("records") == null ? CorosData.records(raw.optString("activities"), zone) : CorosData.records(raw.optJSONArray("records"));
            hrv = CorosData.hrv(cockpit.optJSONArray("hrv")); resting = CorosData.resting(cockpit.optJSONArray("resting")); daily = CorosData.daily(cockpit.optJSONObject("daily"));
            JSONObject profile = cockpit.optJSONObject("profile"), health = cockpit.optJSONObject("daily");
            // Calculate for the fetched date. Old data keeps its date instead of becoming today's reading.
            scores = Scores.compute(date, zone, activities, hrv, resting, daily, profile == null ? 0 : profile.optInt("age"), profile != null && "Female".equals(profile.optString("gender")), observedMax, health == null ? 0 : health.optInt("restingHr"));
        }
        boolean today() { return date.equals(LocalDate.now()); }
    }
    Snapshot cached() {
        try { String raw = prefs.getString("snapshot", null); return raw == null ? null : new Snapshot(new JSONObject(raw), observedMax()); }
        catch (JSONException | RuntimeException damaged) { return null; }
    }
    String error() { return prefs.getString("error", ""); }
    synchronized Snapshot refresh(boolean force) throws IOException {
        if (PocketCloud.selected(context) && PocketCloud.saved(context) || prefs.getBoolean("cloud_owned", false)) return syncAccount(force);
        if (!connected()) return cached();
        Snapshot saved = cached();
        if (!force && saved != null && saved.today() && System.currentTimeMillis() - saved.updated < 15 * 60_000) return saved;
        try {
            LocalDate end = LocalDate.now(); DateTimeFormatter ymd = DateTimeFormatter.BASIC_ISO_DATE;
            JSONObject records = new JSONObject().put("startDate", ymd.format(end.minusDays(89))).put("endDate", ymd.format(end))
                    .put("sportTypeCodes", JSONObject.NULL).put("minDistanceKm", JSONObject.NULL).put("maxDistanceKm", JSONObject.NULL)
                    .put("minDurationMinutes", JSONObject.NULL).put("maxDurationMinutes", JSONObject.NULL).put("maxAveragePace", JSONObject.NULL)
                    .put("locationKeyword", JSONObject.NULL).put("limit", 150);
            // Publish one complete snapshot; failed requests leave the earlier date and inputs together.
            JSONObject raw = new JSONObject().put("activities", detailIO.tool("querySportRecords", records))
                    .put("resting", detailIO.tool("queryRestingHeartRate", new JSONObject().put("days", 29)))
                    .put("hrv", detailIO.tool("querySleepHrv", new JSONObject().put("startDate", JSONObject.NULL).put("endDate", JSONObject.NULL).put("days", 28)))
                    .put("daily", detailIO.tool("queryDailyHealthData", new JSONObject().put("days", 28)))
                    .put("profile", detailIO.tool("queryUserInfo", new JSONObject())).put("updated", System.currentTimeMillis());
            JSONObject before = new JSONObject(prefs.getString("snapshot", "{}")), partAt = before.optJSONObject("partAt"); if (partAt == null) partAt = new JSONObject();
            String[][] asks = {{"recovery","queryRecoveryStatus"},{"fitness","queryFitnessAssessmentOverview"},{"load","queryTrainingLoadAssessment"},{"sleep","querySleepOverview"},{"device","queryDevices"}};
            boolean partial = false;
            for (String[] ask : asks) {
                try { raw.put(ask[0], detailIO.tool(ask[1], "load".equals(ask[0]) || "sleep".equals(ask[0]) ? new JSONObject().put("days", 28) : new JSONObject())); partAt.put(ask[0], raw.optLong("updated")); }
                catch (IOException failure) { partial = true; if (before.has(ask[0])) raw.put(ask[0], before.get(ask[0])); }
            }
            // Preserve the archive while replacing readings atomically.
            Map<String, CorosData.Activity> archive = new java.util.LinkedHashMap<>();
            for (CorosData.Activity a : before.optJSONArray("records") == null ? CorosData.records(before.optString("activities"), ZoneId.systemDefault()) : CorosData.records(before.optJSONArray("records"))) archive.put(a.id, a);
            for (CorosData.Activity a : CorosData.records(raw.optString("activities"), ZoneId.systemDefault())) archive.put(a.id, a);
            raw.put("records", CorosData.recordsJson(new ArrayList<>(archive.values()))).put("partAt", partAt);
            raw.put("cockpit", CorosData.cockpit(raw).put("partAt", partAt));
            Snapshot result = new Snapshot(raw, observedMax());
            if (!prefs.edit().putString("snapshot", raw.toString()).putString("error", partial ? "Some COROS readings could not refresh." : "").commit()) throw new IOException("Could not save movement data.");
            broadcast(); return result;
        } catch (JSONException | RuntimeException error) {
            fail("COROS data could not be read. Try Refresh."); throw new IOException("COROS data could not be read. Try Refresh.", error);
        } catch (IOException error) {
            fail(error.getMessage()); throw error;
        }
    }
    String detailOwner() { return prefs.getBoolean("cloud_owned", false) ? PocketCloud.accountId(context) : "local"; }
    private JSONObject detailCache() {
        try { JSONObject cache = new JSONObject(prefs.getString("activity_details", "{}")); return detailOwner().equals(cache.optString("owner")) ? cache : new JSONObject().put("owner", detailOwner()).put("entries", new JSONObject()); }
        catch (JSONException damaged) { return new JSONObject(); }
    }
    JSONObject cachedDetail(String id) { JSONObject entries = detailCache().optJSONObject("entries"), entry = entries == null ? null : entries.optJSONObject(id); return entry == null ? null : entry.optJSONObject("value"); }
    int observedMax() {
        int max = 0; JSONObject entries = detailCache().optJSONObject("entries"); if (entries == null) return max;
        for (java.util.Iterator<String> keys = entries.keys(); keys.hasNext();) { JSONObject entry = entries.optJSONObject(keys.next()), value = entry == null ? null : entry.optJSONObject("value"), laps = value == null ? null : value.optJSONObject("laps"); JSONArray rows = laps == null ? null : laps.optJSONArray("laps");
            if (rows != null) for (int i = 0; i < rows.length(); i++) { JSONObject row = rows.optJSONObject(i); if (row != null) max = Math.max(max, row.optInt("maxHr")); }
        } return max;
    }
    synchronized void rememberDetail(String owner, String id, JSONObject value, boolean shared) throws IOException {
        if (!owner.equals(detailOwner())) throw new IOException("Pocket account changed.");
        if (!id.matches("[A-Za-z0-9_-]{1,160}") || value == null || value.optJSONArray("detail") == null || value.has("fitUrl") || value.toString().length() > 1000000) throw new IOException("Invalid activity cache.");
        try {
            JSONObject cache = detailCache(), entries = cache.optJSONObject("entries"); if (entries == null) { entries = new JSONObject(); cache.put("entries", entries).put("owner", owner); }
            entries.put(id, new JSONObject().put("value", value).put("at", System.currentTimeMillis()).put("shared", shared));
            while (entries.length() > 20 || cache.toString().length() > 2000000) {
                String oldest = null; long at = Long.MAX_VALUE;
                for (java.util.Iterator<String> keys = entries.keys(); keys.hasNext();) { String key = keys.next(); if (key.equals(id)) continue; long time = entries.getJSONObject(key).optLong("at"); if (oldest == null || time < at) { oldest = key; at = time; } }
                if (oldest == null) break; entries.remove(oldest);
            }
            if (!prefs.edit().putString("activity_details", cache.toString()).commit()) throw new IOException("Could not save this activity."); broadcast();
        } catch (JSONException error) { throw new IOException("Could not save this activity.", error); }
    }
    private void uploadDetails() {
        String owner = detailOwner(); if (owner.isEmpty() || "local".equals(owner)) return;
        JSONObject cache = detailCache(), entries = cache.optJSONObject("entries"); if (entries == null) return;
        int sent = 0;
        for (java.util.Iterator<String> keys = entries.keys(); keys.hasNext() && sent < 3;) {
            String id = keys.next(); JSONObject entry = entries.optJSONObject(id); if (entry == null || entry.optBoolean("shared") || entry.optJSONObject("value") == null) continue;
            try { detailIO.api("PUT", "/api/coros/details/" + android.net.Uri.encode(id), new JSONObject().put("value", entry.getJSONObject("value"))); if (!owner.equals(detailOwner())) return; entry.put("shared", true); sent++; }
            catch (IOException | JSONException failure) { break; }
        }
        if (owner.equals(detailOwner())) prefs.edit().putString("activity_details", cache.toString()).commit();
    }
    synchronized JSONObject detail(CorosData.Activity item, boolean force) throws IOException {
        JSONObject saved = cachedDetail(item.id); if (!force && saved != null) { uploadDetails(); return saved; }
        if (!connected()) { if (saved != null) return saved; throw new IOException("Reconnect COROS to load this activity."); }
        String owner = detailOwner(); boolean cloud = prefs.getBoolean("cloud_owned", false), complete = true; String detail = "", laps = "", fitUrl = "";
        try {
            if (cloud) {
                JSONObject answer = detailIO.api("GET", "/api/coros/details/" + android.net.Uri.encode(item.id) + "?sport=" + item.sport, null);
                if (!owner.equals(detailOwner())) throw new IOException("Pocket account changed.");
                if (answer.optJSONObject("cached") != null) { JSONObject value = answer.getJSONObject("cached"); rememberDetail(owner, item.id, value, true); return value; }
                detail = answer.optString("detail"); laps = answer.optString("laps"); fitUrl = answer.optString("fitUrl");
            } else {
                JSONObject args = new JSONObject().put("labelId", item.id).put("sportType", item.sport);
                try { detail = detailIO.tool("getActivityDetail", args); } catch (IOException failure) { complete = false; }
                try { laps = detailIO.tool("queryActivityLapData", args); } catch (IOException failure) { complete = false; }
                try { java.util.regex.Matcher url = java.util.regex.Pattern.compile("https://[^\\s\"'<>]+\\.fit[^\\s\"'<>]*").matcher(detailIO.tool("queryActivityFitFileDownloadUrls", args)); if (url.find()) fitUrl = url.group(); } catch (IOException failure) { complete = false; }
                if (detail.isEmpty() && laps.isEmpty()) throw new IOException("This activity could not load. Try again.");
            }
            JSONObject fit = null;
            if (!fitUrl.isEmpty()) try { fit = MovementFit.parse(detailIO.download(fitUrl), item.sport < 200 || item.sport >= 900 && item.sport < 1000); } catch (IOException invalid) { complete = false; }
            JSONObject value = new JSONObject().put("detail", CorosData.pairs(detail)).put("laps", CorosData.laps(laps))
                    .put("path", fit == null ? JSONObject.NULL : fit.opt("path")).put("climb", fit == null ? JSONObject.NULL : fit.opt("climb")).put("series", fit == null ? JSONObject.NULL : fit.opt("series"));
            if (value.getJSONArray("detail").length() == 0 && value.optJSONObject("laps") == null && fit == null) throw new IOException("This activity has no available details. Try again.");
            if (!complete) value.put("partial", true);
            if (!owner.equals(detailOwner())) throw new IOException("Pocket account changed.");
            if (complete) { rememberDetail(owner, item.id, value, !cloud); if (cloud) uploadDetails(); }
            return value;
        } catch (JSONException error) { throw new IOException("This activity could not be read.", error); }
    }
    /** Signed download URLs and Pocket credentials never enter the cache or the download headers. */
    static byte[] downloadFit(String address) throws IOException {
        java.net.URL url = new java.net.URL(address);
        for (int redirects = 0; redirects < 4; redirects++) {
            if (!"https".equals(url.getProtocol()) || url.getUserInfo() != null || url.getHost().isEmpty()) throw new IOException("Invalid activity download address.");
            javax.net.ssl.HttpsURLConnection connection = (javax.net.ssl.HttpsURLConnection) url.openConnection(); connection.setConnectTimeout(15000); connection.setReadTimeout(25000); connection.setInstanceFollowRedirects(false);
            try {
                int status = connection.getResponseCode();
                if (status >= 300 && status < 400) { String location = connection.getHeaderField("Location"); if (location == null) throw new IOException("The activity file could not download."); url = new java.net.URL(url, location); continue; }
                if (status != 200 || connection.getContentLengthLong() > 16 * 1024 * 1024) throw new IOException("The activity file could not download.");
                try (java.io.InputStream in = connection.getInputStream(); java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192]; int n; while ((n = in.read(buffer)) != -1) { if (Thread.currentThread().isInterrupted()) throw new IOException("Activity load cancelled."); if (bytes.size() + n > 16 * 1024 * 1024) throw new IOException("The activity file is too large."); bytes.write(buffer, 0, n); } return bytes.toByteArray();
                }
            } finally { connection.disconnect(); }
        }
        throw new IOException("The activity file redirected too often.");
    }
    private void fail(String text) { prefs.edit().putString("error", text).apply(); broadcast(); }
    private void broadcast() { context.sendBroadcast(new Intent(ACTION_UPDATED).setPackage(context.getPackageName())); }
}
