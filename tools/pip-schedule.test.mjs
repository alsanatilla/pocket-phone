import test from 'node:test';
import assert from 'node:assert/strict';
import { dayList, lastRunLine, routineCaption, routineProblems, routineWhen, scheduleSummary, sortRoutines, statusText } from '../src/client/pip-routine-model.js';

// The scheduled-runs screen: what it calls out, how it orders routines and what it says about a run.
const routine = (over = {}) => ({ id: 'r1', kind: 'prompt', title: 'Car watch', time: '07:30', days: [1, 2, 3, 4, 5], enabled: true, nextRun: Date.now() + 3600000, lastRun: 0, lastStatus: '', lastError: '', ...over });
const state = (routines, over = {}) => ({ routines, hasKey: true, settings: { enabled: true, dailyTokens: 200000 }, usedToday: 0, ...over });

test('a failed run, an overdue routine and missing setup are called out; a healthy one is not', () => {
  const now = Date.parse('2026-10-16T09:00:00Z');
  assert.deepEqual(routineProblems(state([routine({ nextRun: now + 3600000 })]), now), []);
  assert.deepEqual(routineProblems(state([routine({ enabled: false, nextRun: now - 8 * 3600000 })]), now), [], 'a paused routine is not overdue');
  assert.equal(routineProblems(state([routine({ lastStatus: 'failed', lastError: 'The provider stopped responding.' })]), now)[0].text, 'The provider stopped responding.');
  assert.match(routineProblems(state([routine({ lastStatus: 'failed' })]), now)[0].text, /last run failed/);
  const late = routineProblems(state([routine({ nextRun: now - 3 * 3600000 })]), now)[0];
  assert.match(late.text, /has not run since/); assert.equal(late.routine, 'Car watch');
  assert.match(routineProblems(state([routine()], { hasKey: false }), now)[0].text, /No dedicated key/);
  assert.match(routineProblems(state([routine()], { settings: { enabled: false } }), now)[0].text, /switched off/);
  assert.deepEqual(routineProblems(state([routine({ enabled: false })], { hasKey: false }), now), [], 'a paused routine is not waiting for a key');
});

test('the list puts live routines first, soonest first, and paused ones last', () => {
  const now = Date.now();
  const sorted = sortRoutines([routine({ id: 'c', title: 'C', nextRun: now + 9e6 }), routine({ id: 'b', title: 'B', nextRun: now + 9e5 }), routine({ id: 'p', title: 'Paused', enabled: false }), routine({ id: 'z', title: 'Not scheduled', nextRun: 0 })]);
  assert.deepEqual(sorted.map(item => item.id), ['b', 'c', 'z', 'p']);
});

test('a routine says when it runs, when it runs next and how its last run ended', () => {
  const now = Date.now();
  assert.match(routineCaption(routine({ nextRun: now + 3600000 })), /^07:30 · weekdays · next /);
  assert.equal(routineCaption(routine({ enabled: false, nextRun: 0 })), '07:30 · weekdays · paused');
  assert.match(routineCaption(routine({ nextRun: now - 3 * 3600000 })), /^07:30 · weekdays · due since /);
  assert.match(routineCaption(routine({ kind: 'training', days: [0, 1, 2, 3, 4, 5, 6] })), /^after workouts · daily check 07:30 · every day · next data check /);
  assert.equal(dayList([1, 2, 3, 4, 5, 6, 0]), 'every day'); assert.equal(dayList([1, 3, 5]), 'mon wed fri');
  assert.equal(lastRunLine(routine()), 'never run');
  assert.equal(lastRunLine(routine({ lastRun: now, lastStatus: 'done' })), 'last ' + routineWhen(now));
  assert.match(lastRunLine(routine({ lastRun: now, lastStatus: 'limit' })), /token limit reached$/);
  assert.equal(statusText('off'), 'did not run'); assert.equal(statusText('answered'), 'answered');
});

test('the summary names the day\'s spend, the routine count and the next run', () => {
  const now = Date.now();
  const summary = scheduleSummary({ routines: [routine({ nextRun: now + 3600000 })], hasKey: true, usedToday: 12345, settings: { dailyTokens: 200000, enabled: true } }, now);
  assert.equal(summary, ['today · ' + (12345).toLocaleString() + ' of ' + (200000).toLocaleString() + ' tokens', '1 routine', 'next · ' + routineWhen(now + 3600000) + ' Car watch'].join(' · '));
  assert.equal(scheduleSummary({ routines: [routine({ nextRun: now - 3 * 3600000 })], hasKey: true, usedToday: 0, settings: { enabled: true } }, now), 'today · 0 tokens · 1 routine · 1 waiting to run');
  assert.match(scheduleSummary({ routines: [], hasKey: true, usedToday: 0, settings: { enabled: true } }, now), /^today · 0 tokens · 0 routines$/);
  assert.match(scheduleSummary({ routines: [routine({ enabled: false })], hasKey: false, usedToday: 0, settings: { enabled: false } }, now), /^no dedicated key · 1 routine · routines switched off$/);
});
