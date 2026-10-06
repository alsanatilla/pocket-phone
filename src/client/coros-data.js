// COROS answers in plain text, and routes only exist inside each activity's FIT file.
// These helpers turn both into the plain shapes the Movement tab draws. No DOM, so node can test them.

/** Tool text sometimes arrives as a JSON string literal; this returns the text inside. */
export function unwrap(text) {
  if (!text.startsWith('"')) return text;
  try { return JSON.parse(text); } catch { return text; }
}

const RUN = [100, 101, 102, 103], HIKE = [104, 105], WALK = [900];
/** Short label for a COROS sport code; the full name from COROS stays as a fallback. */
export function sportLabel(code, name = "") {
  if (RUN.includes(code)) return "RUN";
  if (HIKE.includes(code)) return "HIKE";
  if (WALK.includes(code)) return "WALK";
  if (code >= 200 && code < 300) return "RIDE";
  if (code >= 300 && code < 400) return "SWIM";
  if (code === 402) return "STRENGTH";
  return (name.split(" ").pop() || "ACTIVITY").toUpperCase();
}
const seconds = text => text.split(":").map(Number).reduce((total, part) => total * 60 + part, 0);

/** Splits querySportRecords text into activities, newest first as COROS lists them. */
export function parseRecords(text) {
  const list = [];
  for (const block of unwrap(text).split(/\n(?=\d+\.\s)/)) {
    const head = block.match(/^\d+\.\s+(.+?)\s+[—–-]\s+(\d{4}-\d{2}-\d{2})/), id = block.match(/LabelId:\s*(\d+)/);
    if (!head || !id) continue;
    const find = pattern => block.match(pattern)?.[1]?.trim() ?? null;
    const sport = Number(find(/SportType:\s*(\d+)/)), stamp = Number(find(/startTimestamp=(\d+)/));
    const distance = block.match(/Distance:\s*([\d.]+)\s*(km|m)\b/);
    const pace = block.match(/Average (Pace|Speed):\s*([^|\n]+)/);
    list.push({
      id: id[1], sport, type: sportLabel(sport, head[1]), name: find(/Location:\s*([^\n]+)/) || head[1],
      start: stamp ? stamp * 1000 : new Date(head[2] + "T12:00:00").getTime(),
      km: distance ? Number(distance[1]) / (distance[2] === "m" ? 1000 : 1) : 0,
      seconds: seconds(find(/Duration:\s*([\d:]+)/) || "0"),
      pace: pace ? pace[2].trim() : null, paceLabel: pace?.[1] === "Speed" ? "average" : "pace",
      hr: Number(find(/Avg HR:\s*(\d+)/)) || null, kcal: Number(find(/Calories:\s*(\d+)/)) || 0,
    });
  }
  return list;
}

const DEGREES = 180 / 2 ** 31, NO_POSITION = 0x7fffffff, NO_ASCENT = 0xffff;
// Record (message 20) fields worth charting: FIT field number → [name, divide by, then subtract].
const CHANNELS = { 5: ["distance", 100, 0], 2: ["altitude", 5, 500], 78: ["altitude", 5, 500], 3: ["hr", 1, 0], 4: ["cadence", 1, 0],
  6: ["speed", 1000, 0], 73: ["speed", 1000, 0], 7: ["power", 1, 0], 41: ["contact", 10, 0], 39: ["oscillation", 10, 0], 83: ["ratio", 100, 0], 85: ["step", 10, 0] };
