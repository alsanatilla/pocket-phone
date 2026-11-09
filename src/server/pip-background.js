import { randomUUID } from 'node:crypto';
import { execute as sql } from './database.js';
import { seal, open } from './secrets.js';
import { keyStatus, readKey } from './pip-keys.js';
import { readDocuments } from './workspace.js';
import { writeObject } from './objects.js';
import { corosState, corosTool, corosCatalog } from './coros.js';
import { EMPTY } from '../shared/workspace.js';
import { config as pipConfig, requestBody, contextCoverage } from '../client/pip-core.js';
import { execute as runTool, recordSource, WRITE_TOOLS } from '../client/pip-tools.js';
import { trainingRuntime, trainingObservation, trainingCheckpoint, trainingChanged, rememberTraining, sweepMissedSessions, TRAINING_GRANTS, TRAINING_CHECK_INTERVAL } from './pip-training.js';
import { trainingChatRoutine } from '../shared/pip-training-chat.js';
import { sweepRuns } from './pip-runs.js';
import { notify } from './pip-notify.js';
import { replyNotice } from '../shared/pip-notice.js';
import { patternDigest } from './pip-patterns.js';

// Pip on its own: routines that run on a schedule with the account's dedicated provider key, read the account's
// server copy and reply in a synced Pip chat. Training routines have scoped writes; calendar appointments stay on the phone.
const DAY = 86400000, NEVER = Number.MAX_SAFE_INTEGER, RUN_DEADLINE = 150000;
/** How long one scheduled job call may keep starting work, within the function's 300-second limit. */
export const JOB_BUDGET = 240000;
export const BACKGROUND_GRANTS = ['notes', 'thoughts', 'tasks', 'gym', 'coros'];
export const BACKGROUND_OWNER = 'pip-routine';
const CHECKIN = 'Morning check-in. Look at my open tasks (overdue, due today and important ones), thoughts I parked more than a week ago, and my COROS readiness and recent training load if available. Tell me briefly what needs attention today and suggest at most three concrete changes, such as moving a task. If nothing needs attention, say so in one line.';
const BRIEF = 'Nightly brief. Look at what actually changed in my Pocket records since the last brief: completed and moved tasks, new or edited notes, thoughts I parked, gym sessions, and my COROS readiness and load when available. Write at most five short parts and leave out any part with nothing to say: (1) what changed, in one line; (2) what is rotting: overdue tasks, a task I moved more than once, a thought parked over a week with no action; (3) one connection or contradiction worth knowing, such as two notes about the same thing or a task that no longer matches the note it came from; (4) the single action that would help most today, and why; (5) a closing line only if something else matters. Never invent a record or a number. Under 150 words, plain sentences, no headings, no list longer than three items. '
  + 'Then call show_card once: a Card (title: the day in under six words; description: "<n due · n done>") holding a Grid of two columns with two Metrics, "next" (two or three words, tone accent) and "rotting" (a count, tone warning), each with a one-line hint. Every value must stay short enough to read on a phone, never a whole paragraph.';
/** The collections a brief is about. Drafts, the clock, receipts and preferences change constantly and are not news. */
const CONTENT_DOCUMENTS = ['notes.json', 'tasks.json', 'parking.json', 'journal.json', 'gym.json'];
/** A watch answers SKIP, in one word, when nothing new matches; that reply is never written to the chat. */
const SKIP = /^\s*skip\b/i;
export const quietWatch = answer => SKIP.test(String(answer || ''));
const watchMessage = (routine, since) => `Standing watch. ${routine.prompt}\n\nLook only at what is new or changed since ${since}. Read what you already reported earlier in this chat and stay silent about it. If nothing new matches, reply with exactly SKIP and nothing else. If something matches, reply in at most 80 words: what you found, where it is, and what I should do next.`;
const WATCH_KINDS = ['brief', 'watch'];
/** What an unattended job is told about its notes. They are its memory between runs; nobody else reads them. */
const JOB_NOTES = notes => '\n\nYour notes from this job\'s earlier runs (only you read them): '
  + (notes.trim() ? '<<<\n' + notes.trim() + '\n>>>' : 'none yet, this is the first run.')
  + ' Use them to leave out what you already reported and to compare with last time. Before your final answer, call update_scratch once with the notes the next run will need'
  + ' (what you reported, values to compare, open threads), replacing the old ones.';
const AWAY = '\n\nThis reply runs on a schedule while the user is away; they read it later, perhaps from a notification. Lead with what needs their attention. You cannot save or change anything in this run: describe a change you suggest so the user can ask for it in this chat. Calendar appointments are on the user\'s phone and not available here.';

// ── Time: a routine's wall-clock time on chosen weekdays, in the account's timezone. ──
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
export function validTimezone(value) { try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return typeof value === 'string' && value.length <= 64; } catch { return false; } }
function wallClock(at, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' }).formatToParts(at).map(part => [part.type, part.value]));
  return { year: +parts.year, month: +parts.month, day: +parts.day, hour: +parts.hour, minute: +parts.minute, second: +parts.second, weekday: WEEKDAYS[parts.weekday] };
}
const offset = (at, timeZone) => { const w = wallClock(at, timeZone); return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(at / 1000) * 1000; };
/** The instant a wall-clock time occurs in a timezone; a time skipped by a DST change moves forward with it. */
export function zonedTime(year, month, day, hour, minute, timeZone) {
  const local = Date.UTC(year, month - 1, day, hour, minute);
  const first = local - offset(local, timeZone);
  return local - offset(first, timeZone);
}
const minutesOf = clock => { const [hour, minute] = clock.split(':').map(Number); return hour * 60 + minute; };
/** Whether a wall-clock moment is on one of the routine's days and inside its active hours (overnight windows work). */
function inWindow(wall, { days, activeHours }) {
  if (Array.isArray(days) && !days.includes(wall.weekday)) return false;
  if (!activeHours) return true;
  const now = wall.hour * 60 + wall.minute, start = minutesOf(activeHours.start), end = minutesOf(activeHours.end);
  return start < end ? now >= start && now < end : now >= start || now < end;
}
const STEP = 15 * 60000;
/**
 * When a routine runs next: once at a moment (`at`), every N minutes on its days within its active hours
 * (`every`), or at a time on chosen days. Interval runs that fall outside the window start when it opens.
 */
