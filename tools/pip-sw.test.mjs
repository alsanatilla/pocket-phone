import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Pocket's service worker in a sandbox: what a pushed message shows, and where tapping it goes.
const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
/** Objects made inside the sandbox belong to its realm; compare their plain values. */
const plain = value => JSON.parse(JSON.stringify(value));
function worker({ windows = [] } = {}) {
  const listeners = {}, shown = [], opened = [];
  const self = {
    location: { origin: 'https://pocket.example' },
    addEventListener: (type, listener) => { listeners[type] = listener; },
    registration: { showNotification: async (title, options) => { shown.push({ title, ...options }); }, pushManager: { subscribe: async options => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/new', options, toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/new', keys: { p256dh: 'p', auth: 'a' } }) }) } },
    clients: { matchAll: async () => windows, openWindow: async url => { opened.push(url); }, claim: async () => {} },
    skipWaiting: async () => {}
  };
  const fetched = [];
  vm.runInNewContext(source, { self, caches: {}, URL, fetch: async (url, options) => { fetched.push({ url, options }); return new Response('{}'); } });
  const fire = async (type, fields) => { let done; const event = { ...fields, waitUntil: promise => { done = promise; } }; listeners[type](event); await done; return event; };
  return { fire, shown, opened, fetched };
}

test('a pushed message shows its chat and keeps the link it was given', async () => {
  const sw = worker();
  await sw.fire('push', { data: { json: () => ({ title: 'Pip · Blue car', body: 'It costs 21,000 euros.', href: '/pip/c1', tag: 'pip-c1' }) } });
  assert.deepEqual(plain(sw.shown), [{ title: 'Pip · Blue car', body: 'It costs 21,000 euros.', tag: 'pip-c1', renotify: true, data: { href: '/pip/c1' } }]);
  // A link off Pocket is not followed, and an unreadable message still shows.
  await sw.fire('push', { data: { json: () => ({ title: 'Pip', href: 'https://evil.example/' }) } });
  await sw.fire('push', { data: { json: () => { throw new SyntaxError('cut'); } } });
  assert.deepEqual(sw.shown.slice(1).map(item => [item.title, item.data.href]), [['Pip', '/pip'], ['Pip', '/pip']]);
});

test('tapping a notice brings an open Pocket forward on its chat, or opens one', async () => {
  const focused = [], messages = [];
  const tab = { url: 'https://pocket.example/#/today', focus: async () => { focused.push(true); }, postMessage: message => messages.push(message) };
  const open = worker({ windows: [{ url: 'https://elsewhere.example/', focus: async () => {}, postMessage: () => { throw new Error('wrong window'); } }, tab] });
  let closed = 0;
  await open.fire('notificationclick', { notification: { close: () => { closed++; }, data: { href: '/pip/c1' } } });
  assert.equal(closed, 1); assert.equal(focused.length, 1); assert.deepEqual(plain(messages), [{ type: 'pocket-open', href: '/pip/c1' }]); assert.deepEqual(open.opened, []);
  const none = worker();
  await none.fire('notificationclick', { notification: { close: () => {}, data: { href: '/pip/c2' } } });
  assert.deepEqual(none.opened, ['/#/pip/c2']);
});

test('a subscription the browser replaced is renewed for the same account', async () => {
  const sw = worker();
  await sw.fire('pushsubscriptionchange', { oldSubscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/old', options: { userVisibleOnly: true } }, newSubscription: null });
  assert.equal(sw.fetched.length, 1);
  const { url, options } = sw.fetched[0], body = JSON.parse(options.body);
  assert.equal(url, '/api/pip/push'); assert.equal(options.method, 'POST'); assert.equal(options.credentials, 'same-origin');
  assert.equal(body.action, 'renew'); assert.equal(body.old, 'https://fcm.googleapis.com/fcm/send/old'); assert.equal(body.subscription.endpoint, 'https://fcm.googleapis.com/fcm/send/new');
});
