import { load, importDocument, tasks } from './store.js';
import { validContent } from '../shared/pocket-content.js';
import { drafts } from './extras.js';

const MINUTE = 60_000, DAY = 24 * 60 * MINUTE;
const copy = value => JSON.parse(JSON.stringify(value));
const stamp = old => Math.max(Date.now(), Number(old?.updated || 0) + 1);
const live = (name, key) => (load(name)[key] || []).filter(item => !item.deleted);
const whole = (name, key, uid) => (load(name)[key] || []).find(item => item.uid === uid);
function put(name, key, value) {
  const doc = load(name), old = doc[key].find(item => item.uid === value.uid);
  const item = { ...old, ...value, uid: value.uid || crypto.randomUUID(), created: old?.created || value.created || Date.now(), updated: stamp(old), deleted: Boolean(value.deleted) };
  const at = doc[key].findIndex(entry => entry.uid === item.uid);
  if (at < 0) doc[key].push(item); else doc[key][at] = item;
  if (!validContent(name, doc)) throw new Error(name === 'agenda.json' ? 'Check the appointment. Calendar holds up to 300 records.' : 'Check the clock. Clock holds up to 200 records.');
  importDocument(name, doc); return copy(item);
}
const tombstone = (name, key, uid) => { const old = whole(name, key, uid); if (old) return put(name, key, { ...old, deleted: true }); };
const instant = value => { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new Error('Choose a date and time.'); return date.getTime(); };
const pad = value => String(value).padStart(2, '0');
function dateInput(at) {
  const date = new Date(at); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
const nextHour = () => { const at = new Date(Date.now() + 60 * MINUTE); at.setMinutes(0, 0, 0); return at.getTime(); };
const time = at => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const day = at => new Date(at).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
export function nextAlarm(hour, minute, now = Date.now()) {
  const due = new Date(now); due.setHours(hour, minute, 0, 0); if (due.getTime() <= now) due.setDate(due.getDate() + 1); return due.getTime();
}
export const elapsed = (entry, now = Date.now()) => Math.max(0, Number(entry.remaining || 0) + (entry.enabled ? Math.max(0, now - Number(entry.due || now)) : 0));
export const left = (entry, now = Date.now()) => entry.enabled ? Math.max(0, entry.due - now) : Math.max(0, entry.remaining || 0);
export function clockText(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000)), hours = Math.floor(seconds / 3600);
  return (hours ? pad(hours) + ':' : '') + pad(Math.floor(seconds / 60) % 60) + ':' + pad(seconds % 60);
}