export function nextRun(routine, timeZone, after = Date.now()) {
  if (Number.isSafeInteger(routine.at)) return routine.at > after ? routine.at : NEVER;
  if (Number.isInteger(routine.every)) {
    let at = after + routine.every * 60000;
    if (inWindow(wallClock(at, timeZone), routine)) return at;
    for (let step = 0; step < 8 * 96; step++) {
      const previous = at; at += STEP;
      const wall = wallClock(at, timeZone);
      if (!inWindow(wall, routine)) continue;
      // Entered the window during this step: start when it opens, not up to fifteen minutes later.
      const opens = routine.activeHours ? zonedTime(wall.year, wall.month, wall.day, ...routine.activeHours.start.split(':').map(Number), timeZone) : at;
      return opens > previous && opens <= at && inWindow(wallClock(opens, timeZone), routine) ? opens : at;
    }
    return NEVER;
  }
  return nextDaily(routine, timeZone, after);
}
function nextDaily({ time, days }, timeZone, after) {
  const [hour, minute] = time.split(':').map(Number);
  for (let step = 0; step <= 8; step++) {
    const date = wallClock(after + step * DAY, timeZone);
    if (!days.includes(date.weekday)) continue;
    const at = zonedTime(date.year, date.month, date.day, hour, minute, timeZone);
    if (at > after) return at;
  }
  return NEVER;
}
export const localDay = (at, timeZone) => { const w = wallClock(at, timeZone); return [w.year, String(w.month).padStart(2, '0'), String(w.day).padStart(2, '0')].join('-'); };

// ── Settings, key and routines ──
const invalid = message => Object.assign(new Error(message), { status: 400 });
export function trainingMessage(value) {
  if (!value || !trainingChatRoutine(value.chat) || !/^[A-Za-z0-9_-]{1,100}$/.test(value.uid || '') || !/^[A-Za-z0-9_-]{1,100}$/.test(value.attempt || '')
    || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 16000) throw invalid('Write a message in your training chat.');
  const context = value.context || [];
  if (!Array.isArray(context) || context.length > 3 || context.some(item => !item || typeof item.text !== 'string' || item.text.length > 8000 || typeof item.title !== 'string' || item.title.length > 500)) throw invalid('Attach up to three short sources.');
  return { chat: value.chat, uid: value.uid, attempt: value.attempt, text: value.text.trim(), context: context.map(item => ({ kind: String(item.kind || ''), title: item.title, text: item.text })) };
}
export function backgroundSettings(value) {
  const base = pipConfig(value), grants = Array.isArray(value.grants) ? BACKGROUND_GRANTS.filter(name => value.grants.includes(name)) : [];
  const dailyTokens = Number(value.dailyTokens);
  if (!Number.isInteger(dailyTokens) || dailyTokens < 1000 || dailyTokens > 5000000) throw invalid('Choose a daily limit from 1,000 to 5,000,000 tokens.');
  if (!validTimezone(value.timezone)) throw invalid('Choose a valid timezone.');
  return { ...base, thinking: false, grants, dailyTokens, timezone: value.timezone, enabled: Boolean(value.enabled), useAccountKey: Boolean(value.useAccountKey) };
}
export function backgroundRoutine(value) {
  const kind = ['checkin', 'prompt', 'training', 'brief', 'watch'].includes(value.kind) ? value.kind : null;
  if (!kind) throw invalid('Choose a check-in, nightly brief, standing watch, training planner or scheduled prompt.');
  const id = typeof value.id === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(value.id) ? value.id : randomUUID().replaceAll('-', '');
  const title = String(value.title || (kind === 'checkin' ? 'Morning check-in' : kind === 'brief' ? 'Nightly brief' : kind === 'training' ? 'Training planner' : kind === 'watch' ? 'Standing watch' : '')).trim(), prompt = kind !== 'checkin' && kind !== 'brief' ? String(value.prompt || '').trim() : '';
  if (!title || title.length > 80) throw invalid('Give the routine a name, up to 80 characters.');
  if ((kind === 'prompt' || kind === 'watch') && !prompt || prompt.length > 4000) throw invalid(kind === 'watch' ? 'Write what to watch for, up to 4,000 characters.' : 'Write the prompt, up to 4,000 characters.');
  // How it is scheduled: once at a moment, every N minutes, or at a time on chosen days (the default and the only
  // choice for the training planner, whose days carry meaning).
  const mode = kind === 'training' ? 'daily' : Number.isSafeInteger(value.at) ? 'once' : Number.isInteger(value.every) ? 'every' : 'daily';
  const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (mode === 'once' && (value.at < Date.now() - 60000 || value.at > Date.now() + 366 * DAY)) throw invalid('Choose a moment within the next year.');
  if (mode === 'every' && (value.every < 15 || value.every > 1440)) throw invalid('Run every 15 minutes to 24 hours.');
  if (mode === 'daily' && (typeof value.time !== 'string' || !CLOCK.test(value.time))) throw invalid('Choose a time.');
  const days = mode === 'once' ? [0, 1, 2, 3, 4, 5, 6]
    : [...new Set(Array.isArray(value.days) ? value.days.filter(day => Number.isInteger(day) && day >= 0 && day <= 6) : mode === 'every' ? [0, 1, 2, 3, 4, 5, 6] : [])].sort();
  if (!days.length) throw invalid('Choose at least one day.');
  let activeHours = null;
  if (value.activeHours && mode === 'every') {
    const { start, end } = value.activeHours;
    if (!CLOCK.test(start) || !(CLOCK.test(end) || end === '24:00') || start === end) throw invalid('Choose active hours with a different start and end.');
    activeHours = { start, end: end === '24:00' ? '00:00' : end };
  }
  const delivery = value.delivery === 'quiet' ? 'quiet' : 'notify';
  const time = mode === 'daily' ? value.time : '00:00';
  const trainingDays = [...new Set(Array.isArray(value.trainingDays) ? value.trainingDays.filter(day => Number.isInteger(day) && day >= 0 && day <= 6) : [])].sort();
  if (kind === 'training' && !trainingDays.length) throw invalid('Choose your available training days.');
  const feedback = (Array.isArray(value.feedback) ? value.feedback : []).filter(item => Number.isSafeInteger(item.at) && typeof item.text === 'string').slice(-12).map(item => ({ at: item.at, text: item.text.slice(0, 1000) }));
  return { id, kind, title, prompt, time, days, enabled: value.enabled !== false, delivery,
    ...(mode === 'once' ? { at: value.at } : {}), ...(mode === 'every' ? { every: value.every } : {}), ...(activeHours ? { activeHours } : {}),
    ...(kind === 'training' ? { trainingDays, feedback } : {}) };
}
/**
 * The newest change in the records a brief reads. Content (notes, tasks, thoughts, gym, journal) is one document per
 * collection in pocket_documents; chats are the brief's own output, so they never count as news. Missing either
 * source would make the brief think nothing ever changes.
 */
