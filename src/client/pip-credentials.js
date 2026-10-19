import { activeAccount, tabStorage as sessionStorage } from './workspace-storage.js';

// Signed-in keys live encrypted on the account and never return to this browser.
// Guests (and a vault that cannot be reached) keep the tab-only key.

export const keyName = value => value.provider === "anthropic" ? "pocket:claude-key" : "pocket:pip-key:" + value.baseUrl;
export const apiKey = (value, storage = sessionStorage) => storage.getItem(keyName(value)) || "";
export function setKey(value, key, storage = sessionStorage) {
  const text = String(key || "").trim();
  if (!/^[\x21-\x7e]{8,512}$/.test(text) || value.provider === "anthropic" && (!text.startsWith("sk-ant-") || text.length < 30)) throw new Error("Enter a valid API key for this provider.");
  storage.setItem(keyName(value), text);
}

const cache = new Map(), pending = new Map();
const id = value => [activeAccount(), value.provider, value.provider === 'anthropic' ? '' : String(value.baseUrl || '').trim()].join('|');
const tabSaved = value => Boolean(apiKey(value));

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
  let body = null;
  try { body = await response.json(); } catch { /* The status decides. */ }
  if (!response.ok) throw new Error(body?.error || 'Pocket could not reach the key vault.');
  return body || {};
}

/** Cached vault state for this endpoint: { mode: 'account'|'tab', saved, hint }. */
export function cached(value) { return cache.get(id(value)) || null; }

export async function status(value) {
  if (!activeAccount()) return { mode: 'tab', saved: tabSaved(value), hint: '' };
  if (value.provider === 'compatible' && !String(value.baseUrl || '').trim()) return { mode: 'account', saved: false, hint: '' };
  const key = id(value);
  if (cache.has(key)) return cache.get(key);
  if (pending.has(key)) return pending.get(key);
  const run = (async () => {
    try {
      const answer = await request('/api/pip/keys?provider=' + encodeURIComponent(value.provider) + '&baseUrl=' + encodeURIComponent(value.baseUrl || ''));
      const result = { mode: 'account', saved: Boolean(answer.saved), hint: answer.hint || '' };
      cache.set(key, result);
      return result;
    } catch {
      // Offline or signed out mid-session: a tab key can still complete the reply.
      return { mode: 'account', saved: false, hint: '', unreachable: true, tab: tabSaved(value) };
    } finally { pending.delete(key); }
  })();
  pending.set(key, run);
  return run;
}

/** What a reply needs: an account-relayed request, a tab key, or nothing. */
export async function resolve(value) {
  if (!activeAccount()) {
    const key = apiKey(value);
    return key ? { key } : null;
  }
  if ((await status(value)).saved) return { relay: true };
  const key = apiKey(value);
  return key ? { key } : null;
}

export async function save(value, key) {
  const text = String(key || '').trim();
  if (!activeAccount()) { setKey(value, text); cache.delete(id(value)); return { mode: 'tab' }; }
  const answer = await request('/api/pip/keys', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: value.provider, baseUrl: value.baseUrl, key: text }),
  });
  cache.set(id(value), { mode: 'account', saved: true, hint: answer.hint || '' });
  // The key now lives on the account, so the tab copy is removed rather than left behind.
  sessionStorage.removeItem(keyName(value));
  return { mode: 'account', hint: answer.hint || '' };
}

export async function forget(value) {
  if (!activeAccount()) {
    sessionStorage.removeItem(keyName(value));
    cache.delete(id(value));
    return { mode: 'tab' };
  }
  await request('/api/pip/keys?provider=' + encodeURIComponent(value.provider) + '&baseUrl=' + encodeURIComponent(value.baseUrl || ''), { method: 'DELETE' });
  cache.delete(id(value));
  return { mode: 'account' };
}

export function reset() { cache.clear(); pending.clear(); }
