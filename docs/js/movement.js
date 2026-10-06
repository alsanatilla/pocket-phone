// Movement: a cockpit of COROS readiness, trends, fitness and activities, or an invented sample until COROS is connected.
import * as coros from "./coros.js?v=20261006-080";
import { svg, ring, meter, stack, dayLine, dayBars, dayPair, trace } from "./movement-charts.js?v=20261006-080";
import { scores } from "./scores.js?v=20261006-080";
import { backdrop } from "./pixel-backdrop.js?v=20261006-080";

// A visual concept only. These activities and readings are invented and never read or saved.
const SAMPLE = [
  { type: "RUN", daysAgo: 1, name: "Run", km: 6.2, minutes: 38, climb: 73, kcal: 480, pace: "6:08 /km", start: [48, 148], route: "M48 148 C65 130 72 109 91 114 L119 74 C132 58 157 86 174 59 C194 38 221 54 225 83 L262 101 C270 126 241 146 215 135 L181 155 C151 169 131 139 110 150 C83 161 61 155 48 148" },
  { type: "RIDE", daysAgo: 3, name: "Ride", km: 24.8, minutes: 72, climb: 156, kcal: 690, pace: "20.7 km/h", start: [38, 152], route: "M38 152 L69 135 L84 93 L122 101 L145 57 L193 42 L228 55 L276 33 L290 68 L252 92 L268 125 L230 143 L190 117 L144 149 L101 135 L65 155" },
  { type: "WALK", daysAgo: 5, name: "Walk", km: 4.6, minutes: 58, climb: 24, kcal: 260, pace: "12:36 /km", start: [65, 146], route: "M65 146 L93 126 L80 105 L101 78 L141 91 L158 60 L185 86 L220 72 L242 99 L223 128 L182 114 L154 144 L115 135 L91 156" }
];
const DAYS = 28;
const el = (tag, className, ...children) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children.flat(Infinity).filter(child => child != null));
  return node;
};
const words = (tag, className, text) => el(tag, className, document.createTextNode(text));
const day = offset => {
  const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() - offset);
  return date;
};
const key = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dayKeys = count => Array.from({ length: count }, (_, i) => key(day(count - 1 - i)));
const sameDay = (a, b) => a.toDateString() === b.toDateString();
const dateLabel = date => new Intl.DateTimeFormat("en", { weekday: "short", day: "2-digit", month: "short" }).format(date).toUpperCase();
const shortDate = text => new Intl.DateTimeFormat("en", { day: "2-digit", month: "short" }).format(new Date(text + "T12:00:00")).toUpperCase();
const when = text => text === key(day(0)) ? "last night" : text === key(day(1)) ? "yesterday" : shortDate(text).toLowerCase();
const minutes = value => value >= 60 ? `${Math.floor(value / 60)}h ${String(value % 60).padStart(2, "0")}m` : `${value} min`;
const moving = seconds => minutes(Math.round(seconds / 60));
const two = n => String(n).padStart(2, "0");
const pace = seconds => seconds == null ? "—" : `${Math.floor(seconds / 60)}:${two(Math.round(seconds % 60))}`;
const average = values => { const known = values.filter(v => v != null); return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null; };
const latest = list => list?.length ? list[list.length - 1] : null;
const onDays = (keys, list, pick) => { const by = new Map((list || []).map(entry => [entry.date, entry])); return keys.map(k => by.has(k) ? pick(by.get(k)) ?? null : null); };

// ── Invented sample: the same shapes COROS data takes, so the cockpit can be seen before connecting. ──
const wave = (i, base, size, speed) => base + size * Math.sin(i * speed);
const sample = () => SAMPLE.map((item, index) => ({
  id: "sample-" + index, sport: item.type === "RIDE" ? 200 : item.type === "WALK" ? 900 : 100, type: item.type, name: item.name,
  start: day(item.daysAgo).getTime(), km: item.km, seconds: item.minutes * 60, pace: item.pace, paceLabel: item.type === "RIDE" ? "average" : "pace",
  hr: [148, 132, 104][index], kcal: item.kcal, sample: { path: { d: item.route, start: item.start }, climb: item.climb } }));
