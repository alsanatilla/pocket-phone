import { storage as localStorage, tabStorage as sessionStorage } from './workspace-storage.js';
// COROS through its MCP server, straight from this page: OAuth with PKCE, then JSON-RPC tool calls.
// Tokens, activities and routes stay in this browser's storage, outside workspace sync.
import { parseRecords, parseFit, routePath, series, unwrap, pairs, parseLaps, parseRecovery, parseFitness, parseLoad, parseDaily, parseSleep, parseHrv, parseResting, parseDevice, parseProfile } from "./coros-data.js";

const DISCOVERY = "https://mcp.coros.com/.well-known/openid-configuration", SCOPE = "openid offline_access mcp.tools";
const SESSION = "pocket:coros", CLIENT = "pocket:coros-client", PENDING = "pocket:coros-login";
const ACTIVITIES = "pocket:coros-activities", COCKPIT = "pocket:coros-cockpit", DETAILS = "pocket:coros-details", DETAIL_LIMIT = 25;
const read = key => { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } };
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const redirect = () => location.origin + location.pathname;
const random = size => base64url(crypto.getRandomValues(new Uint8Array(size)));
function base64url(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
const ymd = date => `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;

export class Expired extends Error { constructor() { super("COROS sign-in expired. Connect again."); } }
export const connected = () => Boolean(read(SESSION)?.refresh);
export const cached = () => read(ACTIVITIES);
export const returning = () => { const query = new URLSearchParams(location.search); return query.has("state") && (query.has("code") || query.has("error")); };

async function post(url, body) {
  const json = !(body instanceof URLSearchParams);
  const response = await fetch(url, { method: "POST", body: json ? JSON.stringify(body) : body, headers: json ? { "Content-Type": "application/json" } : {} });
  const answer = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, answer };
}
/** COROS routes each account to a regional server; the global discovery document names it. */
async function discover() {
  const response = await fetch(DISCOVERY);
  if (!response.ok) throw new Error("COROS could not be reached.");
  return response.json();
}
/** One public client per page address, registered on first use (COROS allows dynamic registration). */
async function client(meta) {
  const known = read(CLIENT);
  if (known?.issuer === meta.issuer && known.redirect === redirect()) return known.id;
  const { ok, answer } = await post(meta.registration_endpoint, {
    client_name: "pocket", redirect_uris: [redirect()], grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"], scope: SCOPE, token_endpoint_auth_method: "none" });
  if (!ok || !answer.client_id) throw new Error("COROS did not accept this page as an app.");
  write(CLIENT, { issuer: meta.issuer, redirect: redirect(), id: answer.client_id });
  return answer.client_id;
}

/** Leaves for the COROS sign-in page; finish() completes it when the browser comes back here. */
export async function connect() {
  const meta = await discover(), id = await client(meta), verifier = random(48), state = random(24);
  const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  sessionStorage.setItem(PENDING, JSON.stringify({ verifier, state, id, issuer: meta.issuer, token: meta.token_endpoint, redirect: redirect() }));
  location.assign(meta.authorization_endpoint + "?" + new URLSearchParams({
    response_type: "code", client_id: id, redirect_uri: redirect(), scope: SCOPE,
    code_challenge: challenge, code_challenge_method: "S256", resource: meta.issuer + "/mcp", state }));
}
export async function finish() {
  const query = new URLSearchParams(location.search), pending = JSON.parse(sessionStorage.getItem(PENDING) || "null");
  sessionStorage.removeItem(PENDING);
  history.replaceState(null, "", location.pathname + "#/movement");
  if (query.get("error")) throw new Error("COROS sign-in was cancelled.");
  if (!pending || query.get("state") !== pending.state || !query.get("code")) throw new Error("COROS sign-in did not match this page. Try again.");
  const { ok, answer } = await post(pending.token, new URLSearchParams({
    grant_type: "authorization_code", client_id: pending.id, code: query.get("code"), redirect_uri: pending.redirect, code_verifier: pending.verifier }));
  if (!ok || !answer.access_token) throw new Error("COROS sign-in failed. Try again.");
  save(answer, { issuer: pending.issuer, token: pending.token, client: pending.id });
}
function save(answer, base) {
  write(SESSION, { ...base, access: answer.access_token, refresh: answer.refresh_token || base.refresh,
    expires: Date.now() + Number(answer.expires_in || 3600) * 1000 });
}
export function disconnect() {
  [SESSION, ACTIVITIES, COCKPIT, DETAILS, "pocket:coros-routes"].forEach(key => localStorage.removeItem(key));
  ready = null;
}

let refreshing = null;
/** A valid access token, refreshed once when it is about to run out. */
async function access(force = false) {
  const session = read(SESSION);
  if (!session?.refresh) throw new Expired();
  if (!force && Date.now() < session.expires - 60_000) return session.access;
  refreshing ??= (async () => {
    const { ok, status, answer } = await post(session.token, new URLSearchParams({ grant_type: "refresh_token", client_id: session.client, refresh_token: session.refresh }));
    if (status === 400 || status === 401) { disconnect(); throw new Expired(); }
    if (!ok || !answer.access_token) throw new Error("COROS could not be reached.");
    save(answer, session);
    return answer.access_token;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

let ready = null, next = 0;
async function rpc(method, params, retry = true) {
  const token = await access(!retry);
  const response = await fetch(read(SESSION).issuer + "/mcp", { method: "POST",
    headers: { Authorization: "Bearer " + token, Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++next, method, params }) });
  if (response.status === 401 && retry) return rpc(method, params, false);
  if (response.status === 401) { disconnect(); throw new Expired(); }
  if (!response.ok) throw new Error("COROS answered " + response.status + ".");
  const body = await response.text();
  // Streamable HTTP may answer as server-sent events; the reply is the last data line.
  const payload = JSON.parse((response.headers.get("content-type") || "").includes("text/event-stream")
    ? body.split(/\r?\n/).filter(line => line.startsWith("data:")).pop()?.slice(5) || "{}" : body || "{}");
  if (payload.error) throw new Error(payload.error.message || "COROS refused the request.");
  return payload.result;
}
async function tool(name, args) {
  ready ??= rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "pocket", version: "1.0.0" } })
    .catch(error => { ready = null; throw error; });
  await ready;
  const result = await rpc("tools/call", { name, arguments: args });
  const text = unwrap((result?.content || []).filter(part => part.type === "text").map(part => part.text).join("\n"));
  if (result?.isError) throw new Error(text || "COROS could not answer.");
  return text;
}

/** Activities from the last `days` days, newest first; also kept for the next visit. */
export async function activities(days = 90) {
  const end = new Date(), start = new Date(); start.setDate(start.getDate() - days + 1);
  const text = await tool("querySportRecords", { startDate: ymd(start), endDate: ymd(end), sportTypeCodes: null,
    minDistanceKm: null, maxDistanceKm: null, minDurationMinutes: null, maxDurationMinutes: null, maxAveragePace: null, locationKeyword: null, limit: 150 });
  const list = parseRecords(text);
  write(ACTIVITIES, { at: Date.now(), list });
  return list;
}
/** Readiness, sleep, HRV, load and fitness for the cockpit. A tool that fails keeps its last answer. */
export async function cockpit(days = 28) {
  const before = read(COCKPIT) || {};
  const asks = {
    recovery: () => tool("queryRecoveryStatus", {}).then(parseRecovery),
    fitness: () => tool("queryFitnessAssessmentOverview", {}).then(parseFitness),
    load: () => tool("queryTrainingLoadAssessment", { days }).then(parseLoad),
    daily: () => tool("queryDailyHealthData", { days }).then(parseDaily),
    sleep: () => tool("querySleepOverview", { days }).then(parseSleep),
    hrv: () => tool("querySleepHrv", { startDate: null, endDate: null, days }).then(parseHrv),
    resting: () => tool("queryRestingHeartRate", { days }).then(parseResting),
    device: () => tool("queryDevices", {}).then(parseDevice),
    profile: () => tool("queryUserInfo", {}).then(parseProfile),
  };
  const names = Object.keys(asks), answers = await Promise.allSettled(names.map(name => asks[name]()));
  const expired = answers.find(answer => answer.reason instanceof Expired);
  if (expired) throw expired.reason;
  const result = { ...before, at: Date.now() };
  answers.forEach((answer, i) => { if (answer.status === "fulfilled") result[names[i]] = answer.value; });
  if (answers.every(answer => answer.status === "rejected")) throw answers[0].reason;
  write(COCKPIT, result);
  return result;
}
export const cachedCockpit = () => read(COCKPIT);
/** Highest lap maximum heart rate among the activities opened so far. */
export const observedMaxHr = () => Math.max(0, ...Object.values(read(DETAILS) || {}).flatMap(d => d.laps?.laps.map(lap => lap.maxHr || 0) || []));

/**
 * Everything COROS knows about one activity: the detail list, laps, and from the FIT file the route,
 * climb and per-distance series. Kept for the most recent DETAIL_LIMIT activities.
 */
export async function activity(item) {
  const kept = read(DETAILS) || {};
  if (kept[item.id]) return kept[item.id];
  const args = { labelId: item.id, sportType: item.sport };
  const fit = async () => {
    const url = (await tool("queryActivityFitFileDownloadUrls", args)).match(/https:\/\/[^\s"'<>]+\.fit[^\s"'<>]*/)?.[0];
    if (!url) return null;
    const response = await fetch(url);
    if (!response.ok) throw new Error("The FIT file could not be downloaded.");
    return parseFit(await response.arrayBuffer());
  };
  const [detail, laps, file] = await Promise.allSettled([tool("getActivityDetail", args).then(pairs), tool("queryActivityLapData", args).then(parseLaps), fit()]);
  const failed = [detail, laps, file].find(answer => answer.status === "rejected");
  if (failed?.reason instanceof Expired || failed && [detail, laps, file].every(answer => answer.status === "rejected")) throw failed.reason;
  const data = file.value;
  const result = { detail: detail.value || [], laps: laps.value || null, path: data ? routePath(data.points) : null, climb: data?.ascent ?? null,
    series: data ? series(data.samples, { steps: item.sport < 200 || (item.sport >= 900 && item.sport < 1000) }) : null };
  // Only a complete answer is kept; a partial one is shown now and asked again next time.
  if (!failed) {
    const all = { ...read(DETAILS), [item.id]: result }, ids = Object.keys(all);
    ids.slice(0, Math.max(0, ids.length - DETAIL_LIMIT)).forEach(id => delete all[id]);
    try { write(DETAILS, all); } catch { localStorage.removeItem(DETAILS); } // storage full: start the cache over
  }
  return result;
}
