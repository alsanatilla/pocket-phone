// The OpenClaw gateway's config, generated at boot from Pocket's environment. One OpenClaw agent owns Pip's
// workspace and memory; Pocket talks to it over the loopback Responses API and the gateway protocol.
// Personal deployment: one agent, one workspace, no multi-tenant routing yet.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const env = process.env;
export const gatewayHome = () => env.PIP_GATEWAY_HOME || '/data/openclaw';
export const gatewayPort = () => Number(env.PIP_GATEWAY_PORT) || 18789;
export const agentId = () => env.PIP_GATEWAY_AGENT || 'pocket';
const provider = () => env.PIP_GATEWAY_PROVIDER || 'compatible';
const model = () => env.PIP_GATEWAY_MODEL || 'deepseek-v4.1-flash';

/** The config the gateway reads: loopback, token auth, memory-core, and the account's model as a custom provider. */
export function gatewayConfig() {
  const id = provider(), name = model();
  const baseUrl = env.PIP_GATEWAY_BASE_URL || 'https://opencode.ai/inference/go/openai/v1';
  const key = env.PIP_GATEWAY_KEY || '';
  const workspace = join(gatewayHome(), 'agents', agentId());
  return {
    gateway: { mode: 'local', port: gatewayPort(), bind: 'loopback', auth: { mode: 'token', token: env.PIP_GATEWAY_TOKEN || '' },
      http: { endpoints: { responses: { enabled: true } } } },
    // Only the memory plugin: every other bundled plugin adds tools and prompt text this personal agent never uses.
    plugins: { slots: { memory: 'memory-core' }, entries: { 'memory-core': { enabled: true } },
      deny: ['anthropic', 'browser', 'canvas', 'cua-computer', 'device-pair', 'file-transfer', 'geolocation', 'github', 'linux-node', 'ollama', 'openai', 'talk-voice', 'xai'] },
    // Keyword memory: no embedding key is required, and the index stays fts-only instead of waiting for vectors.
    memory: { search: { provider: 'none', sources: ['memory'] } },
    models: { mode: 'merge', providers: {
      [id]: { baseUrl, apiKey: key, api: 'openai-completions', authHeader: true,
        models: [{ id: name, name, api: 'openai-completions', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 8192 }] },
    } },
    agents: { entries: { [agentId()]: { workspace, model: id + '/' + name } } },
  };
}

/** Writes the config where the gateway finds it and creates its workspace; returns both paths. */
export async function writeGatewayConfig() {
  const home = gatewayHome(), path = join(home, 'openclaw.json'), workspace = join(home, 'agents', agentId());
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  // Pip's persona, not OpenClaw's "pick a name" scaffolding. USER.md and MEMORY.md are the agent's and stay untouched.
  await writeFile(join(workspace, 'IDENTITY.md'), '# Pip\n\n- **Name:** Pip\n- **Role:** the assistant inside Pocket\n', { mode: 0o600 });
  await writeFile(join(workspace, 'SOUL.md'), '# Pip\n\nBe brief, plain and useful. No filler, no introductions, no emoji.\n', { mode: 0o600 });
  await writeFile(join(workspace, 'AGENTS.md'), '# Pip\'s workspace\n\nYou are Pip, the assistant inside Pocket, talking to the person who owns this Pocket. '
    + 'Answer in the language they use. USER.md and MEMORY.md are your memory of them. '
    + 'Cards, notes, tasks, appointments and other Pocket data come through the client tools; use them instead of inventing data.\n', { mode: 0o600 });
  await writeFile(path, JSON.stringify(gatewayConfig(), null, 2) + '\n', { mode: 0o600 });
  return { path, workspace, home };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const written = await writeGatewayConfig();
  console.log(JSON.stringify(written));
}
