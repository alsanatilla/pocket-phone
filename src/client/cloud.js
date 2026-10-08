import { startAuthentication, startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { activeAccount, switchAccount, importGuestCopy } from './workspace-storage.js';
import { chosenName } from '../shared/profile-name.js';

let user = null, ready = false, isChecked = false, profileVersion = 0;
export const connected = () => Boolean(user && user.id === activeAccount());
export const configured = () => ready;
/** True once Pocket has asked the server whether accounts exist, even when offline. */
export const checked = () => isChecked;
export const account = () => user;
export async function refreshAccount() {
  const accountId = activeAccount(), version = profileVersion, session = await request('/api/auth/get-session');
  if (accountId !== activeAccount()) return null;
  if (version !== profileVersion) return user;
  if (!session?.user) { user = null; throw new Expired(); }
  if (session.user.id !== accountId) throw new Error('Account changed. Reload Pocket.');
  user = session.user;
  return user;
}
export class Expired extends Error { constructor() { super('Sign in to Pocket again.'); } }
export async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  if (response.status === 401) { user = null; throw new Expired(); }
  const value = await response.json();
  if (!response.ok) throw new Error(value.error_description || value.message || (typeof value.error === 'string' ? value.error : '') || 'Pocket storage did not answer.');
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
  finally { isChecked = true; }
}
const send = (path, body = {}) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function finish(user, importCopy) {
  if (!user?.id) throw new Error('Sign-in did not finish.');
  switchAccount(user.id);
  if (importCopy) { importGuestCopy(); await (await import('./zine-store.js')).importGuestBooks(user.id); }
  location.reload();
}
const cancelled = error => error?.name === 'NotAllowedError' || error?.name === 'AbortError';
export const passkeysSupported = () => browserSupportsWebAuthn();
export async function login(email, password, create = false, importCopy = false, name) {
  const result = await send('/api/auth/' + (create ? 'sign-up/email' : 'sign-in/email'), { email, password, ...(create ? { name: chosenName(name ?? email.split('@')[0]) } : {}) });
  await finish(result.user, importCopy);
}
/** Returns false when the person closed the passkey prompt. */
export async function signInWithPasskey(importCopy = false) {
  const options = await request('/api/auth/passkey/generate-authenticate-options');
  let response; try { response = await startAuthentication({ optionsJSON: { ...options, userVerification: 'required' } }); } catch (error) { if (cancelled(error)) return false; throw error; }
  await send('/api/auth/passkey/verify-authentication', { response });
  await finish((await request('/api/auth/get-session'))?.user, importCopy); return true;
}
const deviceName = () => { const ua = navigator.userAgent; const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'this device'; return os; };
export async function addPasskey(name = deviceName()) {
  const options = await request('/api/auth/passkey/generate-register-options');
  let response; try { response = await startRegistration({ optionsJSON: options }); } catch (error) { if (cancelled(error)) return false; throw error; }
  await send('/api/auth/passkey/verify-registration', { response, name }); return true;
}
/** Create the user and its session only after a verified passkey ceremony. */
export async function createAccount(email, importCopy = false, name) {
  const { context } = await send('/api/auth/pocket/start-account', { email, name: chosenName(name ?? email.split('@')[0]) });
  const options = await request('/api/auth/passkey/generate-register-options?context=' + encodeURIComponent(context));
  let response; try { response = await startRegistration({ optionsJSON: options }); } catch (error) { if (cancelled(error)) return false; throw error; }
  const result = await send('/api/auth/passkey/verify-registration', { response, name: deviceName(), createSession: true });
  await finish(result.user, importCopy); return true;
}
export const passkeys = () => request('/api/auth/passkey/list-user-passkeys');
export async function updateName(value) {
  const accountId = activeAccount();
  if (!connected()) throw new Expired();
  const name = chosenName(value); profileVersion++;
  const response = await post('/api/profile', { name });
  if (activeAccount() !== accountId || response.accountId !== accountId || response.user?.id !== accountId) throw new Error('Account changed. Reload Pocket.');
  profileVersion++; user = response.user;
  return user;
}
export const removePasskey = id => send('/api/auth/passkey/delete-passkey', { id });
export const sessions = () => request('/api/auth/list-sessions');
export const revokeSession = token => send('/api/auth/revoke-session', { token });
export const checkCode = code => request('/api/auth/device?user_code=' + encodeURIComponent(code));
export const approveCode = userCode => send('/api/auth/device/approve', { userCode });
export const denyCode = userCode => send('/api/auth/device/deny', { userCode });
export const search = q => request('/api/search?q=' + encodeURIComponent(q));
export const noteHistory = uid => request('/api/history/notes/' + encodeURIComponent(uid));
export const restoreNote = (uid, version, current) => post('/api/history/notes/' + encodeURIComponent(uid) + '/restore', { version, current });
export const deletedNotes = () => request('/api/history/deleted');
export async function disconnect() {
  await request('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  user = null; switchAccount(''); location.reload();
}
export async function exchange(documents, onlyRequested = false) {
  const result = await request('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: activeAccount(), documents, onlyRequested }) });
  if (result.accountId !== activeAccount()) throw new Error('Account changed. Reload Pocket.');
  return result.documents;
}
export async function post(path, value = {}, method = 'POST') {
  return request(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...value, accountId: activeAccount() }) });
}
export async function media(name, blob, bookId) {
  const response = await fetch('/api/media/' + encodeURIComponent(name), { credentials: 'same-origin', ...(blob ? {
    method: 'PUT', headers: { 'Content-Type': 'image/jpeg', 'X-Pocket-Account': activeAccount(), 'X-Pocket-Book': bookId }, body: blob,
  } : {}) });
  if (response.status === 401) { user = null; throw new Expired(); }
  if (response.status === 404 && !blob) return null;
  if (!response.ok) { const value = await response.json(); throw new Error(value.error || 'Could not sync this zine photo.'); }
  return blob ? null : response.blob();
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