export const agenda = {
  all: () => live('agenda.json', 'events').sort((a, b) => a.when - b.when),
  get: uid => live('agenda.json', 'events').find(item => item.uid === uid) || null,
  save(value) {
    if (!String(value.title || '').trim() || String(value.title).length > 500) throw new Error('Write a title, up to 500 characters.');
    return put('agenda.json', 'events', { ...value, title: value.title.trim(), when: instant(value.when), minutes: Number(value.minutes), remindAt: Number(value.remindAt || 0), task_uid: value.task_uid || '', deleted: false });
  },
  remove: uid => tombstone('agenda.json', 'events', uid),
};
export function agendaToday(now = Date.now()) {
  const start = new Date(now); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 1);
  return agenda.all().filter(event => event.when < end.getTime() && event.when + event.minutes * MINUTE > start.getTime());
}
function clockRecord(kind, values = {}) {
  return { uid: values.uid || crypto.randomUUID(), kind, title: '', enabled: false, daily: false, hour: 0, minute: 0, due: 0, remaining: 0, task_uid: '', created: Date.now(), ...values };
}
export const clock = {
  all: () => live('clock.json', 'entries').sort((a, b) => b.created - a.created),
  get: uid => live('clock.json', 'entries').find(item => item.uid === uid) || null,
  save: value => put('clock.json', 'entries', clockRecord(value.kind, value)),
  remove: uid => tombstone('clock.json', 'entries', uid),
  pause(uid) {
    const entry = this.get(uid); if (!entry?.enabled) return entry;
    return this.save({ ...entry, enabled: false, due: 0, remaining: entry.kind === 'stopwatch' ? elapsed(entry) : left(entry) });
  },
  resume(uid) {
    const entry = this.get(uid); if (!entry) throw new Error('This clock was removed.');
    if (entry.kind === 'alarm') return this.save({ ...entry, enabled: true, due: entry.task_uid && entry.due > Date.now() ? entry.due : nextAlarm(entry.hour, entry.minute) });
    return this.save({ ...entry, enabled: true, due: entry.kind === 'stopwatch' ? Date.now() : Date.now() + Math.max(1000, entry.remaining || 0) });
  },
  stopwatch() { return this.get('stopwatch') || clockRecord('stopwatch', { uid: 'stopwatch', title: 'Stopwatch' }); },
};
function navigate(path) {
  const next = '#' + path;
  if (location.hash === next) dispatchEvent(new Event('hashchange')); else location.hash = next;
}
export function planTask(task) {
  const pending = agenda.all().find(event => event.task_uid === task.uid && event.when + event.minutes * MINUTE > Date.now());
  if (pending) { navigate('/calendar/' + pending.uid); return pending; }
  drafts.set('appointment', '', { title: task.text, when: nextHour(), minutes: 60, remind: false, remindAt: 0, task_uid: task.uid });
  navigate('/calendar/new'); return null;
}
export function remindTask(task) {
  const previous = clock.all().find(entry => entry.kind === 'alarm' && entry.task_uid === task.uid);
  if (previous) { navigate('/clock/' + previous.uid); return previous; }
  drafts.set('capture', 'clock', { domain: 'clock', kind: 'alarm', title: task.text, task_uid: task.uid, due: nextHour() });
  navigate('/clock/new/alarm'); return null;
}
export function focusTask(task) {
  const current = clock.all().find(entry => entry.kind === 'focus' && entry.task_uid === task.uid && entry.enabled && entry.due > Date.now());
  const entry = current || clock.save(clockRecord('focus', { title: task.text, task_uid: task.uid, enabled: true, remaining: 25 * MINUTE, due: Date.now() + 25 * MINUTE }));
  navigate('/clock/' + entry.uid); return entry;
}
const attempt = (api, work) => async () => { try { await work(); } catch (error) { api.say(error.message); } };
const field = (h, name, input) => h('label', { class: 'account-field' }, h('span', { class: 'meta muted', text: name }), input);
const hashArg = () => location.hash.split('/')[2] || '';
const blankAgenda = () => ({ title: '', when: nextHour(), minutes: 60, remindAt: 0, task_uid: '' });

