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

/**
 * Reads the plain-text answers of COROS's MCP tools into the few values the scores need. Same rules as
 * docs/js/coros-data.js; change both together.
 */
final class CorosData {
    static final class Activity {
        final String id; final int sport; final String name; final long start; final double km; final int seconds; final int hr;
        Activity(String id, int sport, String name, long start, double km, int seconds, int hr) {
            this.id = id; this.sport = sport; this.name = name; this.start = start; this.km = km; this.seconds = seconds; this.hr = hr;
        }
        LocalDate day(ZoneId zone) { return Instant.ofEpochMilli(start).atZone(zone).toLocalDate(); }
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
            list.add(new Activity(id.group(1), sport, location == null ? head.group(1) : location.trim(), start, km,
                    seconds(find(block, "Duration:\\s*([\\d:]+)")), (int) number(find(block, "Avg HR:\\s*(\\d+)"), 0)));
        }
        return list;
    }

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
        return out;
    }
    private static String find(String text, String pattern) { Matcher m = Pattern.compile(pattern).matcher(text); return m.find() ? m.group(1) : null; }
    private static double number(String text, double fallback) {
        if (text == null) return fallback;
        try { return Double.parseDouble(text.replace(",", "")); } catch (NumberFormatException e) { return fallback; }
    }
    private CorosData() { }
}
