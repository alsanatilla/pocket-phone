// Load Google's SDK only when a Travel map is opened. The public, referrer-
// restricted browser key comes from runtime config, never the application bundle.
const TIMEOUT = 12000, RETRY_DELAY = 3000;
let pending = null, ready = null, attempt = 0, active = null, retryAt = 0, fatalAuth = false;
let status = { state: 'idle', reason: '', retryable: true };
const authListeners = new Set();
let previousAuthFailure, authHandler;
const error = (code, message) => Object.assign(new Error(message), { name: 'MapsUnavailableError', code });
const unavailable = () => error('unavailable', 'Google Maps is unavailable.');
const abortError = () => new DOMException('Location lookup stopped.', 'AbortError');
export const mapsStatus = () => ({ ...status });

function installAuthHandler() {
  if (authHandler) return;
  previousAuthFailure = globalThis.gm_authFailure;
  authHandler = () => {
    fatalAuth = true; ready = null; retryAt = Infinity;
    status = { state: 'failed', reason: 'auth', retryable: false };
    const failure = error('auth', 'Google Maps could not authenticate.');
    active?.fail(failure);
    for (const listener of authListeners) { try { listener(failure); } catch { /* A closed map must not break the SDK callback. */ } }
    if (typeof previousAuthFailure === 'function') { try { previousAuthFailure(); } catch { /* Preserve other consumers without exposing provider diagnostics. */ } }
  };
  globalThis.gm_authFailure = authHandler;
}

export function onMapsAuthFailure(listener) {
  if (typeof listener !== 'function') throw new TypeError('Provide a map failure listener.');
  installAuthHandler(); authListeners.add(listener);
  if (fatalAuth) queueMicrotask(() => { if (authListeners.has(listener)) listener(error('auth', 'Google Maps could not authenticate.')); });
  return () => authListeners.delete(listener);
}

function callerPromise(shared, signal) {
  if (!signal) return shared;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(abortError()); };
    signal.addEventListener('abort', abort, { once: true });
    shared.then(value => { signal.removeEventListener('abort', abort); if (!signal.aborted) resolve(value); }, failure => { signal.removeEventListener('abort', abort); reject(failure); });
  });
}

export function loadGoogleMaps({ signal } = {}) {
  if (signal?.aborted) return Promise.reject(abortError());
  if (fatalAuth) return Promise.reject(error('auth', 'Google Maps could not authenticate.'));
  if (ready) return callerPromise(Promise.resolve(ready), signal);
  if (pending) return callerPromise(pending, signal);
  if (typeof document === 'undefined' || globalThis.navigator?.onLine === false) {
    status = { state: 'failed', reason: 'offline', retryable: true };
    return Promise.reject(error('offline', 'Google Maps is unavailable offline.'));
  }
  if (Date.now() < retryAt) return Promise.reject(error(status.reason || 'unavailable', 'Google Maps is unavailable. Try again shortly.'));
  installAuthHandler();
  const serial = ++attempt, controller = new AbortController(), callback = '__pocketMapsReady' + serial;
  status = { state: 'loading', reason: '', retryable: true };
  let script, timer, settled = false, resolveAttempt, rejectAttempt;
  const current = new Promise((resolve, reject) => { resolveAttempt = resolve; rejectAttempt = reject; });
  pending = current;
  const cleanup = () => {
    clearTimeout(timer); controller.abort();
    if (globalThis[callback]) delete globalThis[callback];
    if (script) script.onerror = null;
    if (active?.serial === serial) active = null;
  };
  const fail = failure => {
    if (settled) return; settled = true;
    cleanup(); script?.remove();
    const reason = failure?.code || 'unavailable';
    if (reason !== 'auth') status = { state: reason === 'disabled' ? 'disabled' : 'failed', reason, retryable: reason !== 'disabled' };
    retryAt = reason === 'auth' ? Infinity : Date.now() + (reason === 'disabled' ? 60000 : RETRY_DELAY);
    if (pending === current) pending = null;
    rejectAttempt(failure?.name === 'MapsUnavailableError' ? failure : unavailable());
  };
  active = { serial, fail };
  timer = setTimeout(() => fail(error('timeout', 'Google Maps took too long to load.')), TIMEOUT);
  const finish = async () => {
    try {
      const maps = globalThis.google?.maps;
      if (!maps || typeof maps.importLibrary !== 'function') throw unavailable();
      await Promise.all([maps.importLibrary('maps'), maps.importLibrary('geocoding')]);
      if (settled || attempt !== serial || fatalAuth) return;
      if (!['Map', 'OverlayView', 'Polyline', 'LatLngBounds', 'Geocoder'].every(name => typeof maps[name] === 'function')) throw unavailable();
      settled = true; cleanup(); ready = maps;
      status = { state: 'ready', reason: '', retryable: true }; retryAt = 0;
      resolveAttempt(maps);
    } catch { fail(unavailable()); }
  };
  void (async () => {
    try {
      const response = await fetch('/api/maps-config', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (settled) return;
      if (!response.ok) throw error('config', 'Google Maps configuration is unavailable.');
      const config = await response.json();
      if (settled) return;
      if (!config?.enabled || typeof config.key !== 'string' || !/^[A-Za-z0-9_-]{20,200}$/.test(config.key)) throw error('disabled', 'Google Maps is not configured.');
      if (globalThis.google?.maps?.importLibrary) { await finish(); return; }
      globalThis[callback] = finish;
      script = document.createElement('script'); script.async = true;
      script.nonce = document.querySelector('script[nonce]')?.nonce || '';
      const url = new URL('https://maps.googleapis.com/maps/api/js');
      url.search = new URLSearchParams({ key: config.key, loading: 'async', v: 'quarterly', callback }).toString();
      script.src = url.href;
      script.onerror = () => fail(error('network', 'Google Maps could not load.'));
      document.head.append(script);
    } catch (failure) {
      if (!settled) fail(failure?.name === 'MapsUnavailableError' ? failure : error('network', 'Google Maps could not load.'));
    }
  })();
  return callerPromise(current, signal);
}

let enabledCheck = null;
/** Whether a browser key is configured, without loading the SDK: true, false, or null when that is unknown (offline). */
export function mapsEnabled() {
  if (fatalAuth) return Promise.resolve(false);
  enabledCheck ??= fetch('/api/maps-config', { credentials: 'same-origin', cache: 'no-store' })
    .then(response => response.ok ? response.json() : null).then(config => config ? config.enabled === true : null).catch(() => null)
    .then(value => { if (value === null) enabledCheck = null; return value; });
  return enabledCheck;
}

/** Cancel this loader's unfinished attempt; already-loaded SDK libraries stay shared. */
export function disposeGoogleMaps() {
  if (active) active.fail(error('disposed', 'Google Maps loading stopped.'));
}
globalThis.addEventListener?.('online', () => { if (!fatalAuth && ['network', 'offline', 'timeout'].includes(status.reason)) retryAt = 0; });
globalThis.addEventListener?.('pagehide', disposeGoogleMaps);