export function mountAgenda(body, api, selected = hashArg()) {
  const { h, add, rowButton, section, keys, split } = api, events = agenda.all(), past = selected === 'past';
  api.title(body, 'calendar', events.length + (events.length === 1 ? ' appointment' : ' appointments'));
  const list = h('div', {}, keys(['+ appointment', () => navigate('/calendar/new'), { class: 'accent' }], [past ? 'upcoming' : 'past', () => navigate(past ? '/calendar' : '/calendar/past')]));
  let group = '';
  const now = Date.now(), shown = events.filter(event => past ? event.when + event.minutes * MINUTE <= now : event.when + event.minutes * MINUTE > now);
  if (past) shown.reverse();
  for (const event of shown) {
    const heading = day(event.when); if (heading !== group) { add(list, section(heading)); group = heading; }
    add(list, rowButton(event.title, time(event.when) + '–' + time(event.when + event.minutes * MINUTE), () => navigate('/calendar/' + event.uid)));
  }
  if (!shown.length) add(list, h('p', { class: 'small muted', text: past ? 'No past appointments.' : 'No appointments.' }));
  const editor = h('div', { class: 'narrow' }), event = selected && !['new', 'past'].includes(selected) ? agenda.get(selected) : null;
  if (event || selected === 'new') appointmentForm(editor, api, event);
  else if (selected && !past) add(editor, h('p', { class: 'small muted', text: 'This appointment was removed.' }));
  else if (drafts.get('appointment', '')) add(editor, rowButton('continue appointment', '', () => navigate('/calendar/new')));
  split(body, list, editor);
}
function appointmentForm(host, api, event) {
  const { h, add, keys } = api, target = event?.uid || '', draft = drafts.get('appointment', target), initial = { ...blankAgenda(), ...event, ...draft };
  const title = h('input', { type: 'text', maxlength: 500, required: true, 'aria-label': 'Appointment title', placeholder: 'Title' }); title.value = initial.title;
  const when = h('input', { type: 'datetime-local', required: true, 'aria-label': 'Appointment date and time' }); when.value = dateInput(initial.when || nextHour());
  const minutes = h('input', { type: 'number', min: 1, max: 1440, step: 1, required: true, 'aria-label': 'Duration in minutes' }); minutes.value = initial.minutes || 60;
  const reminder = h('select', { 'aria-label': 'Appointment reminder' });
  const lead = initial.remindAt ? Math.max(0, Math.round((initial.when - initial.remindAt) / MINUTE)) : initial.remind ? 0 : -1;
  const leads = [-1, 0, 5, 15, 30, 60]; if (!leads.includes(lead)) leads.push(lead);
  for (const value of leads) add(reminder, h('option', { value, text: value < 0 ? 'off' : value === 0 ? 'at start' : value + ' min before' })); reminder.value = String(lead);
  const values = () => { const at = new Date(when.value).getTime(), before = Number(reminder.value); return { title: title.value, when: Number.isFinite(at) ? at : 0, minutes: Number(minutes.value), remind: before >= 0, remindAt: before >= 0 && Number.isFinite(at) ? Math.max(0, at - before * MINUTE) : 0, task_uid: initial.task_uid || '' }; };
  const saveDraft = attempt(api, () => drafts.set('appointment', target, values()));
  for (const input of [title, when, minutes, reminder]) input.addEventListener('input', saveDraft);
  const form = h('form', { class: 'account-create', onsubmit: async e => {
    e.preventDefault(); if (!form.reportValidity()) return;
    await attempt(api, () => { const saved = agenda.save({ ...event, ...values(), uid: event?.uid }); drafts.clear('appointment', target); navigate('/calendar/' + saved.uid); api.say('Saved.'); })();
  } }, field(h, 'TITLE', title), field(h, 'WHEN', when), field(h, 'MINUTES', minutes), field(h, 'REMINDER', reminder), h('button', { type: 'submit', class: 'accent', text: 'save appointment' }));
  add(host, form);
  if (initial.task_uid) {
    const task = tasks.get(initial.task_uid); if (task) add(host, api.rowButton('open task', task.text, () => api.go('/tasks/' + task.uid)));
  }
  add(host, keys(['back', () => { saveDraft(); navigate('/calendar'); }], ...(event ? [['delete', attempt(api, async () => { if (await api.confirm('Delete this appointment on all devices?', 'delete')) { agenda.remove(event.uid); drafts.clear('appointment', target); navigate('/calendar'); } })]] : [['discard draft', attempt(api, () => { drafts.clear('appointment', target); navigate('/calendar'); })]])));
}

