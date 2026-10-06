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
import org.json.JSONException;
import org.json.JSONObject;

/** Only the compact score inputs are cached, privately on the phone. Home never waits for the network. */
final class CorosRepository {
    static final String ACTION_UPDATED = "org.textphone.launcher.MOVEMENT_UPDATED";
    private static CorosRepository instance;
    private final Context context; private final SharedPreferences prefs; private final CorosVault vault; private final CorosAuth auth;
    static synchronized CorosRepository get(Context context) {
        if (instance == null || instance.context != context.getApplicationContext()) instance = new CorosRepository(context.getApplicationContext());
        return instance;
    }
    private CorosRepository(Context context) {
        this.context = context; prefs = context.getSharedPreferences("pocket_movement", 0); vault = new CorosVault(context); auth = new CorosAuth(vault, new CorosAuth.Http());
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
    private void accept(JSONObject state) throws IOException {
        if (!PocketCloud.accountId(context).equals(state.optString("accountId"))) throw new IOException("Pocket account changed.");
        try {
            SharedPreferences.Editor edit = prefs.edit().putBoolean("cloud_owned", true).putBoolean("cloud_connected", state.optBoolean("connected"))
                    .putBoolean("cloud_pending", state.optBoolean("pending")).putString("error", state.optString("error"));
            JSONObject data = state.optJSONObject("data"), raw = data == null ? null : data.optJSONObject("native");
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
                accept(PocketCloud.api(context, "POST", "/api/coros/import", new JSONObject().put("credentials", new JSONObject(vault.get("tokens")))
                        .put("zone", ZoneId.systemDefault().getId()).put("data", data)));
                vault.put("tokens", null); // Server acknowledgement precedes removal of phone credentials.
            }
            JSONObject state = PocketCloud.api(context, "GET", "/api/coros/state", null); accept(state);
            if (state.optBoolean("connected") && (force || System.currentTimeMillis() >= state.optLong("next")))
                accept(PocketCloud.api(context, "POST", "/api/coros/refresh", new JSONObject().put("force", force)));
            CorosJob.ensure(context); return cached();
        } catch (JSONException error) { throw new IOException("COROS connection could not be saved.", error); }
    }
    static final class Snapshot {
        final long updated; final LocalDate date; final Scores.Result scores; final List<CorosData.Activity> activities;
        final List<CorosData.Hrv> hrv; final Map<LocalDate, Integer> resting; final Map<LocalDate, CorosData.Day> daily;
        Snapshot(JSONObject raw) throws JSONException {
            updated = raw.getLong("updated"); ZoneId zone = ZoneId.systemDefault(); date = java.time.Instant.ofEpochMilli(updated).atZone(zone).toLocalDate();
            activities = CorosData.records(raw.getString("activities"), zone); hrv = CorosData.hrv(raw.getString("hrv"));
            resting = CorosData.resting(raw.getString("resting")); daily = CorosData.daily(raw.getString("daily"));
            String profile = raw.getString("profile");
            // Calculate for the fetched date. Old data keeps its date instead of becoming today's reading.
            scores = Scores.compute(date, zone, activities, hrv, resting, daily, CorosData.age(profile), CorosData.female(profile));
        }
        boolean today() { return date.equals(LocalDate.now()); }
    }
    Snapshot cached() {
        try { String raw = prefs.getString("snapshot", null); return raw == null ? null : new Snapshot(new JSONObject(raw)); }
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
            JSONObject raw = new JSONObject().put("activities", auth.tool("querySportRecords", records))
                    .put("resting", auth.tool("queryRestingHeartRate", new JSONObject().put("days", 29)))
                    .put("hrv", auth.tool("querySleepHrv", new JSONObject().put("startDate", JSONObject.NULL).put("endDate", JSONObject.NULL).put("days", 28)))
                    .put("daily", auth.tool("queryDailyHealthData", new JSONObject().put("days", 28)))
                    .put("profile", auth.tool("queryUserInfo", new JSONObject())).put("updated", System.currentTimeMillis());
            Snapshot result = new Snapshot(raw);
            if (!prefs.edit().putString("snapshot", raw.toString()).remove("error").commit()) throw new IOException("Could not save movement data.");
            broadcast(); return result;
        } catch (JSONException | RuntimeException error) {
            fail("COROS data could not be read. Try Refresh."); throw new IOException("COROS data could not be read. Try Refresh.", error);
        } catch (IOException error) {
            fail(error.getMessage()); throw error;
        }
    }
    private void fail(String text) { prefs.edit().putString("error", text).apply(); broadcast(); }
    private void broadcast() { context.sendBroadcast(new Intent(ACTION_UPDATED).setPackage(context.getPackageName())); }
}