function sampleCockpit() {
  const keys = dayKeys(DAYS);
  return {
    recovery: { percent: 82, level: "Ready for training", full: "9h" },
    fitness: { vo2max: 48, level: 72, threshold: "5:05 /km", predictions: [["5 km", "23:40"], ["10 km", "49:30"], ["Half Marathon", "1:50:10"], ["Marathon", "3:52:00"]] },
    load: keys.map((date, i) => { const short = Math.round(wave(i, 52, 14, .35)), long = Math.round(44 + i * .4); return { date, comment: "Optimized", short, long, ratio: +(short / long).toFixed(2) }; }),
    daily: { restingHr: 52, hrvBaseline: 63, days: keys.map((date, i) => ({ date, steps: Math.round(wave(i, 8200, 3400, 1.3)), stress: Math.round(wave(i, 33, 11, .9)),
      sleep: { total: Math.round(wave(i, 445, 45, .7)), deep: 92, light: 236, rem: 104, awake: 13, hr: { avg: 54, min: 47, max: 71 } } })) },
    sleep: keys.map((date, i) => ({ date, score: Math.round(wave(i, 78, 9, .7)), window: "23:10 - 06:40" })),
    hrv: keys.map((date, i) => ({ date, avg: Math.round(wave(i, 63, 6, .8)), status: "Normal", low: 55, high: 72, baseline: 63 })),
    resting: keys.map((date, i) => ({ date, bpm: Math.round(wave(i, 52, 2, .6)) })),
    device: "SAMPLE WATCH", profile: { age: 34, gender: "Male" },
  };
}
/** Older invented workouts behind the sample, so its Strain and Conditioning have a history to read. */
const sampleHistory = () => Array.from({ length: 36 }, (_, i) => ({ id: "history-" + i, sport: i % 4 === 3 ? 200 : 100, km: i % 4 === 3 ? 30 : 8,
  seconds: (i % 4 === 3 ? 80 : 45) * 60, hr: 140 + (i % 5) * 4, start: day(7 + i * 2.3 | 0).getTime() }));
function sampleActivity(item) {
  const steps = 160, run = item.type !== "RIDE", x = Array.from({ length: steps }, (_, i) => +(i / (steps - 1) * item.km).toFixed(2));
  const base = item.seconds / item.km, laps = [];
  for (let k = 0; k < Math.ceil(item.km); k++) {
    const km = Math.min(1, item.km - k), lapPace = Math.round(wave(k, base, base * .05, 1.7));
    laps.push({ index: k + 1, km, seconds: lapPace * km, pace: lapPace, hr: Math.round(wave(k, item.hr, 6, .9)), cadence: run ? Math.round(wave(k, 164, 4, 1.1)) : 82, climb: Math.round(wave(k, 8, 6, 2)) });
  }
  return { ...item.sample, laps: { every: 1, fastest: [laps.reduce((best, lap, i) => lap.pace < laps[best].pace ? i : best, 0) + 1], laps },
    detail: [["Workout Time", moving(item.seconds)], ["Distance", `${item.km} km`], ["Average Heart Rate", `${item.hr} bpm`], ["Calories", `${item.kcal} kcal`], ["Training Load", "86"], ["Aerobic TE", "3.1"]],
    series: { x, unit: "km", pace: x.map((_, i) => Math.round(wave(i, base, base * .06, .21))), hr: x.map((_, i) => Math.round(item.hr - 14 + 18 * (1 - Math.exp(-i / 18)) + 3 * Math.sin(i / 7))),
      altitude: x.map((_, i) => +(wave(i, 320, 14, .05) + 4 * Math.sin(i / 3)).toFixed(1)), cadence: x.map((_, i) => run ? Math.round(wave(i, 164, 3, .4)) : Math.round(wave(i, 82, 4, .3))),
      hrBands: [[110, .04], [120, .1], [130, .22], [140, .38], [150, .2], [160, .06]].map(([from, share]) => ({ from, share })) } };
}

// ── Pieces ──
const kicker = (text, className = "") => words("span", "movement-kicker " + className, text);
function gauge(label, { value, unit, extra, graphic, notes = [] }) {
  return el("div", "cockpit-gauge",
    kicker(label),
    value != null ? el("div", "cockpit-value", words("strong", "", String(value)), unit ? words("span", "", unit) : null, extra ? words("em", "", extra) : null) : null,
    graphic,
    ...notes.filter(Boolean).map(note => words("span", "cockpit-note", note)));
}
const missing = label => el("div", "cockpit-gauge", kicker(label), words("span", "cockpit-note", "no reading yet"));

