import test from 'node:test';
import assert from 'node:assert/strict';
import { patternDigest } from '../src/server/pip-patterns.js';

// The brief may quote numbers, so the numbers are computed here rather than guessed by a model. These tests pin the
// arithmetic and the shapes the workspace actually uses (tasks carry `text`/`done`/`due`/`updated`, workouts carry
// `started`, thoughts carry `created`).

const NOW = Date.parse('2026-11-08T06:00:00Z');
const DAY = 86400000;
const doc = value => ({ value });

test('an empty workspace says nothing at all', () => {
  assert.deepEqual(patternDigest({}, NOW), []);
});

test('open, overdue and recent completions are counted separately', () => {
  const tasks = [
    { uid: 'a', text: 'Pay rent', due: '2026-11-01', done: false, updated: NOW - 3 * DAY },
    { uid: 'b', text: 'Book flights', due: '', done: false, updated: NOW - DAY },
    { uid: 'c', text: 'Call Ana', due: '2026-11-20', done: false, updated: NOW },
    { uid: 'd', text: 'Old thing', due: '', done: true, updated: NOW - 90 * DAY },
    { uid: 'e', text: 'Done thing', due: '', done: true, updated: NOW - 2 * DAY }
  ];
  const lines = patternDigest({ 'tasks.json': doc({ tasks }) }, NOW);
  assert.equal(lines[0], 'Tasks: 3 open, 1 overdue, 1 completed in the last 28 days.');
  assert.match(lines[1], /Oldest overdue: "Pay rent"/);
});

test('a due date today is not overdue', () => {
  const tasks = [{ uid: 'a', text: 'Today', due: '2026-11-08', done: false, updated: NOW }];
  assert.equal(patternDigest({ 'tasks.json': doc({ tasks }) }, NOW)[0], 'Tasks: 1 open, 0 overdue, 0 completed in the last 28 days.');
});

test('notes count only what is still kept', () => {
  const notes = [{ uid: '1', text: 'a', updated: NOW - DAY }, { uid: '2', text: 'b', updated: NOW - 400 * DAY }, { uid: '3', text: 'gone', deleted: true, updated: NOW }];
  assert.equal(patternDigest({ 'notes.json': doc({ notes }) }, NOW)[0], 'Notes: 2 kept, 1 touched in the last 28 days.');
});

test('the oldest parked thought is dated', () => {
  const items = [{ uid: '1', created: NOW - 12 * DAY }, { uid: '2', created: NOW - 2 * DAY }, { uid: '3', done: true, created: NOW - 30 * DAY }];
  assert.equal(patternDigest({ 'parking.json': doc({ items }) }, NOW)[0], 'Thoughts: 2 parked, the oldest 12 days old.');
});

test('gym sessions are counted in the last 28 days', () => {
  const workouts = [{ started: NOW - DAY }, { started: NOW - 20 * DAY }, { started: NOW - 60 * DAY }];
  assert.equal(patternDigest({ 'gym.json': doc({ workouts }) }, NOW)[0], 'Gym: 2 sessions in the last 28 days, last on 2026-11-07.');
});

test('a collection with the wrong shape is ignored, not crashed on', () => {
  const lines = patternDigest({ 'tasks.json': doc({ tasks: 'nope' }), 'gym.json': doc({}) }, NOW);
  assert.deepEqual(lines, []);
});
