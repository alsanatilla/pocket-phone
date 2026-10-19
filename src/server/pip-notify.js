import { execute as sql } from './database.js';
import { push, vapidKeys } from './web-push.js';

// Pip tells a device when something it is not watching needs the user: a server reply finished or failed, a reply
// waits for an approval, or a scheduled routine wrote in its chat. Each browser subscribes for its signed-in
// account; a reply a tab is following is left to that tab, which shows its own notice while it is hidden.
const DEVICES = 10, WATCH = 12000, REFRESH = 4000;
/** The push services browsers use. The server only ever posts to these, never to an address a client made up. */
const SERVICES = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];
const no = message => Object.assign(new Error(message), { status: 400 });
const parse = raw => { try { return JSON.parse(String(raw)); } catch { return null; } };
const key = value => typeof value === 'string' && /^[A-Za-z0-9_-]+={0,2}$/.test(value) && value.length <= 200;

export const publicKey = () => vapidKeys().publicKey;

/** A browser's PushSubscription.toJSON(), checked: a known push service over HTTPS and well-formed keys. */
export function subscription(value) {
  let url;
  try { url = new URL(String(value?.endpoint || '')); } catch { throw no('This browser gave an unusable notification address.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 1000 || !SERVICES.some(pattern => pattern.test(url.hostname)))
    throw no('This browser’s notification service is not supported.');
  if (!key(value?.keys?.p256dh) || !key(value?.keys?.auth)) throw no('This browser gave unusable notification keys.');
  return { endpoint: url.href, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
}

/** Saves this browser for the account. An address another account used moves here; the oldest beyond ten goes. */
export async function subscribe(userId, value, device = '', now = Date.now()) {
  const item = subscription(value);
  await sql({ sql: `INSERT INTO pocket_push_subscriptions (endpoint, user_id, keys, device, created, updated) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, keys = excluded.keys, device = excluded.device, updated = excluded.updated`,
    args: [item.endpoint, userId, JSON.stringify(item.keys), String(device).slice(0, 80), now, now] });
  await sql({ sql: `DELETE FROM pocket_push_subscriptions WHERE user_id = ? AND endpoint NOT IN
    (SELECT endpoint FROM pocket_push_subscriptions WHERE user_id = ? ORDER BY updated DESC LIMIT ${DEVICES})`, args: [userId, userId] });
  return devices(userId);
}
export async function unsubscribe(userId, endpoint) {
  await sql({ sql: 'DELETE FROM pocket_push_subscriptions WHERE user_id = ? AND endpoint = ?', args: [userId, String(endpoint || '')] });
  return devices(userId);
}
/** The browser replaced its subscription on its own; the new one keeps the old one's account. */
export async function renew(userId, old, value) {
  const item = subscription(value);
  const moved = (await sql({ sql: 'UPDATE pocket_push_subscriptions SET endpoint = ?, keys = ?, updated = ? WHERE user_id = ? AND endpoint = ? RETURNING endpoint',
    args: [item.endpoint, JSON.stringify(item.keys), Date.now(), userId, String(old || '')] })).rows[0];
  return Boolean(moved);
}
export const devices = async userId => Number((await sql({ sql: 'SELECT COUNT(*) AS n FROM pocket_push_subscriptions WHERE user_id = ?', args: [userId] })).rows[0].n);
/** Whether this browser's subscription is the account's: a browser last used by another account is not. */
export const subscribed = async (userId, endpoint) =>
  Boolean(endpoint && (await sql({ sql: 'SELECT 1 FROM pocket_push_subscriptions WHERE user_id = ? AND endpoint = ?', args: [userId, String(endpoint)] })).rows[0]);

/**
 * A follower keeps this mark fresh while it reads a run, so what it already shows is not pushed as well. The write
 * is skipped while the mark has more than REFRESH ms left; a follower that disconnects clears it.
 */
export function watching(userId, runId, now = Date.now()) {
  return sql({ sql: `INSERT INTO pocket_pip_watch (user_id, run_id, until) VALUES (?, ?, ?)
    ON CONFLICT(user_id, run_id) DO UPDATE SET until = excluded.until WHERE pocket_pip_watch.until < excluded.until - ?`, args: [userId, runId, now + WATCH, WATCH - REFRESH] });
}
export const unwatch = (userId, runId) => sql({ sql: 'UPDATE pocket_pip_watch SET until = 0 WHERE user_id = ? AND run_id = ?', args: [userId, runId] });
export const watched = async (userId, runId, now = Date.now()) =>
  Number((await sql({ sql: 'SELECT until FROM pocket_pip_watch WHERE user_id = ? AND run_id = ?', args: [userId, runId] })).rows[0]?.until || 0) > now;
export const forgetWatches = (before = Date.now() - 3600000) => sql({ sql: 'DELETE FROM pocket_pip_watch WHERE until < ?', args: [before] });

/**
 * Sends a notice to every browser of the account, or only to `endpoint`. Never throws: a notice is not part of the
 * reply it is about. A subscription the push service reports gone is forgotten.
 */
export async function notify(userId, notice, { endpoint = '', fetcher } = {}) {
  const result = { sent: 0, gone: 0, failed: 0 };
  if (!notice) return result;
  try {
    const rows = (await sql({ sql: `SELECT endpoint, keys FROM pocket_push_subscriptions WHERE user_id = ?${endpoint ? ' AND endpoint = ?' : ''}`, args: endpoint ? [userId, endpoint] : [userId] })).rows;
    const message = { title: String(notice.title || 'Pip').slice(0, 80), body: String(notice.body || '').slice(0, 200), href: String(notice.href || '/pip'), tag: String(notice.tag || 'pip') };
    const outcomes = await Promise.all(rows.map(row => push({ endpoint: String(row.endpoint), keys: parse(row.keys) }, message, { fetcher, topic: message.tag, ttl: notice.ttl })));
    for (const [index, outcome] of outcomes.entries()) {
      result[outcome]++;
      if (outcome === 'gone') await sql({ sql: 'DELETE FROM pocket_push_subscriptions WHERE user_id = ? AND endpoint = ?', args: [userId, String(rows[index].endpoint)] });
    }
  } catch { result.failed++; }
  return result;
}
