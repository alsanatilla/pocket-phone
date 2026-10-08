// Run: node --experimental-vm-modules scripts/profile-client-check.mjs
// All browser APIs and requests are fixtures; this test performs no networking.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/client/cloud.js', import.meta.url), 'utf8');
const profileSource = await readFile(new URL('../src/shared/profile-name.js', import.meta.url), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function fixture() {
  const state = { accountId: 'alice', user: { id: 'alice', name: 'Original', email: 'alice@example.com' }, sessionHooks: [], profileHooks: [], requests: [], reloads: 0 };
  const response = (value, status = 200) => ({ status, ok: status < 400, json: async () => copy(value) });
  const fetch = async (path, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    state.requests.push({ path, body });
    if (path === '/api/status') return response({ configured: true });
    if (path === '/api/auth/get-session') return state.sessionHooks.length ? state.sessionHooks.shift()() : response({ user: state.user });
    if (path === '/api/profile') {
      if (state.profileHooks.length) return state.profileHooks.shift()(body);
      state.user = { ...state.user, name: body.name }; return response({ accountId: state.accountId, user: state.user });
    }
    if (path === '/api/auth/sign-up/email') return response({ user: { ...state.user, name: body.name } });
    if (path === '/api/auth/pocket/start-account') return response({ context: 'fixture-context' });
    if (path.startsWith('/api/auth/passkey/generate-register-options')) return response({ fixtureOptions: true });
    if (path === '/api/auth/passkey/verify-registration') return response({ user: state.user });
    throw new Error('Unexpected fixture request: ' + path);
  };
  const context = vm.createContext({ console, URL, fetch, navigator: { userAgent: 'Windows' }, location: { reload() { state.reloads++; } } });
  const workspace = new vm.SyntheticModule(['activeAccount', 'switchAccount', 'importGuestCopy'], function () {
    this.setExport('activeAccount', () => state.accountId); this.setExport('switchAccount', id => { state.accountId = id; }); this.setExport('importGuestCopy', () => {});
  }, { context });
  const webauthn = new vm.SyntheticModule(['startAuthentication', 'startRegistration', 'browserSupportsWebAuthn'], function () {
    this.setExport('startAuthentication', async () => ({ fixture: true })); this.setExport('startRegistration', async () => ({ fixture: true })); this.setExport('browserSupportsWebAuthn', () => true);
  }, { context });
  const names = new vm.SourceTextModule(profileSource, { context });
  const cloud = new vm.SourceTextModule(source, { context });
  await cloud.link(path => path.includes('workspace-storage') ? workspace : path.includes('profile-name') ? names : webauthn); await cloud.evaluate();
  await cloud.namespace.init(); return { cloud: cloud.namespace, state, response };
}
{
  const { cloud, state, response } = await fixture(); const old = deferred();
  state.sessionHooks.push(() => old.promise);
  const refresh = cloud.refreshAccount();
  await cloud.updateName('  Ana\u0301  '); assert.equal(cloud.account().name, 'Aná');
  old.resolve(response({ user: { ...state.user, name: 'Original' } }));
  assert.equal((await refresh).name, 'Aná'); assert.equal(cloud.account().name, 'Aná');
  console.log('PASS pre-save stale account refresh cannot replace the new profile');
}
{
  const { cloud, state, response } = await fixture(), save = deferred(), refreshGate = deferred();
  state.profileHooks.push(() => save.promise);
  const saving = cloud.updateName('Current');
  state.sessionHooks.push(() => refreshGate.promise); const refreshing = cloud.refreshAccount();
  save.resolve(response({ accountId: 'alice', user: { ...state.user, name: 'Current' } })); await saving;
  refreshGate.resolve(response({ user: state.user })); assert.equal((await refreshing).name, 'Current'); assert.equal(cloud.account().name, 'Current');
  console.log('PASS refresh started during save cannot replace its completed response');
}
{
  const { cloud, state, response } = await fixture(), gate = deferred();
  state.profileHooks.push(() => gate.promise); const saving = cloud.updateName('Alice name');
  state.accountId = 'bob'; state.user = { id: 'bob', name: 'Bob name', email: 'bob@example.com' }; await cloud.init();
  gate.resolve(response({ accountId: 'alice', user: { id: 'alice', name: 'Alice name', email: 'alice@example.com' } }));
  await assert.rejects(saving, /Account changed/); assert.equal(cloud.account().id, 'bob'); assert.equal(cloud.account().name, 'Bob name');
  console.log('PASS in-flight profile save is fenced when accounts change');
}
{
  const { cloud, state } = await fixture(); const before = state.requests.length;
  await assert.rejects(() => cloud.updateName('   '), /Enter your name/); assert.equal(state.requests.length, before);
  await cloud.login('alice@example.com', 'FixturePassword123!', true, false, '  José  ');
  assert.equal(state.requests.find(request => request.path === '/api/auth/sign-up/email').body.name, 'José');
  await cloud.createAccount('alice@example.com', false, '  Léa  ');
  assert.equal(state.requests.find(request => request.path === '/api/auth/pocket/start-account').body.name, 'Léa');
  assert.equal(state.requests.find(request => request.path === '/api/auth/passkey/verify-registration').body.name, 'Windows');
  console.log('PASS signup chosen names propagate separately from passkey device labels');
}
console.log('Profile client fixtures passed.');