export async function newestRecordAt(userId) {
  const row = (await sql({ sql: `SELECT (SELECT MAX(updated_at) FROM pocket_documents WHERE user_id = ? AND name IN (${CONTENT_DOCUMENTS.map(() => '?').join(',')})) AS documents,
    (SELECT MAX(json_extract(payload, '$.updated')) FROM pocket_objects WHERE user_id = ? AND collection <> 'chats') AS objects`,
    args: [userId, ...CONTENT_DOCUMENTS, userId] })).rows[0];
  return Math.max(Number(row?.documents || 0), Number(row?.objects || 0));
}
const parse = raw => { try { return JSON.parse(String(raw)); } catch { return null; } };
/**
 * The account's background settings and how its jobs reach a model: a dedicated key sealed for them, or, with
 * useAccountKey, the key the account already keeps in its vault for the same provider and endpoint (the one Pip's
 * chat uses), so nobody has to enter the same key twice. The daily token limit applies either way.
 */
async function stored(userId) {
  const row = (await sql({ sql: 'SELECT settings, credentials, used_day, used_tokens FROM pocket_pip_background WHERE user_id = ?', args: [userId] })).rows[0];
  if (!row) return null;
  const settings = parse(row.settings), credentials = row.credentials ? String(row.credentials) : '';
  const accountKey = !credentials && Boolean(settings?.useAccountKey)
    && (await keyStatus(userId, { provider: settings.provider, baseUrl: settings.baseUrl }).catch(() => ({ saved: false }))).saved;
  return { settings, credentials, accountKey, usedDay: String(row.used_day), usedTokens: Number(row.used_tokens) };
}
/** Whether this account's jobs can reach a model. */
const hasKey = saved => Boolean(saved?.credentials || saved?.accountKey);
/** The key a job uses. */
export async function keyOf(userId, saved) {
  if (saved?.credentials) return open(userId, saved.credentials).key;
  if (saved?.accountKey) return readKey(userId, { provider: saved.settings.provider, baseUrl: saved.settings.baseUrl });
  throw invalid('Add a key for Pip on its own first.');
}
/** The account's server key and settings, as a shared chat run needs them. */
export const backgroundAccount = stored;
/** What the account's server key may still spend today. Scheduled routines and shared chat runs share one daily limit. */
export function tokensLeft(saved, now = Date.now()) {
  if (!saved?.settings) return 0;
  return saved.settings.dailyTokens - (saved.usedDay === localDay(now, saved.settings.timezone) ? saved.usedTokens : 0);
}
/** Adds spent tokens to today's total in one statement, so runs finishing together never lose each other's usage. */
export async function chargeTokens(userId, timeZone, tokens, now = Date.now()) {
  if (!(tokens > 0)) return;
  const today = localDay(now, timeZone);
  await sql({ sql: 'UPDATE pocket_pip_background SET used_tokens = CASE WHEN used_day = ? THEN used_tokens + ? ELSE ? END, used_day = ? WHERE user_id = ?', args: [today, tokens, tokens, today, userId] });
}
// ── A job's notes (scratch) ──
const SCRATCH_LIMIT = 2000;
export async function readScratch(userId, routineId) {
  const row = (await sql({ sql: 'SELECT scratch FROM pocket_pip_routine_memory WHERE user_id = ? AND routine_id = ?', args: [userId, String(routineId)] })).rows[0];
  return row ? String(row.scratch) : '';
}
export async function writeScratch(userId, routineId, text, now = Date.now()) {
  const scratch = String(text ?? '').slice(0, SCRATCH_LIMIT);
  await sql({ sql: `INSERT INTO pocket_pip_routine_memory (user_id, routine_id, scratch, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, routine_id) DO UPDATE SET scratch = excluded.scratch, updated_at = excluded.updated_at`, args: [userId, String(routineId), scratch, now] });
  return scratch;
}
export async function clearScratch(userId, routineId) {
  await sql({ sql: 'DELETE FROM pocket_pip_routine_memory WHERE user_id = ? AND routine_id = ?', args: [userId, String(routineId)] });
  return backgroundState(userId);
}