const watchers = new Set();
let ticker;
function notification(entry) {
  if (globalThis.Notification?.permission !== 'granted') return;
  try { new Notification(entry.title || (entry.kind === 'alarm' ? 'Alarm' : 'Time is up'), { tag: 'pocket-clock-' + entry.uid }); } catch { /* Phone scheduling remains independent. */ }
}
function tick() {
  const now = Date.now();
  for (const entry of clock.all()) {
    if (!entry.enabled || entry.kind === 'stopwatch' || entry.due <= 0 || entry.due > now) continue;
    if (now - entry.due <= MINUTE) notification(entry);
    try { clock.save({ ...entry, enabled: entry.kind === 'alarm' && entry.daily, due: entry.kind === 'alarm' && entry.daily ? nextAlarm(entry.hour, entry.minute, now) : entry.due }); } catch { /* Retry after the next local refresh. */ }
  }
  for (const watch of watchers) { if (!watch.body.isConnected) watchers.delete(watch); else watch.run(now); }
}
export function startClockRuntime() { if (!ticker) ticker = setInterval(tick, 1000); }
function watch(body, run) { watchers.add({ body, run }); run(Date.now()); startClockRuntime(); }
export function requestNotifications() {
  if (!globalThis.Notification) return Promise.resolve('unavailable');
  return Notification.requestPermission();
}
function subtitle(entry, now) {
  if (entry.kind === 'stopwatch') return clockText(elapsed(entry, now));
  if (entry.kind === 'alarm') return entry.task_uid ? day(entry.due) + ' · ' + time(entry.due) + (entry.enabled ? '' : ' · off') : pad(entry.hour) + ':' + pad(entry.minute) + (entry.daily ? ' · daily' : '') + (entry.enabled ? '' : ' · off');
  return (entry.kind === 'focus' ? 'focus · ' : '') + (entry.enabled ? clockText(left(entry, now)) : entry.due ? 'done' : 'paused · ' + clockText(left(entry, now)));
}
export function mountClock(body, api, selected = hashArg()) {
  const { h, add, rowButton, section, keys, split } = api, entries = clock.all().filter(entry => entry.kind !== 'stopwatch');
  api.title(body, 'clock', entries.filter(entry => entry.enabled).length + ' running');
  const list = h('div', {}, keys(['+ alarm', () => navigate('/clock/new/alarm')], ['+ timer', () => navigate('/clock/new/timer')], ['+ focus', () => navigate('/clock/new/focus')]));
  for (const [heading, kinds] of [['ALARMS', ['alarm']], ['TIMERS', ['timer', 'focus']]]) {
    add(list, section(heading)); const group = entries.filter(entry => kinds.includes(entry.kind));
    for (const entry of group) {
      const state = h('span'); add(list, rowButton(entry.title || entry.kind, state, () => navigate('/clock/' + entry.uid)));
      watch(body, now => { const current = clock.get(entry.uid); state.textContent = current ? subtitle(current, now) : 'removed'; });
    }
    if (!group.length) add(list, h('p', { class: 'small muted', text: heading === 'ALARMS' ? 'No alarms.' : 'No timers.' }));
  }
  const stopwatch = clock.stopwatch(), stopwatchState = h('span'); add(list, section('STOPWATCH'), rowButton(stopwatch.title, stopwatchState, () => navigate('/clock/stopwatch')));
  watch(body, now => { stopwatchState.textContent = subtitle(clock.stopwatch(), now); });
  if (globalThis.Notification) add(list, rowButton(Notification.permission === 'granted' ? 'notifications on' : 'notifications', '', attempt(api, async () => { const permission = await requestNotifications(); api.say(permission === 'granted' ? 'Notifications on.' : 'Notifications are off.'); })));
  const detail = h('div', { class: 'narrow' }), entry = selected === 'stopwatch' ? stopwatch : clock.get(selected);
  if (selected === 'new') clockForm(detail, api, null, location.hash.split('/')[3] || 'timer');
  else if (entry?.kind === 'stopwatch') stopwatchView(detail, body, api);
  else if (entry) {
    clockControls(detail, body, api, entry);
    clockForm(detail, api, entry, entry.kind);
  } else if (selected) add(detail, h('p', { class: 'small muted', text: 'This clock was removed.' }));
  else stopwatchView(detail, body, api);
  split(body, list, detail); startClockRuntime();
}
function clockControls(host, body, api, entry) {
  const { h, add, keys } = api;
  if (entry.kind === 'alarm') return;
  const display = h('div', { class: 'workspace-title', role: 'timer', 'aria-live': 'off' }), controls = h('div'); let state = '';
  const refresh = now => {
    const current = clock.get(entry.uid); if (!current) return;
    display.textContent = current.enabled ? clockText(left(current, now)) : current.due ? 'done' : clockText(left(current, now));
    const next = JSON.stringify([current.enabled, current.due, current.remaining]); if (state === next) return; state = next;
    controls.replaceChildren(keys([current.enabled ? 'pause' : current.due ? 'start again' : 'resume', attempt(api, () => { if (clock.get(entry.uid)?.enabled) clock.pause(entry.uid); else clock.resume(entry.uid); refresh(Date.now()); }), { class: 'accent' }]));
  };
  add(host, display, controls); watch(body, refresh);
}
function stopwatchView(host, body, api) {
  const { h, add, keys } = api, display = h('div', { class: 'workspace-title', role: 'timer', 'aria-live': 'off' }), controls = h('div'); let state = '';
  add(host, api.section('STOPWATCH'), display, controls);
  const refresh = now => {
    const entry = clock.stopwatch(); display.textContent = clockText(elapsed(entry, now));
    const next = JSON.stringify([entry.enabled, entry.due, entry.remaining]); if (next === state) return; state = next;
    controls.replaceChildren(keys([entry.enabled ? 'pause' : entry.remaining ? 'resume' : 'start', attempt(api, () => { if (!clock.get('stopwatch')) clock.save(entry); if (clock.get('stopwatch').enabled) clock.pause('stopwatch'); else clock.resume('stopwatch'); refresh(Date.now()); }), { class: 'accent' }], ['reset', attempt(api, () => { clock.save({ ...entry, enabled: false, due: 0, remaining: 0 }); refresh(Date.now()); })]));
  };
  watch(body, refresh);
}
function clockForm(host, api, entry, kind) {
  const { h, add, keys } = api, capture = !entry ? drafts.get('capture', 'clock') : null;
  if (!['alarm', 'timer', 'focus'].includes(kind)) kind = 'timer';
  const current = clockRecord(kind, { title: kind === 'focus' ? 'Focus' : '', remaining: (kind === 'focus' ? 25 : 5) * MINUTE, ...entry, ...(capture?.domain === 'clock' && capture.kind === kind ? capture : {}) });
  const title = h('input', { type: 'text', maxlength: 500, 'aria-label': 'Clock title', placeholder: kind === 'alarm' ? 'Alarm' : kind === 'focus' ? 'Focus' : 'Timer' }); title.value = current.title;
  const form = h('form', { class: 'account-create' }, field(h, 'TITLE', title));
  let read;
  if (kind === 'alarm') {
    const due = h('input', { type: current.task_uid ? 'datetime-local' : 'time', required: true, 'aria-label': 'Alarm time' });
    due.value = current.task_uid ? dateInput(current.due || nextHour()) : pad(current.hour) + ':' + pad(current.minute);
    const enabled = h('input', { type: 'checkbox' }), daily = h('input', { type: 'checkbox' }); enabled.checked = entry ? current.enabled : true; daily.checked = current.daily;
    add(form, field(h, current.task_uid ? 'WHEN' : 'TIME', due), h('label', { class: 'check-label' }, enabled, 'on'), !current.task_uid ? h('label', { class: 'check-label' }, daily, 'daily') : null);
    read = () => {
      const at = current.task_uid ? new Date(due.value) : null, [hour, minute] = current.task_uid ? [at.getHours(), at.getMinutes()] : due.value.split(':').map(Number);
      const deadline = current.task_uid ? at.getTime() : nextAlarm(hour, minute);
      if (enabled.checked && deadline <= Date.now()) throw new Error('Choose a future reminder time.');
      return { enabled: enabled.checked, daily: !current.task_uid && daily.checked, hour, minute, due: deadline, remaining: 0 };
    };
  } else {
    const minutes = h('input', { type: 'number', min: 1 / 60, max: 1440, step: 'any', required: true, 'aria-label': 'Minutes' }); minutes.value = Number((current.remaining / MINUTE).toFixed(3));
    add(form, field(h, 'MINUTES', minutes));
    read = () => { const remaining = Math.round(Number(minutes.value) * MINUTE); if (!Number.isSafeInteger(remaining) || remaining < 1000 || remaining > DAY) throw new Error('Use 1 second to 24 hours.'); return { remaining, enabled: true, daily: false, due: Date.now() + remaining }; };
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!form.reportValidity()) return;
    await attempt(api, () => { const saved = clock.save({ ...current, title: title.value.trim(), ...read() }); if (!entry) drafts.clear('capture', 'clock'); navigate('/clock/' + saved.uid); api.say('Saved.'); })();
  });
  add(form, h('button', { type: 'submit', class: 'accent', text: kind === 'alarm' ? 'save alarm' : entry ? 'set & start' : kind === 'focus' ? 'start focus' : 'start timer' })); add(host, form);
  if (current.task_uid) { const task = tasks.get(current.task_uid); if (task) add(host, api.rowButton('open task', task.text, () => api.go('/tasks/' + task.uid))); }
  add(host, keys(['back', () => navigate('/clock')], ...(entry ? [['delete', attempt(api, async () => { if (await api.confirm('Delete this clock on all devices?', 'delete')) { clock.remove(entry.uid); navigate('/clock'); } })]] : [])));
}
