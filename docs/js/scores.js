// Recovery, Strain and Conditioning in the spirit of Bevel (and Whoop), computed here from COROS data.
// Bevel publishes what goes into its scores but not the formulas; these are open approximations,
// written so every number can be traced back to a reading. Pure functions: node tests them.

const DAY = 864e5;
export const key = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const noon = text => new Date(text + "T12:00:00");
const shift = (text, days) => key(new Date(noon(text).getTime() + days * DAY));
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const deviation = values => { const m = mean(values); return values.length > 1 ? Math.sqrt(mean(values.map(v => (v - m) ** 2))) : null; };
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/**
 * Tanaka's age estimate, raised when a recorded lap shows a higher maximum, but by at most 10 bpm:
 * wrist sensors spike, and one bad lap should not rescale every workout.
 */
export function maxHeartRate(age, observed = 0) {
  const estimate = age ? 208 - 0.7 * age : 185;
  return Math.round(Math.max(estimate, Math.min(observed || 0, estimate + 10)));
}

/**
 * Banister TRIMP from an activity's average heart rate: minutes × reserve fraction × 0.64·e^(k·fraction).
 * Without heart rate (some swims, gym sessions) a steady moderate effort is assumed.
 */
export function trimp(activity, { rest, max, female = false }) {
  const mins = activity.seconds / 60;
  if (!activity.hr || !rest || !max || max <= rest) return mins * 1.2;
  const reserve = clamp((activity.hr - rest) / (max - rest), 0, 1);
  return mins * reserve * 0.64 * Math.exp((female ? 1.67 : 1.92) * reserve);
}

// Strain: 100% is about one hour hard (TRIMP 150). Logarithmic, so each extra percent costs more, and not capped.
const FULL = 150, SOFT = 40;
export const strainOf = load => Math.round(100 * Math.log1p(load / SOFT) / Math.log1p(FULL / SOFT));
const STEPS_PER_KM = 1300, ON_FOOT = sport => (sport >= 100 && sport < 200) || (sport >= 900 && sport < 1000);

/** Daily load: workouts (active) plus everyday steps not already inside a workout (passive). */
export function dailyLoads(dates, activities, daily, heart) {
  const steps = new Map((daily?.days || []).map(d => [d.date, d.steps || 0]));
  return dates.map(date => {
    const today = activities.filter(a => key(new Date(a.start)) === date);
    const active = today.reduce((sum, a) => sum + trimp(a, heart), 0);
    const walked = today.filter(a => ON_FOOT(a.sport)).reduce((sum, a) => sum + a.km * STEPS_PER_KM, 0);
    const passive = Math.max(0, (steps.get(date) || 0) - walked) / 1000 * 1.5;
    return { date, active, passive, load: active + passive, strain: strainOf(active + passive), workouts: today.length };
  });
}

const RECOVERY_ZONES = [[67, "primed"], [34, "steady"], [0, "run down"]];
/**
 * Recovery for one morning: how last night's HRV, resting heart rate and sleep compare with your own normal.
 * Each becomes a z-score; the weighted mix (HRV 50%, resting HR 30%, sleep 20%, re-weighted when one is
 * missing) maps onto 1–100% with an ordinary day near 60%.
 */