const lastNight = deck => [...(deck.daily?.days || [])].reverse().find(d => d.sleep);
function hrvGauge(deck) {
  const hrv = latest(deck.hrv);
  if (!hrv) return missing("HRV");
  return gauge("HRV", { value: hrv.avg, unit: "ms",
    graphic: meter({ min: Math.min(hrv.low ?? hrv.avg, hrv.avg) - 12, max: Math.max(hrv.high ?? hrv.avg, hrv.avg) + 12, value: hrv.avg, band: hrv.low != null ? [hrv.low, hrv.high] : null, baseline: hrv.baseline,
      label: `HRV ${hrv.avg} milliseconds, normal ${hrv.low} to ${hrv.high}, baseline ${hrv.baseline}` }),
    notes: [`${(hrv.status || "").toLowerCase()} · ${when(hrv.date)}`, hrv.low != null ? `normal ${hrv.low}–${hrv.high} · baseline ${hrv.baseline}` : null] });
}
function restGauge(deck) {
  const rest = latest(deck.resting), all = (deck.resting || []).map(r => r.bpm), avg = Math.round(average(all) ?? 0);
  if (!rest) return missing("RESTING HR");
  return gauge("RESTING HR", { value: rest.bpm, unit: "bpm",
    graphic: meter({ min: Math.min(...all) - 3, max: Math.max(...all) + 3, value: rest.bpm, baseline: avg, label: `Resting heart rate ${rest.bpm}, ${DAYS}-day average ${avg}` }),
    notes: [rest.date === key(day(0)) ? "today" : when(rest.date), `${DAYS}-day avg ${avg} · ${Math.min(...all)}–${Math.max(...all)}`] });
}
function sleepGauge(deck) {
  const night = lastNight(deck), score = night && deck.sleep?.find(s => s.date === night.date);
  if (!night) return missing("SLEEP");
  const s = night.sleep;
  return gauge("SLEEP", { value: minutes(s.total), extra: score ? `score ${score.score}` : null,
    graphic: stack([{ label: "deep", value: s.deep, text: minutes(s.deep), tone: "deep" }, { label: "light", value: s.light, text: minutes(s.light), tone: "light" },
      { label: "REM", value: s.rem, text: minutes(s.rem), tone: "rem" }, { label: "awake", value: s.awake, text: minutes(s.awake), tone: "awake" }]),
    notes: [`deep ${minutes(s.deep)} · light ${minutes(s.light)} · rem ${minutes(s.rem)} · awake ${minutes(s.awake)}`,
      [when(night.date), score?.window ? score.window.replace(/\d{4}-\d{2}-\d{2} /g, "").replace(" - ", "–") : null, s.hr ? `sleep hr ${s.hr.avg}` : null].filter(Boolean).join(" · ")] });
}

/** The 28-day tiles by name, so each score shows only its own. A tile without data is null. */
function trendTiles(deck) {
  const keys = dayKeys(DAYS), days = keys.map(shortDate);
  const sleep = onDays(keys, deck.daily?.days, d => d.sleep?.total), stress = onDays(keys, deck.daily?.days, d => d.stress), steps = onDays(keys, deck.daily?.days, d => d.steps);
  const hrv = onDays(keys, deck.hrv, d => d.avg), band = onDays(keys, deck.hrv, d => d.low != null ? [d.low, d.high] : null), rest = onDays(keys, deck.resting, d => d.bpm);
  const short = onDays(keys, deck.load, d => d.short), long = onDays(keys, deck.load, d => d.long);
  const last = values => values.findLast(v => v != null);
  const tile = (values, label, now, chart, note) => values.some(v => v) ? el("div", "cockpit-trend",
    el("div", "cockpit-trend-head", kicker(label), words("strong", "", now ?? "—")), chart,
    el("div", "cockpit-axis", words("span", "", days[0]), words("span", "", note || "today"))) : null;
  return {
    sleep: tile(sleep, "SLEEP", last(sleep) != null ? minutes(last(sleep)) : null, dayBars(days, sleep, { format: minutes, label: "Sleep per night" }), `avg ${minutes(Math.round(average(sleep) ?? 0))}`),
    hrv: tile(hrv, "HRV", last(hrv) != null ? `${last(hrv)} ms` : null, dayLine(days, hrv, { band, format: v => `${v} ms`, label: "Night HRV with normal range" }), "grey band = normal range"),
    rest: tile(rest, "RESTING HR", last(rest) != null ? `${last(rest)} bpm` : null, dayLine(days, rest, { format: v => `${v} bpm`, label: "Resting heart rate" })),
    stress: tile(stress, "STRESS", last(stress) != null ? String(last(stress)) : null, dayBars(days, stress, { max: 100, label: "Average daily stress, 0 to 100" }), "0–100"),
    steps: tile(steps, "STEPS", last(steps) != null ? last(steps).toLocaleString("en") : null, dayBars(days, steps, { format: v => v.toLocaleString("en"), label: "Steps per day" }), `avg ${Math.round(average(steps) ?? 0).toLocaleString("en")}`),
    load: tile(short, "COROS TRAINING LOAD", last(short) != null ? `${last(short)} / ${last(long)}` : null, dayPair(days, short, long, { names: ["short", "long"], label: "Short-term load against long-term load" }), "accent short · white long"),
  };
}
function fitnessStrip(deck) {
  const f = deck.fitness;
  if (!f) return null;
  const short = { "Half Marathon": "HALF", "Marathon": "MARATHON" };
  const cells = [["VO2MAX", f.vo2max], ["RUNNING LEVEL", f.level], ["THRESHOLD /KM", f.threshold?.replace(" /km", "")],
    ...f.predictions.map(([name, time]) => [short[name] || name.toUpperCase(), time])].filter(([, v]) => v != null);
  return el("div", "", el("div", "cockpit-block-head", kicker("FITNESS · FROM COROS")),
    el("div", "cockpit-fitness", cells.map(([label, v]) => el("div", "", words("strong", "", String(v)), words("span", "", label)))));
}

