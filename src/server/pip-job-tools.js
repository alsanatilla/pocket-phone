import { createHash } from 'node:crypto';
import { backgroundAccount, backgroundRoutine, backgroundState, onceResult, removeRoutine, saveRoutine, validTimezone, zonedTime, BACKGROUND_GRANTS } from './pip-background.js';

// Pip sets up the account's jobs when the person asks in words ("remind me every Monday at 8 …"). The tools take
// what saveRoutine validates, in words a model gets right (day names, a local moment), and answer a refusal with
// the validator's own sentence so the model can correct itself. Offered only to server replies (`jobs: true` in the
// run's value, set by drive); a job's own run never has them, so a job never creates jobs.

/** The tools, in the order a model meets them. remove_job waits for the person's approval (a write tool). */
export const JOB_TOOLS = ['list_jobs', 'create_job', 'change_job', 'remove_job'];
const KINDS = ['prompt', 'watch', 'checkin', 'brief'], FIXED = ['checkin', 'brief'];
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const FULL_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
/** A day name as the model writes it ("mon" or "monday", any case) as its number, or -1 when it is not one. */
const dayNumber = day => { const name = String(day).trim().toLowerCase(); return Math.max(DAY_NAMES.indexOf(name), FULL_DAYS.indexOf(name)); };
const SHOWN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const refused = message => ({ error: 'invalid_job', message });

/**
 * The account's timezone for jobs: the background settings', else the chat's (the device's), else UTC. Jobs do not
 * run until the background settings exist, but a moment said now must mean the person's local time.
 */
async function settingsOf(userId, fallback = '') {
  const saved = await backgroundAccount(userId);
  const timezone = saved?.settings?.timezone || (validTimezone(fallback) ? fallback : 'UTC');
  return { settings: saved?.settings || null, timezone, on: Boolean(saved?.settings?.enabled && (saved?.credentials || saved?.accountKey)) };
}

const wall = (at, timeZone) => new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at).replace(',', '');
const dayList = days => {
  const set = [...new Set(days)].sort();
  if (set.length === 7) return 'every day';
  if (set.join() === '1,2,3,4,5') return 'weekdays';
  if (set.join() === '0,6') return 'weekends';
  return set.map(day => SHOWN_DAYS[day]).join(' ');
};
/** A job's schedule in a few words, in the account's timezone: "Mon 08:00", "every 2 h · 08:00–22:00", "once · 2026-11-14 08:00". */
export function scheduleWords(routine, timeZone) {
  if (Number.isSafeInteger(routine.at)) return 'once · ' + wall(routine.at, timeZone);
  if (Number.isInteger(routine.every)) {
    const every = routine.every % 60 === 0 ? (routine.every === 60 ? 'every hour' : 'every ' + routine.every / 60 + ' h') : 'every ' + routine.every + ' min';
    return every + (routine.activeHours ? ' · ' + routine.activeHours.start + '–' + (routine.activeHours.end === '00:00' ? '24:00' : routine.activeHours.end) : '') + (routine.days.length === 7 ? '' : ' · ' + dayList(routine.days));
  }
  return (routine.days.length === 7 ? 'daily ' : dayList(routine.days) + ' ') + routine.time;
}

/** A job as the model reads it: what it needs to answer "what do you do for me?" and to refer to one by id. */
const shown = (routine, timeZone) => ({ id: routine.id, title: routine.title, type: routine.kind, schedule: scheduleWords(routine, timeZone), enabled: routine.enabled,
  to: routine.chat ? 'own' : routine.to === 'home' ? 'home' : 'own', ...(routine.prompt ? { prompt: routine.prompt.slice(0, 300) } : {}),
  next: routine.enabled && routine.nextRun ? wall(routine.nextRun, timeZone) : null, ...(routine.delivery === 'quiet' ? { quiet: true } : {}) });

/**
 * The tool's arguments as backgroundRoutine reads them. Only what is given is set; a new schedule replaces the old
 * one's mode (a time, an interval or a moment), keeping the days unless new ones are given.
 */
