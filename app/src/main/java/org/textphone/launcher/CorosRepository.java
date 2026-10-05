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
    boolean connected() { return vault.present("tokens"); }
    boolean pending() { return vault.present("pending"); }
    synchronized String begin() throws IOException { return auth.begin(); }
    synchronized boolean finish() throws IOException { return auth.finish(); }
    synchronized void disconnect() {
        vault.clear(); prefs.edit().clear().commit();
        try { auth.disconnect(); } catch (IOException ignored) { }
        broadcast();
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
        if (!connected()) return null;
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
            if (error instanceof CorosAuth.Expired) prefs.edit().remove("snapshot").apply();
            fail(error.getMessage()); throw error;
        }
    }
    private void fail(String text) { prefs.edit().putString("error", text).apply(); broadcast(); }
    private void broadcast() { context.sendBroadcast(new Intent(ACTION_UPDATED).setPackage(context.getPackageName())); }
}