// ── Scores: three rings and one sentence each; a ring opens what is behind it. ──
const sign = z => z > .3 ? "▲ " : z < -.3 ? "▼ " : "· ";
const NAMES = { hrv: "HRV", rest: "resting HR", sleep: "sleep" };
const join = list => list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0];
function recoveryLine(r) {
  if (!r) return "needs last night's HRV or resting heart rate";
  const down = r.parts.filter(p => p.z < -.3).map(p => NAMES[p.name]), up = r.parts.filter(p => p.z > .3).map(p => NAMES[p.name]);
  if (!down.length && !up.length) return "everything close to your normal";
  if (!down.length) return `${join(up)} better than usual`;
  return `held back by ${join(down)}` + (up.length ? `, helped by ${join(up)}` : "");
}
function strainLine(s) {
  const done = s.workouts ? `${s.workouts} workout${s.workouts === 1 ? "" : "s"} today` : "no workout yet today";
  return `${done} · ${s.strain < s.target[0] ? "room for more" : s.strain > s.target[1] ? "past today's target" : "on target"}`;
}
const CONDITION = { calibrating: "needs a few more weeks of workouts", detraining: "training less than you used to", maintaining: "holding your fitness steady",
  productive: "building fitness", peaking: "fit and fresh", fatigued: "a big week on top of a quieter month", overtraining: "far above your usual load: ease off" };
const METHOD = {
  recovery: () => "Last night's HRV against your COROS baseline (half the weight), resting heart rate against your last 28 days (30%) and sleep against what you needed (20%; 8 h, plus more after a hard day). An ordinary morning lands near 60%; 67% and up is primed, below 34% is run down.",
  strain: heart => `Every workout's TRIMP (minutes, weighted by how close your average heart rate sat to your maximum of ${heart.max} bpm) plus everyday steps outside workouts. Logarithmic and open-ended: 100% is about an hour of hard effort. The target is your usual two weeks, scaled by today's Recovery.`,
  conditioning: () => "A 42-day weighted average of workout TRIMP, shown as 0–100 (45 TRIMP a day, about 5–6 hours of steady training a week, reads 63). The label compares the last 7 days with the last 42, like Bevel's cardio status.",
};
const BEVEL = "Bevel publishes what goes into its scores but not the formulas, so this is an open approximation from COROS data, not Bevel's number.";

function scorePanel(name, result, deck) {
  const labels = dayKeys(DAYS).map(shortDate), tiles = trendTiles(deck);
  const reasons = list => el("ul", "score-reasons", list.filter(Boolean).map(item => words("li", "", item)));
  const history = (title, chart) => el("div", "score-history", kicker(title), chart, el("div", "cockpit-axis", words("span", "", labels[0]), words("span", "", "today")));
  const method = text => el("details", "score-method", words("summary", "", "how this is worked out"), words("p", "", text), words("p", "", BEVEL));
  const grid = (...items) => { const kept = items.filter(Boolean); return kept.length ? el("div", "cockpit-trends", kept) : null; };
  if (name === "recovery") {
    const r = result.recovery, own = deck.recovery;
    return [
      r ? reasons(r.parts.map(part => sign(part.z) + part.text)) : null,
      history("RECOVERY · LAST 28 MORNINGS", dayLine(labels, result.recoveries.map(x => x?.score ?? null), { format: v => `${v}%`, label: "Recovery by morning" })),
      el("div", "cockpit-readiness three", hrvGauge(deck), restGauge(deck), sleepGauge(deck)),
      grid(tiles.sleep, tiles.hrv, tiles.rest, tiles.stress),
      own?.percent != null ? words("p", "score-aside", `COROS's own recovery, from training load alone: ${own.percent}% · ${(own.level || "").toLowerCase()}`) : null,
      method(METHOD.recovery()),
    ];
  }
  if (name === "strain") {
    const s = result.strain;
    return [
      reasons([`${s.workouts} workout${s.workouts === 1 ? "" : "s"} · TRIMP ${Math.round(s.active)}`, `everyday movement · TRIMP ${Math.round(s.passive)}`, `target ${s.target[0]}–${s.target[1]}% from your usual days and today's Recovery`]),
      history("STRAIN · LAST 28 DAYS", dayBars(labels, result.strains.map(d => d.strain || null), { format: v => `${v}%`, label: "Strain by day" })),
      grid(tiles.steps),
      method(METHOD.strain(result.heart)),
    ];
  }
  const c = result.conditioning;
  return [
    reasons([`last 7 days · ${Math.round(c.acute)} TRIMP a day`, `last 42 days · ${Math.round(c.chronic)} TRIMP a day`, c.ratio != null ? `balance ${c.ratio.toFixed(2)} (7-day ÷ 42-day; 0.8–1.3 is the usual range)` : null]),
    history("CONDITIONING · LAST 28 DAYS", dayLine(labels, c.trail.slice(-DAYS).map(t => t.score), { label: "Conditioning by day" })),
    fitnessStrip(deck),
    grid(tiles.load),
    method(METHOD.conditioning()),
  ];
}

