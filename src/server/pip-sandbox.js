// OpenClaw's native coding tools, confined to a separately provisioned Fly SSH user.
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const SANDBOX_TOOLS = ['exec', 'read', 'write', 'edit', 'apply_patch'];
export const sandboxAccount = userId => 'p' + createHash('sha256').update(String(userId)).digest('hex').slice(0, 24);
export const normalizeSshKey = value => String(value).replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim() + '\n';
const material = new Map();
const safeToken = value => /^[a-zA-Z0-9._:-]+$/.test(value);

export async function sandboxTools(userId, { signal, sessionKey, env = process.env } = {}) {
  if (!userId) return [];
  const account = sandboxAccount(userId);
  if (!(env.PIP_SANDBOX_ACCOUNTS || '').split(',').includes(account)) return [];
  const [{ createOpenClawCodingToolsAsync }, { createSshSandboxSessionFromConfigText, runSshSandboxCommand, prepareSshSandboxExec, disposeSshSandboxSession, createRemoteShellSandboxBackend }] = await Promise.all([import('openclaw/plugin-sdk/agent-harness'), import('openclaw/plugin-sdk/sandbox')]);
  const host = env.PIP_SANDBOX_HOST || 'pocket-pip-sandbox.internal', port = env.PIP_SANDBOX_PORT || '2222';
  if (!safeToken(host) || !/^\d{1,5}$/.test(port)) throw new Error('Invalid sandbox SSH endpoint');
  if (!env.PIP_SANDBOX_SSH_KEY || !env.PIP_SANDBOX_KNOWN_HOSTS) throw new Error('Sandbox SSH credentials are missing');
  const fingerprint = createHash('sha256').update(env.PIP_SANDBOX_SSH_KEY + env.PIP_SANDBOX_KNOWN_HOSTS).digest('hex');
  if (!material.has(fingerprint)) material.set(fingerprint, (async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pocket-sandbox-'));
    await writeFile(join(dir, 'identity'), normalizeSshKey(env.PIP_SANDBOX_SSH_KEY), { mode: 0o600 });
    await writeFile(join(dir, 'known_hosts'), env.PIP_SANDBOX_KNOWN_HOSTS.trim() + '\n', { mode: 0o600 });
    return dir;
  })());
  const dir = await material.get(fingerprint), workspaceDir = join(dir, account), remote = '/workspace/' + account;
  await mkdir(workspaceDir, { mode: 0o700, recursive: true });
  const configText = `Host pocket-sandbox\n HostName ${host}\n Port ${port}\n User ${account}\n HostKeyAlias pocket-pip-sandbox\n IdentityFile ${dir}/identity\n UserKnownHostsFile ${dir}/known_hosts\n StrictHostKeyChecking yes\n IdentitiesOnly yes\n BatchMode yes\n ConnectTimeout 5\n ServerAliveInterval 15\n ServerAliveCountMax 3\n`;
  const backend = await createRemoteShellSandboxBackend({ cfg: { backend: 'ssh', workspaceAccess: 'rw', docker: { env: {} }, ssh: { workspaceRoot: remote } }, scopeKey: account, workspaceDir, agentWorkspaceDir: workspaceDir }, {
    backendId: 'ssh', preprovisionedWorkdir: { remoteWorkspaceDir: remote, runtimeId: account }, configLabel: host,
    createSession: async () => {
      const session = await createSshSandboxSessionFromConfigText({ configText });
      return {
        runCommand: params => runSshSandboxCommand({ ...params, session }),
        prepareExec: async params => ({ ...await prepareSshSandboxExec({ ...params, session, env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: remote, LANG: 'C.UTF-8' } }), env: {} }),
        uploadDirectory: async () => { throw new Error('Host uploads to the sandbox are disabled'); },
        dispose: () => disposeSshSandboxSession(session),
      };
    },
  });
  const sandbox = { enabled: true, required: true, backendId: 'ssh', sessionKey: sessionKey || account, workspaceDir, agentWorkspaceDir: workspaceDir, workspaceAccess: 'rw', runtimeId: account, runtimeLabel: account, containerName: account, containerWorkdir: remote, docker: { env: {}, binds: [] }, tools: { allow: SANDBOX_TOOLS, deny: [] }, browserAllowHostControl: false, backend };
  sandbox.fsBridge = backend.createFsBridge({ sandbox });
  const tools = await createOpenClawCodingToolsAsync({ sandbox, workspaceDir, requireWorkspaceOnly: true, sessionKey: sessionKey || account, agentId: account, abortSignal: signal, emitBeforeToolCallDiagnostics: false,
    config: { tools: { allow: SANDBOX_TOOLS, exec: { host: 'sandbox', security: 'full', ask: 'off', applyPatch: { enabled: true, workspaceOnly: true } }, fs: { workspaceOnly: true } } },
    exec: { host: 'sandbox', security: 'full', ask: 'off', timeoutSec: 60, backgroundMs: 120000, notifyOnExit: false },
  });
  // No gateway, network, browser, delegated-agent or host tools enter Pocket's surface.
  return tools.filter(tool => SANDBOX_TOOLS.includes(tool.name)).map(tool => ({ ...tool, executionMode: 'sequential', execute: (id, args, callSignal, onUpdate) => tool.execute(id, tool.name === 'exec' ? { ...args, host: 'sandbox', elevated: false, background: false, awaitResults: true, timeoutSeconds: Math.min(60, Math.max(1, args.timeoutSeconds || 60)) } : args, callSignal, onUpdate) }));
}
