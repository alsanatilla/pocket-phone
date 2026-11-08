import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isMissedSession } from '../src/server/pip-training.js';

// A missed planned session used to stay open for ever while the planner added the next one: a fortnight of missed
// workouts became ten overdue copies, which is exactly what a nightly brief found in a real account. The predicate
// below decides what may be cleared, so these tests are about what it must refuse as much as what it accepts.

const hash = text => createHash('sha256').update(text).digest('hex').slice(0, 24);
const signature = task => hash(JSON.stringify([task.text, task.due, task.important, task.steps, task.source?.text]));
/** The shape the planner writes: a stable uid, a source token over its own content. */
const planned = (due, overrides = {}) => {
  const task = { uid: 'pip-training-' + hash('routine:' + due + ':gym'), created: 1, updated: 2, deleted: false, done: false,
    text: 'Gym · Core & Stability', due, important: false, steps: [{ text: '3×10', done: false }],
    source: { kind: 'shared', name: 'Pip training', text: 'Session why', token: '' }, ...overrides };
  task.source.token = task.uid + ':' + signature(task);
  return task;
};

const TODAY = '2026-11-08';

test('an untouched session from yesterday was missed', () => {
  assert.equal(isMissedSession(planned('2026-11-07'), TODAY), true);
});

test("today's session is still ahead of you", () => {
  assert.equal(isMissedSession(planned(TODAY), TODAY), false);
});

test('a future session is kept', () => {
  assert.equal(isMissedSession(planned('2026-11-10'), TODAY), false);
});

test('a completed session is kept', () => {
  assert.equal(isMissedSession(planned('2026-11-05', { done: true }), TODAY), false);
});

test('a session the person edited is left alone', () => {
  const task = planned('2026-11-05');
  task.text = 'Gym · Core & Stability (my own sets)';
  assert.equal(isMissedSession(task, TODAY), false);
});

test("someone else's task, or one without a due date, is never touched", () => {
  const mine = planned('2026-11-05');
  assert.equal(isMissedSession({ ...mine, uid: 'user-task-1' }, TODAY), false);
  assert.equal(isMissedSession({ ...mine, uid: 'user-task-1', source: { kind: 'user', name: 'Notes' } }, TODAY), false);
  assert.equal(isMissedSession({ ...mine, due: '' }, TODAY), false);
  assert.equal(isMissedSession({ ...mine, due: 'someday' }, TODAY), false);
});

test('an already deleted session is not cleared twice', () => {
  assert.equal(isMissedSession(planned('2026-11-05', { deleted: true }), TODAY), false);
});
