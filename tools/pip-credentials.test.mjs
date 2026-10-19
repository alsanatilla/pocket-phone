import test from 'node:test';
import assert from 'node:assert/strict';
import { setKey, apiKey, status, resolve, save, forget, reset } from '../src/client/pip-credentials.js';

class Memory {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const config = Object.freeze({ provider: 'compatible', model: 'deepseek/deepseek-v4.1-flash', baseUrl: 'https://openrouter.ai/api/v1', maxTokens: 4096, thinking: false, webSearch: false });
const guest = Object.freeze({ ...config, provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' });

function workspace(t, account = 'user-1') {
  const local = new Memory(), tab = new Memory();
  const previous = [globalThis.localStorage, globalThis.sessionStorage, globalThis.fetch];
  globalThis.localStorage = local; globalThis.sessionStorage = tab;
  if (account) local.setItem('pocket:active-account', account);
  t.after(() => {
    [globalThis.localStorage, globalThis.sessionStorage, globalThis.fetch] = previous;
    reset();
  });
  return { local, tab };
}

const answer = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('guests keep a tab key and call the provider directly', async t => {
  workspace(t, '');
  setKey(guest, 'sk-ant-guest-key-12345678901234567890');
  assert.deepEqual(await resolve(guest), { key: 'sk-ant-guest-key-12345678901234567890' });
  const state = await status(guest);
  assert.equal(state.mode, 'tab');
  assert.equal(state.saved, true);
});

test('a signed-in stored key is relayed and wins over an old tab copy', async t => {
  const { tab } = workspace(t);
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), method: options?.method || 'GET' });
    return answer({ saved: true, hint: '…wxyz' });
  };
  assert.deepEqual(await resolve(config), { relay: true });
  assert.match(calls[0].url, /^\/api\/pip\/keys\?provider=compatible/);
  setKey(config, 'sk-or-v1-old-tab-key');
  assert.equal(apiKey(config), 'sk-or-v1-old-tab-key');
  assert.deepEqual(await resolve(config), { relay: true });
});

test('saving to the account removes the tab copy, and forgetting clears the state', async t => {
  const { tab } = workspace(t);
  let mode = 'save';
  globalThis.fetch = async (url, options) => {
    if ((options?.method || 'GET') === 'DELETE') { mode = 'gone'; return answer({ removed: true }); }
    if (options?.method === 'POST') return answer({ saved: true, hint: '…1234' });
    return answer({ saved: mode !== 'gone', hint: mode === 'gone' ? '' : '…1234' });
  };
  setKey(config, 'sk-or-v1-old-tab-key');
  await save(config, 'sk-or-v1-new-account-key');
  assert.equal(apiKey(config), '');
  assert.equal((await status(config)).saved, true);

  await forget(config);
  assert.equal((await status(config)).saved, false);
});

test('an unreachable vault falls back to the tab key instead of blocking the reply', async t => {
  workspace(t);
  setKey(config, 'sk-or-v1-tab-key');
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  assert.equal((await status(config)).unreachable, true);
  assert.deepEqual(await resolve(config), { key: 'sk-or-v1-tab-key' });
});

test('a signed-in endpoint with no stored or tab key asks for one', async t => {
  workspace(t);
  globalThis.fetch = async () => answer({ saved: false });
  assert.equal(await resolve(config), null);
});