/** The score row, with the opened score's panel placed right after its ring on narrow screens. */
function scoreRow(result, deck, open, toggle) {
  const { recovery, strain, conditioning: c } = result;
  const picks = [
    ["recovery", "RECOVERY", recovery?.score ?? null, recovery ? `${recovery.score}%` : "—", recovery ? recovery.zone : "no reading", recoveryLine(recovery), false],
    ["strain", "STRAIN", strain.strain, `${strain.strain}%`, `target ${strain.target[0]}–${strain.target[1]}%`, strainLine(strain), false],
    ["conditioning", "CONDITIONING", c.score, String(c.score), c.status, CONDITION[c.status], true],
  ];
  const row = el("div", "scores");
  picks.forEach(([name, label, value, text, zone, line, accent], i) => {
    const on = open === name;
    const button = el("button", "score-pick" + (on ? " selected" : ""), ring(value, 120, text),
      el("span", "score-info", kicker(label), words("span", "score-zone" + (accent ? " accent" : ""), zone), words("span", "score-line", line)));
    button.type = "button"; button.dataset.id = "score-" + name; button.style.setProperty("--place", String(i * 2));
    button.setAttribute("aria-expanded", String(on));
    button.addEventListener("click", () => toggle(name));
    row.append(button);
    if (on) { const panel = el("div", "score-panel", scorePanel(name, result, deck)); panel.style.setProperty("--place", String(i * 2 + 1)); row.append(panel); }
  });
  return el("section", "cockpit-block scores-block",
    el("div", "cockpit-block-head", kicker(`TODAY · ${dateLabel(new Date())}`), kicker(open ? "tap the ring again to close" : "tap a ring for what's behind it", "cockpit-quiet")), row);
}

const CHANNELS = [
  ["pace", "PACE", v => `${pace(v)} /km`, { invert: true }], ["hr", "HEART RATE", v => `${Math.round(v)} bpm`], ["altitude", "ELEVATION", v => `${Math.round(v)} m`, { area: true }],
  ["cadence", "CADENCE", v => `${Math.round(v)}`], ["power", "POWER", v => `${Math.round(v)} W`], ["contact", "GROUND CONTACT", v => `${Math.round(v)} ms`],
  ["oscillation", "VERT. OSCILLATION", v => `${(v / 10).toFixed(1)} cm`], ["ratio", "VERT. RATIO", v => `${v.toFixed(1)} %`], ["step", "STEP LENGTH", v => `${(v / 1000).toFixed(2)} m`],
];
/** Linked charts along the activity: hovering or arrow keys move one crosshair through all of them. */
const BASIC = ["pace", "hr", "altitude"];
function charts(series, ride, all, toggle) {
  const present = CHANNELS.filter(([name]) => series[name]?.some(v => v != null)), extra = present.filter(([name]) => !BASIC.includes(name));
  const rows = all ? present : present.filter(([name]) => BASIC.includes(name));
  if (!rows.length) return null;
  const x = series.x, traces = [], values = [];
  const cursor = words("span", "", "");
  const box = el("div", "activity-charts");
  for (const [name, label, format, options] of rows) {
    const shown = name === "pace" && ride ? { ...options, invert: false } : options;
    const data = name === "pace" && ride ? series.pace.map(v => v && 3600 / v) : series[name];
    const show = name === "pace" && ride ? v => `${v.toFixed(1)} km/h` : name === "cadence" ? v => `${Math.round(v)} ${ride ? "rpm" : "spm"}` : format;
    const chart = trace(x, data, shown), reading = words("strong", "", show(average(data)));
    traces.push(chart.move); values.push(i => { reading.textContent = i == null ? show(average(data)) : data[i] == null ? "—" : show(data[i]); });
    box.append(el("div", "activity-chart", el("div", "activity-chart-label", kicker(name === "pace" && ride ? "SPEED" : label), reading), chart.node));
  }
  const unit = series.unit;
  const set = i => { traces.forEach(move => move(i)); values.forEach(update => update(i)); cursor.textContent = i == null ? "avg · hover or use ← →" : `${x[i]} ${unit}`; };
  let index = null;
  const plot = el("div", "activity-chart-stack", box, el("div", "cockpit-axis", words("span", "", `0 ${unit}`), cursor, words("span", "", `${x.at(-1)} ${unit}`)));
  plot.tabIndex = 0;
  plot.setAttribute("role", "group");
  plot.setAttribute("aria-label", `Charts along the activity: ${rows.map(r => r[1].toLowerCase()).join(", ")}. Use left and right arrow keys to read values; the splits table below lists them per lap.`);
  const at = event => { const area = box.querySelector("svg").getBoundingClientRect(), share = (event.clientX - area.left) / area.width; return share < 0 || share > 1 ? null : Math.round(share * (x.length - 1)); };
  plot.addEventListener("pointermove", event => { index = at(event); set(index); });
  plot.addEventListener("pointerleave", () => { index = null; set(null); });
  plot.addEventListener("keydown", event => {
    const step = Math.max(1, Math.round(x.length / 50));
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); index = Math.max(0, Math.min(x.length - 1, (index ?? (event.key === "ArrowRight" ? -step : x.length - 1 + step)) + (event.key === "ArrowRight" ? step : -step))); set(index); }
    else if (event.key === "Escape") { index = null; set(null); }
  });
  set(null);
  let more = null;
  if (extra.length) {
    more = words("button", "activity-toggle", all ? "fewer charts" : `+ ${extra.length} more: ${extra.map(([, label]) => label.toLowerCase()).join(", ")}`);
    more.type = "button"; more.setAttribute("aria-expanded", String(all)); more.addEventListener("click", toggle);
  }
  return el("div", "activity-block", kicker("ALONG THE WAY"), plot, more);
}

