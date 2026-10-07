import { buildBrief, validBriefDay } from '../shared/daily-brief.js';
import { load, onChange } from './store.js';
import { preferences } from './extras.js';
import { cached, cachedCockpit, observedMaxHr } from './coros.js';
import { scores } from './scores.js';
import { mascot } from './pip-pixels.js';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const list = value => Array.isArray(value) ? value.filter(object) : [];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const dated = value => validBriefDay(value.date);

/** Use only cached assessments; fetching the cockpit never becomes their sample date. */
export function briefRecovery(cockpit, activities, day) {
  if (!object(cockpit)) return null;
  const hrv = list(cockpit.hrv).filter(value => dated(value) && finite(value.avg) && value.avg >= 0 && finite(value.baseline) && value.baseline > 0);
  const resting = list(cockpit.resting).filter(value => dated(value) && finite(value.bpm) && value.bpm > 0);
  const days = list(cockpit.daily?.days).filter(dated).map(value => ({ ...value, steps: finite(value.steps) ? value.steps : 0, sleep: object(value.sleep) && finite(value.sleep.total) && value.sleep.total >= 0 ? { ...value.sleep, awake: finite(value.sleep.awake) ? value.sleep.awake : 0 } : null }));
  const deck = { ...cockpit, hrv, resting, daily: { ...cockpit.daily, days } };
  const dates = [...new Set([...hrv, ...resting].map(value => value.date).filter(value => value <= day))].sort().reverse();
  const savedActivities = list(activities).filter(value => finite(value.start) && value.start > 0 && finite(value.seconds) && value.seconds >= 0)
    .map(value => ({ ...value, hr: finite(value.hr) ? value.hr : 0, km: finite(value.km) ? value.km : 0 }));
  for (const date of dates) {
    try {
      const reading = scores({ activities: savedActivities, deck, profile: { ...cockpit.profile, observedMax: observedMaxHr() }, today: date, span: 1 }).recovery;
      if (finite(reading?.score)) return { recovery: reading.score, date, at: 0, source: 'Pocket' };
    } catch { /* A damaged sample does not turn into a fabricated score. */ }
  }
  const recovery = cockpit.recovery;
  if (!object(recovery) || !finite(recovery.percent)) return null;
  return { recovery: recovery.percent, date: validBriefDay(recovery.date) ? recovery.date : '', at: Number.isSafeInteger(cockpit.partAt?.recovery) ? cockpit.partAt.recovery : 0, source: 'COROS' };
}

export function readBrief(options = {}) {
  options = object(options) ? { ...options } : {};
  if (!Number.isSafeInteger(options.now) || options.now < 0 || options.now > 253_402_300_799_999) options.now = Date.now();
  const tasks = load('tasks.json'), agenda = load('agenda.json'), thoughts = load('parking.json'), gym = load('gym.json'), notes = load('notes.json');
  // The pure generator supplies the local civil day without consulting a server.
  const day = buildBrief({}, options).day;
  const brief = buildBrief({ tasks: tasks.tasks, nextTaskUid: tasks.next?.uid, agenda: agenda.events, thoughts: thoughts.items, workouts: gym.workouts, notes: notes.notes, coros: briefRecovery(cachedCockpit(), cached()?.list, day) }, options);
  return { ...brief, summary: (brief.facts.map(fact => fact.text).slice(0, 3).join(' · ') || brief.text).slice(0, 180) };
}
export const briefEnabled = () => preferences.get('daily-brief')?.enabled !== false;
export function setBriefEnabled(enabled) {
  if (typeof enabled !== 'boolean') throw new Error('Check the brief setting.');
  preferences.set('daily-brief', { enabled });
  refreshMounted();
}

const mounted = new Set();
let ticker = 0, watching = false;
function refreshMounted() {
  for (const state of mounted) {
    if (!state.host.isConnected) state.dispose();
    else state.refresh();
  }
}
function watch() {
  if (!watching) {
    watching = true;
    onChange(name => { if (['tasks.json', 'agenda.json', 'parking.json', 'gym.json', 'notes.json', 'preferences.json'].includes(name)) refreshMounted(); });
    for (const name of ['pocket-extras-applied', 'pocket-coros-synced', 'storage', 'pageshow']) addEventListener(name, refreshMounted);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshMounted(); });
  }
  if (!ticker) ticker = setInterval(() => { if (document.visibilityState !== 'hidden') refreshMounted(); }, 30_000);
}

