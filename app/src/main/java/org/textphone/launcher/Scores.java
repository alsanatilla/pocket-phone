package org.textphone.launcher;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Recovery, Strain and Conditioning in the spirit of Bevel, from COROS data. The same formulas and constants as
 * docs/js/scores.js (Bevel publishes the inputs, not its formulas, so these are open approximations). Change both together.
 */
final class Scores {
    static final class Part { final String name, text; final double z; Part(String name, double z, String text) { this.name = name; this.z = z; this.text = text; } }
    static final class Recovery { final int score; final String zone; final List<Part> parts; Recovery(int score, String zone, List<Part> parts) { this.score = score; this.zone = zone; this.parts = parts; } }
    static final class Strain { int strain, workouts, low, high; double active, passive; }
    static final class Conditioning { int score; String status; double acute, chronic; final List<Integer> trail = new ArrayList<>(); }
    static final class Result { Recovery recovery; Strain strain; Conditioning conditioning; int maxHr, restHr;
        final List<Recovery> recoveries = new ArrayList<>(); final List<Integer> strains = new ArrayList<>(); }

    /** Tanaka's age estimate, raised by a recorded maximum but by at most 10 bpm, since wrist sensors spike. */
    static int maxHeartRate(int age, int observed) {
        double estimate = age > 0 ? 208 - 0.7 * age : 185;
        return (int) Math.round(Math.max(estimate, Math.min(observed, estimate + 10)));
    }
    /** Banister TRIMP from average heart rate; without heart rate a steady moderate effort is assumed. */
    static double trimp(int seconds, int hr, int rest, int max, boolean female) {
        double mins = seconds / 60.0;
        if (hr <= 0 || rest <= 0 || max <= rest) return mins * 1.2;
        double reserve = Math.max(0, Math.min(1, (hr - rest) / (double) (max - rest)));
        return mins * reserve * 0.64 * Math.exp((female ? 1.67 : 1.92) * reserve);
    }
    private static final double FULL = 150, SOFT = 40;
    /** 100% is about one hour hard (TRIMP 150); logarithmic and open-ended. */
    static int strainOf(double load) { return (int) Math.round(100 * Math.log1p(load / SOFT) / Math.log1p(FULL / SOFT)); }
    private static boolean onFoot(int sport) { return (sport >= 100 && sport < 200) || (sport >= 900 && sport < 1000); }

    static String recoveryZone(int score) { return score >= 67 ? "primed" : score >= 34 ? "steady" : "run down"; }

    static Recovery recovery(LocalDate date, List<CorosData.Hrv> hrv, Map<LocalDate, Integer> resting, Map<LocalDate, CorosData.Day> daily, int strainYesterday) {
        List<Part> parts = new ArrayList<>(); List<Double> weights = new ArrayList<>();
        for (CorosData.Hrv night : hrv) {
            if (!night.date.equals(date) || night.baseline <= 0) continue;
            double spread = night.low > 0 ? Math.max(3, (night.high - night.low) / 2.0) : Math.max(3, night.baseline * .15);
            parts.add(new Part("hrv", (night.avg - night.baseline) / spread, "HRV " + night.avg + " ms vs baseline " + night.baseline)); weights.add(.5);
        }
        Integer today = resting.get(date);
        List<Integer> before = new ArrayList<>();
        for (Map.Entry<LocalDate, Integer> e : resting.entrySet()) if (e.getKey().isBefore(date) && !e.getKey().isBefore(date.minusDays(28))) before.add(e.getValue());
        if (today != null && before.size() >= 3) {
            double base = mean(before), spread = Math.max(2, deviation(before, base));
            parts.add(new Part("rest", (base - today) / spread, "resting HR " + today + " vs " + Math.round(base) + " normal")); weights.add(.3);
        }
        CorosData.Day night = daily.get(date);
        double need = 480 + Math.max(0, strainYesterday - 60) * .5;
        if (night != null && night.sleep > 0) {
            double share = Math.min(1, (night.sleep - night.awake) / need);
            parts.add(new Part("sleep", (share - .85) / .1, "slept " + Math.round(share * 100) + "% of the " + (Math.round(need / 6.0) / 10.0) + " h needed")); weights.add(.2);
        }
        boolean beyondSleep = false; for (Part p : parts) if (!"sleep".equals(p.name)) beyondSleep = true;
        if (!beyondSleep) return null; // sleep alone is not a recovery reading
        double total = 0, z = 0;
        for (int i = 0; i < parts.size(); i++) { total += weights.get(i); z += weights.get(i) * Math.max(-2.5, Math.min(2.5, parts.get(i).z)); }
        z /= total;
        int score = (int) Math.max(1, Math.min(100, Math.round(100 / (1 + Math.exp(-1.4 * (z + .3))))));
        return new Recovery(score, recoveryZone(score), parts);
    }

    static String cardioStatus(double acute, double chronic, double peak, long days) {
        if (days < 28 || chronic < 3) return "calibrating";
        double ratio = acute / chronic;
        if (ratio > 1.5) return "overtraining";
        if (ratio > 1.3) return "fatigued";
        if (ratio >= 1.05) return "productive";
        if (ratio >= .8) return chronic >= peak * .95 && ratio < .95 ? "peaking" : "maintaining";
        return "detraining";
    }

