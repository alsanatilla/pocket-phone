import test from 'node:test';
import assert from 'node:assert/strict';
import { todayTiles, tileSize, preferences, applyDocument } from '../src/client/extras.js';
import { load, save, merge, dirty } from '../src/client/store.js';
import { switchAccount } from '../src/client/workspace-storage.js';
import { starters, modelName } from '../src/client/pip-presentation.js';

const copies = new Map();
globalThis.localStorage = {
  getItem: key => copies.get(key) ?? null,
  setItem: (key, value) => copies.set(key, String(value)),
  removeItem: key => copies.delete(key),
};
test.beforeEach(() => copies.clear());

test('phone tile sizes, labels and ordering survive a browser edit and a sync round trip', () => {
  const phone = { v: 1, items: [{ uid: 'today-tiles', updated: Date.now(), value: [
    { uid: 'tasks', kind: 'tasks', size: 'small', label: 'next' },
    { uid: 'notes', kind: 'notes', size: 'square' },
    { uid: 'movement', kind: 'movement', size: 'wide' },
  ] }] };
  save('preferences.json', merge['preferences.json'](load('preferences.json'), phone));
  applyDocument('preferences.json');
  const edited = todayTiles.list(); edited.push({ uid: 'clock', kind: 'clock', size: 'small' });
  todayTiles.save(edited);
  assert.ok(dirty().has('preferences.json'));
  const browser = load('preferences.json');
  save('preferences.json', merge['preferences.json'](phone, browser));
  assert.deepEqual(todayTiles.list(), edited);
  assert.equal(todayTiles.list()[0].label, 'next');
});

test('old layouts get native default sizes; an intentionally empty board stays empty', () => {
  assert.deepEqual(todayTiles.list().map(t => t.kind), ['movement', 'agenda', 'thoughts', 'tasks', 'activity']);
  todayTiles.save([{ kind: 'notes' }, { kind: 'tasks' }, { kind: 'dice' }]);
  assert.deepEqual(todayTiles.list().map(tileSize), ['wide', 'square', 'small']);
  todayTiles.save([]); assert.deepEqual(todayTiles.list(), []);
});

test('unknown and duplicate tiles are discarded without dropping valid sizes', () => {
  todayTiles.save([null, { kind: 'unknown' }, { kind: 'notes', size: 'small' }, { kind: 'notes', size: 'wide' }, { kind: 'clock', size: 'huge' }]);
  assert.deepEqual(todayTiles.list(), [{ uid: 'notes', kind: 'notes', size: 'small' }, { uid: 'clock', kind: 'clock' }]);
  assert.equal(tileSize(todayTiles.list()[1]), 'square');
});

test('tile preferences stay in the account that owns them', () => {
  switchAccount('a'); todayTiles.save([{ kind: 'gym', size: 'wide' }]);
  switchAccount('b'); assert.equal(preferences.get('today-tiles'), null); todayTiles.save([]);
  switchAccount('a'); assert.deepEqual(todayTiles.list(), [{ uid: 'gym', kind: 'gym', size: 'wide' }]);
  switchAccount('b'); assert.deepEqual(todayTiles.list(), []);
});

test('Pip starters reflect explicit source access and never include disabled sources', () => {
  assert.deepEqual(starters({ overdue: 9, thoughts: 4 }).map(x => x.label), ['think something through']);
  assert.deepEqual(starters({ enabled: ['tasks', 'thoughts', 'coros'], overdue: 9, thoughts: 4 }).map(x => x.label), ['what’s overdue?', 'plan my day', 'sort my thoughts']);
  assert.deepEqual(starters({ enabled: ['coros'] }).map(x => x.label), ['how’s my recovery?']);
  assert.equal(starters({ training: true }).length, 2);
});

test('Pip displays readable names while retaining full model versions', () => {
  assert.equal(modelName('openrouter/free'), 'Free router');
  assert.equal(modelName('anthropic/claude-sonnet-4-5-20250929'), 'Sonnet 4.5');
  assert.equal(modelName('google/gemini-2.5-pro'), 'Gemini 2.5 pro');
});