async function routines(userId) {
  const rows = (await sql({ sql: `SELECT payload, next_run, last_run, last_error, last_chat,
    (SELECT status FROM pocket_pip_routine_runs r WHERE r.user_id = pocket_pip_routines.user_id AND r.routine_id = pocket_pip_routines.id ORDER BY r.seq DESC LIMIT 1) AS last_status,
    (SELECT scratch FROM pocket_pip_routine_memory m WHERE m.user_id = pocket_pip_routines.user_id AND m.routine_id = pocket_pip_routines.id) AS scratch
    FROM pocket_pip_routines WHERE user_id = ? ORDER BY rowid`, args: [userId] })).rows;
  return rows.map(row => ({ ...parse(row.payload), nextRun: Number(row.next_run) === NEVER ? 0 : Number(row.next_run), lastRun: Number(row.last_run),
    lastError: String(row.last_error), lastChat: String(row.last_chat), lastStatus: String(row.last_status || ''), scratch: String(row.scratch || '') }));
}
const RUN_STATUS = ['done', 'failed', 'limit', 'off', 'skipped', 'unchanged'], RUN_KEEP = 20;
/** Records what a scheduled run did, so a failure stays visible after the routine row moves on. Training
 * check-ins that find nothing new are recorded too, but left out of the overview a person reads. */
export async function recordRun(userId, routineId, result, now = Date.now()) {
  const status = RUN_STATUS.includes(result?.status) ? result.status : 'failed';
  await sql({ sql: 'INSERT INTO pocket_pip_routine_runs (user_id, routine_id, at, status, error, chat, turn) VALUES (?, ?, ?, ?, ?, ?, ?)',
    args: [userId, String(routineId), now, status, String(result?.error || '').slice(0, 500), String(result?.chat || ''), String(result?.turn || '')] });
  await sql({ sql: `DELETE FROM pocket_pip_routine_runs WHERE user_id = ? AND routine_id = ? AND seq NOT IN (
    SELECT seq FROM pocket_pip_routine_runs WHERE user_id = ? AND routine_id = ? ORDER BY seq DESC LIMIT ${RUN_KEEP})`, args: [userId, String(routineId), userId, String(routineId)] });
}
/** The recent runs of every routine, newest first, with the routine's name. Quiet training checks are left out. */
export async function routineRuns(userId, limit = 30) {
  const rows = (await sql({ sql: `SELECT r.routine_id, r.at, r.status, r.error, r.chat, r.turn, p.payload
    FROM pocket_pip_routine_runs r LEFT JOIN pocket_pip_routines p ON p.user_id = r.user_id AND p.id = r.routine_id
    WHERE r.user_id = ? AND r.status != 'unchanged' ORDER BY r.seq DESC LIMIT ?`, args: [userId, Math.min(Math.max(Number(limit) || 30, 1), 100)] })).rows;
  return rows.map(row => { const routine = parse(row.payload) || {};
    return { routine: String(row.routine_id), title: String(routine.title || 'Removed routine'), kind: String(routine.kind || ''), at: Number(row.at),
      status: String(row.status), error: String(row.error || ''), chat: String(row.chat || ''), turn: String(row.turn || '') }; });
}
/** What the browser shows. The key itself never leaves the server. */
export async function backgroundState(userId) {
  const saved = await stored(userId), today = saved?.settings ? localDay(Date.now(), saved.settings.timezone) : '';
  return { settings: saved?.settings || null, hasKey: hasKey(saved), keySource: saved?.credentials ? 'dedicated' : saved?.accountKey ? 'account' : null, usedToday: saved && saved.usedDay === today ? saved.usedTokens : 0, routines: await routines(userId),
    runs: await routineRuns(userId) };
}
const schedule = (routine, settings, active, after = Date.now()) => active && settings?.enabled && routine.enabled
  ? Math.min(nextRun(routine, settings.timezone, after), routine.kind === 'training' ? after + TRAINING_CHECK_INTERVAL : NEVER) : NEVER;