function splits(laps, ride) {
  if (!laps?.laps?.length) return null;
  const has = name => laps.laps.some(lap => lap[name] != null);
  const columns = [
    ["KM", lap => lap.km === laps.every ? String(lap.index * laps.every) : (laps.laps.slice(0, lap.index - 1).reduce((s, l) => s + l.km, 0) + lap.km).toFixed(2)],
    ride ? ["KM/H", lap => lap.speed?.toFixed(1) ?? "—"] : ["PACE", lap => pace(lap.pace)],
    !ride && has("adjusted") && ["ADJUSTED", lap => pace(lap.adjusted)],
    has("hr") && ["HR", lap => lap.hr ?? "—"], has("maxHr") && ["MAX", lap => lap.maxHr ?? "—"],
    has("cadence") && [ride ? "RPM" : "SPM", lap => lap.cadence ?? "—"], has("power") && ["W", lap => lap.power ?? "—"],
    has("stride") && ["STRIDE", lap => lap.stride ? `${(lap.stride / 100).toFixed(2)} m` : "—"], has("contact") && ["GCT", lap => lap.contact ? `${lap.contact} ms` : "—"],
    has("oscillation") && ["V.OSC", lap => lap.oscillation ? `${lap.oscillation.toFixed(1)} cm` : "—"], has("ratio") && ["V.RATIO", lap => lap.ratio ? `${lap.ratio.toFixed(1)}%` : "—"],
    has("climb") && ["↑ M", lap => lap.climb ?? "—"], has("descent") && ["↓ M", lap => lap.descent ?? "—"],
  ].filter(Boolean);
  // Bars compare each lap's speed with the fastest full lap; a short final lap is shown but not bolded.
  const speed = lap => lap.pace ? 1 / lap.pace : lap.speed || 0, best = Math.max(...laps.laps.map(speed));
  const table = el("table", "activity-splits",
    el("thead", "", el("tr", "", columns.map(([label], i) => [words("th", "", label), i === 0 ? words("th", "activity-split-bar-cell", "") : null]))),
    el("tbody", "", laps.laps.map(lap => {
      const bar = el("span", "activity-split-bar"); bar.style.width = `${Math.round(speed(lap) / best * 100)}%`;
      return el("tr", laps.fastest.includes(lap.index) ? "fastest" : "", columns.map(([, cell], i) => [words("td", "", String(cell(lap))), i === 0 ? el("td", "activity-split-bar-cell", bar) : null]));
    })));
  return el("div", "activity-block", el("div", "cockpit-block-head", kicker(`SPLITS · EVERY ${laps.every} KM`), kicker("fastest in accent", "cockpit-quiet")), el("div", "activity-splits-scroll", table));
}

function bands(series) {
  if (!series?.hrBands?.length) return null;
  const top = Math.max(...series.hrBands.map(b => b.share));
  return el("div", "activity-block", kicker("TIME BY HEART RATE"),
    el("div", "activity-bands", series.hrBands.filter(b => b.share >= .005).map(b => {
      const bar = el("span", "activity-band-bar" + (b.share === top ? " top" : "")); bar.style.width = `${Math.round(b.share / top * 100)}%`;
      return el("div", "activity-band", words("span", "activity-band-label", `${b.from}–${b.from + 9}`), el("span", "activity-band-track", bar), words("span", "activity-band-share", `${Math.round(b.share * 100)}%`));
    })));
}

