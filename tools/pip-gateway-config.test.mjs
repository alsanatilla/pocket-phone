import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The gateway's config is generated from Pocket's environment; the shape is what the gateway and Pocket agree on.
const home = await mkdtemp(join(tmpdir(), 'pocket-gateway-'));
process.env.PIP_GATEWAY_HOME = home;
process.env.PIP_GATEWAY_PORT = '18790';
process.env.PIP_GATEWAY_TOKEN = 'token-1234567890';
process.env.PIP_GATEWAY_KEY = 'sk-test';
process.env.PIP_GATEWAY_MODEL = 'fixture-model';
process.env.PIP_GATEWAY_PROVIDER = 'fixture';
process.env.PIP_GATEWAY_BASE_URL = 'https://model.example/v1';
const { gatewayConfig, writeGatewayConfig, gatewayHome, gatewayPort, agentId } = await import('../services/gateway/config.mjs');

test('the generated config is loopback, token-guarded, and serves the Responses API', () => {
  const cfg = gatewayConfig();
  assert.equal(cfg.gateway.bind, 'loopback');
  assert.equal(cfg.gateway.port, 18790);
  assert.equal(cfg.gateway.auth.mode, 'token');
  assert.equal(cfg.gateway.auth.token, 'token-1234567890');
  assert.equal(cfg.gateway.http.endpoints.responses.enabled, true);
  assert.equal(gatewayPort(), 18790);
  assert.equal(gatewayHome(), home);
});

test('memory is keyword only, so no embedding provider is needed', () => {
  const cfg = gatewayConfig();
  assert.equal(cfg.memory.search.provider, 'none');
  assert.deepEqual(cfg.memory.search.sources, ['memory']);
  assert.equal(cfg.plugins.slots.memory, 'memory-core');
  assert.equal(cfg.plugins.entries['memory-core'].enabled, true);
});

test('the account model becomes the agent model, and the workspace sits under the gateway home', () => {
  const cfg = gatewayConfig();
  const provider = cfg.models.providers.fixture;
  assert.equal(provider.baseUrl, 'https://model.example/v1');
  assert.equal(provider.apiKey, 'sk-test');
  assert.equal(provider.models[0].id, 'fixture-model');
  assert.equal(cfg.agents.entries[agentId()].model, 'fixture/fixture-model');
  assert.equal(cfg.agents.entries[agentId()].workspace, join(home, 'agents', 'pocket'));
});

test('writing the config creates the workspace and puts the file where the gateway reads it', async () => {
  const written = await writeGatewayConfig();
  assert.equal(written.path, join(home, 'openclaw.json'));
  assert.equal(written.workspace, join(home, 'agents', 'pocket'));
  const text = await (await import('node:fs/promises')).readFile(written.path, 'utf8');
  assert.match(text, /"mode": "local"/);
  assert.match(text, /"responses": \{\s*"enabled": true/);
});
