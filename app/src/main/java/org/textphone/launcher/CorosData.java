package org.textphone.launcher;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONException;
import org.json.JSONTokener;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * COROS text and the shared browser cache, in the units used by src/client/coros-data.js.
 */
final class CorosData {
    static final class Activity {
        final String id, type, name, pace, paceLabel; final int sport, seconds, hr, kcal; final long start; final double km;
        Activity(String id, int sport, String name, long start, double km, int seconds, int hr) {
            this(id, sport, name, start, km, seconds, hr, 0, null, "pace");
        }
        Activity(String id, int sport, String name, long start, double km, int seconds, int hr, int kcal, String pace, String paceLabel) {
            this.id = id; this.sport = sport; this.type = sportLabel(sport, name); this.name = name; this.start = start; this.km = km;
            this.seconds = seconds; this.hr = hr; this.kcal = kcal; this.pace = pace; this.paceLabel = paceLabel;
        }
        LocalDate day(ZoneId zone) { return Instant.ofEpochMilli(start).atZone(zone).toLocalDate(); }
        JSONObject json() throws JSONException { return new JSONObject().put("id", id).put("sport", sport).put("type", type).put("name", name)
                .put("start", start).put("km", km).put("seconds", seconds).put("hr", hr > 0 ? hr : JSONObject.NULL).put("kcal", kcal)
                .put("pace", pace == null ? JSONObject.NULL : pace).put("paceLabel", paceLabel); }
    }
    static final class Hrv {
        final LocalDate date; final int avg, low, high, baseline;
        Hrv(LocalDate date, int avg, int low, int high, int baseline) { this.date = date; this.avg = avg; this.low = low; this.high = high; this.baseline = baseline; }
    }
    /** One day of the daily health summary; minutes are 0 when that night has no sleep record. */
    static final class Day {
        int steps, sleep, awake;
    }

    /** Tool text sometimes arrives as a JSON string literal; this returns the text inside. */
    static String unwrap(String text) {
        if (text == null) return "";
        if (!text.startsWith("\"")) return text;
        try { Object value = new JSONTokener(text).nextValue(); return value instanceof String ? (String) value : text; }
        catch (JSONException notJson) { return text; }
    }

    private static final Pattern BLOCK = Pattern.compile("\\n(?=\\d+\\.\\s)"), HEAD = Pattern.compile("^\\d+\\.\\s+(.+?)\\s+[—–-]\\s+(\\d{4}-\\d{2}-\\d{2})");
    /** querySportRecords: newest first, as COROS lists them. */
    static List<Activity> records(String text, ZoneId zone) {
        List<Activity> list = new ArrayList<>();
        for (String block : BLOCK.split(unwrap(text))) {
            Matcher head = HEAD.matcher(block), id = Pattern.compile("LabelId:\\s*(\\d+)").matcher(block);
            if (!head.find() || !id.find()) continue;
            int sport = (int) number(find(block, "SportType:\\s*(\\d+)"), 0);
            long stamp = (long) number(find(block, "startTimestamp=(\\d+)"), 0);
            long start = stamp > 0 ? stamp * 1000 : LocalDate.parse(head.group(2)).atTime(12, 0).atZone(zone).toInstant().toEpochMilli();
            Matcher distance = Pattern.compile("Distance:\\s*([\\d.]+)\\s*(km|m)\\b").matcher(block);
            double km = distance.find() ? Double.parseDouble(distance.group(1)) / ("m".equals(distance.group(2)) ? 1000 : 1) : 0;
            String location = find(block, "Location:\\s*([^\\n]+)");
            Matcher pace = Pattern.compile("Average (Pace|Speed):\\s*([^|\\n]+)").matcher(block);
            boolean paced = pace.find();
            list.add(new Activity(id.group(1), sport, location == null ? head.group(1) : location.trim(), start, km,
                    seconds(find(block, "Duration:\\s*([\\d:]+)")), (int) number(find(block, "Avg HR:\\s*(\\d+)"), 0),
                    (int) number(find(block, "Calories:\\s*([\\d,]+)"), 0), paced ? pace.group(2).trim() : null, paced && "Speed".equals(pace.group(1)) ? "average" : "pace"));
        }
        list.sort((a, b) -> Long.compare(b.start, a.start));
        return list;
    }

