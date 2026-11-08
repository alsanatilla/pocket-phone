import test from 'node:test';
import assert from 'node:assert/strict';
import { backgroundRoutine, nextRun, localDay, quietWatch } from '../src/server/pip-background.js';

// Two kinds that share one rule: they only speak when there is something new. A brief reads what changed since the
// last brief; a watch looks for one thing the user named and stays silent otherwise. Both reuse the routine row,
// the account's dedicated key, the run budget and the push notice — no new table, no new scheduler.

test('a brief needs no prompt and gets a readable default name', () => {
  const routine = backgroundRoutine({ kind: 'brief', time: '04:30', days: [0, 1, 2, 3, 4, 5, 6] });
  assert.equal(routine.kind, 'brief');
  assert.equal(routine.title, 'Nightly brief');
  assert.equal(routine.prompt, '');
  assert.equal(routine.enabled, true);
});

test('a brief keeps a name the user chose', () => {
  const routine = backgroundRoutine({ kind: 'brief', title: 'Overnight read', time: '05:00', days: [1, 2, 3, 4, 5] });
  assert.equal(routine.title, 'Overnight read');
});

test('a brief ignores a prompt, because its message is fixed', () => {
  const routine = backgroundRoutine({ kind: 'brief', time: '04:30', days: [1], prompt: 'Say something cheerful.' });
  assert.equal(routine.prompt, '');
});

test('a watch keeps what to watch for', () => {
  const routine = backgroundRoutine({ kind: 'watch', prompt: 'Tell me if I mention the Lisbon trip again.', time: '08:00', days: [1, 2, 3, 4, 5] });
  assert.equal(routine.kind, 'watch');
  assert.equal(routine.prompt, 'Tell me if I mention the Lisbon trip again.');
  assert.equal(routine.title, 'Standing watch');
});

test('a watch without something to watch for is refused', () => {
  assert.throws(() => backgroundRoutine({ kind: 'watch', time: '08:00', days: [1] }), /what to watch for/);
});

test('a watch cannot carry an essay', () => {
  assert.throws(() => backgroundRoutine({ kind: 'watch', prompt: 'x'.repeat(4001), time: '08:00', days: [1] }), /4,000 characters/);
});

test('only a one-word SKIP silences a watch', () => {
  assert.equal(quietWatch('SKIP'), true);
  assert.equal(quietWatch('  skip.'), true);
  assert.equal(quietWatch('SKIP: nothing new today.'), true);
  assert.equal(quietWatch(''), false);
  assert.equal(quietWatch(null), false);
  assert.equal(quietWatch('Nothing new, but SKIPpy the dog is fine.'), false);
  assert.equal(quietWatch('You mentioned Lisbon twice this week.'), false);
});

test('unknown kinds are still refused', () => {
  assert.throws(() => backgroundRoutine({ kind: 'digest', time: '04:30', days: [1] }), /Choose a check-in/);
});

test('a brief is scheduled like any other routine', () => {
  const at = new Date('2026-11-08T23:00:00Z').getTime();
  const next = nextRun({ time: '04:30', days: [0, 1, 2, 3, 4, 5, 6] }, 'UTC', at);
  assert.ok(next > at);
  assert.equal(localDay(next, 'UTC'), '2026-11-09');
});

test('a brief only runs on its chosen days', () => {
  // Sunday 2026-11-08 23:00 UTC; days lists Monday only, so the next run skips to the 9th.
  const at = Date.UTC(2026, 10, 8, 23, 0);
  const next = nextRun({ time: '04:30', days: [1] }, 'UTC', at);
  assert.equal(localDay(next, 'UTC'), '2026-11-09');
});
