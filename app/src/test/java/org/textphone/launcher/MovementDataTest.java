package org.textphone.launcher;

import static org.junit.Assert.*;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/** The browser's COROS fixtures in native units, plus sparse and older phone snapshots. */
@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class MovementDataTest {
    @Test public void legacyHealthTextMatchesWebUnitsAndOrder() throws Exception {
        JSONObject raw = new JSONObject().put("updated", System.currentTimeMillis())
            .put("recovery", "Recovery: 76%\nLevel: Ready\nEstimated Full Recovery: 11h")
            .put("fitness", "VO2max: 50\nRunning Level: 70\nThreshold Pace: 5:00 /km\n5 km Prediction: 22:10\nHalf Marathon Prediction: 1:45:00")
            .put("load", "2026-10-02\nShort-Term Load: 60\nLong-Term Load: 50\nLoad Ratio: 1.20\n2026-10-01\nShort-Term Load: 40\nLong-Term Load: 50\nLoad Ratio: 0.80")
            .put("daily", "Daily Health Data | Resting HR: 50 bpm | HRV Baseline: 60 ms\n--- 20261001 ---\nSteps: 12,345 | Calories: 600 kcal | Exercise: 1h 5min\nStress: Avg 30\nTotal: 7h 30min | Deep: 1h 10min | Light: 4h 0min | REM: 2h 5min | Awake: 15 min\nSleep HR: Avg 52 bpm | Min 45 bpm | Max 70 bpm\n--- 20261002 ---\nSteps: 900 | Calories: 80 kcal | Exercise: 0 min\nStress: Avg 20")
            .put("sleep", "2026-10-01\nSleep Score: 0\n2026-10-02\nSleep Score: 80\nMain Sleep (asleep): 7h 2min\nDeep Sleep Ratio: 20%\nMain Sleep Window: 2026-10-01 23:00 - 2026-10-02 06:10")
            .put("hrv", "2026-10-02:\nHRV Avg: 60 ms — Normal\nNormal Range: 55 - 70 ms\nBaseline: 62 ms\n2026-10-01:\nHRV Avg: 60 ms — Low\nNormal Range: 55 - 70 ms\nBaseline: 62 ms\nSleep HRV Time Series\n2026-10-02:\nHRV Avg: 99 ms")
            .put("resting", "2026-10-02: 51 bpm\n2026-10-01: No data\n2026-09-30: 53 bpm").put("device", "Model Name: PACE 3").put("profile", "Age: 40\nGender: Female");
        JSONObject deck = CorosData.cockpit(raw), daily = deck.getJSONObject("daily"), day = daily.getJSONArray("days").getJSONObject(0), sleep = day.getJSONObject("sleep");
        assertEquals(76, deck.getJSONObject("recovery").getInt("percent")); assertEquals(50, deck.getJSONObject("fitness").getInt("vo2max"));
        assertEquals("1:45:00", deck.getJSONObject("fitness").getJSONArray("predictions").getJSONArray(1).getString(1)); assertEquals(.8, deck.getJSONArray("load").getJSONObject(0).getDouble("ratio"), .001);
        assertEquals(50, daily.getInt("restingHr")); assertEquals(12345, day.getInt("steps")); assertEquals(65, day.getInt("exercise")); assertEquals(450, sleep.getInt("total")); assertEquals(70, sleep.getInt("deep")); assertEquals(125, sleep.getInt("rem")); assertEquals(52, sleep.getJSONObject("hr").getInt("avg"));
        assertNull(daily.getJSONArray("days").getJSONObject(1).optJSONObject("sleep")); assertEquals(0, daily.getJSONArray("days").getJSONObject(1).getInt("exercise"));
        assertEquals(1, deck.getJSONArray("sleep").length()); assertEquals(422, deck.getJSONArray("sleep").getJSONObject(0).getInt("asleep")); assertEquals(20, deck.getJSONArray("sleep").getJSONObject(0).getInt("deep"));
        assertEquals(2, deck.getJSONArray("hrv").length()); assertEquals("Low", deck.getJSONArray("hrv").getJSONObject(0).getString("status")); assertEquals("Normal", deck.getJSONArray("hrv").getJSONObject(1).getString("status"));
        assertEquals("2026-09-30", deck.getJSONArray("resting").getJSONObject(0).getString("date")); assertEquals("PACE 3", deck.getString("device"));
    }
    @Test public void canonicalCockpitOverridesLegacyWithoutInventingMissingMetrics() throws Exception {
        JSONObject cloud = new JSONObject().put("hrv", new JSONArray("[{\"date\":\"2026-10-05\",\"avg\":64,\"baseline\":null}]"));
        JSONObject deck = CorosData.cockpit(new JSONObject().put("hrv", "2026-10-05:\nHRV Avg: 99 ms").put("cockpit", cloud));
        assertEquals(64, deck.getJSONArray("hrv").getJSONObject(0).getInt("avg")); assertNull(CorosData.metric(deck.getJSONArray("hrv").getJSONObject(0), "baseline"));
        assertTrue(deck.getJSONObject("fitness").isNull("vo2max")); assertEquals(0, deck.getJSONArray("sleep").length());
        double[] days = MovementActivity.onDays(cloud.getJSONArray("hrv"), "avg", new String[]{"2026-10-04", "2026-10-05"}); assertTrue(Double.isNaN(days[0])); assertEquals(64, days[1], .001);
    }
    @Test public void archiveKeepsCaloriesPaceAndMissingHeartRateAcrossRoundTrip() throws Exception {
        String text = "1. Outdoor Run — 2026-09-20\nLocation: Riverside Loop\nTime Window: startTimestamp=1790150400 | endTimestamp=1790154000\nDuration: 1:04:30 | Distance: 10.50 km\nAverage Pace: 6:08 /km | Avg HR: 150 bpm | Calories: 700 kcal\nLabelId: 111 | SportType: 100\n2. Outdoor Bike — 2026-09-18\nDuration: 45:00 | Distance: 15.00 km\nAverage Speed: 20.0 km/h | Calories: 400 kcal\nLabelId: 222 | SportType: 200";
        List<CorosData.Activity> records = CorosData.records(text, ZoneId.of("Europe/Berlin"));
        assertEquals(2, records.size()); assertEquals("Riverside Loop", records.get(0).name); assertEquals(10.5, records.get(0).km, .001); assertEquals(3870, records.get(0).seconds); assertEquals(700, records.get(0).kcal);
        List<CorosData.Activity> roundTrip = CorosData.records(CorosData.recordsJson(records)); assertEquals("6:08 /km", roundTrip.get(0).pace); assertEquals("average", roundTrip.get(1).paceLabel); assertEquals(0, roundTrip.get(1).hr);
        JSONArray invalid = new JSONArray().put(records.get(0).json().put("id", "../oops")); assertTrue(CorosData.records(invalid).isEmpty());
    }
    @Test public void splitsUseMetresSecondsAndPlainRunningMetrics() throws Exception {
        JSONObject source = new JSONObject("{\"lapGroups\":[{\"type\":2,\"lapDistance\":100000,\"fastLapIndexList\":[1],\"laps\":[{\"lapIndex\":1,\"distance\":100000,\"time\":300,\"avgPace\":300,\"avgSpeedV2\":1200,\"avgHr\":150,\"maxHr\":172,\"avgCadence\":170,\"avgStrideLength\":118,\"strideHeight\":85,\"strideRatio\":72,\"groundTime\":240,\"avgPower\":0,\"elevGain\":0}]}]}");
        JSONObject laps = CorosData.laps(source.toString()), lap = laps.getJSONArray("laps").getJSONObject(0);
        assertEquals(1, laps.getDouble("every"), 0); assertEquals(1, lap.getDouble("km"), 0); assertEquals(12, lap.getDouble("speed"), 0); assertEquals(118, lap.getDouble("stride"), 0); assertEquals(8.5, lap.getDouble("oscillation"), 0); assertEquals(7.2, lap.getDouble("ratio"), .001); assertTrue(lap.isNull("power")); assertEquals(0, lap.getDouble("climb"), 0); assertTrue(lap.isNull("descent"));
        assertNull(CorosData.laps("not json")); assertEquals("6:00", MovementActivity.pace(359.8));
    }
    @Test public void oldSnapshotsStillComputeAndHistoricalDatesRemainExplicit() throws Exception {
        LocalDate old = LocalDate.now().minusDays(2);
        CorosRepository.Snapshot s = new CorosRepository.Snapshot(new JSONObject().put("updated", old.atTime(12, 0).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()).put("hrv", old + ":\nHRV Avg: 60 ms\nBaseline: 60\nNormal Range: 50 - 70\n").put("daily", old + ":\nTotal: 7h 30min | Deep: 1h | Awake: 20min\n"));
        assertFalse(s.today()); assertEquals(old, s.date); assertNotNull(s.scores.recovery); assertEquals(28, s.scores.recoveries.size()); assertEquals(28, s.scores.strains.size()); assertEquals(90, s.scores.conditioning.trail.size());
        assertEquals(450, s.daily.get(old).sleep);
    }
}