    static String sportLabel(int sport, String name) {
        if (sport >= 100 && sport <= 103) return "RUN";
        if (sport == 104 || sport == 105) return "HIKE";
        if (sport == 900) return "WALK";
        if (sport >= 200 && sport < 300) return "RIDE";
        if (sport >= 300 && sport < 400) return "SWIM";
        if (sport == 402) return "STRENGTH";
        String[] words = name.trim().split("\\s+"); return words.length == 0 || name.isEmpty() ? "ACTIVITY" : words[words.length - 1].toUpperCase(java.util.Locale.ROOT);
    }
    static List<Activity> records(JSONArray array) {
        List<Activity> list = new ArrayList<>();
        if (array != null) for (int i = 0; i < array.length(); i++) {
            JSONObject a = array.optJSONObject(i); if (a == null || !a.optString("id").matches("[A-Za-z0-9_-]{1,160}")) continue;
            double km = a.optDouble("km", 0); long start = a.optLong("start");
            if (!Double.isFinite(km) || km < 0 || start <= 0 || a.optInt("seconds") < 0) continue;
            list.add(new Activity(a.optString("id"), a.optInt("sport"), a.optString("name", "Activity"), start, km, a.optInt("seconds"),
                    a.optInt("hr"), a.optInt("kcal"), string(a, "pace"), a.optString("paceLabel", "pace")));
        }
        list.sort((a, b) -> Long.compare(b.start, a.start)); return list;
    }
    static JSONArray recordsJson(List<Activity> activities) throws JSONException { JSONArray out = new JSONArray(); for (Activity activity : activities) out.put(activity.json()); return out; }

    /** queryRestingHeartRate: bpm by date; days without a reading are left out. */
    static Map<LocalDate, Integer> resting(String text) {
        Map<LocalDate, Integer> map = new HashMap<>();
        Matcher m = Pattern.compile("(?m)^(\\d{4}-\\d{2}-\\d{2}):\\s*(\\d+)\\s*bpm").matcher(unwrap(text));
        while (m.find()) map.put(LocalDate.parse(m.group(1)), Integer.parseInt(m.group(2)));
        return map;
    }

    /** querySleepHrv: the official nightly assessments only, not the raw time series below them. */
    static List<Hrv> hrv(String text) {
        List<Hrv> list = new ArrayList<>();
        String assessment = unwrap(text).split("Sleep HRV Time Series")[0];
        for (String[] day : byDay(assessment)) {
            Matcher avg = Pattern.compile("HRV Avg:\\s*(\\d+)\\s*ms").matcher(day[1]);
            if (!avg.find()) continue;
            Matcher range = Pattern.compile("Normal Range:\\s*(\\d+)\\s*-\\s*(\\d+)").matcher(day[1]);
            boolean known = range.find();
            list.add(new Hrv(LocalDate.parse(day[0]), Integer.parseInt(avg.group(1)), known ? Integer.parseInt(range.group(1)) : -1,
                    known ? Integer.parseInt(range.group(2)) : -1, (int) number(find(day[1], "Baseline:\\s*(\\d+)"), -1)));
        }
        return list;
    }

    /** queryDailyHealthData: steps and the night's sleep and awake minutes, by date. */
    static Map<LocalDate, Day> daily(String text) {
        Map<LocalDate, Day> map = new HashMap<>();
        for (String[] block : byDay(unwrap(text))) {
            Day day = new Day();
            day.steps = (int) number(find(block[1], "Steps:\\s*([\\d,]+)"), 0);
            Matcher sleep = Pattern.compile("Total:\\s*([^|\\n]+)\\|.*?Awake:\\s*([^|\\n]+)").matcher(block[1]);
            if (sleep.find()) { day.sleep = minutes(sleep.group(1)); day.awake = minutes(sleep.group(2)); }
            map.put(LocalDate.parse(block[0]), day);
        }
        return map;
    }

    /** queryUserInfo: only the age, for maximum heart rate, and the gender, for the TRIMP curve. Nothing else is kept. */
    static int age(String text) { return (int) number(find(unwrap(text), "Age:\\s*(\\d+)"), 0); }
    static boolean female(String text) { return "Female".equalsIgnoreCase(find(unwrap(text), "Gender:\\s*(\\w+)")); }