export function mount(body, { say = () => {} } = {}) {
  const live = coros.connected(), saved = live ? coros.cached() : null;
  let items = live ? saved?.list || [] : sample(), deck = live ? coros.cachedCockpit() || {} : sampleCockpit();
  let at = saved?.at || 0, loading = false, selected = items[0]?.id;
  let open = sessionStorage.getItem("pocket:movement-open") || null, allCharts = false, moreOpen = false;
  const details = {}; // activity id → everything COROS has on it, "loading" or "error"
  const list = el("div", "movement-list"), detail = el("section", "movement-detail"), sky = backdrop("terrain");

  const load = async () => {
    loading = true; draw();
    const [activities, cockpit] = await Promise.allSettled([coros.activities(), coros.cockpit(DAYS)]);
    loading = false;
    const failed = [activities, cockpit].find(answer => answer.status === "rejected");
    if (failed?.reason instanceof coros.Expired) { say(failed.reason.message); mount(body, { say }); return; }
    if (failed) say(failed.reason.message);
    if (activities.status === "fulfilled") { items = activities.value; at = Date.now(); if (!items.some(item => item.id === selected)) selected = items[0]?.id; }
    if (cockpit.status === "fulfilled") deck = cockpit.value;
    if (body.isConnected) draw();
  };
  const fetchDetail = async item => {
    details[item.id] = "loading";
    try { details[item.id] = await coros.activity(item); }
    catch (error) { details[item.id] = "error"; say(error.message); if (error instanceof coros.Expired) { mount(body, { say }); return; } }
    if (body.isConnected && selected === item.id) drawDetail();
  };

  const drawList = () => {
    list.replaceChildren();
    if (!items.length) { list.append(words("p", "small muted", loading ? "Loading from COROS…" : "No activities in the last 90 days.")); return; }
    for (const item of items) {
      const on = item.id === selected, date = dateLabel(new Date(item.start));
      const row = el("button", "movement-row" + (on ? " selected" : ""),
        el("span", "movement-row-main", words("span", "movement-row-type", item.type), words("span", "movement-row-date", date)),
        el("span", "movement-row-values", `${item.km.toFixed(1)} km`, words("span", "movement-row-time", [moving(item.seconds), item.hr ? `${item.hr} bpm` : null].filter(Boolean).join(" · "))));
      row.type = "button"; row.dataset.id = item.id;
      row.setAttribute("aria-pressed", String(on));
      row.setAttribute("aria-label", `${item.type.toLowerCase()}, ${item.km.toFixed(1)} kilometres, ${moving(item.seconds)}, ${date}`);
      row.addEventListener("click", () => {
        selected = item.id; drawList(); drawDetail();
        list.querySelector(`[data-id="${item.id}"]`).focus({ preventScroll: true });
        if (matchMedia("(max-width: 899px)").matches) detail.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
      });
      list.append(row);
    }
  };
  const drawDetail = () => {
    const index = items.findIndex(item => item.id === selected), item = items[index];
    detail.hidden = !item;
    if (!item) return;
    if (item.sample) details[item.id] ??= sampleActivity(item);
    else if (!details[item.id]) fetchDetail(item);
    const info = details[item.id], ready = info && typeof info === "object" ? info : null, ride = item.type === "RIDE";
    let route;
    if (ready?.path) {
      route = svg("svg", { viewBox: "0 0 320 190", role: "img", "aria-label": `${live ? "Route of this" : "Sample"} ${item.type.toLowerCase()}` },
        svg("path", { d: ready.path.d, fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }),
        svg("circle", { cx: ready.path.start[0], cy: ready.path.start[1], r: 4, fill: "currentColor" }));
    } else route = words("div", "movement-route-empty", info === "loading" ? "LOADING FROM COROS…" : info === "error" ? "NOT AVAILABLE" : "NO GPS TRACK");
    const climb = ready?.climb != null ? `${ready.climb} m` : info === "loading" ? "…" : "—";
    const everything = ready?.detail?.length ? el("div", "activity-block", kicker("EVERY METRIC COROS RECORDED"),
      el("dl", "activity-facts", ready.detail.map(([label, value]) => el("div", "", words("dt", "", label), words("dd", "", value))))) : null;
    detail.replaceChildren(
      el("div", "movement-detail-header", kicker(`${item.type} / ${dateLabel(new Date(item.start))}`), words("span", "movement-detail-index", `${two(index + 1)} / ${two(items.length)}`)),
      words("h2", "movement-detail-title", item.name),
      el("div", "movement-route", route),
      el("div", "movement-detail-distance", words("strong", "", item.km.toFixed(1)), words("span", "", "km")),
      el("div", "movement-detail-metrics",
        el("div", "", words("strong", "", moving(item.seconds)), words("span", "", "moving")),
        el("div", "", words("strong", "", item.pace || "—"), words("span", "", item.paceLabel)),
        el("div", "", words("strong", "", climb), words("span", "", "climb")),
        el("div", "", words("strong", "", item.hr ? `${item.hr} bpm` : "—"), words("span", "", "avg heart rate")),
        el("div", "", words("strong", "", item.kcal ? `${item.kcal}` : "—"), words("span", "", "kcal"))),
      ready?.series ? charts(ready.series, ride, allCharts, () => { allCharts = !allCharts; drawDetail(); }) : null,
      more(splits(ready?.laps, ride), bands(ready?.series), everything));
  };
  // Splits, heart-rate time and the full metric list wait behind one fold; it stays open from run to run.
  const more = (...parts) => {
    if (!parts.some(Boolean)) return null;
    const fold = el("details", "activity-more", words("summary", "", "splits, time by heart rate and every metric"), parts);
    fold.open = moreOpen; fold.addEventListener("toggle", () => { moreOpen = fold.open; });
    return fold;
  };
  const scoresBox = el("div", "");
  const drawScores = () => {
    const result = scores({ activities: live ? items : [...items, ...sampleHistory()], deck, profile: { ...deck.profile, observedMax: live ? coros.observedMaxHr() : 0 } });
    scoresBox.replaceChildren(scoreRow(result, deck, open, name => {
      open = open === name ? null : name;
      if (open) sessionStorage.setItem("pocket:movement-open", open); else sessionStorage.removeItem("pocket:movement-open");
      drawScores(); scoresBox.querySelector(`[data-id="score-${name}"]`)?.focus({ preventScroll: true });
    }));
  };

  const draw = () => {
    const weekStart = day(6); weekStart.setHours(0, 0, 0, 0);
    const week = items.filter(item => item.start >= weekStart.getTime());
    const totalKm = week.reduce((sum, item) => sum + item.km, 0), totalSeconds = week.reduce((sum, item) => sum + item.seconds, 0);
    const totalKcal = week.reduce((sum, item) => sum + item.kcal, 0);

    let source;
    if (!live) source = words("span", "movement-demo", "SAMPLE DATA");
    else {
      source = words("button", "movement-source", loading ? "COROS · LOADING…" : at ? "COROS · " + new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "COROS");
      source.type = "button"; source.disabled = loading; source.title = "Load again from COROS";
      source.addEventListener("click", load);
    }
    let connect = null;
    if (!live) {
      const button = el("button", "row-button", "connect coros", words("span", "sub", "your own runs, routes, sleep, HRV and recovery · sign-in happens on COROS, the data stays in this browser"));
      button.type = "button";
      button.addEventListener("click", async () => {
        button.disabled = true; say("Opening COROS…");
        try { await coros.connect(); } catch (error) { button.disabled = false; say(error.message); }
      });
      connect = el("div", "movement-connect", button);
    }
    const hero = el("section", "movement-summary",
      kicker("LAST 7 DAYS"),
      el("div", "movement-distance", words("span", "movement-distance-number", totalKm.toFixed(1)), words("span", "movement-distance-unit", "km")),
      el("div", "movement-totals",
        el("div", "", words("strong", "", moving(totalSeconds)), words("span", "", "moving")),
        el("div", "", words("strong", "", String(week.length)), words("span", "", week.length === 1 ? "activity" : "activities")),
        el("div", "", words("strong", "", String(totalKcal)), words("span", "", "kcal"))));
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = day(6 - i);
      return { date, km: items.filter(item => sameDay(new Date(item.start), date)).reduce((sum, item) => sum + item.km, 0) };
    });
    const longest = Math.max(...days.map(d => d.km)), recent = days.findLastIndex(d => d.km > 0);
    const weekday = date => new Intl.DateTimeFormat("en", { weekday: "short" }).format(date);
    const bars = el("div", "movement-bars");
    bars.setAttribute("role", "img");
    bars.setAttribute("aria-label", "Distance by day, last seven days: " + (recent < 0 ? "no activities" : days.filter(d => d.km).map(d => `${weekday(d.date)} ${d.km.toFixed(1)} kilometres`).join(", ")));
    for (const [i, { date, km }] of days.entries()) {
      const column = el("div", "movement-bar-column"), stem = el("span", "movement-bar" + (i === recent ? " recent" : ""));
      stem.style.height = km ? `${Math.max(10, km / longest * 100)}%` : "0";
      column.title = km ? `${km.toFixed(1)} km` : "No activity";
      column.append(stem, words("span", "movement-day", weekday(date).slice(0, 2).toUpperCase()));
      bars.append(column);
    }
    let disconnect = null;
    if (live) {
      disconnect = words("button", "movement-disconnect", "disconnect coros");
      disconnect.type = "button";
      disconnect.addEventListener("click", () => { coros.disconnect(); mount(body, { say }); say("COROS disconnected. This browser's copy of your data is gone."); });
    }
    const focused = body.contains(document.activeElement) ? document.activeElement.dataset.id : null;
    body.replaceChildren(...[
      el("div", "movement-heading movement-sky", sky, words("h1", "movement-title", "movement"), el("div", "movement-heading-side", deck.device ? words("span", "movement-device", deck.device.toUpperCase()) : null, source)),
      connect,
      scoresBox,
      el("div", "cockpit-block-head cockpit-activities-head", kicker(live ? "ACTIVITIES · LAST 90 DAYS" : "ACTIVITIES")),
      el("div", "movement-layout",
        el("div", "movement-overview", hero, bars),
        detail,
        el("section", "movement-activities", list, disconnect))].filter(Boolean));
    drawScores(); drawList(); drawDetail();
    if (focused) list.querySelector(`[data-id="${focused}"]`)?.focus({ preventScroll: true });
  };

  draw();
  if (live) load();
}
