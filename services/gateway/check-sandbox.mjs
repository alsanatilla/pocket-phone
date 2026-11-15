// Admin smoke check through the native gateway, not the retired in-process tool factory.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { sandboxAccount, sandboxAccounts } from './sandbox.mjs';
const cfg = JSON.parse(await readFile(join(process.env.PIP_GATEWAY_HOME || '/data/openclaw', 'openclaw.json'), 'utf8'));
process.env.PIP_GATEWAY_TOKEN = cfg.gateway.auth.token;
const { database } = await import('../../src/server/database.js');
const provisioned = sandboxAccounts();
const users = (await database().execute('SELECT id FROM pocket_user')).rows.map(row => String(row.id)).filter(id => provisioned.includes(sandboxAccount(id)));
assert.ok(users.length, 'No provisioned account');
const userId = users[0], account = sandboxAccount(userId), marker = '.native-check-' + randomUUID();
const { nativeReply, closeGateway } = await import('../../src/server/pip-openclaw.js');
async function run(code) {
  const id = randomUUID();
  const command = 'python3 -c ' + "'" + code.replaceAll("'", "'\\''") + "'";
  const turn = { uid: id, text: 'Administrator sandbox smoke check. Call exec exactly once with this command, then reply OK. Do not call Pocket tools or change memory.\n' + command };
  const reply = await nativeReply({ userId, chatUid: 'sandbox-check-' + id, runId: id, turn, chat: { turns: [turn] },
    signal: AbortSignal.timeout(120000), execute: () => { throw new Error('Pocket tools are not part of this check'); }, preview: () => ({ error: 'disabled' }), ask: async () => ({ approved: false }) });
  assert.ok(reply.activity.some(row => row.name === 'exec' && row.state === 'done' && /native-sandbox-ok/.test(row.result)), 'Native exec did not confirm the check: ' + reply.activity.map(row => row.name + ':' + row.state + ':' + row.result?.slice(0, 500)).join('\n'));
}
try {
  await run(`import os,pathlib,getpass; assert getpass.getuser()==${JSON.stringify(account)}; assert os.getcwd().startswith('/workspace/${account}/'); assert not any(os.getenv(k) for k in ['TURSO_AUTH_TOKEN','PIP_GATEWAY_KEY','PIP_SANDBOX_SSH_KEY','POCKET_ENCRYPTION_SECRET']); pathlib.Path(${JSON.stringify(marker)}).write_text('native-sandbox-ok'); print('native-sandbox-ok')`);
  await run(`import pathlib; p=pathlib.Path(${JSON.stringify(marker)}); assert p.read_text()=='native-sandbox-ok'; p.unlink(); print('native-sandbox-ok')`);
  console.log('PASS: native gateway exec, isolated Unix account, no Pocket credentials, cross-chat persistence.');
} finally { await closeGateway(); database().close(); }