    /** "1h 35min", "54 min", "0h" → minutes. */
    static int minutes(String text) {
        if (text == null) return 0;
        String hours = find(text, "(\\d+)\\s*h"), mins = find(text, "(\\d+)\\s*min");
        return (hours == null ? 0 : Integer.parseInt(hours)) * 60 + (mins == null ? 0 : Integer.parseInt(mins));
    }
    static int seconds(String clock) {
        if (clock == null) return 0;
        int total = 0; for (String part : clock.split(":")) total = total * 60 + Integer.parseInt(part); return total;
    }

    static String string(JSONObject object, String name) { return object == null || object.isNull(name) ? null : object.optString(name, null); }
    static Double metric(JSONObject object, String name) { double n = object == null ? Double.NaN : object.optDouble(name, Double.NaN); return Double.isFinite(n) ? n : null; }
    private static Object numeric(String text) { double n = number(find(text == null ? "" : text.replace(",", ""), "(-?[\\d.]+)"), Double.NaN); return Double.isFinite(n) ? n : JSONObject.NULL; }
    static JSONArray pairs(String text) { JSONArray out = new JSONArray(); Matcher m = Pattern.compile("(?m)^\\s*([^:=\\n][^:\\n]*?):\\s+(.+?)\\s*$").matcher(unwrap(text));
        while (m.find()) out.put(new JSONArray().put(m.group(1).trim()).put(m.group(2).trim())); return out; }
    private static String field(JSONArray pairs, String key) { for (int i = 0; i < pairs.length(); i++) { JSONArray row = pairs.optJSONArray(i); if (row != null && key.equalsIgnoreCase(row.optString(0))) return row.optString(1); } return null; }
    private static Object duration(String text) { return text != null && Pattern.compile("\\d+\\s*(h|min)").matcher(text).find() ? minutes(text) : JSONObject.NULL; }