function routineFields(input, timeZone) {
  const fields = {};
  for (const name of ['title', 'prompt', 'time', 'every', 'enabled']) if (input[name] !== undefined) fields[name] = input[name];
  if (input.kind !== undefined) fields.kind = input.kind;
  // A day that is not one is refused, not dropped: a job on fewer days than asked for runs at the wrong times.
  if (input.days !== undefined) {
    const days = Array.isArray(input.days) ? input.days.map(dayNumber) : [-1];
    if (days.includes(-1)) return { problem: 'Write the days as mon, tue, wed, thu, fri, sat or sun.' };
    fields.days = days;
  }
  if (input.at !== undefined) {
    const written = String(input.at).trim(), match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(written);
    if (!match) return { problem: 'Write the moment as YYYY-MM-DD HH:MM in the account\'s timezone (' + timeZone + ').' };
    const [year, month, day, hour, minute] = match.slice(1).map(Number);
    // A date that is not on the calendar (the 30th of February) is refused instead of rolling over into March.
    const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute));
    if (hour > 23 || minute > 59 || calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day)
      return { problem: written + ' is not a date and time on the calendar. Write the moment as YYYY-MM-DD HH:MM.' };
    const at = zonedTime(year, month, day, hour, minute, timeZone);
    // A clock time the timezone skips (the hour the clocks go forward) is refused rather than moved; one it repeats
    // (the hour they go back) is the later of the two, the one zonedTime gives, which reads back as written.
    if (wall(at, timeZone) !== match.slice(1, 4).join('-') + ' ' + match.slice(4).join(':'))
      return { problem: written + ' does not exist in ' + timeZone + ': the clocks skip that hour. Choose another time.' };
    fields.at = at;
  }
  if (input.active_from !== undefined || input.active_until !== undefined) fields.activeHours = { start: input.active_from, end: input.active_until };
  if (input.quiet !== undefined) fields.delivery = input.quiet ? 'quiet' : 'notify';
  if (input.to !== undefined) fields.to = input.to;
  return { fields };
}
const SCHEDULE = ['time', 'every', 'at', 'activeHours'];

/** The id a job created in this reply's tool call keeps, so a call made again after a restart saves the same job. */
const jobId = (chat, turn, eventId) => 'j' + createHash('sha256').update([chat, turn, eventId].join('\n')).digest('hex').slice(0, 24);
/** The record grants and web access of the chat that creates or changes a job: a job never has more. */
const chatAccess = value => ({ grants: (Array.isArray(value?.grants) ? value.grants : []).filter(grant => BACKGROUND_GRANTS.includes(grant)), web: Boolean(value?.webSearch) });

async function save(userId, routine, once = '') {
  try {
    const state = await saveRoutine(userId, routine, { once });
    if (state.repeated) return { repeated: true };
    return state.routines.find(item => item.id === routine.id) || null;
  } catch (error) {
    if (error.status === 400) return { problem: error.message };
    throw error;
  }
}
/** Whether a stored job is the one these fields describe: the same kind, name, instruction and schedule. */
function sameJob(routine, fields, timeZone) {
  let wanted;
  try { wanted = backgroundRoutine(fields); } catch { return false; }
  return routine.kind === wanted.kind && routine.title.toLowerCase() === wanted.title.toLowerCase() && routine.prompt === wanted.prompt
    && scheduleWords(routine, timeZone) === scheduleWords(wanted, timeZone);
}
const current = async (userId, id) => (await backgroundState(userId)).routines.find(item => item.id === String(id || '')) || null;
const notTraining = routine => routine.kind === 'training' ? refused('The training planner is changed in its own training chat, not with this tool.') : null;

/**
 * Runs one job tool for a server reply. `chat` and `turn` are the reply's, `eventId` its tool row's; `value` is the
 * run's value, whose grants and web access bound the job.
 */