async function reschedule(userId) {
  const saved = await stored(userId), active = hasKey(saved);
  for (const routine of await routines(userId)) await sql({ sql: 'UPDATE pocket_pip_routines SET next_run = ? WHERE user_id = ? AND id = ?', args: [schedule(routine, saved?.settings, active), userId, routine.id] });
}
export async function saveBackground(userId, value, key = '') {
  const settings = backgroundSettings(value), now = Date.now();
  if (key && !/^[\x21-\x7e]{8,512}$/.test(key)) throw invalid('Enter a valid API key for this provider.');
  if (settings.provider === 'anthropic' && key && !key.startsWith('sk-ant-')) throw invalid('Enter a valid API key for this provider.');
  await sql({ sql: `INSERT INTO pocket_pip_background (user_id, settings, credentials, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET settings = excluded.settings, credentials = COALESCE(excluded.credentials, pocket_pip_background.credentials), updated_at = excluded.updated_at`,
    args: [userId, JSON.stringify(settings), key ? seal(userId, { key }) : null, now] });
  await reschedule(userId);
  return backgroundState(userId);
}
export async function forgetBackgroundKey(userId) {
  await sql({ sql: 'UPDATE pocket_pip_background SET credentials = NULL, updated_at = ? WHERE user_id = ?', args: [Date.now(), userId] });
  await reschedule(userId);
  return backgroundState(userId);
}
export async function saveRoutine(userId, value) {
  const routine = backgroundRoutine(value), saved = await stored(userId);
  if (routine.kind === 'training') {
    if (routine.enabled && !TRAINING_GRANTS.every(grant => saved?.settings?.grants.includes(grant))) throw invalid('Enable Gym, COROS and Tasks access in settings first.');
    if ((await routines(userId)).some(item => item.kind === 'training' && item.id !== routine.id)) throw invalid('Keep one training planner so your routines do not compete.');
  }
  const count = Number((await sql({ sql: 'SELECT COUNT(*) AS n FROM pocket_pip_routines WHERE user_id = ? AND id != ?', args: [userId, routine.id] })).rows[0].n);
  if (count >= 12) throw invalid('Keep up to 12 routines.');
  await sql({ sql: `INSERT INTO pocket_pip_routines (user_id, id, payload, next_run) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, id) DO UPDATE SET payload = excluded.payload, next_run = excluded.next_run`,
    args: [userId, routine.id, JSON.stringify(routine), schedule(routine, saved?.settings, hasKey(saved))] });
  return backgroundState(userId);
}
/** Open the shared training conversation without requiring a prewritten brief or starting a paid run. */
export async function openTrainingChat(userId, now = Date.now()) {
  const saved = await stored(userId);
  if (!hasKey(saved)) throw invalid('Add a key for Pip on its own first.');
  let routine = (await routines(userId)).find(item => item.kind === 'training');
  if (!routine) {
    const state = await saveRoutine(userId, { kind: 'training', title: 'Training with Pip', prompt: '', time: '07:00', days: [0, 1, 2, 3, 4, 5, 6], trainingDays: [0, 1, 2, 3, 4, 5, 6], enabled: false });
    routine = state.routines.find(item => item.kind === 'training');
  }
  const chat = await routineChat(userId, routine, saved.settings, now);
  if (!chat) throw invalid('This month’s training chat was deleted.');
  await writeObject(userId, 'chats', chat);
  return { chat: chat.uid };
}
export async function removeRoutine(userId, id) {
  await sql({ sql: 'DELETE FROM pocket_pip_routines WHERE user_id = ? AND id = ?', args: [userId, String(id)] });
  await sql({ sql: 'DELETE FROM pocket_pip_routine_memory WHERE user_id = ? AND routine_id = ?', args: [userId, String(id)] });
  return backgroundState(userId);
}

