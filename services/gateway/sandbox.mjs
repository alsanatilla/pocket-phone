// Native OpenClaw SSH routing. Account selection is server-owned, never a model argument.
import { createHash } from 'node:crypto';
export const sandboxAccount = userId => 'p' + createHash('sha256').update(String(userId)).digest('hex').slice(0, 24);
export const sandboxAccounts = (env = process.env) => [...new Set((env.PIP_SANDBOX_ACCOUNTS || '').split(',').map(x => x.trim()).filter(Boolean))].map(account => {
  if (!/^p[0-9a-f]{24}$/.test(account)) throw new Error('Invalid sandbox account');
  return account;
});
export const sandboxAgent = (account, env = process.env) => (env.PIP_GATEWAY_AGENT || 'pocket') + '-' + account;
export const agentForUser = (userId, env = process.env) => sandboxAccounts(env).includes(sandboxAccount(userId))
  ? sandboxAgent(sandboxAccount(userId), env) : env.PIP_GATEWAY_AGENT || 'pocket';
export const CODING_TOOLS = ['exec', 'read', 'write', 'edit', 'apply_patch'];
export function sshSandbox(account, env = process.env) {
  const host = env.PIP_SANDBOX_HOST || 'pocket-pip-sandbox.internal', port = env.PIP_SANDBOX_PORT || '2222';
  if (!/^[a-zA-Z0-9.-]+$/.test(host) || !/^\d+$/.test(port) || +port < 1 || +port > 65535) throw new Error('Invalid sandbox endpoint');
  if (!env.PIP_SANDBOX_SSH_KEY || !env.PIP_SANDBOX_KNOWN_HOSTS) throw new Error('Sandbox SSH credentials are missing');
  const knownHostsData = env.PIP_SANDBOX_KNOWN_HOSTS.trim().split('\n').map(line => {
    if (!line.trim() || line.startsWith('#')) return line;
    const [names, ...key] = line.trim().split(/\s+/);
    if (!names.split(',').includes('pocket-pip-sandbox')) throw new Error('Sandbox host pin must name pocket-pip-sandbox');
    return (port === '22' ? host : '[' + host + ']:' + port) + ' ' + key.join(' ');
  }).join('\n') + '\n';
  return { mode: 'all', backend: 'ssh', scope: 'agent', workspaceAccess: 'rw',
    ssh: { target: account + '@' + host + ':' + port, workspaceRoot: '/workspace/' + account + '/openclaw',
      strictHostKeyChecking: true, updateHostKeys: false,
      identityData: env.PIP_SANDBOX_SSH_KEY.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim() + '\n', knownHostsData } };
}