/** Reads GPS points and per-second samples (record messages) and total ascent (session messages) from a FIT file. */
export function parseFit(buffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || String.fromCharCode(...bytes.subarray(8, 12)) !== ".FIT") throw new Error("COROS sent a file that is not a FIT file.");
  const end = Math.min(bytes.length, bytes[0] + view.getUint32(4, true)), definitions = [], points = [], samples = [];
  let ascent = null, at = bytes[0];
  const unsigned = (size, little) => size === 1 ? (bytes[at] === 0xff ? null : bytes[at])
    : size === 2 ? (view.getUint16(at, little) === 0xffff ? null : view.getUint16(at, little))
    : size === 4 ? (view.getUint32(at, little) === 0xffffffff ? null : view.getUint32(at, little)) : null;
  const data = definition => {
    if (!definition) throw new Error("This FIT file could not be read.");
    let lat = null, lon = null;
    const sample = {};
    for (const { number, size } of definition.fields) {
      if (definition.global === 20 && size === 4 && number <= 1) {
        const value = view.getInt32(at, definition.little);
        if (value !== NO_POSITION) { if (number === 0) lat = value; else lon = value; }
      } else if (definition.global === 20 && CHANNELS[number]) {
        const [name, divide, subtract] = CHANNELS[number], value = unsigned(size, definition.little);
        if (value !== null) sample[name] = value / divide - subtract;
      } else if (definition.global === 18 && number === 22 && size === 2) {
        const value = view.getUint16(at, definition.little);
        if (value !== NO_ASCENT) ascent = (ascent ?? 0) + value;
      }
      at += size;
    }
    at += definition.developerBytes;
    if (lat !== null && lon !== null && (lat || lon)) points.push([lat * DEGREES, lon * DEGREES]);
    if (definition.global === 20) samples.push(sample);
  };
  while (at < end) {
    const header = bytes[at++];
    if (header & 0x80) { data(definitions[(header >> 5) & 3]); continue; } // compressed timestamp header
    if (!(header & 0x40)) { data(definitions[header & 15]); continue; }
    const little = bytes[at + 1] === 0, global = view.getUint16(at + 2, little), count = bytes[at + 4], fields = [];
    at += 5;
    for (let i = 0; i < count; i++, at += 3) fields.push({ number: bytes[at], size: bytes[at + 1] });
    let developerBytes = 0;
    if (header & 0x20) { const developer = bytes[at++]; for (let i = 0; i < developer; i++, at += 3) developerBytes += bytes[at + 1]; }
    definitions[header & 15] = { global, little, fields, developerBytes };
  }
  return { points, ascent, samples };
}

const SERIES = ["pace", "hr", "altitude", "cadence", "power", "contact", "oscillation", "ratio", "step"];
const round = value => value == null ? null : Math.round(value * 10) / 10;
/** Centred average over 7 buckets (about 2% of the activity), so one stop or GPS jump does not dominate. */
function smooth(values, digits, reach = 3) {
  return values.map((v, i) => {
    if (v == null) return null;
    const near = values.slice(Math.max(0, i - reach), i + reach + 1).filter(n => n != null), mean = near.reduce((a, b) => a + b, 0) / near.length;
    return Number(mean.toFixed(digits));
  });
}
/**
 * Averages per-second samples into `buckets` steps along the distance (or along time, without distance).
 * Running cadence is doubled to steps per minute, as COROS shows it. Channels with no data are left out.
 */
export function series(samples, { steps = true, buckets = 200 } = {}) {
  const byDistance = samples.some(s => s.distance > 0), x = byDistance ? s => s.distance : (_, i) => i;
  const usable = samples.map((s, i) => ({ ...s, at: x(s, i) })).filter(s => s.at != null);
  if (usable.length < 2) return null;
  const last = usable.at(-1).at || 1, sums = Array.from({ length: buckets }, () => ({ n: {}, total: {}, at: 0, count: 0 }));
  for (const s of usable) {
    const bucket = sums[Math.min(buckets - 1, Math.floor(s.at / last * buckets))];
    bucket.at += s.at; bucket.count++;
    for (const name of ["speed", "hr", "altitude", "cadence", "power", "contact", "oscillation", "ratio", "step"]) {
      if (s[name] == null || (name !== "altitude" && s[name] <= 0)) continue;
      bucket.total[name] = (bucket.total[name] ?? 0) + s[name]; bucket.n[name] = (bucket.n[name] ?? 0) + 1;
    }
  }
  const filled = sums.filter(b => b.count), mean = (b, name) => b.n[name] ? b.total[name] / b.n[name] : null;
  const out = { x: filled.map(b => round(byDistance ? b.at / b.count / 1000 : b.at / b.count / 60)), unit: byDistance ? "km" : "min" };
  for (const name of SERIES) {
    const values = filled.map(b => {
      if (name === "pace") { const speed = mean(b, "speed"); return speed > 0.3 ? Math.round(1000 / speed) : null; }
      const value = mean(b, name);
      return name === "cadence" && steps && value != null ? Math.round(value * 2) : round(value);
    });
    if (values.some(v => v != null)) out[name] = name === "altitude" ? values : smooth(values, name === "pace" ? 0 : 1);
  }
  // Share of samples (about one per second) in each 10 bpm band.
  const beats = samples.map(s => s.hr).filter(hr => hr > 0);
  if (beats.length) {
    const bands = {};
    for (const hr of beats) { const from = Math.floor(hr / 10) * 10; bands[from] = (bands[from] ?? 0) + 1; }
    out.hrBands = Object.entries(bands).map(([from, n]) => ({ from: Number(from), share: n / beats.length })).sort((a, b) => a.from - b.from);
  }
  return out;
}

