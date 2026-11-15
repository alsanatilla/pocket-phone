// Administrator smoke check. Run from the deployed Pocket image; prints no credentials or account IDs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database } from '../../src/server/database.js';
import { sandboxAccount, sandboxTools } from '../../src/server/pip-sandbox.js';
const enabled = (process.env.PIP_SANDBOX_ACCOUNTS || '').split(',');
const users = (await database().execute('SELECT id FROM pocket_user')).rows.map(r => String(r.id)).filter(id => enabled.includes(sandboxAccount(id)));
database().close();
assert.ok(users.length, 'No provisioned sandbox account');
const marker = '.pocket-check-' + randomUUID();
const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 180000);
const tools = await sandboxTools(users[0], { signal: controller.signal, sessionKey: 'sandbox-check' });
const invoke = async (name, args, surface = tools) => {
  const tool = surface.find(t => t.name === name); assert.ok(tool, name + ' unavailable');
  const result = await tool.execute(randomUUID(), args, controller.signal);
  assert.ok(!result.isError && !['error', 'failed'].includes(result.details?.status), name + ' failed');
  if (result.details?.exitCode !== undefined) assert.equal(result.details.exitCode, 0, name + ' exited unsuccessfully');
  return result.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
};
try {
  assert.match(await invoke('exec', { command: 'python3 -c "print(6*7)"', host: 'gateway' }), /42/);
  await invoke('write', { path: marker, content: 'forty-two\n' });
  await invoke('edit', { path: marker, edits: [{ oldText: 'forty-two', newText: '42' }] });
  assert.match(await invoke('read', { path: marker }), /42/);
  await invoke('apply_patch', { input: '*** Begin Patch\n*** Update File: ' + marker + '\n@@\n-42\n+43\n*** End Patch' });
  const second = await sandboxTools(users[0], { signal: controller.signal, sessionKey: 'another-chat' });
  assert.match(await invoke('read', { path: marker }, second), /43/);
  await assert.rejects(invoke('read', { path: '/etc/shadow' }));
  await invoke('exec', { command: "test -z \"$(env | cut -d= -f1 | grep -E 'TURSO|SECRET|API_KEY|PIP_SANDBOX' || true)\" && curl -fsS --max-time 15 https://example.com >/dev/null && echo network-and-env-ok" });
  if (users.length > 1) {
    const other = '/workspace/' + sandboxAccount(users[1]);
    await invoke('exec', { command: 'test ! -r ' + other + ' && test ! -x ' + other + ' && echo account-isolation-ok' });
  }
  console.log('PASS: native exec/read/write/edit/apply_patch, cross-chat persistence, account isolation, path confinement, credential-free environment and outbound HTTPS');
} finally {
  await invoke('exec', { command: 'rm -f -- ' + marker }).catch(() => {});
  clearTimeout(timer);
}
