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

test('native: Pocket\'s plugin is loaded, unused core tools are left out, and the cards skill is in the workspace', async () => {
  process.env.PIP_OPENCLAW_NATIVE = '1';
  try {
    const { readFile } = await import('node:fs/promises');
    const written = await writeGatewayConfig();
    const cfg = JSON.parse(await readFile(written.path, 'utf8'));
    assert.match(cfg.plugins.load.paths[0], /services\/gateway\/pocket-plugin$/);
    const pocket = cfg.plugins.entries.pocket;
    assert.equal(pocket.enabled, true);
    assert.match(pocket.config.url, /^http:\/\/127\.0\.0\.1:\d+\/internal\/pip-tools$/);
    assert.ok(pocket.config.tools.some(tool => tool.name === 'show_card' && tool.parameters.type === 'object'));
    assert.ok(!pocket.config.tools.some(tool => ['remember', 'forget'].includes(tool.name)), 'OpenClaw memory replaces Pocket\'s');
    assert.deepEqual(pocket.config.writes, ['create_record', 'change_record', 'remove_job', 'coros_write', 'update_training_preferences']);
    const manifest = JSON.parse(await readFile(join(cfg.plugins.load.paths[0], 'openclaw.plugin.json'), 'utf8'));
    assert.deepEqual([...manifest.contracts.tools].sort(), pocket.config.tools.map(tool => tool.name).sort(), 'the manifest names every tool the plugin registers');
    assert.equal(cfg.tools.profile, 'minimal'); assert.equal(cfg.tools.toolSearch, false);
    assert.ok(cfg.tools.alsoAllow.includes('search_notes') && cfg.tools.alsoAllow.includes('group:memory'));
    assert.deepEqual(cfg.agents.entries[agentId()].skills, ['pocket-cards']);
    const skill = await readFile(join(written.workspace, 'skills', 'pocket-cards', 'SKILL.md'), 'utf8');
    assert.match(skill, /^---\nname: pocket-cards\n/); assert.match(skill, /show_card/);
    assert.match(await readFile(join(written.workspace, 'AGENTS.md'), 'utf8'), /pocket-cards skill/);
  } finally { delete process.env.PIP_OPENCLAW_NATIVE; }
});

test('OpenCode Go goes through OpenClaw\'s own provider, which sends the chat\'s session, and chat does not think first', () => {
  const saved = { ...process.env };
  try {
    process.env.PIP_GATEWAY_BASE_URL = 'https://opencode.ai/inference/go/openai/v1'; process.env.PIP_GATEWAY_KEY = 'k';
    const cfg = gatewayConfig();
    assert.deepEqual(Object.keys(cfg.models.providers), ['opencode-go']);
    assert.equal(cfg.models.providers['opencode-go'].baseUrl, 'https://opencode.ai/zen/go/v1');
    assert.match(cfg.agents.entries.pocket.model, /^opencode-go\//);
    assert.equal(cfg.agents.defaults.thinkingDefault, 'off');
    process.env.PIP_GATEWAY_BASE_URL = 'http://127.0.0.1:9/v1';
    assert.notDeepEqual(Object.keys(gatewayConfig().models.providers), ['opencode-go'], 'any other endpoint stays a plain compatible provider');
  } finally { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); }
});