    /** Rich cloud data is authoritative; old compact snapshots can still draw their known readings. */
    static JSONObject cockpit(JSONObject raw) throws JSONException {
        JSONObject deck = new JSONObject();
        JSONArray hrv = new JSONArray(), rest = new JSONArray(), days = new JSONArray();
        Map<String, String> statuses = new HashMap<>();
        for (String[] block : byDay(unwrap(raw.optString("hrv")).split("Sleep HRV Time Series")[0])) statuses.put(block[0], find(block[1], "HRV Avg:\\s*\\d+\\s*ms\\s*[—–-]\\s*([^\\n]+)"));
        for (Hrv night : hrv(raw.optString("hrv"))) hrv.put(new JSONObject().put("date", night.date.toString()).put("avg", night.avg)
                .put("low", night.low < 0 ? JSONObject.NULL : night.low).put("high", night.high < 0 ? JSONObject.NULL : night.high)
                .put("baseline", night.baseline < 0 ? JSONObject.NULL : night.baseline).put("status", statuses.get(night.date.toString())));
        for (Map.Entry<LocalDate, Integer> entry : new java.util.TreeMap<>(resting(raw.optString("resting"))).entrySet()) rest.put(new JSONObject().put("date", entry.getKey().toString()).put("bpm", entry.getValue()));
        for (String[] block : byDay(unwrap(raw.optString("daily")))) {
            String text = block[1]; JSONObject d = new JSONObject().put("date", block[0]).put("steps", numeric(find(text, "Steps:\\s*([\\d,]+)")))
                    .put("stress", numeric(find(text, "Stress:\\s*Avg\\s*(\\d+)"))).put("kcal", numeric(find(text, "Calories:\\s*([\\d,]+)"))).put("exercise", duration(find(text, "Exercise:\\s*([^|\\n]+)")));
            String total = find(text, "Total:\\s*([^|\\n]+)");
            if (total != null) {
                JSONObject sleep = new JSONObject().put("total", duration(total));
                for (String stage : new String[]{"deep", "light", "rem", "awake"}) sleep.put(stage, duration(find(text, "(?i)\\b" + stage + ":\\s*([^|\\n]+)")));
                Matcher hr = Pattern.compile("Sleep HR:\\s*Avg\\s*(\\d+)\\s*bpm\\s*\\|\\s*Min\\s*(\\d+)\\s*bpm\\s*\\|\\s*Max\\s*(\\d+)").matcher(text);
                if (hr.find()) sleep.put("hr", new JSONObject().put("avg", Integer.parseInt(hr.group(1))).put("min", Integer.parseInt(hr.group(2))).put("max", Integer.parseInt(hr.group(3))));
                d.put("sleep", sleep);
            }
            days.put(d);
        }
        deck.put("hrv", hrv).put("resting", rest).put("daily", new JSONObject().put("days", days)
                .put("restingHr", numeric(find(raw.optString("daily"), "Resting HR:\\s*(\\d+)"))).put("hrvBaseline", numeric(find(raw.optString("daily"), "HRV Baseline:\\s*(\\d+)"))))
                .put("profile", new JSONObject().put("age", age(raw.optString("profile"))).put("gender", female(raw.optString("profile")) ? "Female" : "Male"));
        JSONArray recovery = pairs(raw.optString("recovery")), fitness = pairs(raw.optString("fitness")), predictions = new JSONArray();
        for (int i = 0; i < fitness.length(); i++) { JSONArray pair = fitness.getJSONArray(i); if (pair.getString(0).endsWith("Prediction")) predictions.put(new JSONArray().put(pair.getString(0).replaceAll("\\s*Prediction$", "")).put(pair.getString(1))); }
        deck.put("recovery", new JSONObject().put("percent", numeric(field(recovery, "Recovery"))).put("level", field(recovery, "Level")).put("full", field(recovery, "Estimated Full Recovery")))
                .put("fitness", new JSONObject().put("vo2max", numeric(field(fitness, "VO2max"))).put("level", numeric(field(fitness, "Running Level"))).put("threshold", field(fitness, "Threshold Pace")).put("predictions", predictions))
                .put("device", find(raw.optString("device"), "Model Name:\\s*([^\\n]+)"));
        for (String kind : new String[]{"load", "sleep"}) {
            JSONArray rows = new JSONArray();
            for (String[] block : byDay(raw.optString(kind))) {
                JSONArray p = pairs(block[1]); JSONObject row = new JSONObject().put("date", block[0]);
                if ("load".equals(kind)) row.put("comment", field(p, "Comment")).put("short", numeric(field(p, "Short-Term Load"))).put("long", numeric(field(p, "Long-Term Load"))).put("ratio", numeric(field(p, "Load Ratio")));
                else { row.put("score", numeric(field(p, "Sleep Score"))).put("window", field(p, "Main Sleep Window")).put("asleep", duration(field(p, "Main Sleep (asleep)"))).put("deep", numeric(field(p, "Deep Sleep Ratio"))); if (metric(row, "score") == null || row.optDouble("score") <= 0) continue; }
                rows.put(row);
            }
            deck.put(kind, rows);
        }
        JSONObject cloud = raw.optJSONObject("cockpit");
        if (cloud != null) for (java.util.Iterator<String> keys = cloud.keys(); keys.hasNext();) { String name = keys.next(); deck.put(name, cloud.get(name)); }
        return deck;
    }

