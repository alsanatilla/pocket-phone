import { activeAccount, switchAccount, importGuestCopy } from './workspace-storage.js';

let user = null, ready = false;
export const connected = () => Boolean(user && user.id === activeAccount());
export const configured = () => ready;
export const account = () => user;
export class Expired extends Error { constructor() { super('Sign in to Pocket again.'); } }
async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  if (response.status === 401) { user = null; throw new Expired(); }
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || value.message || 'Pocket storage did not answer.');
  return value;
}
export async function init() {
  try {
    ready = Boolean((await request('/api/status')).configured);
    if (!ready) return;
    const session = await request('/api/auth/get-session');
    user = session?.user || null;
    if (user && activeAccount() !== user.id) { switchAccount(user.id); location.reload(); }
  } catch (error) { if (!(error instanceof Expired)) throw error; }
}
export async function login(email, password, create = false, importCopy = false) {
  const result = await request('/api/auth/' + (create ? 'sign-up/email' : 'sign-in/email'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, ...(create ? { name: email.split('@')[0] } : {}) }),
  });
  if (!result.user?.id) throw new Error('Sign-in did not finish.');
  switchAccount(result.user.id);
  if (importCopy) importGuestCopy();
  location.reload();
}
export async function disconnect() {
  await request('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  user = null; switchAccount(''); location.reload();
}
export async function exchange(documents) {
  const result = await request('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: activeAccount(), documents }) });
  if (result.accountId !== activeAccount()) throw new Error('Account changed. Reload Pocket.');
  return result.documents;
}
export async function readBlob(name) {
  const response = await fetch('/api/files/' + encodeURIComponent(name), { credentials: 'same-origin' });
  if (response.status === 404) return null;
  if (response.status === 401) { user = null; throw new Expired(); }
  if (!response.ok) throw new Error('Could not load this photo.');
  return response.blob();
}
export async function writeImage(name, blob) {
  const response = await fetch('/api/files/' + encodeURIComponent(name), { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'image/jpeg', 'X-Pocket-Account': activeAccount() }, body: blob });
  if (response.status === 401) { user = null; throw new Expired(); }
  if (!response.ok) { const value = await response.json(); throw new Error(value.error || 'Could not save this photo.'); }
}
