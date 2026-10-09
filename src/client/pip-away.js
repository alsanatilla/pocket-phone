import { connected, post, request } from './cloud.js';
import { syncNow } from './sync.js';

// Pip on its own: a dedicated key, what Pip may read, and routines that run on Pocket's server while
// Pocket is closed. Training routines may also maintain workouts and their own dated gym tasks.
const GRANTS = [['notes', 'Notes'], ['thoughts', 'Thoughts'], ['tasks', 'Tasks'], ['gym', 'Gym'], ['coros', 'COROS']];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], WEEK = [1, 2, 3, 4, 5, 6, 0];
const START = { provider: 'compatible', model: 'openrouter/free', baseUrl: 'https://openrouter.ai/api/v1', maxTokens: 8192, webSearch: false, grants: ['notes', 'thoughts', 'tasks'], dailyTokens: 200000, enabled: true };
const API = '/api/pip/background';
const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const dayList = days => days.length === 7 ? 'every day' : days.join() === '1,2,3,4,5' ? 'weekdays' : WEEK.filter(day => days.includes(day)).map(day => DAYS[day]).join(' ');
const when = at => new Date(at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

export async function pipAway(ui, openChat) {
  const caption = text => ui.h('p', { class: 'meta muted', text });
  const button = (text, run, props = {}) => ui.h('button', { onclick: async () => { try { await run(); } catch (error) { ui.say(error.message); } }, ...props }, text);
  if (!connected()) {
    await ui.dialog('pip · on its own', ui.h('div', { class: 'pip-settings' }, caption('Pip can run on a schedule while Pocket is closed and reply in a Pip chat. It needs a Pocket account.'),
      button('sign in', () => { ui.closeDialog(); ui.go('/account'); }, { class: 'row-button accent' })), [['close', null]]);
    return;
  }
  const show = async state => {
    const settings = { ...START, timezone: timezone(), ...state.settings }, error = caption(''); error.classList.add('warn');
    const provider = ui.h('select', { 'aria-label': 'API provider' }, ui.h('option', { value: 'compatible', text: 'Compatible chat API' }), ui.h('option', { value: 'anthropic', text: 'Anthropic' })); provider.value = settings.provider;
    const endpoint = ui.h('input', { type: 'url', 'aria-label': 'API base URL', value: settings.baseUrl });
    const model = ui.h('input', { 'aria-label': 'Model ID', maxlength: 120, value: settings.model });
    const key = ui.h('input', { type: 'password', autocomplete: 'off', 'aria-label': 'Dedicated API key', placeholder: state.hasKey ? 'stored · leave blank to keep' : 'a key with a spending limit' });
    const limit = ui.h('input', { type: 'number', min: 1000, max: 5000000, step: 1000, 'aria-label': 'Daily token limit', value: settings.dailyTokens });
    const replyLimit = ui.h('input', { type: 'number', min: 64, max: 8192, step: 64, 'aria-label': 'Reply token limit', value: settings.maxTokens });
    const check = (label, checked) => { const input = ui.h('input', { type: 'checkbox' }); input.checked = checked; return { input, view: ui.h('label', { class: 'check-label' }, input, label) }; };
    const enabled = check('run my routines', settings.enabled), web = check('web search (Firecrawl)', settings.webSearch);
    const grants = GRANTS.map(([name, label]) => ({ name, ...check(label, settings.grants.includes(name)) }));
    const read = () => ({ provider: provider.value, baseUrl: provider.value === 'anthropic' ? 'https://api.anthropic.com/v1' : endpoint.value.trim(), model: model.value.trim(), maxTokens: Number(replyLimit.value),
      webSearch: web.input.checked, grants: grants.filter(item => item.input.checked).map(item => item.name), dailyTokens: Number(limit.value), timezone: timezone(), enabled: enabled.input.checked });
    const routines = state.routines.map(routine => ui.h('div', { class: 'pip-routine' },
      ui.h('strong', { text: routine.title }),
      caption([routine.time + ' · ' + dayList(routine.days), routine.nextRun ? 'next ' + when(routine.nextRun) : 'paused', routine.lastError].filter(Boolean).join(' · ')),
      ui.h('div', { class: 'pip-routine-actions' },
        button('run now', async () => {
          ui.say('Pip is running “' + routine.title + '”…');
          const next = await post(API, { action: 'run', id: routine.id });
          if (next.run.error) ui.say(next.run.error);
          else if (!next.run.chat) ui.say(next.run.status === 'off' ? 'Save a dedicated key and enable routines first.' : 'This run did not produce a chat.');
          if (next.run.chat) { await syncNow(); ui.closeDialog(); openChat(next.run.chat); return; }
          await show(next);
        }),
        routine.lastChat ? button('open chat', async () => { await syncNow(); ui.closeDialog(); openChat(routine.lastChat); }) : null,
        button('edit', () => edit(routine)))));
    const edit = async (routine = { kind: 'prompt', title: '', prompt: '', time: '08:00', days: [1, 2, 3, 4, 5], enabled: true }) => {
      const training = routine.kind === 'training';
      const title = ui.h('input', { 'aria-label': 'Routine name', maxlength: 80, value: routine.title });
      const prompt = ui.h('textarea', { 'aria-label': 'What Pip should do', rows: 5, maxlength: 4000 }); prompt.value = routine.prompt || '';
      const time = ui.h('input', { type: 'time', 'aria-label': 'Time', value: routine.time });
      const days = WEEK.map(day => ({ day, ...check(DAYS[day], routine.days.includes(day)) })), on = check('on', routine.enabled), problem = caption(''); problem.classList.add('warn');
      const trainingDays = WEEK.map(day => ({ day, ...check(DAYS[day], (routine.trainingDays || []).includes(day)) }));
      const save = async () => {
        try { await show(await post(API, { action: 'routine', routine: { ...routine, title: title.value, prompt: prompt.value, time: time.value, days: days.filter(item => item.input.checked).map(item => item.day), enabled: on.input.checked,
          ...(training ? { trainingDays: trainingDays.filter(item => item.input.checked).map(item => item.day) } : {}) } })); }
        catch (failure) { problem.textContent = failure.message; }
      };
      if (training) prompt.placeholder = 'Your running and gym goals, weekly time budget, equipment, preferences, and any current fatigue or limitations.';
      await ui.dialog(routine.id ? routine.title : training ? 'training planner' : routine.kind === 'checkin' ? 'morning check-in' : 'scheduled prompt', ui.h('div', { class: 'pip-settings' },
        ui.h('label', {}, 'name', title), routine.kind !== 'checkin' ? ui.h('label', {}, training ? 'goals & current training situation' : 'what Pip should do', prompt) : caption('Overdue and due tasks, old parked thoughts, COROS readiness and load, with up to three suggestions.'),
        training ? caption('Automatically plans the next seven days from tomorrow using live COROS recovery, load, recent activities and your Gym history. Running, cycling and trail workouts go to COROS; gym and recovery sessions become dated Pocket tasks. Updates its own sessions, leaves manual workouts intact, and reports changes here.') : null,
        training ? caption('Requires Gym, COROS and Tasks access. COROS must be connected in Movement. Missing live data stops changes. COROS cannot remove a workout; Pip will flag a session to skip when needed.') : null,
        training ? caption('available training days') : null,
        training ? ui.h('div', { class: 'pip-days', 'aria-label': 'Available training days' }, trainingDays.map(item => item.view)) : null,
        ui.h('label', {}, (training ? 'review plan at · ' : 'time · ') + timezone(), time),
        training ? caption('review plan on') : null,
        ui.h('div', { class: 'pip-days', 'aria-label': 'Routine days' }, days.map(item => item.view)), on.view, problem,
        button(training ? 'save automatic training planner' : 'save routine', save, { class: 'row-button accent' }),
        routine.id ? button('delete routine', async () => show(await post(API, { action: 'delete-routine', id: routine.id }))) : null,
        button('back', async () => show(await request(API)))), [['close', null]]);
    };
    const hasCheckin = state.routines.some(routine => routine.kind === 'checkin');
    await ui.dialog('pip · on its own', ui.h('div', { class: 'pip-settings' },
      caption('Runs on Pocket\'s server while Pocket is closed, with a key used only for this. Replies arrive as Pip chats. Check-ins and prompts suggest changes. The training planner automatically saves workouts and its own gym tasks.'),
      caption(state.hasKey ? 'today · ' + state.usedToday.toLocaleString() + ' of ' + settings.dailyTokens.toLocaleString() + ' tokens' : 'Add a key to start. Set a spending limit for it at your provider.'),
      ui.h('label', {}, 'Provider', provider), ui.h('label', {}, 'API base URL', endpoint), ui.h('label', {}, 'Model', model), ui.h('label', {}, 'Dedicated key', key),
      ui.h('label', {}, 'Daily token limit', limit), ui.h('label', {}, 'Reply token limit', replyLimit), caption('For a full training week, use 8,192 reply tokens.'), enabled.view,
      caption('Pip may read'), ...grants.map(item => item.view), web.view, caption('Calendar appointments stay on your phone.'), error,
      button('save settings', async () => {
        try { await show(await post(API, { action: 'settings', settings: read(), key: key.value.trim() })); }
        catch (failure) { error.textContent = failure.message; }
      }, { class: 'row-button accent' }),
      state.hasKey ? button('forget key', async () => show(await post(API, { action: 'forget-key' }))) : null,
      caption('routines'), ...(routines.length ? routines : [caption('No routines yet.')]),
      hasCheckin ? null : button('+ morning check-in', () => edit({ kind: 'checkin', title: 'Morning check-in', time: '07:30', days: [0, 1, 2, 3, 4, 5, 6], enabled: true })),
      state.routines.some(routine => routine.kind === 'training') ? null : button('+ training planner', () => edit({ kind: 'training', title: 'Training planner', prompt: '', time: '07:00', days: [0, 1, 2, 3, 4, 5, 6], trainingDays: [1, 2, 3, 4, 5, 6, 0], enabled: true })),
      button('+ scheduled prompt', () => edit())), [['close', null]]);
  };
  await show(await request(API));
}
