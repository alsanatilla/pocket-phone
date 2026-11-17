import test from 'node:test';
import assert from 'node:assert/strict';
import { GATEWAY_MODELS, gatewayModelFor, isOpencodeBase } from '../src/shared/pip-gateway-models.js';

// A chat's stored provider/model has to become the gateway's session model, and only when this deployment can run it.
test('an OpenCode Go chat maps to the gateway provider and model', () => {
  for (const baseUrl of ['https://opencode.ai/inference/go/openai/v1', 'https://opencode.ai/zen/go/v1', 'https://opencode.ai/inference/go/openai/v1/']) {
    assert.equal(isOpencodeBase(baseUrl), true, baseUrl);
    assert.equal(gatewayModelFor({ provider: 'compatible', baseUrl, model: 'glm-5.3' }), 'opencode-go/glm-5.3');
  }
  assert.equal(gatewayModelFor({ provider: 'compatible', baseUrl: 'https://opencode.ai/inference/go/openai/v1', model: 'kimi-k3.1-pro' }), 'opencode-go/kimi-k3.1-pro');
  assert.equal(gatewayModelFor({ provider: 'compatible', baseUrl: 'https://opencode.ai/inference/go/openai/v1', model: 'deepseek-v4.1-flash' }), 'opencode-go/deepseek-v4.1-flash');
});

test('another provider, a custom endpoint, or an unknown id keeps the gateway default', () => {
  assert.equal(gatewayModelFor({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5' }), '');
  assert.equal(gatewayModelFor({ provider: 'compatible', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free' }), '');
  assert.equal(gatewayModelFor({ provider: 'compatible', baseUrl: 'https://example.com/v1', model: 'my-model' }), '');
  assert.equal(gatewayModelFor({ provider: 'compatible', baseUrl: 'https://opencode.ai/inference/go/openai/v1', model: 'not-in-the-list' }), '');
  assert.equal(gatewayModelFor({}), '');
  assert.equal(gatewayModelFor(null), '');
});

test('every offered model is one the gateway config carries', () => {
  assert.ok(GATEWAY_MODELS.length >= 3);
  for (const entry of GATEWAY_MODELS) {
    assert.ok(entry.id && entry.name && entry.note, entry.id);
    assert.equal(gatewayModelFor({ baseUrl: 'https://opencode.ai/inference/go/openai/v1', model: entry.id }), 'opencode-go/' + entry.id);
  }
});