/** "Label: value" lines in order, as getActivityDetail and the fitness overview write them. */
export function pairs(text) {
  return unwrap(text).split(/\r?\n/).map(line => line.match(/^\s*([^:=\n][^:\n]*?):\s+(.+?)\s*$/)).filter(Boolean).map(m => [m[1].trim(), m[2]]);
}
const value = (list, label) => list.find(([key]) => key.toLowerCase() === label.toLowerCase())?.[1] ?? null;
const number = text => text == null ? null : Number(String(text).replace(/,/g, "").match(/-?[\d.]+/)?.[0] ?? NaN);
const known = n => Number.isFinite(n) ? n : null;
/** "1h 35min", "54 min", "0h" → minutes. */
export function duration(text) {
  if (!text) return null;
  const hours = text.match(/(\d+)\s*h/), mins = text.match(/(\d+)\s*min/);
  return hours || mins ? Number(hours?.[1] || 0) * 60 + Number(mins?.[1] || 0) : null;
}
/** Splits text at date headings ("2026-10-05", "2026-10-05:", "--- 20261005 ---") into [date, block] pairs. */
function byDay(text) {
  const out = [];
  let current = null;
  for (const line of unwrap(text).split(/\r?\n/)) {
    const heading = line.match(/^\s*(?:---\s*)?(\d{4})-?(\d{2})-?(\d{2})(?:\s*---|:)?\s*$/);
    if (heading) { current = [`${heading[1]}-${heading[2]}-${heading[3]}`, ""]; out.push(current); }
    else if (current) current[1] += line + "\n";
  }
  return out;
}
const oldestFirst = list => list.sort((a, b) => a.date.localeCompare(b.date));

/** COROS lap JSON → the first automatic lap set (1 km for runs), in plain units. */
export function parseLaps(text) {
  let data;
  try { data = JSON.parse(unwrap(text)); } catch { return null; }
  const groups = data.lapGroups || [], group = groups.find(g => g.type === 2) || groups.find(g => g.type !== -1) || groups[0];
  if (!group?.laps?.length) return null;
  const positive = v => v > 0 ? v : null;
  return { every: group.lapDistance / 1e5, fastest: group.fastLapIndexList || [], laps: group.laps.map(lap => ({
    index: lap.lapIndex, km: lap.distance / 1e5, seconds: lap.time, pace: positive(lap.avgPace), speed: positive(lap.avgSpeedV2) && lap.avgSpeedV2 / 100,
    adjusted: positive(lap.adjustedPace), hr: positive(lap.avgHr), maxHr: positive(lap.maxHr), cadence: positive(lap.avgCadence),
    power: positive(lap.avgPower), stride: positive(lap.avgStrideLength), contact: positive(lap.groundTime),
    oscillation: positive(lap.strideHeight) && lap.strideHeight / 10, ratio: positive(lap.strideRatio) && lap.strideRatio / 10,
    climb: lap.elevGain ?? null, descent: lap.totalDescent ?? null })) };
}