// ── Running a routine ──
/** The account's server copy as Pip's record source. Live COROS uses the account's own connection. */
async function serverSource(userId) {
  const documents = await readDocuments(userId), coros = await corosState(userId).catch(() => null);
  const live = async run => {
    try { return { value: await run() }; }
    catch (error) { return { failed: { error: error.status === 422 ? 'coros_refused' : 'coros_unavailable', message: String(error.message || 'COROS is unavailable.').slice(0, 800) } }; }
  };
  return recordSource(name => documents[name]?.value || EMPTY[name](), {
    corosCache: () => ({ cockpit: coros?.data?.cockpit || null, activities: coros?.data?.activities || null }),
    coros: (action, body) => action === 'tool' ? live(() => corosTool(userId, body.name, body.arguments)) : action === 'catalog' ? live(() => corosCatalog(userId, body.names)) : Promise.resolve({ failed: { error: 'coros_unavailable', message: 'This COROS request is unavailable here.' } })
  });
}
/** One chat per routine and month keeps every synced chat well within its size limit. */
async function routineChat(userId, routine, settings, now) {
  const month = localDay(now, settings.timezone).slice(0, 7), uid = ((routine.kind === 'training' ? 'pip-training-' : 'pip-routine-') + routine.id + '-' + month).replace(/[^a-zA-Z0-9_-]/g, '');
  const row = (await sql({ sql: "SELECT payload FROM pocket_objects WHERE user_id = ? AND collection = 'chats' AND uid = ?", args: [userId, uid] })).rows[0], chat = row ? parse(row.payload) : null;
  if (chat?.deleted) return null;
  const { grants, dailyTokens, timezone, enabled, ...config } = settings;
  if (chat) return chat;
  // Keep conversations from the earlier report-only planner when opening its first training chat.
  const legacy = routine.kind === 'training' ? (await sql({ sql: "SELECT payload FROM pocket_objects WHERE user_id = ? AND collection = 'chats' AND uid = ?", args: [userId, 'pip-routine-' + routine.id + '-' + month] })).rows[0] : null;
  return { uid, title: 'Pip · ' + routine.title, titled: true, created: now, updated: now, draft: '', context: [], turns: legacy ? (parse(legacy.payload)?.turns || []).slice(-20) : [], config };
}
export async function runRoutine(userId, routine, { fetcher = fetch, now = Date.now(), force = false, trainingServices, message = null, signal } = {}) {
  if (message) message = trainingMessage(message);
  const saved = await stored(userId);
  const conversation = Boolean(message);
  if (!hasKey(saved) || !conversation && !saved.settings?.enabled) return { status: 'off' };
  const { settings } = saved, today = localDay(now, settings.timezone), used = saved.usedDay === today ? saved.usedTokens : 0;
  if (used >= settings.dailyTokens) return { status: 'limit', error: 'Today\'s token limit for Pip on its own is used up.' };
  // A brief or a watch that has nothing new to read must not spend a request to say so.
  let lastRun = 0, digest = '';
  if (WATCH_KINDS.includes(routine.kind) && !conversation && !force) {
    try {
      const row = (await sql({ sql: 'SELECT last_run FROM pocket_pip_routines WHERE user_id = ? AND id = ?', args: [userId, routine.id] })).rows[0];
      lastRun = Number(row?.last_run) || 0;
      const newest = await newestRecordAt(userId);
      // A first brief on an empty workspace would spend a request to say it found nothing; wait for a record.
      if (routine.kind === 'brief' && !newest) return { status: 'unchanged' };
      if (lastRun > 0 && newest <= lastRun) return { status: 'unchanged' };
      if (routine.kind === 'brief' && lastRun > 0) {
        const documents = (await sql({ sql: `SELECT name FROM pocket_documents WHERE user_id = ? AND updated_at > ? AND name IN (${CONTENT_DOCUMENTS.map(() => '?').join(',')})`,
          args: [userId, lastRun, ...CONTENT_DOCUMENTS] })).rows.map(row => String(row.name).replace(/\.json$/, ''));
        const objects = (await sql({ sql: `SELECT collection, COUNT(*) AS n FROM pocket_objects WHERE user_id = ? AND collection <> 'chats' AND json_extract(payload, '$.updated') > ? GROUP BY collection`,
          args: [userId, lastRun] })).rows.map(row => `${row.collection}: ${Number(row.n)}`);
        const parts = [...documents, ...objects];
        if (parts.length) digest = parts.join(', ');
      }
    } catch { /* an unreadable revision is no reason to skip the run */ }
  }
  const chat = await routineChat(userId, routine, settings, now);
  if (!chat) return { status: 'skipped', error: 'This month\'s chat for the routine was deleted.' };  if (conversation && (routine.kind !== 'training' || message.chat !== chat.uid || trainingChatRoutine(message.chat) !== routine.id)) throw invalid('Open your current training chat to continue.');
  const earlier = conversation ? chat.turns.find(turn => turn.uid === message.uid) : null;
  if (earlier && earlier.text !== message.text) throw invalid('This message already has different text.');
  if (earlier?.status === 'done') return { status: 'done', chat: chat.uid, turn: earlier.uid, reply: earlier };
  const key = await keyOf(userId, saved), value = { ...pipConfig(settings), grants: settings.grants, trainingConversation: conversation };
  let training, trainingLoad, observation, checkpoint, dailyReview;
  const formats = [];
  const authorized = async () => {
    const latest = await stored(userId), current = (await routines(userId)).find(item => item.id === routine.id);
    return Boolean(!signal?.aborted && hasKey(latest) && latest.settings.enabled && current?.enabled && current.kind === 'training' && current.prompt
      && current.prompt === routine.prompt && JSON.stringify(current.trainingDays) === JSON.stringify(routine.trainingDays)
      && TRAINING_GRANTS.every(grant => latest.settings.grants.includes(grant)));
  };
  const getTraining = async () => {
    if (!await authorized()) throw invalid('Automatic planning is paused, needs a training goal, or needs Gym, COROS and Tasks access. We can still talk.');
    if (!training) {
      trainingLoad ||= trainingRuntime(userId, routine, today, { ...trainingServices, observation, previous: checkpoint, authorized });
      training = await trainingLoad;
      for (const item of formats) training.observe('coros_format', item.input, item.result);
    }
    return training;
  };
  if (routine.kind === 'training' && !conversation) {
    if (!TRAINING_GRANTS.every(grant => settings.grants.includes(grant))) return { status: 'off', error: 'Training planning needs Gym, COROS and Tasks access.' };
    if (routine.enabled === false) return { status: 'off', error: 'Enable the training planner first.' };
    // Missed sessions the planner wrote itself are cleared before it plans the next ones.
    await sweepMissedSessions(userId, now).catch(() => 0);
    if (!routine.prompt) return { status: 'unchanged' };
    observation = await trainingObservation(userId, today, trainingServices);
    checkpoint = await trainingCheckpoint(userId, routine.id);
    const wall = wallClock(now, settings.timezone), [hour, minute] = routine.time.split(':').map(Number);
    dailyReview = checkpoint?.reviewDay !== today && routine.days.includes(wall.weekday) && wall.hour * 60 + wall.minute >= hour * 60 + minute;
    if (!force && !dailyReview && !trainingChanged(checkpoint, observation)) return { status: 'unchanged' };
    await getTraining();
  }
  const turn = Object.assign(earlier || {}, { uid: message?.uid || randomUUID(), text: message?.text || (routine.kind === 'checkin' ? CHECKIN : routine.kind === 'brief' ? BRIEF : routine.kind === 'watch' ? watchMessage(routine, lastRun ? new Date(lastRun).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'the beginning') : routine.kind === 'training' ? 'Check my latest workouts and recovery, using what we discussed, and adjust only the next sessions if needed.' : routine.prompt), context: message?.context || [], created: earlier?.created || now, owner: conversation ? 'pip-training-chat' : BACKGROUND_OWNER, attempt: message?.attempt || randomUUID(), answer: '', reasoning: '', error: '', status: 'streaming', usage: {}, activity: [], sources: [], phase: 'requesting' });
  if (!earlier) chat.turns.push(turn);
  if (conversation) { chat.updated = now; await writeObject(userId, 'chats', chat); }
  // An unattended job (not the training planner, not a conversation) keeps notes between its runs.
  const job = !conversation && routine.kind !== 'training';
  if (job) value.backgroundJob = true;
  const notes = job ? await readScratch(userId, routine.id) : '';
  const view = { ...chat, config: value }, body = requestBody(view, turn);
  body.tools = body.tools.filter(name => !WRITE_TOOLS.includes(name) || (conversation ? ['coros_write', 'create_record', 'update_training_preferences'].includes(name) : training?.tools.includes(name)));
  if (job) body.instructions += JOB_NOTES(notes);
  body.instructions += conversation ? `\n\nThis is the user's ongoing training conversation with Pip. Answer their actual message naturally, in their language. Ask one useful follow-up when goals, availability or how a workout felt are unclear; do not demand a fixed prompt or issue a full report on every reply. Remember explicit goals, equipment, availability and constraints with update_training_preferences; keep temporary workout feedback dated. The saved preferences and this chat guide automatic reviews too. More recent corrections supersede old preferences. Use live reads when discussing workout performance; no COROS connection is needed just to talk. Automatic planning is currently ${routine.enabled && settings.enabled ? 'on' : 'paused'}. Only enable/resume it if the user asks. Use scoped workout writes when the user wants the plan adjusted; no per-workout confirmation is needed once automatic planning is enabled. Only saved tool results establish changes. Never schedule beyond the next two sessions within three days. Calendar appointments are unavailable.
Remembered training brief: ${JSON.stringify(routine.prompt || 'Not set yet; learn it through conversation.')}
Available weekdays (0=Sunday): ${JSON.stringify(routine.trainingDays)}
Recent dated feedback: ${JSON.stringify(routine.feedback || [])}` : training ? '\n\nThis is the authorized proactive training routine. The training tools save automatically within its scope; no interactive confirmation is required. Calendar appointments are unavailable. ' : AWAY;
  if (digest) body.instructions += `\n\nRecords changed since your last brief, by collection: ${digest}. Use that only to know what is new; read the records themselves before quoting one.`;
  if (routine.kind === 'brief') {
    // Counted here, not by the model: these are facts the brief may quote, never a substitute for reading a record.
    const facts = patternDigest(await readDocuments(userId), now);
    if (facts.length) body.instructions += `\n\nCounted from the workspace (do not recount, do not contradict): ${facts.join(' ')}`;
  }
  if (routine.kind === 'watch') body.instructions += '\n\nThis is a standing watch the user set up. If nothing new matches it, answer exactly SKIP.';
  if (training) body.messages.push({ role: 'user', content: training.prompt });
  const source = await serverSource(userId);
  const prepare = async (value, name, input) => {
    if (name === 'update_training_preferences') return { action: { tool: name, kind: 'training_preferences', title: 'Training preferences' } };
    try { return await (await getTraining()).prepare(name, input); }
    catch (error) { return { error: 'training_unavailable', message: error.message }; }
  };
  const savePreferences = async input => {
    if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    const current = (await routines(userId)).find(item => item.id === routine.id);
    if (!current || current.kind !== 'training') throw invalid('This training planner was removed.');
    const next = backgroundRoutine({ ...current, ...(input.brief !== undefined ? { prompt: input.brief } : {}), ...(input.trainingDays ? { trainingDays: input.trainingDays } : {}), ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      feedback: [...(current.feedback || []), ...(input.feedback ? [{ at: now, text: input.feedback }] : [])] });
    await saveRoutine(userId, next); Object.assign(routine, next); training = null; trainingLoad = null;
    await sql({ sql: 'DELETE FROM pocket_pip_training_state WHERE user_id = ? AND routine_id = ?', args: [userId, routine.id] });
    const latest = await stored(userId);
    return { kind: 'action', action: { tool: 'update_training_preferences', kind: 'training_preferences', title: 'Training preferences', status: 'saved', href: '/pip/' + chat.uid },
      preferences: { brief: next.prompt, trainingDays: next.trainingDays, feedback: next.feedback.slice(-1), enabled: next.enabled, active: Boolean(next.enabled && latest?.settings.enabled && hasKey(latest)) } };
  };
  let pendingChange = Promise.resolve();
  const conversationWrite = (name, input) => {
    const next = pendingChange.then(async () => {
      try { return name === 'update_training_preferences' ? await savePreferences(input) : await (await getTraining()).execute(name, input); }
      catch (error) { return { error: 'training_not_saved', message: error.message }; }
    });
    pendingChange = next.catch(() => {}); return next;
  };
  // Imported here: the agent runtime and provider adapters load only when a routine runs.
  const { streamChat } = await import('../client/pip-stream.js');
  try {
    const reply = await streamChat(view, turn, { value, body, key, fetcher, signal, deadlineMs: RUN_DEADLINE, coverage: contextCoverage(view, turn),
      onUpdate: update => Object.assign(turn, update),
      ...(training || conversation ? { previewTool: prepare, approve: async requests => new Map(requests.map(request => [request.toolCallId, { approved: true }])) } : {}),
      executeTool: async (value, name, input, signal, context) => {
        if (name === 'update_scratch') {
          if (!job) return { error: 'unavailable', message: 'Only a scheduled job keeps notes.' };
          const kept = await writeScratch(userId, routine.id, input?.notes);
          return { kind: 'scratch', saved: true, length: kept.length };
        }
        if (conversation && WRITE_TOOLS.includes(name)) return conversationWrite(name, input);
        if (training?.isWrite(name)) return training.execute(name, input);
        const result = await runTool(value, name, input, signal, { ...context, source });
        if (name === 'coros_format') formats.push({ input, result });
        training?.observe(name, input, result);
        return result;
      } });
    Object.assign(turn, reply, { status: 'done' });
  } catch (error) { Object.assign(turn, { status: 'failed', phase: 'failed', error: String(error?.message || 'The scheduled reply failed.').slice(0, 500) }); }
  // A watch that found nothing answers SKIP; the chat stays empty and no notification is sent.
  const quiet = routine.kind === 'watch' && !conversation && turn.status === 'done' && quietWatch(turn.answer);
  if (quiet) {
    chat.turns = chat.turns.filter(item => item !== turn);
    const spent = (turn.usage?.input_tokens || 0) + (turn.usage?.output_tokens || 0);
    await sql({ sql: 'UPDATE pocket_pip_background SET used_day = ?, used_tokens = ? WHERE user_id = ?', args: [today, used + spent, userId] });
    return { status: 'unchanged' };
  }
  turn.updated = chat.updated = Math.max(Date.now(), chat.updated + 1);
  await writeObject(userId, 'chats', chat);
  if (!conversation && training?.complete && turn.status === 'done') await rememberTraining(userId, routine.id, observation, dailyReview ? today : checkpoint?.reviewDay || '');
  const spent = (turn.usage?.input_tokens || 0) + (turn.usage?.output_tokens || 0);
  await sql({ sql: 'UPDATE pocket_pip_background SET used_day = ?, used_tokens = ? WHERE user_id = ?', args: [today, used + spent, userId] });
  return { status: turn.status, chat: chat.uid, turn: turn.uid, ...(conversation ? { reply: turn } : {}), ...(turn.error ? { error: turn.error } : {}) };
}
/** Claims a routine so two jobs never run it at once, runs it and schedules its next time. */
export async function runClaimed(userId, id, { force = false, fetcher, now = Date.now(), trainingServices, message, signal } = {}) {
  const claimed = (await sql({ sql: `UPDATE pocket_pip_routines SET lock_until = ? WHERE user_id = ? AND id = ? AND lock_until <= ? ${force ? '' : 'AND next_run <= ?'} RETURNING payload`,
    args: [now + 10 * 60000, userId, id, now, ...(force ? [] : [now])] })).rows[0];
  if (!claimed) throw Object.assign(new Error('This routine is already running.'), { status: 409 });
  const routine = parse(claimed.payload);
  let result;
  try { result = await runRoutine(userId, routine, { fetcher, now, force, trainingServices, message, signal }); }
  catch (error) { result = { status: 'failed', error: String(error?.message || 'The routine could not run.').slice(0, 500) }; }
  const saved = await stored(userId);
  const current = (await routines(userId)).find(item => item.id === id);
  await sql({ sql: 'UPDATE pocket_pip_routines SET lock_until = 0, last_run = ?, last_error = ?, last_chat = ?, next_run = ? WHERE user_id = ? AND id = ?',
    args: [now, result.error || '', result.chat || current?.lastChat || '', current ? schedule(current, saved?.settings, hasKey(saved)) : NEVER, userId, id] });
  await recordRun(userId, id, result, now);
  // A scheduled run that wrote in its chat is worth a notification, unless the job is quiet; one the user started
  // is not. Failures notify once per streak, on the second in a row: a single blip is not worth a buzz, and a
  // broken job does not alert on every run.
  if (!force && !message && result.chat) {
    if (result.status === 'done' && routine.delivery !== 'quiet') await notifyRoutine(userId, routine, result);
    if (result.status === 'failed' && await failureStreak(userId, id) === 2) await notifyRoutine(userId, routine, result);
  }
  return result;
}
/** How many of this routine's latest runs failed in a row (quiet "unchanged" checks do not break a streak). */
async function failureStreak(userId, routineId) {
  const rows = (await sql({ sql: "SELECT status FROM pocket_pip_routine_runs WHERE user_id = ? AND routine_id = ? AND status != 'unchanged' ORDER BY seq DESC LIMIT 10", args: [userId, String(routineId)] })).rows;
  let streak = 0;
  for (const row of rows) { if (String(row.status) !== 'failed') break; streak++; }
  return streak;
}
async function notifyRoutine(userId, routine, result) {
  try {
    const row = (await sql({ sql: "SELECT payload FROM pocket_objects WHERE user_id = ? AND collection = 'chats' AND uid = ?", args: [userId, result.chat] })).rows[0];
    const chat = row ? parse(row.payload) : null, turn = chat?.turns?.find(item => item.uid === result.turn);
    await notify(userId, replyNotice({ uid: result.chat, title: chat?.title || 'Pip · ' + routine.title }, turn || { status: result.status, error: result.error }));
  } catch { /* A notification is not part of the run. */ }
}
export async function runPipJob({ fetcher, now = Date.now() } = {}) {
  // A shared chat run nobody answered does not wait forever: its requests are settled and it finishes.
  const swept = await sweepRuns({ fetcher, now });
  const due = (await sql({ sql: 'SELECT user_id, id FROM pocket_pip_routines WHERE next_run <= ? AND lock_until <= ? ORDER BY next_run LIMIT 10', args: [now, now] })).rows;
  const deadline = Date.now() + JOB_BUDGET; let ran = 0;
  for (const row of due) {
    // Each run may use its whole research deadline; leave the rest for the next call.
    if (ran && Date.now() + RUN_DEADLINE > deadline) break;
    try { await runClaimed(String(row.user_id), String(row.id), { fetcher, now: Date.now() }); ran++; } catch (error) { if (error.status !== 409) throw error; }
  }
  return { due: due.length, ran, more: ran < due.length || due.length === 10, expired: swept.length };
}
