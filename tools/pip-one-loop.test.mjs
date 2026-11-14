import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The new app runs every Pip reply on the server (docs/pip-agent-runtime.md). A key it moves from a tab to the account
// must be stored sealed and be what the server then runs the chat with; the refusals it explains must be the server's.
const folder = mkdtempSync(join(tmpdir(), 'pocket-pip-one-loop-'));
process.env.TURSO_DATABASE_URL = 'file:' + join(folder, 'pocket.db').replaceAll('\\', '/');
process.env.TURSO_AUTH_TOKEN = 'fixture-token'; process.env.POCKET_ENCRYPTION_SECRET = 'fixture-secret';
const { ensureSchema, execute, database } = await import('../src/server/database.js');
const { saveKey, readKey } = await import('../src/server/pip-keys.js');
const runs = await import('../src/server/pip-runs.js');
const refusals = await import('../src/shared/pip-refusals.js');
await ensureSchema();
test.after(() => { database().close(); try { rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch {} });

const CONFIG = { provider: 'anthropic', model: 'claude-sonnet-5-5', baseUrl: 'https://api.anthropic.com/v1', maxTokens: 4096, thinking: false, webSearch: false };
const KEY = 'sk-ant-fixture-key-0123456789abcdef';

test('a key moved from a tab is stored sealed on the account, and the server then runs the chat with it', async () => {
  const now = Date.now();
  await execute({ sql: 'INSERT INTO pocket_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', args: ['user-move', 'Fixture', 'move@example.com', now, now] });
  // Before: the server has no key for the chat's endpoint, and a submit is refused with the shared sentence.
  assert.equal((await runs.serverRunState('user-move', 'chat-move', CONFIG)).available, false);
  await assert.rejects(runs.submitRun('user-move', { requestId: 'req-move', text: 'Hello', chat: { uid: 'chat-move', title: 'Pip', created: now, config: CONFIG } }),
    error => error.message === refusals.NOT_SET_UP && error.status === 409);
  // What POST /api/pip/keys does with the key the new app sends after the person said yes.
  await saveKey('user-move', { provider: 'anthropic', baseUrl: CONFIG.baseUrl, key: KEY });
  const row = (await execute({ sql: 'SELECT sealed, hint FROM pocket_pip_keys WHERE user_id = ?', args: ['user-move'] })).rows[0];
  assert.ok(row, 'the key is on the account');
  assert.equal(String(row.sealed).includes(KEY), false, 'never stored in the clear');
  assert.equal(String(row.sealed).includes(KEY.slice(7, 20)), false);
  assert.equal(String(row.hint), KEY.slice(-4));
  assert.equal(await readKey('user-move', CONFIG), KEY);
  // After: the same chat may run on the server, so a paused run can resume in a later request from the vault.
  assert.equal((await runs.serverRunState('user-move', 'chat-move', CONFIG)).available, true);
});

test('the server refuses with the sentences the new app explains', () => {
  const source = readFileSync(new URL('../src/server/pip-runs.js', import.meta.url), 'utf8');
  assert.match(source, /import \{ NOT_SET_UP, NO_TOKENS \} from '\.\.\/shared\/pip-refusals\.js';/);
  assert.equal(/const NOT_SET_UP\s*=|NO_TOKENS\s*=\s*'/.test(source), false, 'one copy of each sentence');
});

test('only the classic app reaches the browser reply loop', () => {
  const classic = readFileSync(new URL('../src/client/pip.js', import.meta.url), 'utf8');
  const core = readFileSync(new URL('../src/client/pip-core.js', import.meta.url), 'utf8');
  assert.match(classic, /import \{ streamReply \} from "\.\/pip-local\.js";/);
  assert.equal(/pip-stream\.js|pip-local\.js/.test(core.replace(/\/\/.*$/gm, '')), false, 'pip-core.js, which the new app imports, does not load the loop');
});
