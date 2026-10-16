import { connected, post, request } from './cloud.js';
import { syncNow } from './sync.js';
import { API, pipAway, routineEditor } from './pip-away.js';
import { ROUTINE_KINDS, STATUS_MARK, lastRunLine, routineCaption, routineProblems, routineWhen, scheduleSummary, sortRoutines, statusText } from './pip-routine-model.js';

// Everything Pip runs on a schedule: every routine, when it runs next, how its last run went, and the recent
// runs themselves (a failure stays readable here even after the routine row shows something newer).
const CACHE = 60000;
let cache = null;

/** The account's routine state, reused for a minute so the Pip header does not refetch on every visit. */
export async function scheduledState(force = false) {
  if (!force && cache && Date.now() - cache.at < CACHE) return cache.state;
  const state = await request(API); cache = { at: Date.now(), state }; return state;
}
export const remember = state => { cache = { at: Date.now(), state }; };
/** What needs attention: a failed run, one that was due and never ran, or nothing to run with. */
export const scheduledProblems = state => routineProblems(state);
/** How many routines need a look, for the Pip header and the launcher mark. Never throws. */
export async function scheduledProblemCount() {
  if (!connected()) return 0;
  try { return routineProblems(await scheduledState()).length; } catch { return 0; }
}

export async function pipScheduled(ui, { root, go, openChat }) {
  const caption = (text, extra = {}) => ui.h('p', { class: 'meta muted', ...extra, text });
  const button = (text, run, props = {}) => ui.h('button', { onclick: async () => { try { await run(); } catch (error) { ui.say(error.message); } }, ...props }, text);
  const refresh = async state => { remember(state); await show(state); };
  const body = ui.h('div', { class: 'pip-schedule' });
  root.replaceChildren(ui.h('div', { class: 'pip-panel' },
    ui.h('header', { class: 'pip-heading' },
      ui.h('div', {}, ui.h('h1', { class: 'workspace-title', text: 'scheduled' }), caption('Routines Pip runs while Pocket is closed.')),
      ui.h('div', { class: 'pip-chat-actions' }, button('back to chats', () => go('/pip')), button('on its own', () => pipAway(ui, openChat)))),
    body));

  const routineRow = routine => ui.h('div', { class: 'pip-routine' + (routine.enabled ? '' : ' paused') },
    ui.h('strong', { text: routine.title }),
    routine.kind !== 'prompt' ? ui.h('span', { class: 'meta muted', text: ' · ' + (ROUTINE_KINDS[routine.kind] || routine.kind) }) : null,
    routine.lastError || routine.lastStatus === 'failed' ? ui.h('span', { class: 'pip-run-status failed', text: ' △' }) : null,
    caption(routineCaption(routine)),
    caption(lastRunLine(routine), routine.lastStatus && routine.lastStatus !== 'done' ? { class: 'meta warn' } : {}),
    routine.lastError ? caption(routine.lastError, { class: 'pip-run-status failed' }) : null,
    ui.h('div', { class: 'pip-routine-actions' },
      button(routine.enabled ? 'pause' : 'resume', async () => { await refresh(await post(API, { action: 'routine', routine: { ...routine, enabled: !routine.enabled } })); }, { title: routine.enabled ? 'Stop running this until you resume it' : 'Run this again on schedule' }),
      button('run now', async () => {
        ui.say('Pip is running “' + routine.title + '”…');
        const next = await post(API, { action: 'run', id: routine.id }), result = next.run || {};
        if (result.error) ui.say(result.error);
        else if (result.status === 'unchanged') ui.say('Nothing new to review.');
        else if (!result.chat && result.status !== 'done') ui.say('This run did not produce a chat.');
        await refresh(next);
        if (result.chat) { await syncNow(); openChat(result.chat); }
      }),
      button('edit', () => routineEditor(ui, routine, { onSaved: async state => { ui.closeDialog(); await refresh(state); } })),
      routine.lastChat ? button('open chat', async () => { await syncNow(); openChat(routine.lastChat); }) : null));

  const runRow = run => ui.h('div', { class: 'pip-run' },
    ui.h('div', { class: 'pip-run-head' },
      ui.h('span', { class: 'pip-run-status ' + run.status, text: (STATUS_MARK[run.status] || '·') + ' ' + statusText(run.status) }),
      ui.h('span', { class: 'meta muted', text: ' · ' + routineWhen(run.at) + ' · ' + run.title })),
    run.error ? caption(run.error, { class: 'pip-run-status failed' }) : null,
    run.chat ? button('open chat', async () => { await syncNow(); openChat(run.chat); }) : null);

  async function show(state) {
    const routines = sortRoutines(state.routines || []), problems = routineProblems(state);
    body.replaceChildren(
      problems.length ? ui.h('div', { class: 'pip-attention', role: 'status' },
        ui.h('strong', { text: problems.length === 1 ? 'one routine needs attention' : problems.length + ' routines need attention' }),
        ui.h('ul', {}, problems.map(item => ui.h('li', { text: item.routine + ' · ' + item.text })))) : null,
      caption(scheduleSummary(state)),
      ui.h('h2', {}, 'routines', ui.h('span', { class: 'meta muted', text: routines.length ? ' · newest runs appear below' : '' })),
      ...(routines.length ? routines.map(routineRow) : [caption('No routines yet. Add a morning check-in or a scheduled prompt in settings.'),
        ui.h('div', { class: 'pip-routine-actions' }, button('+ scheduled prompt', () => routineEditor(ui, undefined, { onSaved: async state => { ui.closeDialog(); await refresh(state); } })))]),
      ui.h('h2', {}, 'recent runs'),
      ...((state.runs || []).length ? state.runs.map(runRow) : [caption('Nothing has run yet, or no run has produced a chat.')]));
  }

  if (!connected()) {
    body.replaceChildren(caption('Scheduled runs need a Pocket account: Pip runs them on Pocket\'s server while Pocket is closed.'),
      ui.h('div', { class: 'pip-routine-actions' }, button('sign in', () => go('/account'), { class: 'row-button accent' })));
    return;
  }
  await show(await scheduledState(true));
}
