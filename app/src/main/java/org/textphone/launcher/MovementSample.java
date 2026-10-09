package org.textphone.launcher;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Invented, visibly marked preview. Never passed to the repository, sync or preferences. */
final class MovementSample {
    static CorosRepository.Snapshot snapshot() {
        try {
            LocalDate today = LocalDate.now(); List<CorosData.Activity> activities = new ArrayList<>();
            String[] names = {"Run", "Ride", "Walk"}, paces = {"6:08 /km", "20.7 km/h", "12:36 /km"};
            int[] sports = {100, 200, 900}, ago = {1, 3, 5}, seconds = {2280, 4320, 3480}, hr = {148, 132, 104}, kcal = {480, 690, 260}; double[] km = {6.2, 24.8, 4.6};
            for (int i = 0; i < 3; i++) activities.add(new CorosData.Activity("sample-" + i, sports[i], names[i], stamp(today.minusDays(ago[i])), km[i], seconds[i], hr[i], kcal[i], paces[i], i == 1 ? "average" : "pace"));
            for (int i = 0; i < 36; i++) activities.add(new CorosData.Activity("sample-history-" + i, i % 4 == 3 ? 200 : 100, "Training", stamp(today.minusDays(7 + (int) (i * 2.3))), i % 4 == 3 ? 30 : 8, (i % 4 == 3 ? 80 : 45) * 60, 140 + i % 5 * 4));
            JSONArray days = new JSONArray(), sleep = new JSONArray(), hrv = new JSONArray(), resting = new JSONArray(), load = new JSONArray();
            for (int i = 0; i < 28; i++) {
                String date = today.minusDays(27 - i).toString(); int shortLoad = wave(i, 52, 14, .35), longLoad = Math.round(44 + i * .4f);
                days.put(new JSONObject().put("date", date).put("steps", wave(i, 8200, 3400, 1.3)).put("stress", wave(i, 33, 11, .9)).put("sleep", new JSONObject().put("total", wave(i, 445, 45, .7)).put("deep", 92).put("light", 236).put("rem", 104).put("awake", 13).put("hr", new JSONObject().put("avg", 54).put("min", 47).put("max", 71))));
                sleep.put(new JSONObject().put("date", date).put("score", wave(i, 78, 9, .7)).put("window", "23:10 – 06:40"));
                hrv.put(new JSONObject().put("date", date).put("avg", wave(i, 63, 6, .8)).put("status", "Normal").put("low", 55).put("high", 72).put("baseline", 63));
                resting.put(new JSONObject().put("date", date).put("bpm", wave(i, 52, 2, .6)));
                load.put(new JSONObject().put("date", date).put("short", shortLoad).put("long", longLoad).put("ratio", shortLoad / (double) longLoad));
            }
            JSONObject deck = new JSONObject().put("recovery", new JSONObject().put("percent", 82).put("level", "Ready for training").put("full", "9h"))
                    .put("fitness", new JSONObject().put("vo2max", 48).put("level", 72).put("threshold", "5:05 /km").put("predictions", new JSONArray("[[\"5 km\",\"23:40\"],[\"10 km\",\"49:30\"],[\"Half Marathon\",\"1:50:10\"],[\"Marathon\",\"3:52:00\"]]")))
                    .put("load", load).put("daily", new JSONObject().put("restingHr", 52).put("hrvBaseline", 63).put("days", days)).put("sleep", sleep).put("hrv", hrv).put("resting", resting).put("device", "SAMPLE WATCH").put("profile", new JSONObject().put("age", 34).put("gender", "Male"));
            return new CorosRepository.Snapshot(new JSONObject().put("updated", System.currentTimeMillis()).put("records", CorosData.recordsJson(activities)).put("cockpit", deck));
        } catch (JSONException impossible) { throw new IllegalStateException(impossible); }
    }
    static JSONObject detail(CorosData.Activity item) {
        try {
            boolean onFoot = !item.type.equals("RIDE"); int which = item.id.equals("sample-1") ? 1 : item.id.equals("sample-2") ? 2 : 0;
            String[] routes = {"M48 148 L65 130 L72 109 L91 114 L119 74 L132 58 L157 86 L174 59 L194 38 L221 54 L225 83 L262 101 L270 126 L241 146 L215 135 L181 155 L151 169 L131 139 L110 150 L83 161 L61 155 L48 148", "M38 152 L69 135 L84 93 L122 101 L145 57 L193 42 L228 55 L276 33 L290 68 L252 92 L268 125 L230 143 L190 117 L144 149 L101 135 L65 155", "M65 146 L93 126 L80 105 L101 78 L141 91 L158 60 L185 86 L220 72 L242 99 L223 128 L182 114 L154 144 L115 135 L91 156"};
            JSONArray laps = new JSONArray(); int fastest = 1; double best = Double.POSITIVE_INFINITY, base = item.seconds / item.km;
            for (int k = 0; k < Math.ceil(item.km); k++) {
                double km = Math.min(1, item.km - k), pace = wave(k, base, base * .05, 1.7);
                if (km == 1 && pace < best) { best = pace; fastest = k + 1; }
                laps.put(new JSONObject().put("index", k + 1).put("km", km).put("seconds", pace * km).put("pace", pace).put("speed", 3600 / pace).put("hr", wave(k, item.hr, 6, .9)).put("cadence", onFoot ? wave(k, 164, 4, 1.1) : 82).put("climb", wave(k, 8, 6, 2)));
            }
            JSONObject series = new JSONObject().put("unit", "km"); String[] keys = {"x", "pace", "hr", "altitude", "cadence"};
            for (String key : keys) series.put(key, new JSONArray());
            for (int i = 0; i < 160; i++) {
                series.getJSONArray("x").put(Math.round(i / 159.0 * item.km * 100) / 100.0);
                series.getJSONArray("pace").put(wave(i, base, base * .06, .21)); series.getJSONArray("hr").put(Math.round(item.hr - 14 + 18 * (1 - Math.exp(-i / 18.0)) + 3 * Math.sin(i / 7.0)));
                series.getJSONArray("altitude").put(wave(i, 320, 14, .05) + 4 * Math.sin(i / 3.0)); series.getJSONArray("cadence").put(onFoot ? wave(i, 164, 3, .4) : wave(i, 82, 4, .3));
            }
            series.put("hrBands", new JSONArray("[{\"from\":110,\"share\":0.04},{\"from\":120,\"share\":0.1},{\"from\":130,\"share\":0.22},{\"from\":140,\"share\":0.38},{\"from\":150,\"share\":0.2},{\"from\":160,\"share\":0.06}]"));
            return new JSONObject().put("path", new JSONObject().put("d", routes[which]).put("start", new JSONArray(which == 1 ? "[38,152]" : which == 2 ? "[65,146]" : "[48,148]"))).put("climb", new int[]{73, 156, 24}[which])
                    .put("laps", new JSONObject().put("every", 1).put("fastest", new JSONArray().put(fastest)).put("laps", laps)).put("series", series)
                    .put("detail", new JSONArray().put(new JSONArray().put("Workout Time").put(MovementActivity.moving(item.seconds))).put(new JSONArray().put("Distance").put(String.format(Locale.getDefault(), "%.1f km", item.km))).put(new JSONArray().put("Average Heart Rate").put(item.hr + " bpm")).put(new JSONArray().put("Calories").put(item.kcal + " kcal")).put(new JSONArray().put("Training Load").put("86")).put(new JSONArray().put("Aerobic TE").put("3.1")));
        } catch (JSONException impossible) { throw new IllegalStateException(impossible); }
    }
    private static long stamp(LocalDate day) { return day.atTime(12, 0).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli(); }
    private static int wave(int i, double base, double size, double speed) { return (int) Math.round(base + size * Math.sin(i * speed)); }
    private MovementSample() { }
}
