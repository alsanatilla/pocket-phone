// One path through Pocket's connections: account, phone, COROS, then Pip.
// Every step can be skipped and picked up later; the page always opens at the first open step.
import { storage, tabStorage } from './workspace-storage.js';
import * as cloud from './cloud.js';
import * as coros from './coros.js';
import { DEFAULT_CONFIG, settings, saveSettings, apiKey, setKey } from './pip-core.js';

const SKIPPED = 'pocket:setup-skipped', HIDDEN = 'pocket:setup-hidden', PHONE = 'pocket:setup-phone', PIP = 'pocket:setup-pip', RETURN = 'pocket:setup-return';
const PHONE_AGENT = /Pocket Android|okhttp|Dalvik/i;
export const OPENROUTER = Object.freeze({ provider: 'compatible', model: 'openrouter/free', baseUrl: 'https://openrouter.ai/api/v1', maxTokens: 2048, thinking: false, webSearch: false });
const STEPS = [
  { id: 'account', name: 'account', why: 'One Pocket account keeps notes, tasks, chats and COROS the same on every device.' },
  { id: 'phone', name: 'phone', why: 'Link the Pocket phone to this account. Both then sync both ways.' },
  { id: 'coros', name: 'COROS', why: 'Recovery, sleep and training for Today and Movement. Connect once here; the phone uses the same connection.' },
  { id: 'pip', name: 'pip', why: 'Pip needs an AI provider. OpenRouter’s free models cost nothing; a Claude key gives the best answers and also reads Paper.' },
];

const skipped = () => { try { const list = JSON.parse(storage.getItem(SKIPPED) || '[]'); return Array.isArray(list) ? list : []; } catch { return []; } };
function skip(id, on = true) { const list = skipped().filter(item => item !== id); if (on) list.push(id); storage.setItem(SKIPPED, JSON.stringify(list)); }
const pipKey = () => { try { return Boolean(apiKey(settings())); } catch { return false; } };

function stateOf(id) {
  let done = false, blocked = false;
  if (id === 'account') { if (!cloud.checked() || !cloud.configured()) blocked = true; else done = cloud.connected(); }
  else if (id === 'phone') { if (!cloud.connected()) blocked = true; else done = storage.getItem(PHONE) === '1'; }
  else if (id === 'coros') done = coros.connected();
  else if (id === 'pip') done = pipKey() || storage.getItem(PIP) === '1';
  return done ? 'done' : blocked ? 'blocked' : skipped().includes(id) ? 'skipped' : 'open';
}
const blockedNote = id => id === 'phone' ? 'needs an account' : cloud.checked() ? 'no account server' : 'checking…';
const detail = id => {
  if (id === 'account') return cloud.account()?.email || '';
  if (id === 'phone') return 'linked';
  if (id === 'coros') return 'connected';
  if (id === 'pip') { try { const value = settings(); return (value.provider === 'anthropic' ? 'Claude' : new URL(value.baseUrl).hostname.replace(/^api\./, '')) + (pipKey() ? '' : ' · key asked once per tab'); } catch { return 'set up'; } }
  return '';
};

/** How far setup is, for the Today banner and the account page. */
export function progress() {
  if (!cloud.checked()) return { done: 0, total: STEPS.length, next: '', open: false };
  const states = STEPS.map(step => stateOf(step.id));
  const next = STEPS.find((step, i) => states[i] === 'open');
  return { done: states.filter(s => s === 'done').length, total: STEPS.length, next: next?.name || '', open: Boolean(next) };
}
export const hidden = () => storage.getItem(HIDDEN) === '1';
export const hide = () => storage.setItem(HIDDEN, '1');

/** COROS returns through its own sign-in page; send the person back here when they started from setup. */
export function resume() {
  if (tabStorage.getItem(RETURN) !== '1') return false;
  tabStorage.removeItem(RETURN); history.replaceState(null, '', location.pathname + '#/setup'); return true;
}

