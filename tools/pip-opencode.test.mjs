import test from 'node:test';
import assert from 'node:assert/strict';
import { OPENCODE_GO, opencodeSession, opencodeTarget } from '../src/shared/pip-opencode.js';

// OpenCode Go: the browser needs Pocket's proxy (no CORS), and every request needs a routing session.
test('only the chat endpoint is proxied', () => {
  assert.equal(opencodeTarget('chat/completions'), OPENCODE_GO + '/chat/completions');
  assert.equal(opencodeTarget('/v1/chat/completions'), OPENCODE_GO + '/chat/completions');
  assert.equal(opencodeTarget('v1//chat/completions/'), OPENCODE_GO + '/chat/completions');
  // Anything else — another provider path, a traversal attempt, an absolute URL — is refused.
  for (const path of ['', 'v1/models', 'v1/embeddings', '../chat/completions', 'https://example.test/chat/completions', 'chat']) assert.equal(opencodeTarget(path), '', path + ' must not be proxied');
});

test('the routing session is stable, opaque and different per key', () => {
  const key = 'oc_sk_example_key_000000000000000000000001';
  const session = opencodeSession(key);
  assert.match(session, /^pocket-[0-9a-f]{40}$/);
  assert.equal(session, opencodeSession(key), 'the same key keeps its session');
  assert.notEqual(session, opencodeSession(key + 'x'), 'another key gets another session');
  assert.ok(!session.includes(key.slice(8, 24)), 'the session never carries key material');
  assert.notEqual(opencodeSession(''), opencodeSession(' '));
});
