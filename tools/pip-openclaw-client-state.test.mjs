import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { clientStateDir, prepareClientState } = await import('../src/server/pip-openclaw.js');

// The regression: a root-owned 0700 directory at a shared path made every reply fail with "The OpenClaw gateway did
// not answer." The web process could not open its own device identity, and the handshake timed out after 60 seconds.
test('the gateway client state is one directory per Unix user, never a shared name', () => {
  const saved = process.env.PIP_OPENCLAW_CLIENT_STATE;
  try {
    delete process.env.PIP_OPENCLAW_CLIENT_STATE;
    const dir = clientStateDir();
    assert.equal(dir, join(tmpdir(), 'pocket-openclaw-client-' + process.getuid()));
    assert.notEqual(dir, join(tmpdir(), 'pocket-openclaw-client'), 'a shared name is what locked the web process out');
    process.env.PIP_OPENCLAW_CLIENT_STATE = '/tmp/pocket-client-explicit';
    assert.equal(clientStateDir(), '/tmp/pocket-client-explicit', 'an explicit path still wins');
  } finally {
    if (saved === undefined) delete process.env.PIP_OPENCLAW_CLIENT_STATE;
    else process.env.PIP_OPENCLAW_CLIENT_STATE = saved;
  }
});

test('the client state directory is created private before the gateway client starts', async () => {
  const saved = process.env.PIP_OPENCLAW_CLIENT_STATE;
  try {
    const dir = join(await mkdtemp(join(tmpdir(), 'pocket-client-')), 'state');
    process.env.PIP_OPENCLAW_CLIENT_STATE = dir;
    assert.equal(await prepareClientState(), dir);
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
    assert.equal(await prepareClientState(), dir, 'a second boot reuses it');
  } finally {
    if (saved === undefined) delete process.env.PIP_OPENCLAW_CLIENT_STATE;
    else process.env.PIP_OPENCLAW_CLIENT_STATE = saved;
  }
});