export const phoneLinked = () => storage.setItem(PHONE, '1');
/** A phone linked earlier, or from the phone itself, also completes the step. Signing a phone out later is managed under Account. */
async function checkPhone(redraw) {
  if (!cloud.connected() || storage.getItem(PHONE) === '1') return;
  try { if ((await cloud.sessions()).some(item => PHONE_AGENT.test(item.userAgent || ''))) { phoneLinked(); redraw(); } }
  catch { /* Offline: ask again next time. */ }
}

// A step the person opened themselves; otherwise the first open step is shown.
let expanded = '';
export function mount(body, api, creating = false) {
  const { h, add, go, workspaceTitle } = api;
  const redraw = () => { if (location.hash.startsWith('#/setup')) api.route(); };
  if (creating && cloud.connected()) history.replaceState(null, '', location.pathname + '#/setup');
  const { done, total, open } = progress();
  workspaceTitle(body, 'set up', done === total ? 'all connected' : done + ' of ' + total + ' connected');
  const list = h('div', { class: 'setup' });
  const states = STEPS.map(step => stateOf(step.id));
  const current = expanded && states[STEPS.findIndex(s => s.id === expanded)] !== 'blocked' ? expanded : STEPS.find((step, i) => states[i] === 'open')?.id || '';
  STEPS.forEach((step, index) => {
    const state = states[index], active = step.id === current;
    const mark = state === 'done' ? '✓' : state === 'skipped' || state === 'blocked' ? '–' : String(index + 1);
    const note = state === 'done' ? detail(step.id) : state === 'skipped' ? 'skipped' : state === 'blocked' ? blockedNote(step.id) : active ? 'now' : '';
    const head = h('button', { class: 'setup-head', 'aria-expanded': String(active), disabled: state === 'blocked',
      onclick: () => { expanded = active ? '' : step.id; redraw(); } },
      h('span', { class: 'setup-mark', 'aria-hidden': 'true', text: mark }), h('span', { class: 'setup-name', text: step.name }), h('span', { class: 'setup-note', text: note }));
    const card = h('section', { class: 'setup-step is-' + state + (active ? ' is-current' : ''), 'aria-label': step.name + ' · ' + (note || state) }, head);
    if (active) add(card, h('p', { class: 'small muted setup-why', text: step.why }), panel(step.id, state, api, creating, redraw));
    add(list, card);
  });
  if (!open && !current) add(list, h('div', { class: 'setup-finish' }, h('p', { text: done === total ? 'Pocket is set up. Change any connection above at any time.' : 'Setup is finished. Skipped steps wait here until you want them.' }),
    h('button', { class: 'account-primary', onclick: () => { expanded = ''; go('/today'); } }, 'go to today')));
  add(body, list);
  checkPhone(redraw);
}