export async function jobTool(userId, name, input = {}, { chat = '', turn = '', eventId = '', value = {} } = {}) {
  const { timezone, on } = await settingsOf(userId, value?.timezone);
  if (name === 'list_jobs') {
    const { routines } = await backgroundState(userId);
    return { kind: 'jobs', timezone, on, limit: 12, jobs: routines.map(routine => shown(routine, timezone)) };
  }
  if (name === 'create_job') {
    if (!KINDS.includes(input.kind)) return refused('Choose a scheduled prompt, a standing watch, a check-in or a brief.');
    // backgroundRoutine would drop the prompt of a check-in or brief without a word; the model is told instead.
    if (FIXED.includes(input.kind) && String(input.prompt || '').trim()) return refused('A check-in and a brief have fixed instructions and take no prompt; for your own instruction use kind prompt.');
    const { fields, problem } = routineFields(input, timezone);
    if (problem) return refused(problem);
    const id = jobId(chat, turn, eventId), once = 'create:' + id;
    const off = on ? {} : { off: true, note: 'Pip on its own is off, so this job will not run until the person turns it on in jobs.' };
    // This tool call made again (a reply continued after a restart) creates nothing: it answers with the job as it
    // stands now, paused or changed since, or says it was removed. The key is taken with the job, in one transaction.
    const replayed = async () => {
      const made = await current(userId, id);
      return made ? { kind: 'job', done: 'scheduled', ...shown(made, timezone), timezone, existing: true, ...off }
        : { error: 'job_removed', message: 'The job this call created was removed since; it is not created again.' };
    };
    if (await onceResult(userId, once)) return replayed();
    // The same job asked for twice (a model that repeats its call, a message sent again) is one job: the one that
    // exists is the answer.
    const twin = (await backgroundState(userId)).routines.find(item => item.id !== id && sameJob(item, fields, timezone));
    if (twin) return { kind: 'job', done: 'scheduled', ...shown(twin, timezone), timezone, existing: true, ...off };
    // Only a job created in conversation reports into the big chat unless told otherwise; the Jobs page keeps its own.
    const routine = { to: 'home', ...fields, id, ...chatAccess(value) };
    const saved = await save(userId, routine, once);
    if (saved?.repeated) return replayed();
    if (!saved || saved.problem) return refused(saved?.problem || 'The job could not be saved.');
    return { kind: 'job', done: 'scheduled', ...shown(saved, timezone), timezone, ...off };
  }
  const old = await current(userId, input.id);
  // A removal is approved for a job that existed; gone by the time it runs, it was removed already (a decision sent
  // twice, a reply continued after a restart, or by hand on the Jobs page).
  if (!old && name === 'remove_job') return { error: 'job_not_found', message: 'The job "' + String(input.id || '') + '" no longer exists; it was removed already.' };
  if (!old) return { error: 'job_not_found', message: 'There is no job with id "' + String(input.id || '') + '". Call list_jobs for the ids.' };
  const training = notTraining(old);
  if (training) return training;
  if (name === 'change_job') {
    const { fields, problem } = routineFields(input, timezone);
    if (problem) return refused(problem);
    if (fields.kind && fields.kind !== old.kind) return refused('A job keeps its kind; remove it and create another to change what kind it is.');
    const base = Object.fromEntries(Object.entries(old).filter(([key]) => !['nextRun', 'lastRun', 'lastError', 'lastChat', 'lastStatus', 'scratch'].includes(key)));
    if (SCHEDULE.some(key => fields[key] !== undefined)) for (const key of SCHEDULE) if (fields[key] === undefined) delete base[key];
    // Changed from a chat, a job keeps at most what that chat may read.
    const access = chatAccess(value), grants = Array.isArray(old.grants) ? old.grants.filter(grant => access.grants.includes(grant)) : access.grants;
    const saved = await save(userId, { ...base, ...fields, grants, web: old.web !== false && access.web });
    if (!saved || saved.problem) return refused(saved?.problem || 'The job could not be saved.');
    const only = Object.keys(fields).every(key => key === 'enabled');
    const done = only && old.enabled && !saved.enabled ? 'paused' : only && !old.enabled && saved.enabled ? 'resumed' : 'changed';
    return { kind: 'job', done, ...shown(saved, timezone), timezone };
  }
  if (name === 'remove_job') {
    await removeRoutine(userId, old.id);
    return { kind: 'job', done: 'removed', id: old.id, title: old.title, schedule: scheduleWords(old, timezone) };
  }
  return { error: 'tool_unavailable', message: 'This tool is unavailable.' };
}

/** What the person approves before a job is removed: its name and schedule. */
export async function jobPreview(userId, name, input = {}, value = {}) {
  if (name !== 'remove_job') return { error: 'tool_unavailable', message: 'This tool is unavailable.' };
  const old = await current(userId, input.id);
  if (!old) return { error: 'job_not_found', message: 'There is no job with id "' + String(input.id || '') + '". Call list_jobs for the ids.' };
  const training = notTraining(old);
  if (training) return training;
  const { timezone } = await settingsOf(userId, value?.timezone);
  return { action: { tool: name, kind: 'job', title: old.title + ' · ' + scheduleWords(old, timezone) } };
}
