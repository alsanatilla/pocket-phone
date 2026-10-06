// Run with: node --test tools/coros.test.mjs
// Invented activities in the same text and FIT layouts COROS uses; no real data lives in this public repo.
import test from "node:test";
import assert from "node:assert/strict";
import { parseRecords, parseFit, routePath, sportLabel, unwrap } from "../src/client/coros-data.js";

const RECORDS = JSON.stringify(`Sport Records — 2026-09-01 to 2026-09-30 (2 records)
========================

1. Outdoor Run — 2026-09-20
   Location: Riverside Loop
   Start Coordinates: 50.000000, 10.000000
   Time Window: startTimestamp=1790150400 | endTimestamp=1790154000
   Duration: 1:04:30 | Distance: 10.50 km
   Average Pace: 6:08 /km | Avg HR: 150 bpm | Calories: 700 kcal
   LabelId: 111 | SportType: 100

2. Outdoor Bike — 2026-09-18
   Duration: 45:00 | Distance: 15.00 km
   Average Speed: 20.0 km/h | Calories: 400 kcal
   LabelId: 222 | SportType: 200`);

test("sport records text becomes activities", () => {
  const [run, ride] = parseRecords(RECORDS);
  assert.deepEqual(run, { id: "111", sport: 100, type: "RUN", name: "Riverside Loop", start: 1790150400000, km: 10.5,
    seconds: 3870, pace: "6:08 /km", paceLabel: "pace", hr: 150, kcal: 700 });
  assert.equal(ride.type, "RIDE");
  assert.equal(ride.name, "Outdoor Bike", "no location falls back to the sport name");
  assert.equal(ride.seconds, 2700);
  assert.equal(ride.paceLabel, "average");
  assert.equal(ride.hr, null);
  assert.equal(unwrap("plain"), "plain");
  assert.equal(sportLabel(9999, "Custom Paddle"), "PADDLE");
});

/** A tiny FIT file: one record definition, three positions (one missing), one session with ascent. */
function fit(points, ascent, little = true) {
  const body = [];
  const u16 = v => little ? [v & 255, v >> 8] : [v >> 8, v & 255];
  const i32 = v => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v, little); return [...b]; };
  body.push(0x40, 0, little ? 0 : 1, ...u16(20), 3, 253, 4, 134, 0, 4, 133, 1, 4, 133);
  for (const [lat, lon] of points) body.push(0x00, ...i32(1000), ...i32(lat), ...i32(lon));
  body.push(0x61, 0, little ? 0 : 1, ...u16(18), 1, 22, 2, 132, 1, 0, 2, 0); // with one developer field (2 bytes)
  body.push(0x01, ...u16(ascent), 9, 9);
  const header = [14, 0x20, 0, 0, ...[body.length, body.length >> 8, 0, 0], ...".FIT".split("").map(c => c.charCodeAt(0)), 0, 0];
  return new Uint8Array([...header, ...body, 0, 0]).buffer;
}
const semicircles = degrees => Math.round(degrees * 2 ** 31 / 180);

test("FIT records give positions and sessions give the climb, in either byte order", () => {
  for (const little of [true, false]) {
    const { points, ascent } = parseFit(fit([[semicircles(50), semicircles(10)], [0x7fffffff, 0x7fffffff], [semicircles(50.01), semicircles(10.02)]], 102, little));
    assert.equal(points.length, 2, "missing positions are skipped");
    assert.ok(Math.abs(points[1][0] - 50.01) < 1e-6 && Math.abs(points[1][1] - 10.02) < 1e-6);
    assert.equal(ascent, 102);
  }
  assert.throws(() => parseFit(new Uint8Array(20).buffer));
});

test("routes fit inside the drawing box and start at the first point", () => {
  const points = Array.from({ length: 2000 }, (_, i) => [48 + Math.sin(i / 300) / 100, 11 + i / 50000]);
  const { d, start } = routePath(points);
  const numbers = d.match(/[\d.]+/g).map(Number);
  assert.ok(numbers.length / 2 <= 501, "long tracks are thinned");
  numbers.forEach((n, i) => assert.ok(n >= 0 && n <= (i % 2 ? 190 : 320)));
  assert.deepEqual(start, numbers.slice(0, 2));
  assert.equal(routePath([[48, 11]]), null);
  assert.equal(routePath([[48, 11], [48, 11]]), null);
});