function panel(id, state, api, creating, redraw) {
  const { h, add, go, say } = api;
  const pane = h('div', { class: 'setup-panel' });
  const later = (text, step = id) => h('button', { class: 'account-switch', onclick: () => { skip(step); expanded = ''; redraw(); } }, text);
  const reopen = text => h('button', { class: 'account-switch', onclick: () => { skip(id, false); expanded = ''; redraw(); } }, text);
  if (id === 'account') {
    if (state === 'done') { add(pane, h('button', { class: 'account-switch', onclick: () => go('/sync') }, 'devices, passkeys & sign out')); return pane; }
    const form = h('div', { class: 'account' }); api.signInForm(form, creating, '/setup'); add(pane, form);
    add(pane, state === 'skipped' ? reopen('ask again') : later('use pocket without an account'));
    return pane;
  }
  if (id === 'phone') {
    if (state === 'done') { add(pane, h('p', { class: 'small muted', text: 'Your Pocket phone is signed in to this account.' })); return pane; }
    const code = h('input', { class: 'code-input', placeholder: 'XXXX-XXXX', maxlength: 9, autocomplete: 'one-time-code', 'aria-label': 'Code shown on the phone',
      oninput: event => { event.target.value = api.normalCode(event.target.value); } });
    add(pane, h('ol', { class: 'setup-how small' }, h('li', { text: 'On the phone, open Pocket → settings → set up pocket.' }), h('li', { text: 'Tap “link this phone”. It shows a code.' }), h('li', { text: 'Type the code here.' })),
      h('form', { class: 'account-link', onsubmit: async event => { event.preventDefault(); await api.linkPhone(code.value); } }, code, h('button', { type: 'submit', class: 'account-commit' }, 'link phone')),
      state === 'skipped' ? reopen('ask again') : later('no phone right now'));
    return pane;
  }
  if (id === 'coros') {
    if (state === 'done') { add(pane, h('button', { class: 'account-switch', onclick: () => go('/movement') }, 'open movement')); return pane; }
    add(pane, h('button', { class: 'account-primary', onclick: async event => {
      event.currentTarget.disabled = true; say('Opening COROS…'); tabStorage.setItem(RETURN, '1');
      try { await coros.connect(); } catch (error) { tabStorage.removeItem(RETURN); event.target.disabled = false; say(error.message); }
    } }, 'connect COROS'), state === 'skipped' ? reopen('ask again') : later('no COROS watch'));
    return pane;
  }
  // Pip: two presets cover nearly everyone; anything else lives in Pip's own API settings.
  let current; try { current = settings(); } catch { current = DEFAULT_CONFIG; }
  // A fresh browser starts on the free models; a saved Claude setup stays on Claude.
  let choice = current.provider === 'anthropic' && state === 'done' ? 'anthropic' : 'openrouter';
  const key = h('input', { type: 'password', autocomplete: 'off', 'aria-label': 'API key' });
  const where = h('a', { class: 'small muted', target: '_blank', rel: 'noopener' });
  const tabs = h('div', { class: 'setup-choice', role: 'radiogroup', 'aria-label': 'AI provider' });
  const pick = value => {
    choice = value;
    tabs.querySelectorAll('button').forEach(button => { const on = button.dataset.value === value; button.classList.toggle('selected', on); button.setAttribute('aria-checked', String(on)); });
    key.placeholder = value === 'anthropic' ? 'sk-ant-…' : 'sk-or-…';
    where.href = value === 'anthropic' ? 'https://console.anthropic.com/settings/keys' : 'https://openrouter.ai/settings/keys';
    where.textContent = value === 'anthropic' ? 'get a Claude key ↗' : 'get a free OpenRouter key ↗';
  };
  add(tabs, [['openrouter', 'free models', 'OpenRouter'], ['anthropic', 'Claude', 'Anthropic']].map(([value, title, sub]) =>
    h('button', { type: 'button', role: 'radio', 'data-value': value, onclick: () => pick(value) }, title, h('span', { class: 'sub', text: sub }))));
  pick(choice);
  const save = event => {
    event.preventDefault();
    try {
      const value = choice === 'anthropic' ? { ...DEFAULT_CONFIG } : { ...OPENROUTER };
      if (!key.value.trim()) throw new Error('Paste your API key.');
      setKey(value, key.value); saveSettings(value); storage.setItem(PIP, '1'); skip('pip', false);
      key.value = ''; expanded = ''; redraw(); say('Pip is ready.');
    } catch (error) { say(error.message); }
  };
  add(pane, tabs, h('form', { class: 'account-create', onsubmit: save },
    h('label', { class: 'account-field' }, h('span', { text: 'API KEY' }), key), where,
    h('p', { class: 'meta muted', text: 'The key stays in this browser tab and goes only to the provider. The phone keeps its own encrypted copy.' }),
    h('button', { type: 'submit', class: 'account-primary' }, state === 'done' ? 'replace key' : 'save key')),
    h('button', { class: 'account-switch', onclick: () => go('/pip') }, 'another provider'),
    state === 'done' ? null : state === 'skipped' ? reopen('ask again') : later('later'));
  return pane;
}
