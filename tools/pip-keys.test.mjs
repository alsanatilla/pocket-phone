import test from 'node:test';
import assert from 'node:assert/strict';
import { endpoint, publicTarget, upstream, FIRECRAWL } from '../src/server/pip-keys.js';

test('fixed providers ignore a supplied endpoint; compatible endpoints must be public HTTPS', () => {
  assert.equal(endpoint('anthropic', 'https://evil.example'), 'https://api.anthropic.com/v1');
  assert.equal(endpoint('firecrawl', ''), FIRECRAWL);
  assert.equal(endpoint('compatible', 'https://openrouter.ai/api/v1/'), 'https://openrouter.ai/api/v1');
  for (const bad of [
    'http://openrouter.ai/api/v1',
    'https://user:pass@openrouter.ai/api/v1',
    'https://openrouter.ai/api/v1?key=1',
    'https://openrouter.ai/api/v1#frag',
    'https://localhost/api/v1',
    'https://127.0.0.1/api/v1',
    'https://10.0.0.5/api/v1',
    'https://192.168.1.10/api/v1',
    'https://169.254.1.1/api/v1',
    'https://[::1]/api/v1',
  ]) assert.throws(() => endpoint('compatible', bad), /HTTPS|public|credentials|query|fragment/i, bad);
});

test('the relay path is fixed by the provider, never supplied by the browser', () => {
  assert.equal(upstream('anthropic', 'https://anything.example'), 'https://api.anthropic.com/v1/messages');
  assert.equal(upstream('compatible', 'https://openrouter.ai/api/v1/'), 'https://openrouter.ai/api/v1/chat/completions');
});

test('a private endpoint is refused before any lookup', async () => {
  await assert.rejects(publicTarget('compatible', 'https://127.0.0.1/api/v1'), /public/i);
  await assert.rejects(publicTarget('compatible', 'https://localhost/api/v1'), /public/i);
  assert.equal(await publicTarget('anthropic', 'https://ignored.example'), 'https://api.anthropic.com/v1');
});