export function parseRecovery(text) {
  const list = pairs(text);
  return { percent: known(number(value(list, "Recovery"))), level: value(list, "Level"), full: value(list, "Estimated Full Recovery") };
}
export function parseFitness(text) {
  const list = pairs(text);
  return { vo2max: known(number(value(list, "VO2max"))), level: known(number(value(list, "Running Level"))), threshold: value(list, "Threshold Pace"),
    predictions: list.filter(([key]) => /Prediction$/.test(key)).map(([key, time]) => [key.replace(/\s*Prediction$/, ""), time]) };
}
export function parseLoad(text) {
  return oldestFirst(byDay(text).map(([date, block]) => {
    const list = pairs(block);
    return { date, comment: value(list, "Comment"), short: known(number(value(list, "Short-Term Load"))),
      long: known(number(value(list, "Long-Term Load"))), ratio: known(number(value(list, "Load Ratio"))) };
  }));
}
export function parseDaily(text) {
  const body = unwrap(text), head = body.split(/\r?\n/)[0];
  const days = oldestFirst(byDay(body).map(([date, block]) => {
    const sleep = block.match(/Total:\s*([^|\n]+)\|\s*Deep:\s*([^|\n]+)\|\s*Light:\s*([^|\n]+)\|\s*REM:\s*([^|\n]+)\|\s*Awake:\s*([^|\n]+)/);
    const sleepHr = block.match(/Sleep HR:\s*Avg\s*(\d+)\s*bpm\s*\|\s*Min\s*(\d+)\s*bpm\s*\|\s*Max\s*(\d+)/);
    return { date, steps: known(number(block.match(/Steps:\s*([\d,]+)/)?.[1])), kcal: known(number(block.match(/Calories:\s*([\d,]+)/)?.[1])),
      exercise: duration(block.match(/Exercise:\s*([^|\n]+)/)?.[1]), stress: known(number(block.match(/Stress:\s*Avg\s*(\d+)/)?.[1])),
      sleep: sleep ? { total: duration(sleep[1]), deep: duration(sleep[2]), light: duration(sleep[3]), rem: duration(sleep[4]), awake: duration(sleep[5]),
        hr: sleepHr ? { avg: Number(sleepHr[1]), min: Number(sleepHr[2]), max: Number(sleepHr[3]) } : null } : null };
  }));
  return { restingHr: known(number(head.match(/Resting HR:\s*(\d+)/)?.[1])), hrvBaseline: known(number(head.match(/HRV Baseline:\s*(\d+)/)?.[1])), days };
}
export function parseSleep(text) {
  return oldestFirst(byDay(text).map(([date, block]) => {
    const list = pairs(block), ratio = label => known(number(value(list, label)));
    return { date, score: known(number(value(list, "Sleep Score"))), asleep: duration(value(list, "Main Sleep (asleep)")),
      deep: ratio("Deep Sleep Ratio"), light: ratio("Light Sleep Ratio"), rem: ratio("REM Ratio"), awake: ratio("Awake Ratio"),
      window: value(list, "Main Sleep Window") };
  }).filter(day => day.score > 0));
}
export function parseHrv(text) {
  const assessment = unwrap(text).split(/Sleep HRV Time Series/)[0];
  return oldestFirst(byDay(assessment).map(([date, block]) => {
    const avg = block.match(/HRV Avg:\s*(\d+)\s*ms\s*[—–-]\s*([^\n]+)/), range = block.match(/Normal Range:\s*(\d+)\s*-\s*(\d+)/);
    return { date, avg: avg ? Number(avg[1]) : null, status: avg?.[2].trim() ?? null, low: range ? Number(range[1]) : null,
      high: range ? Number(range[2]) : null, baseline: known(number(block.match(/Baseline:\s*(\d+)/)?.[1])) };
  }).filter(day => day.avg != null));
}
export function parseResting(text) {
  return oldestFirst([...unwrap(text).matchAll(/^(\d{4}-\d{2}-\d{2}):\s*(\d+)\s*bpm/gm)].map(m => ({ date: m[1], bpm: Number(m[2]) })));
}
/** Only what the scores need: age (for maximum heart rate) and gender (for the TRIMP curve). Height and weight are not kept. */
export function parseProfile(text) {
  const body = unwrap(text);
  return { age: known(number(body.match(/Age:\s*(\d+)/)?.[1])), gender: body.match(/Gender:\s*(\w+)/)?.[1] ?? null };
}
export function parseDevice(text) {
  return unwrap(text).match(/Model Name:\s*([^\n]+)/)?.[1].trim() ?? null;
}

/** Fits GPS points into an SVG box as one path; null when there is nothing to draw. */
export function routePath(points, width = 320, height = 190, pad = 14, limit = 500) {
  if (points.length < 2) return null;
  const step = Math.max(1, Math.ceil(points.length / limit));
  const kept = points.filter((_, i) => i % step === 0 || i === points.length - 1);
  const middle = kept.reduce((sum, [lat]) => sum + lat, 0) / kept.length, squeeze = Math.cos(middle * Math.PI / 180);
  const flat = kept.map(([lat, lon]) => [lon * squeeze, -lat]);
  const xs = flat.map(p => p[0]), ys = flat.map(p => p[1]);
  const left = Math.min(...xs), top = Math.min(...ys), spanX = Math.max(...xs) - left, spanY = Math.max(...ys) - top;
  if (!spanX && !spanY) return null;
  const scale = Math.min((width - pad * 2) / (spanX || Infinity), (height - pad * 2) / (spanY || Infinity));
  const offsetX = (width - spanX * scale) / 2, offsetY = (height - spanY * scale) / 2;
  const xy = flat.map(([x, y]) => [+((x - left) * scale + offsetX).toFixed(1), +((y - top) * scale + offsetY).toFixed(1)]);
  return { d: xy.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" "), start: xy[0] };
}