    /** All three for `today`, from 90 days of activities and the last few weeks of health data. */
    static Result compute(LocalDate today, ZoneId zone, List<CorosData.Activity> activities, List<CorosData.Hrv> hrv,
                          Map<LocalDate, Integer> resting, Map<LocalDate, CorosData.Day> daily, int age, boolean female) {
        return compute(today, zone, activities, hrv, resting, daily, age, female, 0, 0);
    }
    static Result compute(LocalDate today, ZoneId zone, List<CorosData.Activity> activities, List<CorosData.Hrv> hrv,
                          Map<LocalDate, Integer> resting, Map<LocalDate, CorosData.Day> daily, int age, boolean female, int observedMax, int restingFallback) {
        Result result = new Result();
        LocalDate latestRest = null; for (LocalDate d : resting.keySet()) if (latestRest == null || d.isAfter(latestRest)) latestRest = d;
        result.restHr = latestRest == null ? restingFallback : resting.get(latestRest);
        result.maxHr = maxHeartRate(age, observedMax);
        int history = 90; double[] active = new double[history], passive = new double[history]; int[] workouts = new int[history], strain = new int[history];
        for (int i = 0; i < history; i++) {
            LocalDate date = today.minusDays(history - 1 - i); double walked = 0;
            for (CorosData.Activity a : activities) {
                if (!a.day(zone).equals(date)) continue;
                active[i] += trimp(a.seconds, a.hr, result.restHr, result.maxHr, female); workouts[i]++;
                if (onFoot(a.sport)) walked += a.km * 1300;
            }
            CorosData.Day day = daily.get(date);
            passive[i] = Math.max(0, (day == null ? 0 : day.steps) - walked) / 1000.0 * 1.5;
            strain[i] = strainOf(active[i] + passive[i]);
        }
        for (int i = history - 28; i < history; i++) { result.recoveries.add(recovery(today.minusDays(history - 1 - i), hrv, resting, daily, strain[i - 1])); result.strains.add(strain[i]); }
        result.recovery = result.recoveries.get(result.recoveries.size() - 1);
        Strain s = new Strain(); s.strain = strain[history - 1]; s.active = active[history - 1]; s.passive = passive[history - 1]; s.workouts = workouts[history - 1];
        double usual = 0; for (int i = history - 15; i < history - 1; i++) usual += strain[i]; usual = Math.max(30, usual / 14);
        double factor = result.recovery == null ? 1 : .6 + .8 * result.recovery.score / 100.0;
        s.low = (int) Math.round(usual * factor * .85); s.high = (int) Math.round(usual * factor * 1.15);
        result.strain = s;
        Conditioning c = new Conditioning(); double peak = 0;
        for (double load : active) { c.acute += (load - c.acute) / 7; c.chronic += (load - c.chronic) / 42; peak = Math.max(peak, c.chronic); c.trail.add((int) Math.round(100 * (1 - Math.exp(-c.chronic / 45)))); }
        c.score = (int) Math.round(100 * (1 - Math.exp(-c.chronic / 45)));
        long oldest = Long.MAX_VALUE; for (CorosData.Activity a : activities) oldest = Math.min(oldest, a.start);
        long days = oldest == Long.MAX_VALUE ? 0 : ChronoUnit.DAYS.between(java.time.Instant.ofEpochMilli(oldest).atZone(zone).toLocalDate(), today);
        c.status = cardioStatus(c.acute, c.chronic, peak, days);
        result.conditioning = c;
        return result;
    }

    // One sentence per score, as on the web page.
    static String recoveryLine(Recovery r) {
        if (r == null) return "needs last night's HRV or resting heart rate";
        List<String> down = new ArrayList<>(), up = new ArrayList<>();
        for (Part p : r.parts) { String name = "hrv".equals(p.name) ? "HRV" : "rest".equals(p.name) ? "resting HR" : "sleep"; if (p.z < -.3) down.add(name); else if (p.z > .3) up.add(name); }
        if (down.isEmpty() && up.isEmpty()) return "everything close to your normal";
        if (down.isEmpty()) return join(up) + " better than usual";
        return "held back by " + join(down) + (up.isEmpty() ? "" : ", helped by " + join(up));
    }
    static String strainLine(Strain s) {
        String done = s.workouts == 0 ? "no workout yet today" : s.workouts + " workout" + (s.workouts == 1 ? "" : "s") + " today";
        return done + " · " + (s.strain < s.low ? "room for more" : s.strain > s.high ? "past today's target" : "on target");
    }
    static String conditionLine(String status) {
        switch (status) {
            case "calibrating": return "needs a few more weeks of workouts";
            case "detraining": return "training less than you used to";
            case "maintaining": return "holding your fitness steady";
            case "productive": return "building fitness";
            case "peaking": return "fit and fresh";
            case "fatigued": return "a big week on top of a quieter month";
            default: return "far above your usual load: ease off";
        }
    }
    private static String join(List<String> list) { return list.size() > 1 ? String.join(", ", list.subList(0, list.size() - 1)) + " and " + list.get(list.size() - 1) : list.get(0); }
    private static double mean(List<Integer> values) { double sum = 0; for (int v : values) sum += v; return sum / values.size(); }
    private static double deviation(List<Integer> values, double mean) { if (values.size() < 2) return 0; double sum = 0; for (int v : values) sum += (v - mean) * (v - mean); return Math.sqrt(sum / values.size()); }
    private Scores() { }
}
