// The scheduled-run model: when each routine runs, what its last runs did, and what needs a person's
// attention. Free of browser APIs so it can be tested directly; pip-scheduled.js renders it.
export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], WEEK = [1, 2, 3, 4, 5, 6, 0];
export const ROUTINE_KINDS = { checkin: 'morning check-in', prompt: 'scheduled prompt', training: 'training planner' };
export const STATUS_TEXT = { done: 'answered', failed: 'failed', limit: 'token limit reached', off: 'did not run', skipped: 'skipped', unchanged: 'nothing new' };
export const STATUS_MARK = { done: '✓', failed: '△', limit: '△', off: '−', skipped: '−', unchanged: '·' };
/** A run that produced no chat but did something else is still worth naming plainly. */
export const statusText = status => STATUS_TEXT[status] || status || 'unknown';
export const dayList = days => days.length === 7 ? 'every day' : days.join() === '1,2,3,4,5' ? 'weekdays' : WEEK.filter(day => days.includes(day)).map(day => DAYS[day]).join(' ');
export const routineWhen = at => new Date(at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
const LATE = 45 * 60000;
/** The one line under a routine's name: when it runs, and when it runs next (or that it is already due). */
export function routineCaption(routine) {
  const schedule = routine.kind === 'training' ? 'after workouts · daily check ' + routine.time + ' · ' + dayList(routine.days || []) : routine.time + ' · ' + dayList(routine.days || []);
  const next = !routine.nextRun ? (routine.enabled ? 'not scheduled' : 'paused')
    : routine.enabled && routine.nextRun <= Date.now() - LATE ? 'due since ' + routineWhen(routine.nextRun)
    : (routine.kind === 'training' ? 'next data check ' : 'next ') + routineWhen(routine.nextRun);
  return schedule + ' · ' + next;
}
/** The line after it: when it last ran and how that ended. */
export function lastRunLine(routine) {
  if (!routine.lastRun) return 'never run';
  const status = routine.lastStatus || '';
  return 'last ' + routineWhen(routine.lastRun) + (status && status !== 'done' ? ' · ' + statusText(status) : '');
}
const SELF_LATE = 45 * 60000;
/** Everything a person should be told about: a failed run, one that was due and never ran, or nothing to run with. */
export function routineProblems({ routines = [], hasKey = true, settings = null } = {}, now = Date.now()) {
  const problems = [];
  for (const routine of routines) {
    if (routine.lastError || routine.lastStatus === 'failed') { problems.push({ routine: routine.title, text: routine.lastError || 'The last run failed.' }); continue; }
    // A routine whose time has passed by much more than the 15-minute schedule is not being run at all.
    if (routine.enabled && routine.nextRun && routine.nextRun < now - SELF_LATE) problems.push({ routine: routine.title, text: 'Was due ' + routineWhen(routine.nextRun) + ' and has not run since. The schedule may not be running.' });
  }
  if (!hasKey && routines.some(routine => routine.enabled)) problems.push({ routine: 'settings', text: 'No dedicated key is stored, so nothing can run.' });
  else if (settings?.enabled === false && routines.length) problems.push({ routine: 'settings', text: '“run my routines” is switched off.' });
  return problems;
}
/** Live routines first, soonest first; paused ones after them by name. */
export function sortRoutines(routines = []) {
  return [...routines].sort((left, right) => (left.enabled === right.enabled ? 0 : left.enabled ? -1 : 1)
    || (left.nextRun || Infinity) - (right.nextRun || Infinity) || String(left.title).localeCompare(String(right.title)));
}
export function scheduleSummary({ routines = [], hasKey = true, usedToday = 0, settings = null } = {}, now = Date.now()) {
  const live = sortRoutines(routines).filter(routine => routine.enabled && routine.nextRun);
  const upcoming = live.filter(routine => routine.nextRun > now), next = upcoming[0], due = live.length - upcoming.length;
  return [
    hasKey ? 'today · ' + Number(usedToday || 0).toLocaleString() + (settings?.dailyTokens ? ' of ' + Number(settings.dailyTokens).toLocaleString() : '') + ' tokens' : 'no dedicated key',
    routines.length + (routines.length === 1 ? ' routine' : ' routines'),
    settings?.enabled === false ? 'routines switched off' : next ? 'next · ' + routineWhen(next.nextRun) + ' ' + next.title : due ? due + ' waiting to run' : routines.length ? 'nothing scheduled' : ''
  ].filter(Boolean).join(' · ');
}
