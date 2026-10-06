import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { database, execute } from './database.js';
import { seal, open } from './secrets.js';
import { parseRecords, parseRecovery, parseFitness, parseLoad, parseDaily, parseSleep, parseHrv, parseResting, parseDevice, parseProfile, unwrap } from '../client/coros-data.js';

const DISCOVERY = 'https://mcp.coros.com/.well-known/openid-configuration';
const SCOPE = 'openid offline_access mcp.tools', INTERVAL = 15 * 60000;
const b64 = bytes => bytes.toString('base64url');
const fault = (message, status = 502) => Object.assign(new Error(message), { status });
export function endpoint(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname === 'coros.com' || url.hostname.endsWith('.coros.com'))) throw fault('Invalid COROS service address.', 400);
  return url.href.replace(/\/$/, '');
}
async function remote(url, options = {}) {
  return fetch(endpoint(url), { redirect: 'manual', signal: AbortSignal.timeout(8000), ...options });
}
async function jsonPost(url, value) {
  const response = await remote(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  if (!response.ok) throw fault('COROS could not complete this request.');
  return response.json();
}
async function row(userId) { return (await execute({ sql: 'SELECT * FROM pocket_coros WHERE user_id = ?', args: [userId] })).rows[0]; }
export async function corosState(userId) {
  const saved = await row(userId);
  return { connected: Boolean(saved?.credentials) && !saved.needs_auth, needsAuth: Boolean(saved?.needs_auth), pending: Boolean(saved?.pending),
    updated: Number(saved?.last_success || 0), attempted: Number(saved?.last_attempt || 0), next: Number(saved?.next_attempt || 0),
    refreshing: Boolean(saved?.lock_owner && Number(saved.lock_until) > Date.now()), error: saved?.error || '', data: saved?.snapshot ? JSON.parse(String(saved.snapshot)) : null };
}
function timezone(value) { if (typeof value !== 'string' || !value) return 'UTC'; try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return value; } catch { return 'UTC'; } }
async function register(redirect) {
  const response = await remote(DISCOVERY); if (!response.ok) throw fault('COROS could not be reached.');
  const meta = await response.json();
  const issuer = endpoint(meta.issuer), token = endpoint(meta.token_endpoint), authorize = endpoint(meta.authorization_endpoint);
  const registration = await jsonPost(meta.registration_endpoint, { client_name: 'pocket', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: SCOPE, token_endpoint_auth_method: 'none' });
  if (!registration.client_id) throw fault('COROS did not accept Pocket.');
  return { issuer, token, authorize, client: registration.client_id };
}
async function savePending(userId, pending) {
  await execute({ sql: 'INSERT INTO pocket_coros (user_id, pending, generation) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET pending = excluded.pending RETURNING user_id', args: [userId, seal(userId, pending), randomUUID()] });
}
export async function beginCoros(userId, origin, zone, native = false) {
  const redirect = native ? 'http://127.0.0.1:43123/callback' : origin + '/api/coros/callback';
  const meta = await register(redirect), verifier = b64(randomBytes(32)), state = b64(randomBytes(24));
  const pending = { ...meta, redirect, verifier, state, zone: timezone(zone), expires: Date.now() + 10 * 60000, native };
  const authorization = meta.authorize + '?' + new URLSearchParams({ response_type: 'code', client_id: meta.client, redirect_uri: redirect, scope: SCOPE, code_challenge: b64(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', resource: meta.issuer + '/mcp', state });
  if (native) {
    const login = await jsonPost(meta.issuer + '/api/v1/cli/login-sessions', { clientId: meta.client });
    pending.session = login.sessionId; pending.poll = login.pollToken; pending.authorization = authorization;
    await savePending(userId, pending);
    return { url: endpoint(login.loginUrl), expires: pending.expires };
  }
  await savePending(userId, pending); return { url: authorization, expires: pending.expires };
}
async function redeem(userId, pending, code, encryptedPending) {
  const response = await remote(pending.token, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', client_id: pending.client, redirect_uri: pending.redirect, code_verifier: pending.verifier, code }) });
  if (!response.ok) throw fault('COROS sign-in did not finish. Try again.');
  const answer = await response.json();
  if (!answer.access_token || !answer.refresh_token) throw fault('COROS did not grant continuing access.');
  const credentials = { issuer: pending.issuer, token: pending.token, client: pending.client, access: answer.access_token, refresh: answer.refresh_token, zone: pending.zone, expires: Date.now() + Number(answer.expires_in || 3600) * 1000 };
  const result = await execute({ sql: "UPDATE pocket_coros SET credentials = ?, pending = NULL, generation = ?, needs_auth = 0, error = '', next_attempt = 0, lock_owner = NULL, lock_until = 0 WHERE user_id = ? AND pending = ? RETURNING user_id", args: [seal(userId, credentials), randomUUID(), userId, encryptedPending] });
  if (!result.rows.length) throw fault('COROS connection changed. Try again.', 409);
}
export async function finishCoros(userId, state, code) {
  const saved = await row(userId), pending = saved?.pending && open(userId, saved.pending);
  if (!pending || pending.native || pending.state !== state || Date.now() > pending.expires || !code) throw fault('COROS sign-in did not match Pocket.', 400);
  await redeem(userId, pending, code, saved.pending); return corosState(userId);
}
export async function claimCoros(userId) {
  const saved = await row(userId), pending = saved?.pending && open(userId, saved.pending);
  if (!pending?.native) return { complete: Boolean(saved?.credentials) };
  if (Date.now() > pending.expires) throw fault('COROS sign-in timed out. Connect again.', 400);
  const response = await remote(pending.issuer + '/api/v1/cli/login-sessions/' + encodeURIComponent(pending.session) + '/claim', { method: 'POST', headers: { 'X-Poll-Token': pending.poll } });
  if (!response.ok) throw fault('COROS sign-in could not be checked.');
  const claim = await response.json(); if (claim.status === 'pending') return { complete: false };
  if (claim.status !== 'authorized') throw fault('COROS sign-in ended. Connect again.', 400);
  const authorization = await remote(pending.authorization + '&' + new URLSearchParams({ login_ticket: claim.loginTicket }));
  const callback = new URL(authorization.headers.get('location') || 'https://invalid');
  if (![302, 303].includes(authorization.status) || callback.origin + callback.pathname !== pending.redirect || callback.searchParams.get('state') !== pending.state) throw fault('COROS sign-in did not match Pocket.', 400);
  await redeem(userId, pending, callback.searchParams.get('code'), saved.pending); return { complete: true };
}
export async function importCoros(userId, value) {
  const credentials = value?.credentials;
  if (!credentials || !['access', 'refresh', 'client'].every(name => typeof credentials[name] === 'string' && credentials[name].length > 0 && credentials[name].length <= 16000) || !Number.isFinite(credentials.expires)) throw fault('Invalid COROS connection.', 400);
  const clean = { issuer: endpoint(credentials.issuer), token: endpoint(credentials.token), client: credentials.client, access: credentials.access, refresh: credentials.refresh, expires: credentials.expires, zone: timezone(value.zone) };
  // Never replace another device's established connection during automatic migration.
  const data = value.data && { updated: Number(value.data.updated || 0),
    ...(value.data.activities?.list && { activities: value.data.activities }), ...(value.data.cockpit && { cockpit: value.data.cockpit }),
    ...(value.data.native && { native: Object.fromEntries(['updated', 'activities', 'hrv', 'resting', 'daily', 'profile'].filter(name => value.data.native[name] !== undefined).map(name => [name, value.data.native[name]])) }) };
  if (data && (!Number.isSafeInteger(data.updated) || data.updated < 0)) throw fault('Invalid COROS cache.', 400);
  await execute({ sql: "INSERT INTO pocket_coros (user_id, credentials, generation, snapshot, last_success) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET credentials = excluded.credentials, generation = excluded.generation, needs_auth = 0, error = '', next_attempt = 0 WHERE pocket_coros.credentials IS NULL RETURNING user_id", args: [userId, seal(userId, clean), randomUUID(), data ? JSON.stringify(data) : null, data?.updated || 0] });
  return corosState(userId);
}
export async function disconnectCoros(userId) {
  // Disconnect stops polling and removes credentials; saved readings remain available.
  await execute({ sql: "UPDATE pocket_coros SET credentials = NULL, pending = NULL, generation = ?, needs_auth = 0, error = '', lock_owner = NULL, lock_until = 0 WHERE user_id = ? RETURNING user_id", args: [randomUUID(), userId] });
  return corosState(userId);
}
async function lease(userId, force) {
  const saved = await row(userId); if (!saved?.credentials || saved.needs_auth) return null;
  const now = Date.now(); if (!force && Number(saved.next_attempt) > now) return null;
  const credentials = open(userId, saved.credentials);
  const owner = randomUUID();
  const result = await execute({ sql: 'UPDATE pocket_coros SET lock_owner = ?, lock_until = ?, last_attempt = ? WHERE user_id = ? AND generation = ? AND lock_until <= ? RETURNING user_id', args: [owner, now + 240000, now, userId, saved.generation, now] });
  return result.rows.length ? { ...saved, owner, credentials, deadline: now + 180000 } : null;
}
class Reconnect extends Error { constructor() { super('Reconnect COROS. Saved readings are kept.'); } }
async function access(userId, locked, force = false) {
  const session = locked.credentials;
  if (!force && session.access && Date.now() < session.expires - 60000) return session.access;
  const response = await remote(session.token, { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', client_id: session.client, refresh_token: session.refresh }) });
  if ([400, 401].includes(response.status)) throw new Reconnect();
  if (!response.ok) throw fault('COROS could not be reached.');
  const value = await response.json(); if (!value.access_token) throw fault('COROS returned an incomplete session.');
  Object.assign(session, { access: value.access_token, refresh: value.refresh_token || session.refresh, expires: Date.now() + Number(value.expires_in || 3600) * 1000 });
  // Save a rotated refresh token before making any more requests, across server instances.
  const saved = await execute({ sql: 'UPDATE pocket_coros SET credentials = ? WHERE user_id = ? AND generation = ? AND lock_owner = ? RETURNING user_id', args: [seal(userId, session), userId, locked.generation, locked.owner] });
  if (!saved.rows.length) throw fault('COROS connection changed.', 409);
  return session.access;
}
function rpcClient(userId, locked) {
  let next = 0;
  const rpc = async (method, params, retry = true) => {
    if (Date.now() > locked.deadline) throw fault('COROS refresh timed out.');
    const token = await access(userId, locked, !retry);
    const response = await remote(locked.credentials.issuer + '/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++next, method, params }) });
    if (response.status === 401 && retry) return rpc(method, params, false);
    if (response.status === 401) throw new Reconnect();
    if (!response.ok) throw fault('COROS could not read the requested data.');
    const text = await response.text(), payload = JSON.parse((response.headers.get('content-type') || '').includes('text/event-stream') ? text.split(/\r?\n/).filter(line => line.startsWith('data:')).at(-1)?.slice(5) || '{}' : text || '{}');
    if (payload.error) throw fault('COROS could not read the requested data.');
    return payload.result;
  };
  let ready;
  return async (name, args) => {
    ready ??= rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pocket', version: '0.10.0' } }); await ready;
    const result = await rpc('tools/call', { name, arguments: args });
    if (result?.isError) throw fault('COROS could not read ' + name + '.');
    return unwrap((result?.content || []).filter(part => part.type === 'text').map(part => part.text).join('\n'));
  };
}
function dates(zone) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const end = date.replaceAll('-', ''), start = new Date(date + 'T12:00:00Z'); start.setUTCDate(start.getUTCDate() - 89);
  return { date, end, start: start.toISOString().slice(0, 10).replaceAll('-', '') };
}
export async function refreshCoros(userId, force = false) {
  const locked = await lease(userId, force); if (!locked) return corosState(userId);
  try {
    await access(userId, locked);
    const tool = rpcClient(userId, locked), period = dates(locked.credentials.zone || 'UTC'), raw = {}, failures = [];
    const asks = [
      ['activities', 'querySportRecords', { startDate: period.start, endDate: period.end, sportTypeCodes: null, minDistanceKm: null, maxDistanceKm: null, minDurationMinutes: null, maxDurationMinutes: null, maxAveragePace: null, locationKeyword: null, limit: 150 }],
      ['resting', 'queryRestingHeartRate', { days: 29 }], ['hrv', 'querySleepHrv', { startDate: null, endDate: null, days: 28 }], ['daily', 'queryDailyHealthData', { days: 28 }], ['profile', 'queryUserInfo', {}],
      ['recovery', 'queryRecoveryStatus', {}], ['fitness', 'queryFitnessAssessmentOverview', {}], ['load', 'queryTrainingLoadAssessment', { days: 28 }], ['sleep', 'querySleepOverview', { days: 28 }], ['device', 'queryDevices', {}],
    ];
    // Serial reads keep refresh-token rotation and COROS rate use predictable.
    for (const [name, method, args] of asks) {
      try { raw[name] = await tool(method, args); } catch (error) { if (error instanceof Reconnect) throw error; failures.push(name); }
    }
    if (['activities', 'resting', 'hrv', 'daily', 'profile'].some(name => !(name in raw))) throw fault('COROS refresh did not finish. Saved readings are kept.');
    const before = locked.snapshot ? JSON.parse(locked.snapshot) : {}, now = Date.now();
    const parsers = { resting: parseResting, hrv: parseHrv, daily: parseDaily, profile: parseProfile, recovery: parseRecovery, fitness: parseFitness, load: parseLoad, sleep: parseSleep, device: parseDevice };
    const cockpit = { ...before.cockpit, at: now, partAt: { ...before.cockpit?.partAt } };
    for (const [name, parser] of Object.entries(parsers)) if (raw[name] !== undefined) { cockpit[name] = parser(raw[name]); cockpit.partAt[name] = now; }
    const archive = new Map((before.activities?.list || []).map(item => [item.id, item]));
    for (const item of parseRecords(raw.activities)) archive.set(item.id, item);
    const nativeArchive = new Map();
    for (const text of [before.native?.activities || '', raw.activities]) for (const block of text.split(/\n(?=\d+\.\s)/)) {
      const id = block.match(/LabelId:\s*(\d+)/)?.[1]; if (id) nativeArchive.set(id, block);
    }
    const data = { updated: now, activities: { at: now, list: [...archive.values()].sort((a, b) => b.start - a.start) }, cockpit,
      native: { updated: now, ...Object.fromEntries(['activities', 'resting', 'hrv', 'daily', 'profile'].map(name => [name, name === 'activities' && nativeArchive.size ? [...nativeArchive.values()].join('\n') : raw[name]])) } };
    const tx = await database().transaction('write');
    try {
      const updated = await tx.execute({ sql: "UPDATE pocket_coros SET snapshot = ?, last_success = ?, next_attempt = ?, needs_auth = 0, error = ?, lock_owner = NULL, lock_until = 0 WHERE user_id = ? AND generation = ? AND lock_owner = ? RETURNING user_id", args: [JSON.stringify(data), now, now + INTERVAL, failures.length ? 'Some COROS readings could not refresh.' : '', userId, locked.generation, locked.owner] });
      if (updated.rows.length) await tx.execute({ sql: 'INSERT INTO pocket_coros_history (user_id, date, payload) VALUES (?, ?, ?) ON CONFLICT(user_id, date) DO UPDATE SET payload = excluded.payload RETURNING user_id', args: [userId, period.date, JSON.stringify(data)] });
      await tx.commit();
    } catch (error) { await tx.rollback().catch(() => {}); throw error; } finally { tx.close(); }
  } catch (error) {
    await execute({ sql: 'UPDATE pocket_coros SET needs_auth = ?, error = ?, next_attempt = ?, lock_owner = NULL, lock_until = 0 WHERE user_id = ? AND generation = ? AND lock_owner = ? RETURNING user_id', args: [error instanceof Reconnect ? 1 : 0, error instanceof Reconnect ? error.message : 'COROS refresh failed. Saved readings are kept.', Date.now() + (error instanceof Reconnect ? 24 * 3600000 : 15 * 60000), userId, locked.generation, locked.owner] });
  }
  return corosState(userId);
}
export async function corosDetail(userId, activityId, sport) {
  const kept = await execute({ sql: 'SELECT payload FROM pocket_coros_details WHERE user_id = ? AND activity_id = ?', args: [userId, activityId] });
  if (kept.rows[0]) return { cached: JSON.parse(String(kept.rows[0].payload)) };
  const locked = await lease(userId, true); if (!locked) throw fault('COROS is refreshing. Try this activity again shortly.', 409);
  try {
    const tool = rpcClient(userId, locked), args = { labelId: activityId, sportType: sport };
    const detail = await tool('getActivityDetail', args), laps = await tool('queryActivityLapData', args);
    let fitUrl = ''; try { fitUrl = (await tool('queryActivityFitFileDownloadUrls', args)).match(/https:\/\/[^\s"'<>]+\.fit[^\s"'<>]*/)?.[0] || ''; } catch { }
    return { detail, laps, fitUrl };
  } catch (error) {
    if (error instanceof Reconnect) await execute({ sql: 'UPDATE pocket_coros SET needs_auth = 1, error = ? WHERE user_id = ? AND generation = ? AND lock_owner = ? RETURNING user_id', args: [error.message, userId, locked.generation, locked.owner] });
    throw error;
  } finally { await execute({ sql: 'UPDATE pocket_coros SET lock_owner = NULL, lock_until = 0 WHERE user_id = ? AND generation = ? AND lock_owner = ? RETURNING user_id', args: [userId, locked.generation, locked.owner] }); }
}
export async function saveCorosDetail(userId, activityId, value) {
  if (!value || !Array.isArray(value.detail) || JSON.stringify(value).length > 1000000 || 'fitUrl' in value) throw fault('Invalid activity cache.', 400);
  await execute({ sql: 'INSERT INTO pocket_coros_details (user_id, activity_id, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, activity_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at RETURNING user_id', args: [userId, activityId, JSON.stringify(value), Date.now()] });
}
export async function runCorosJob() {
  const due = await execute({ sql: 'SELECT user_id FROM pocket_coros WHERE credentials IS NOT NULL AND needs_auth = 0 AND next_attempt <= ? ORDER BY last_success LIMIT 10', args: [Date.now()] });
  let refreshed = 0, checked = 0; const deadline = Date.now() + 230000;
  for (const owner of due.rows) {
    if (checked && Date.now() > deadline - 185000) break;
    const before = await corosState(owner.user_id), after = await refreshCoros(owner.user_id); checked++;
    if (after.updated > before.updated) refreshed++;
  }
  return { checked, refreshed, more: checked < due.rows.length || due.rows.length === 10 };
}