test("health, sleep, load and fitness text become numbers, oldest day first", async () => {
  const d = await import("../src/client/coros-data.js");
  assert.deepEqual(d.parseRecovery("Recovery Status\n===\n\nRecovery: 76%\nLevel: Ready\nEstimated Full Recovery: 11h"), { percent: 76, level: "Ready", full: "11h" });
  const fitness = d.parseFitness("VO2max: 50\nRunning Level: 70\nThreshold Pace: 5:00 /km\n5 km Prediction: 22:10\nHalf Marathon Prediction: 1:45:00");
  assert.deepEqual(fitness, { vo2max: 50, level: 70, threshold: "5:00 /km", predictions: [["5 km", "22:10"], ["Half Marathon", "1:45:00"]] });
  const load = d.parseLoad("2026-10-02\nComment: Optimized\nShort-Term Load: 60\nLong-Term Load: 50\nLoad Ratio: 1.20\n\n2026-10-01\nComment: Maintaining\nShort-Term Load: 40\nLong-Term Load: 50\nLoad Ratio: 0.80");
  assert.deepEqual(load.map(l => [l.date, l.ratio]), [["2026-10-01", .8], ["2026-10-02", 1.2]]);
  const daily = d.parseDaily("Daily Health Data — Last 2 days | Resting HR: 50 bpm | HRV Baseline: 60 ms\n\n--- 20261001 ---\nSteps: 12,345 | Calories: 600 kcal | Exercise: 1h 5min\nStress: Avg 30\nSleep Summary:\n  Total: 7h 30min | Deep: 1h 10min | Light: 4h 0min | REM: 2h 5min | Awake: 15 min\n  Sleep HR: Avg 52 bpm | Min 45 bpm | Max 70 bpm\n\n--- 20261002 ---\nSteps: 900 | Calories: 80 kcal | Exercise: 0 min\nStress: Avg 20");
  assert.equal(daily.restingHr, 50);
  assert.deepEqual(daily.days[0], { date: "2026-10-01", steps: 12345, kcal: 600, exercise: 65, stress: 30,
    sleep: { total: 450, deep: 70, light: 240, rem: 125, awake: 15, hr: { avg: 52, min: 45, max: 70 } } });
  assert.equal(daily.days[1].sleep, null);
  const sleep = d.parseSleep("2026-10-01\nSleep Score: 0\nSleep detail for this day is not available yet.\n\n2026-10-02\nSleep Score: 80\nMain Sleep (asleep): 7h 2min\nDeep Sleep Ratio: 20%\nMain Sleep Window: 2026-10-01 23:00 - 2026-10-02 06:10");
  assert.deepEqual(sleep.map(s => [s.date, s.score, s.asleep, s.deep]), [["2026-10-02", 80, 422, 20]]);
  const hrv = d.parseHrv("HRV Assessment\n\n2026-10-02:\n  HRV Avg: 60 ms — Normal\n  Normal Range: 55 - 70 ms\n  Baseline: 62 ms\n2026-10-01:\n  No data\n\nSleep HRV Time Series — Last 7 days\n2026-10-02:\n  timestamp=1, hrv=99 ms");
  assert.deepEqual(hrv, [{ date: "2026-10-02", avg: 60, status: "Normal", low: 55, high: 70, baseline: 62 }]);
  assert.deepEqual(d.parseResting("2026-10-02: 51 bpm\n2026-10-01: No data\n2026-09-30: 53 bpm"), [{ date: "2026-09-30", bpm: 53 }, { date: "2026-10-02", bpm: 51 }]);
  assert.equal(d.duration("2h 3min"), 123);
  assert.equal(d.duration("0h"), 0);
});

test("laps use plain units and the activity series is bucketed along the distance", async () => {
  const d = await import("../src/client/coros-data.js");
  const laps = d.parseLaps(JSON.stringify({ lapGroups: [{ type: 2, lapDistance: 100000, fastLapIndexList: [1], laps: [
    { lapIndex: 1, distance: 100000, time: 300, avgPace: 300, avgSpeedV2: 1200, avgHr: 150, avgCadence: 170, avgStrideLength: 118, strideHeight: 85, strideRatio: 72, groundTime: 240, avgPower: 0, elevGain: 4 }] }] }));
  assert.deepEqual(laps.laps[0], { index: 1, km: 1, seconds: 300, pace: 300, speed: 12, adjusted: null, hr: 150, maxHr: null, cadence: 170, power: null,
    stride: 118, contact: 240, oscillation: 8.5, ratio: 7.2, climb: 4, descent: null });
  assert.equal(d.parseLaps("not json"), null);
  const samples = Array.from({ length: 1000 }, (_, i) => ({ distance: i * 3, speed: 3, hr: 140 + (i % 2), cadence: 85, altitude: 100 + i / 100 }));
  const s = d.series(samples, { buckets: 50 });
  assert.equal(s.unit, "km");
  assert.equal(s.x.length, 50);
  assert.ok(s.pace.every(p => p === 333), "3 m/s is 5:33 per km");
  assert.ok(s.cadence.every(c => c === 170), "running cadence counts both feet");
  assert.ok(!("power" in s), "missing channels are left out");
  assert.deepEqual(s.hrBands.map(b => b.from), [140]);
  assert.deepEqual(d.pairs("Title\n=====\nWorkout Time: 1:00:00\nAverage Pace: 5:00 /km"), [["Workout Time", "1:00:00"], ["Average Pace", "5:00 /km"]]);
});
