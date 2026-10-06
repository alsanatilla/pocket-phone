// Keep each account's workspace, drafts, provider settings and caches separate.
const ACTIVE = 'pocket:active-account';
const native = () => globalThis.localStorage;
export const activeAccount = () => native()?.getItem(ACTIVE) || '';
const prefix = () => activeAccount() ? `pocket:account:${activeAccount()}:` : '';

function scoped(storageTarget) {
  const keys = () => {
    const target = storageTarget(), scope = prefix(), result = [];
    for (let i = 0; i < target.length; i++) {
      const key = target.key(i);
      if (scope ? key?.startsWith(scope) : key && key !== ACTIVE && !key.startsWith('pocket:account:')) result.push(scope ? key.slice(scope.length) : key);
    }
    return result;
  };
  return {
    get length() { return keys().length; },
    key: index => keys()[index] ?? null,
    getItem: key => storageTarget().getItem(prefix() + key),
    setItem: (key, value) => storageTarget().setItem(prefix() + key, value),
    removeItem: key => storageTarget().removeItem(prefix() + key),
  };
}
export const storage = scoped(native);
export const tabStorage = scoped(() => globalThis.sessionStorage);
export function switchAccount(id) {
  if (id) native().setItem(ACTIVE, id); else native().removeItem(ACTIVE);
}
export function clearWorkspace() {
  const scope = prefix();
  for (const key of Object.keys(native())) {
    if (scope ? key.startsWith(scope) : key.startsWith('pocket:') && !key.startsWith('pocket:account:') && key !== ACTIVE) native().removeItem(key);
  }
}
/** True when this browser holds guest records worth bringing into an account. */
export function guestHasData() {
  if(Object.keys(native()).some(key=>key.startsWith('pocket:pip-chat:')))return true;
  for (const name of ['notes.json', 'tasks.json', 'parking.json', 'journal.json', 'gym.json']) {
    try { const doc = JSON.parse(native().getItem('pocket:' + name) || 'null'); if (doc && Object.values(doc).some(value => Array.isArray(value) && value.length)) return true; } catch { /* unreadable copy */ }
  }
  return false;
}
export function importGuestCopy() {
  if (!activeAccount()) return;
  const excluded = /(?:token|expires|connected|coros|access|settings|key)/i;
  for (const key of Object.keys(native())) {
    if (key.startsWith('pocket:') && !key.startsWith('pocket:account:') && key !== ACTIVE && !excluded.test(key) && storage.getItem(key) === null) storage.setItem(key, native().getItem(key));
  }
  for (const key of ['pocket:coros', 'pocket:coros-client', 'pocket:coros-activities', 'pocket:coros-cockpit', 'pocket:coros-details']) {
    if (native().getItem(key) !== null && storage.getItem(key) === null) storage.setItem(key, native().getItem(key));
  }
  // All tabs switch to this account; only its server may rotate the transferred token.
  native().removeItem('pocket:coros'); native().removeItem('pocket:coros-client');
}
addEventListener('storage', event => { if (event.key === ACTIVE) location.reload(); });