    static List<Hrv> hrv(JSONArray values) {
        List<Hrv> out = new ArrayList<>(); if (values != null) for (int i = 0; i < values.length(); i++) {
            JSONObject h = values.optJSONObject(i); if (h == null || metric(h, "avg") == null) continue;
            try { out.add(new Hrv(LocalDate.parse(h.getString("date")), h.optInt("avg"), h.optInt("low", -1), h.optInt("high", -1), h.optInt("baseline", -1))); } catch (JSONException | RuntimeException ignored) { }
        } return out;
    }
    static Map<LocalDate, Integer> resting(JSONArray values) {
        Map<LocalDate, Integer> out = new java.util.TreeMap<>(); if (values != null) for (int i = 0; i < values.length(); i++) {
            JSONObject r = values.optJSONObject(i); if (r == null || metric(r, "bpm") == null) continue;
            try { out.put(LocalDate.parse(r.getString("date")), r.optInt("bpm")); } catch (JSONException | RuntimeException ignored) { }
        } return out;
    }
    static Map<LocalDate, Day> daily(JSONObject daily) {
        Map<LocalDate, Day> out = new java.util.TreeMap<>(); JSONArray values = daily == null ? null : daily.optJSONArray("days");
        if (values != null) for (int i = 0; i < values.length(); i++) { JSONObject d = values.optJSONObject(i); if (d == null) continue;
            try { Day day = new Day(); day.steps = d.optInt("steps"); JSONObject sleep = d.optJSONObject("sleep"); if (sleep != null) { day.sleep = sleep.optInt("total"); day.awake = sleep.optInt("awake"); } out.put(LocalDate.parse(d.getString("date")), day); } catch (JSONException | RuntimeException ignored) { }
        } return out;
    }
    static JSONObject laps(String text) throws JSONException {
        JSONObject data; try { data = new JSONObject(unwrap(text)); } catch (JSONException invalid) { return null; }
        JSONArray groups = data.optJSONArray("lapGroups"); if (groups == null || groups.length() == 0) return null;
        JSONObject group = null;
        for (int i = 0; i < groups.length(); i++) { JSONObject g = groups.optJSONObject(i); if (g != null && g.optInt("type") == 2) { group = g; break; } }
        if (group == null) for (int i = 0; i < groups.length(); i++) { JSONObject g = groups.optJSONObject(i); if (g != null && g.optInt("type") != -1) { group = g; break; } }
        if (group == null) group = groups.optJSONObject(0); if (group == null) return null;
        JSONArray input = group.optJSONArray("laps"), out = new JSONArray(); if (input == null || input.length() == 0) return null;
        String[][] fields = {{"pace","avgPace"},{"speed","avgSpeedV2"},{"adjusted","adjustedPace"},{"hr","avgHr"},{"maxHr","maxHr"},{"cadence","avgCadence"},{"power","avgPower"},{"stride","avgStrideLength"},{"contact","groundTime"},{"oscillation","strideHeight"},{"ratio","strideRatio"}};
        for (int i = 0; i < input.length(); i++) { JSONObject lap = input.optJSONObject(i); if (lap == null) continue;
            JSONObject row = new JSONObject().put("index", lap.optInt("lapIndex", i + 1)).put("km", lap.optDouble("distance", 0) / 1e5).put("seconds", lap.optDouble("time", 0));
            for (String[] field : fields) { double n = lap.optDouble(field[1], 0); double divisor = "speed".equals(field[0]) ? 100 : "oscillation".equals(field[0]) || "ratio".equals(field[0]) ? 10 : 1; row.put(field[0], n > 0 && Double.isFinite(n) ? n / divisor : JSONObject.NULL); }
            row.put("climb", metric(lap, "elevGain") == null ? JSONObject.NULL : metric(lap, "elevGain")).put("descent", metric(lap, "totalDescent") == null ? JSONObject.NULL : metric(lap, "totalDescent")); out.put(row);
        }
        return new JSONObject().put("every", group.optDouble("lapDistance", 0) / 1e5).put("fastest", group.optJSONArray("fastLapIndexList") == null ? new JSONArray() : group.optJSONArray("fastLapIndexList")).put("laps", out);
    }

    /** Splits text at date headings ("2026-10-05", "2026-10-05:", "--- 20261005 ---") into {date, block}. */
    private static List<String[]> byDay(String text) {
        List<String[]> out = new ArrayList<>();
        Pattern heading = Pattern.compile("^\\s*(?:---\\s*)?(\\d{4})-?(\\d{2})-?(\\d{2})(?:\\s*---|:)?\\s*$");
        StringBuilder current = null; String date = null;
        for (String line : text.split("\\r?\\n")) {
            Matcher m = heading.matcher(line);
            if (m.matches()) {
                if (date != null) out.add(new String[]{date, current.toString()});
                date = m.group(1) + "-" + m.group(2) + "-" + m.group(3); current = new StringBuilder();
            } else if (current != null) current.append(line).append('\n');
        }
        if (date != null) out.add(new String[]{date, current.toString()});
        out.sort((a, b) -> a[0].compareTo(b[0])); return out;
    }
    private static String find(String text, String pattern) { Matcher m = Pattern.compile(pattern).matcher(text); return m.find() ? m.group(1) : null; }
    private static double number(String text, double fallback) {
        if (text == null) return fallback;
        try { return Double.parseDouble(text.replace(",", "")); } catch (NumberFormatException e) { return fallback; }
    }
    private CorosData() { }
}
