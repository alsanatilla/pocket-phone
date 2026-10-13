import { svg, meter, stack, dayLine, dayBars, dayPair, trace } from "./movement-charts.js";
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


export { scorePanel, fitnessStrip, charts, splits, bands };
