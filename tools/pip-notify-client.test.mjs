import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';

// The browser half of Pip's notifications against a fake browser and a fake Pocket server.
class Memory {
  values = new Map();
  get length() { return this.values.size; }
  key(i) { return [...this.values.keys()][i] ?? null; }
  getItem(k) { return this.values.get(k) ?? null; }
  setItem(k, v) { this.values.set(k, String(v)); }
  removeItem(k) { this.values.delete(k); }
}
globalThis.localStorage = new Memory(); globalThis.sessionStorage = new Memory();
localStorage.setItem('pocket:active-account', 'u1');

const serverKey = () => { const ecdh = createECDH('prime256v1'); ecdh.generateKeys(); return ecdh.getPublicKey().toString('base64url'); };
const browser = { permission: 'default', answer: 'granted', subscription: null, shown: [], unsubscribed: 0 };
const server = { publicKey: serverKey(), devices: 0, endpoints: new Set(), posts: [] };
const subscription = key => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/' + Math.random().toString(36).slice(2), options: { applicationServerKey: key },
  toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'BPfixture', auth: 'fixture' } }; },
  async unsubscribe() { browser.unsubscribed++; browser.subscription = null; return true; } });
const registration = {
  pushManager: { getSubscription: async () => browser.subscription, subscribe: async options => (browser.subscription = subscription(options.applicationServerKey.buffer)) },
  showNotification: async (title, options) => { browser.shown.push({ title, ...options }); }
};
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Windows', serviceWorker: { getRegistration: async () => registration, ready: Promise.resolve(registration) } } });
globalThis.PushManager = function PushManager() {};
globalThis.Notification = { get permission() { return browser.permission; }, requestPermission: async () => (browser.permission = browser.answer) };
globalThis.document = { visibilityState: 'hidden' };
globalThis.fetch = async (url, options = {}) => {
  const path = String(url), body = options.body ? JSON.parse(options.body) : null;
  const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
  if (path === '/api/status') return json({ configured: true });
  if (path === '/api/auth/get-session') return json({ user: { id: 'u1' } });
  if (path.startsWith('/api/pip/push') && !body) { const endpoint = new URL(path, 'https://p.example').searchParams.get('endpoint'); return json({ accountId: 'u1', publicKey: server.publicKey, devices: server.devices, here: server.endpoints.has(endpoint) }); }
  if (path === '/api/pip/push') {
    server.posts.push(body);
    if (body.action === 'subscribe') { server.endpoints.add(body.subscription.endpoint); server.devices = server.endpoints.size; }
    if (body.action === 'unsubscribe') { server.endpoints.delete(body.endpoint); server.devices = server.endpoints.size; }
    return json({ accountId: 'u1', devices: server.devices, sent: body.action === 'test' ? 1 : 0 });
  }
  throw new Error('Unexpected request: ' + path);
};
const cloud = await import('../src/client/cloud.js');
await cloud.init();
const notifications = await import('../src/client/pip-notify.js');
const keyOf = sub => Buffer.from(sub.options.applicationServerKey).toString('base64url');

test('turning notifications on asks once, subscribes with the server’s key and registers this browser', async () => {
  assert.equal((await notifications.pushState()).state, 'off');
  await notifications.enablePush();
  assert.equal(browser.permission, 'granted');
  assert.equal(keyOf(browser.subscription), server.publicKey, 'the subscription is bound to Pocket’s VAPID key');
  const subscribe = server.posts.find(item => item.action === 'subscribe');
  assert.equal(subscribe.accountId, 'u1'); assert.equal(subscribe.device, 'Windows'); assert.equal(subscribe.subscription.endpoint, browser.subscription.endpoint);
  assert.deepEqual(await notifications.pushState(), { state: 'on', devices: 1 });
  await notifications.testPush();
  assert.equal(server.posts.at(-1).action, 'test'); assert.equal(server.posts.at(-1).endpoint, browser.subscription.endpoint);
});

test('a subscription made for an earlier server key is replaced', async () => {
  const before = browser.subscription;
  server.publicKey = serverKey();
  assert.equal((await notifications.pushState()).state, 'off', 'the old subscription cannot receive Pocket’s messages any more');
  await notifications.enablePush();
  assert.notEqual(browser.subscription, before); assert.equal(browser.unsubscribed, 1); assert.equal(keyOf(browser.subscription), server.publicKey);
});

test('a hidden tab shows its own notice; a visible one, or one turned off, does not', async () => {
  const notice = { title: 'Pip · Blue car', body: 'It costs 21,000 euros.', href: '/pip/c1', tag: 'pip-c1' };
  assert.equal(await notifications.notifyHere(notice), true);
  assert.deepEqual(browser.shown.at(-1), { title: 'Pip · Blue car', body: 'It costs 21,000 euros.', tag: 'pip-c1', renotify: true, data: { href: '/pip/c1' } });
  document.visibilityState = 'visible';
  assert.equal(await notifications.notifyHere(notice), false);
  document.visibilityState = 'hidden';
  await notifications.disablePush();
  assert.equal(browser.subscription, null); assert.equal(server.posts.at(-1).action, 'unsubscribe');
  assert.equal(await notifications.notifyHere(notice), false);
  assert.equal(browser.shown.length, 1);
});

test('a browser that blocks notifications says so instead of subscribing', async () => {
  browser.permission = 'default'; browser.answer = 'denied';
  await assert.rejects(() => notifications.enablePush(), /blocked/);
  assert.equal(browser.subscription, null);
  assert.equal((await notifications.pushState()).state, 'blocked');
});
