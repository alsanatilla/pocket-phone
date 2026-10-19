import { post, request } from './cloud.js';
import { storage } from './workspace-storage.js';

// Pip's notifications on this browser. Turning them on asks for the browser's permission and subscribes it for the
// signed-in account, so the server can say when a reply finishes, fails or waits for an OK while no tab is watching,
// and when a scheduled routine writes in its chat. A Pocket tab that is open but hidden shows the same notices itself.
const FLAG = 'pocket:pip-notify';
const supported = () => 'serviceWorker' in navigator && 'PushManager' in globalThis && 'Notification' in globalThis;
const worker = () => navigator.serviceWorker.getRegistration();
const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), char => char.charCodeAt(0));
const encode = buffer => buffer ? btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '';
const deviceName = () => { const agent = navigator.userAgent; return /Android/.test(agent) ? 'Android' : /iPhone|iPad/.test(agent) ? 'iOS' : /Windows/.test(agent) ? 'Windows' : /Mac/.test(agent) ? 'Mac' : /Linux/.test(agent) ? 'Linux' : ''; };

/** 'unsupported', 'blocked', 'off' or 'on' for this browser and account, with how many devices the account has. */
export async function pushState() {
  if (!supported()) return { state: 'unsupported' };
  const registration = await worker();
  // The service worker registers once Pocket's production build has loaded; the dev server has none.
  if (!registration) return { state: 'unsupported' };
  if (Notification.permission === 'denied') return { state: 'blocked' };
  const subscription = await registration.pushManager.getSubscription();
  const server = await request('/api/pip/push' + (subscription ? '?endpoint=' + encodeURIComponent(subscription.endpoint) : ''));
  const on = Boolean(subscription && server.here && Notification.permission === 'granted' && encode(subscription.options.applicationServerKey) === server.publicKey);
  return { state: on ? 'on' : 'off', devices: server.devices };
}

export async function enablePush() {
  if (!supported() || !await worker()) throw new Error('This browser cannot show Pocket notifications.');
  if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications are blocked for Pocket. Allow them in this browser’s site settings.');
  const registration = await navigator.serviceWorker.ready, { publicKey } = await request('/api/pip/push');
  let subscription = await registration.pushManager.getSubscription();
  // A subscription made for another server key cannot receive these messages.
  if (subscription && encode(subscription.options.applicationServerKey) !== publicKey) { await subscription.unsubscribe(); subscription = null; }
  subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decode(publicKey) });
  await post('/api/pip/push', { action: 'subscribe', subscription: subscription.toJSON(), device: deviceName() });
  storage.setItem(FLAG, '1');
}

export async function disablePush() {
  storage.removeItem(FLAG);
  const subscription = supported() ? await (await worker())?.pushManager.getSubscription() : null;
  if (!subscription) return;
  await post('/api/pip/push', { action: 'unsubscribe', endpoint: subscription.endpoint }).catch(() => {});
  await subscription.unsubscribe();
}

export async function testPush() {
  const subscription = supported() ? await (await worker())?.pushManager.getSubscription() : null;
  if (!subscription) throw new Error('Turn notifications on first.');
  const result = await post('/api/pip/push', { action: 'test', endpoint: subscription.endpoint });
  if (!result.sent) throw new Error(result.gone ? 'This browser’s subscription has expired. Turn notifications off and on again.' : 'The notification service did not take the message. Try again later.');
}

/** A notice this tab shows itself while it is hidden: the server leaves a reply that a tab is following to that tab. */
export async function notifyHere(notice) {
  if (!notice || !supported() || Notification.permission !== 'granted' || storage.getItem(FLAG) !== '1' || document.visibilityState === 'visible') return false;
  const registration = await worker();
  if (!registration) return false;
  await registration.showNotification(notice.title, { body: notice.body, tag: notice.tag, renotify: true, data: { href: notice.href } });
  return true;
}

/** Pip's notifications row: what this browser does now, turning it on or off, and a test message. */
export function notificationControls(ui) {
  const status = ui.h('p', { class: 'meta muted', text: 'notifications · checking…' }), actions = ui.h('div', { class: 'pip-routine-actions' });
  const act = (text, run, props = {}) => ui.h('button', { onclick: async () => { try { await run(); } catch (error) { ui.say(error.message); } await paint(); }, ...props }, text);
  const paint = async () => {
    let value;
    try { value = await pushState(); } catch { value = { state: 'error' }; }
    const devices = value.devices ? ' · ' + value.devices + (value.devices === 1 ? ' device' : ' devices') : '';
    status.textContent = 'notifications · ' + ({ unsupported: 'not available in this browser', blocked: 'blocked in this browser’s site settings', off: 'off on this device' + devices,
      on: 'on for this device' + devices, error: 'unavailable right now' })[value.state];
    actions.replaceChildren(...(value.state === 'off' ? [act('notify me on this device', enablePush, { class: 'accent' })]
      : value.state === 'on' ? [act('send a test', async () => { await testPush(); ui.say('Sent. It should appear in a moment.'); }), act('turn off here', disablePush)] : []));
  };
  void paint();
  return ui.h('div', { class: 'pip-notify' }, status,
    ui.h('p', { class: 'meta muted', text: 'Pip tells you when a reply finishes, fails or needs your OK while Pocket is closed or in the background, and when a routine writes in its chat.' }), actions);
}