export function recoveryOn(date, deck, strainYesterday = 0) {
  const parts = [];
  const hrv = (deck.hrv || []).find(h => h.date === date);
  if (hrv?.avg != null && hrv.baseline != null) {
    const spread = hrv.low != null ? Math.max(3, (hrv.high - hrv.low) / 2) : Math.max(3, hrv.baseline * .15);
    parts.push({ name: "hrv", weight: .5, z: (hrv.avg - hrv.baseline) / spread, text: `HRV ${hrv.avg} ms vs baseline ${hrv.baseline}` });
  }
  const resting = deck.resting || [], today = resting.find(r => r.date === date);
  const before = resting.filter(r => r.date < date && r.date >= shift(date, -28)).map(r => r.bpm);
  if (today && before.length >= 3) {
    const base = mean(before), spread = Math.max(2, deviation(before) || 0);
    parts.push({ name: "rest", weight: .3, z: (base - today.bpm) / spread, text: `resting HR ${today.bpm} vs ${Math.round(base)} normal` });
  }
  const night = (deck.daily?.days || []).find(d => d.date === date)?.sleep;
  const need = 480 + Math.max(0, strainYesterday - 60) * .5;
  if (night?.total) {
    const asleep = night.total - (night.awake || 0), share = Math.min(1, asleep / need);
    parts.push({ name: "sleep", weight: .2, z: (share - .85) / .1, text: `slept ${Math.round(share * 100)}% of the ${Math.round(need / 60 * 10) / 10} h needed` });
  }
  if (!parts.length || !parts.some(p => p.name !== "sleep")) return null; // sleep alone is not a recovery reading
  const weight = parts.reduce((sum, p) => sum + p.weight, 0);
  const z = parts.reduce((sum, p) => sum + p.weight * clamp(p.z, -2.5, 2.5), 0) / weight;
  const score = clamp(Math.round(100 / (1 + Math.exp(-1.4 * (z + .3)))), 1, 100);
  return { date, score, zone: RECOVERY_ZONES.find(([low]) => score >= low)[1], parts, need };
}

// Cardio status from the balance of the last week (acute) against the last six weeks (chronic), like Bevel's labels.
export function cardioStatus(acute, chronic, chronicPeak, days) {
  if (days < 28 || chronic < 3) return "calibrating";
  const ratio = acute / chronic;
  if (ratio > 1.5) return "overtraining";
  if (ratio > 1.3) return "fatigued";
  if (ratio >= 1.05) return "productive";
  if (ratio >= .8) return chronic >= chronicPeak * .95 && ratio < .95 ? "peaking" : "maintaining";
  return "detraining";
}

/**
 * Conditioning: the fitness your training has built. Chronic load is a 42-day weighted average of daily
 * workout TRIMP; the score is 100·(1 − e^(−chronic/45)), so 45 TRIMP a day (about 5–6 hours of steady
 * training a week) reads 63 and further gains come slower.
 */
export function conditioning(loads, historyDays) {
  let acute = 0, chronic = 0, peak = 0;
  const trail = loads.map(day => {
    acute += (day.active - acute) / 7; chronic += (day.active - chronic) / 42; peak = Math.max(peak, chronic);
    return { date: day.date, acute, chronic, score: Math.round(100 * (1 - Math.exp(-chronic / 45))) };
  });
  const last = trail.at(-1) || { acute: 0, chronic: 0, score: 0 };
  return { score: last.score, acute: last.acute, chronic: last.chronic, ratio: last.chronic ? last.acute / last.chronic : null,
    status: cardioStatus(last.acute, last.chronic, peak, historyDays), trail };
}

/** All three scores for `today`, with daily histories for the last `span` days. */
export function scores({ activities, deck, profile, today = key(new Date()), history = 90, span = 28 }) {
  const restingNow = (deck.resting || []).at(-1)?.bpm ?? deck.daily?.restingHr ?? null;
  const heart = { rest: restingNow, max: maxHeartRate(profile?.age, profile?.observedMax), female: profile?.gender === "Female" };
  const dates = Array.from({ length: history }, (_, i) => shift(today, i - history + 1));
  const loads = dailyLoads(dates, activities, deck.daily, heart);
  const strainByDate = new Map(loads.map(l => [l.date, l.strain]));
  const recent = dates.slice(-span);
  const recoveries = recent.map(date => recoveryOn(date, deck, strainByDate.get(shift(date, -1)) || 0));
  const recovery = recoveries.at(-1) ?? null;
  // Target strain: your usual day over two weeks, stretched or shrunk by this morning's recovery.
  const usual = Math.max(30, mean(loads.slice(-15, -1).map(l => l.strain)) || 0), factor = recovery ? .6 + .8 * recovery.score / 100 : 1;
  const oldest = activities.length ? Math.min(...activities.map(a => a.start)) : Date.now();
  const historyDays = Math.round((noon(today).getTime() - oldest) / DAY);
  return {
    heart, recovery, recoveries,
    strain: { ...loads.at(-1), target: [Math.round(usual * factor * .85), Math.round(usual * factor * 1.15)] },
    strains: loads.slice(-span),
    conditioning: conditioning(loads, historyDays),
  };
}