/** Mount into an owned host; the caller may dispose it when navigating away. */
export function mountBrief(body, api, { compact = false } = {}) {
  const { h, add, go } = api;
  const host = h('section', { class: 'daily-brief' + (compact ? ' daily-brief-compact' : ''), 'aria-label': 'Daily brief' });
  add(body, host);
  let signature = '', disposed = false;
  const disposeMascot = () => host.querySelectorAll('.pip-mascot').forEach(node => node.dispose?.());
  const safely = work => async () => { try { await work(); } catch (error) { api.say?.(error.message || 'The brief could not open.'); } };
  const button = (text, run, extra = {}) => h('button', { type: 'button', onclick: safely(run), ...extra, text });
  const refresh = () => {
    if (disposed) return;
    const enabled = briefEnabled(), brief = enabled ? readBrief() : null;
    const shown = compact ? brief?.facts.slice(0, 3) : brief?.facts;
    const nextSignature = JSON.stringify([enabled, brief?.day, brief?.facts.length, shown?.map(fact => [fact.id, fact.text, fact.href])]);
    if (nextSignature === signature) return; signature = nextSignature;
    const focused = host.contains(document.activeElement) ? document.activeElement : null;
    const focusedFact = focused?.getAttribute('data-brief-fact'), focusedHref = focused?.getAttribute('data-brief-href'), focusedAction = focused?.getAttribute('data-brief-action');
    const restoreFocus = () => {
      if (!focusedFact && !focusedAction) return;
      const target = [...host.querySelectorAll('button')].find(node => focusedFact ? node.getAttribute('data-brief-fact') === focusedFact && node.getAttribute('data-brief-href') === focusedHref : node.getAttribute('data-brief-action') === focusedAction);
      target?.focus({ preventScroll: true });
    };
    disposeMascot(); host.replaceChildren(); host.hidden = compact && !enabled;
    if (!enabled) {
      if (!compact) add(host, button('enable brief', () => setBriefEnabled(true), { class: 'accent', 'data-brief-action': 'enable' }));
      restoreFocus();
      return;
    }
    const face = mascot(false); face.classList.add('daily-brief-mascot');
    const identity = h('div', { class: 'daily-brief-identity' }, face, compact ? button('pip’s daily brief', () => go('/brief'), { class: 'daily-brief-heading accent', 'data-brief-action': 'title' }) : null);
    const header = h('div', { class: 'daily-brief-header' }, identity, h('span', { class: 'meta muted', text: brief.day }));
    add(host, header);
    const facts = h('div', { class: 'daily-brief-facts' });
    for (const fact of shown) {
      const row = button('', () => go(fact.href), { class: 'daily-brief-fact' + (fact.stale ? ' daily-brief-stale' : ''), 'data-brief-fact': fact.id, 'data-brief-href': fact.href });
      add(row, h('span', { class: 'meta muted daily-brief-kind', text: fact.kind === 'training' ? 'gym' : fact.kind === 'agenda' ? 'calendar' : fact.kind }), h('span', { text: fact.text }), h('span', { class: 'accent', 'aria-hidden': 'true', text: '›' }));
      add(facts, row);
    }
    if (!brief.facts.length) add(facts, h('p', { class: 'small muted', text: brief.text }));
    add(host, facts);
    const actions = h('div', { class: 'keys daily-brief-actions' });
    if (compact && brief.facts.length > 3) add(actions, button('open brief', () => go('/brief'), { 'data-brief-action': 'open' }));
    if (api.askPip) add(actions, button('think with pip', () => api.askPip(readBrief()), { class: 'accent', 'data-brief-action': 'pip' }));
    if (!compact) add(actions, button('disable brief', () => setBriefEnabled(false), { 'data-brief-action': 'disable' }));
    add(host, actions);
    restoreFocus();
  };
  const dispose = () => { if (disposed) return; disposed = true; disposeMascot(); mounted.delete(state); if (!mounted.size) { clearInterval(ticker); ticker = 0; } };
  const state = { host, refresh, dispose };
  mounted.add(state); watch(); refresh();
  dispose.refresh = refresh;
  return dispose;
}
