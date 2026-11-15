import test from 'node:test';
import assert from 'node:assert/strict';
import { sandboxAccount, sandboxTools, normalizeSshKey } from '../src/server/pip-sandbox.js';

test('account workspace identities are stable, opaque Unix usernames', () => {
  assert.match(sandboxAccount('user/../../x'), /^p[0-9a-f]{24}$/);
  assert.equal(sandboxAccount('user-a'), sandboxAccount('user-a'));
  assert.notEqual(sandboxAccount('user-a'), sandboxAccount('user-b'));
});
test('sandbox is unavailable without an authenticated provisioned account', async () => {
  assert.deepEqual(await sandboxTools(undefined, {env:{}}), []);
  assert.deepEqual(await sandboxTools('unprovisioned', {env:{}}), []);
  assert.deepEqual(await sandboxTools('other-user', {env:{ PIP_SANDBOX_ACCOUNTS: sandboxAccount('user') }}), []);
});

test('Fly dotenv escaped key newlines are normalized before OpenSSH reads them', () => {
  assert.equal(normalizeSshKey('BEGIN\\nbody\\nEND'), 'BEGIN\nbody\nEND\n');
  assert.equal(normalizeSshKey('BEGIN\r\nbody\r\nEND\r\n'), 'BEGIN\nbody\nEND\n');
});
