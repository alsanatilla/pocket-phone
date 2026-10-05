// Run with: node --test tools/scores.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { trimp, strainOf, maxHeartRate, recoveryOn, cardioStatus, conditioning, scores, key } from "../docs/js/scores.js";

test("maximum heart rate follows age, and a spiking lap can lift it only 10 bpm", () => {
  assert.equal(maxHeartRate(40), 180);
  assert.equal(maxHeartRate(40, 184), 184);
  assert.equal(maxHeartRate(40, 205), 190);
  assert.equal(maxHeartRate(null), 185);
});

test("TRIMP grows with time and much faster with intensity; strain is open-ended and logarithmic", () => {
  const heart = { rest: 50, max: 190 };
  const easy = trimp({ seconds: 3600, hr: 120 }, heart), hard = trimp({ seconds: 3600, hr: 170 }, heart);
  assert.ok(hard > easy * 2.5);
  assert.equal(trimp({ seconds: 3600 }, heart), 72, "no heart rate: a steady moderate hour");
  assert.equal(strainOf(0), 0);
  assert.equal(strainOf(150), 100);
  assert.ok(strainOf(300) > 100 && strainOf(300) < 150, "past 100% is possible, and slow");
  assert.ok(strainOf(75) - strainOf(0) > strainOf(225) - strainOf(150), "each extra percent costs more");
});

const deck = ({ hrv, rest, sleep }) => ({
  hrv: [{ date: "2026-10-05", avg: hrv, low: 50, high: 70, baseline: 60 }],
  resting: [...Array.from({ length: 10 }, (_, i) => ({ date: `2026-09-${String(20 + i).padStart(2, "0")}`, bpm: 55 + (i % 3) - 1 })), { date: "2026-10-05", bpm: rest }],
  daily: { days: [{ date: "2026-10-05", sleep: { total: sleep, awake: 0 } }] },
});
test("recovery rises with HRV and sleep, falls with resting heart rate, and lands near 60 on an ordinary morning", () => {
  const ordinary = recoveryOn("2026-10-05", deck({ hrv: 60, rest: 55, sleep: 410 }));
  assert.ok(ordinary.score >= 52 && ordinary.score <= 66, `ordinary ${ordinary.score}`);
  const great = recoveryOn("2026-10-05", deck({ hrv: 75, rest: 50, sleep: 500 })), poor = recoveryOn("2026-10-05", deck({ hrv: 45, rest: 62, sleep: 300 }));
  assert.ok(great.score >= 67 && great.zone === "primed");
  assert.ok(poor.score < 34 && poor.zone === "run down");
  assert.equal(recoveryOn("2026-10-05", { daily: deck({ hrv: 60, rest: 55, sleep: 400 }).daily }), null, "sleep alone is not enough");
  const strained = recoveryOn("2026-10-05", deck({ hrv: 60, rest: 55, sleep: 450 }), 140);
  assert.ok(strained.need > 480, "a hard day raises the sleep needed");
});

test("cardio status reads the balance of the last week against the last six", () => {
  assert.equal(cardioStatus(10, 10, 10, 10), "calibrating");
  assert.equal(cardioStatus(20, 10, 10, 60), "overtraining");
  assert.equal(cardioStatus(14, 10, 10, 60), "fatigued");
  assert.equal(cardioStatus(12, 10, 10, 60), "productive");
  assert.equal(cardioStatus(10, 10, 12, 60), "maintaining");
  assert.equal(cardioStatus(9, 10, 10, 60), "peaking");
  assert.equal(cardioStatus(5, 10, 10, 60), "detraining");
  const steady = conditioning(Array.from({ length: 300 }, () => ({ active: 45 })), 300);
  assert.ok(Math.abs(steady.score - 63) <= 1, `45 TRIMP a day reads about 63, got ${steady.score}`);
  assert.equal(steady.status, "maintaining");
});

test("scores combine into one reading for today", () => {
  const today = "2026-10-05", start = d => new Date(d + "T08:00:00").getTime();
  const activities = Array.from({ length: 30 }, (_, i) => ({ sport: 100, km: 8, seconds: 2700, hr: 150, start: start(key(new Date(Date.parse("2026-10-05T12:00:00") - i * 3 * 864e5))) }));
  const r = scores({ activities, deck: deck({ hrv: 60, rest: 55, sleep: 420 }), profile: { age: 40 }, today });
  assert.ok(r.recovery.score > 0);
  assert.equal(r.strain.workouts, 1);
  assert.ok(r.strain.strain > 50);
  assert.ok(r.strain.target[0] < r.strain.target[1]);
  assert.equal(r.strains.length, 28);
  assert.ok(r.conditioning.score > 0 && r.conditioning.status !== "calibrating");
});
