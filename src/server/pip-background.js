import { randomUUID } from 'node:crypto';
import { execute as sql } from './database.js';
import { seal, open } from './secrets.js';
import { readDocuments } from './workspace.js';
import { writeObject } from './objects.js';
import { corosState, corosTool, corosCatalog } from './coros.js';
import { EMPTY } from '../shared/workspace.js';
import { config as pipConfig, requestBody, contextCoverage, BACKGROUND_OWNER } from '../client/pip-core.js';
import { execute as runTool, recordSource, WRITE_TOOLS } from '../client/pip-tools.js';
import { trainingRuntime, trainingObservation, trainingCheckpoint, trainingChanged, rememberTraining, TRAINING_GRANTS, TRAINING_CHECK_INTERVAL } from './pip-training.js';
import { objectId } from '../shared/objects.js';

// Pip on its own: routines that run on a schedule with the account's dedicated provider key, read the account's
// server copy and reply in a synced Pip chat. Training routines have scoped writes and reply in the chat where the user last
// talked training with Pip; calendar appointments stay on the phone.
const DAY = 86400000, NEVER = Number.MAX_SAFE_INTEGER, RUN_DEADLINE = 150000, JOB_BUDGET = 240000;
export const BACKGROUND_GRANTS = ['notes', 'thoughts', 'tasks', 'gym', 'coros'];
export { BACKGROUND_OWNER };
const CHECKIN = 'Morning check-in. Look at my open tasks (overdue, due today and important ones), thoughts I parked more than a week ago, and my COROS readiness and recent training load if available. Tell me briefly what needs attention today and suggest at most three concrete changes, such as moving a task. If nothing needs attention, say so in one line.';
const TRAINING_CHECK = 'Check my latest workouts and recovery, using what we discussed, and adjust only the next sessions if needed.';
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
export function nextRun({ time, days }, timeZone, after = Date.now()) {
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
export function backgroundSettings(value) {
  const base = pipConfig(value), grants = Array.isArray(value.grants) ? BACKGROUND_GRANTS.filter(name => value.grants.includes(name)) : [];
  const dailyTokens = Number(value.dailyTokens);
  if (!Number.isInteger(dailyTokens) || dailyTokens < 1000 || dailyTokens > 5000000) throw invalid('Choose a daily limit from 1,000 to 5,000,000 tokens.');
  if (!validTimezone(value.timezone)) throw invalid('Choose a valid timezone.');
  return { ...base, thinking: false, grants, dailyTokens, timezone: value.timezone, enabled: Boolean(value.enabled) };
}
export function backgroundRoutine(value) {
  const kind = ['checkin', 'prompt', 'training'].includes(value.kind) ? value.kind : null;
  if (!kind) throw invalid('Choose a check-in, training planner or scheduled prompt.');
  const id = typeof value.id === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(value.id) ? value.id : randomUUID().replaceAll('-', '');
  const title = String(value.title || (kind === 'checkin' ? 'Morning check-in' : kind === 'training' ? 'Training planner' : '')).trim(), prompt = kind !== 'checkin' ? String(value.prompt || '').trim() : '';
  if (!title || title.length > 80) throw invalid('Give the routine a name, up to 80 characters.');
  if (kind === 'prompt' && !prompt || prompt.length > 4000) throw invalid('Write the prompt, up to 4,000 characters.');
  if (typeof value.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)) throw invalid('Choose a time.');
  const days = [...new Set(Array.isArray(value.days) ? value.days.filter(day => Number.isInteger(day) && day >= 0 && day <= 6) : [])].sort();
  if (!days.length) throw invalid('Choose at least one day.');
  const trainingDays = [...new Set(Array.isArray(value.trainingDays) ? value.trainingDays.filter(day => Number.isInteger(day) && day >= 0 && day <= 6) : [])].sort();
  if (kind === 'training' && !trainingDays.length) throw invalid('Choose your available training days.');
  const feedback = (Array.isArray(value.feedback) ? value.feedback : []).filter(item => Number.isSafeInteger(item.at) && typeof item.text === 'string').slice(-12).map(item => ({ at: item.at, text: item.text.slice(0, 1000) }));
  return { id, kind, title, prompt, time: value.time, days, enabled: value.enabled !== false, ...(kind === 'training' ? { trainingDays, feedback, chat: objectId(value.chat) ? value.chat : '' } : {}) };
}
const parse = raw => { try { return JSON.parse(String(raw)); } catch { return null; } };
async function stored(userId) {
  const row = (await sql({ sql: 'SELECT settings, credentials, used_day, used_tokens FROM pocket_pip_background WHERE user_id = ?', args: [userId] })).rows[0];
  return row ? { settings: parse(row.settings), credentials: row.credentials ? String(row.credentials) : '', usedDay: String(row.used_day), usedTokens: Number(row.used_tokens) } : null;
}
async function routines(userId) {
  const rows = (await sql({ sql: 'SELECT payload, next_run, last_run, last_error, last_chat FROM pocket_pip_routines WHERE user_id = ? ORDER BY rowid', args: [userId] })).rows;
  return rows.map(row => ({ ...parse(row.payload), nextRun: Number(row.next_run) === NEVER ? 0 : Number(row.next_run), lastRun: Number(row.last_run), lastError: String(row.last_error), lastChat: String(row.last_chat) }));
}
const trainingReady = saved => Boolean(saved?.credentials && saved.settings?.enabled && TRAINING_GRANTS.every(grant => saved.settings.grants.includes(grant)));
/** What the browser shows. The key itself never leaves the server. */
export async function backgroundState(userId) {
  const saved = await stored(userId), today = saved?.settings ? localDay(Date.now(), saved.settings.timezone) : '';
  return { settings: saved?.settings || null, hasKey: Boolean(saved?.credentials), usedToday: saved && saved.usedDay === today ? saved.usedTokens : 0, routines: await routines(userId),
    trainingReady: trainingReady(saved) };
}
const schedule = (routine, settings, active, after = Date.now()) => active && settings?.enabled && routine.enabled
  ? Math.min(nextRun(routine, settings.timezone, after), routine.kind === 'training' ? after + TRAINING_CHECK_INTERVAL : NEVER) : NEVER;
async function reschedule(userId) {
  const saved = await stored(userId), active = Boolean(saved?.credentials);
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
    args: [userId, routine.id, JSON.stringify(routine), schedule(routine, saved?.settings, Boolean(saved?.credentials))] });
  return backgroundState(userId);
}
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
/** What the user told Pip about their training, from any Pip chat. Automatic reviews then reply in that chat. */
export async function saveTrainingPreferences(userId, chat, input = {}, now = Date.now()) {
  if (!objectId(chat)) throw invalid('Open a Pip chat first.');
  if (!input || typeof input !== 'object' || Array.isArray(input) || !['brief', 'trainingDays', 'feedback', 'enabled'].some(key => input[key] !== undefined)) throw invalid('Supply a training preference to remember.');
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw invalid('Choose whether automatic planning is on or off.');
  for (const [field, limit] of [['brief', 4000], ['feedback', 1000]]) {
    if (input[field] !== undefined && (typeof input[field] !== 'string' || !input[field].trim() || input[field].length > limit)) throw invalid('Write a nonempty training ' + field + ', up to ' + limit + ' characters.');
  }
  if (input.trainingDays !== undefined && (!Array.isArray(input.trainingDays) || !input.trainingDays.length || input.trainingDays.length > 7 || input.trainingDays.some(day => !Number.isInteger(day) || day < 0 || day > 6))) throw invalid('Choose your available training days.');
  const saved = await stored(userId), current = (await routines(userId)).find(item => item.kind === 'training');
  const brief = input.brief !== undefined ? String(input.brief).trim() : current?.prompt || '', wanted = Boolean(input.enabled ?? current?.enabled);
  const ready = trainingReady(saved);
  const next = backgroundRoutine({ kind: 'training', title: 'Training with Pip', time: '07:00', days: EVERY_DAY, ...current, prompt: brief,
    trainingDays: input.trainingDays || current?.trainingDays || EVERY_DAY, enabled: wanted && ready && Boolean(brief), chat,
    feedback: [...(current?.feedback || []), ...(input.feedback ? [{ at: now, text: String(input.feedback) }] : [])] });
  await saveRoutine(userId, next);
  // New preferences start a fresh review at the next check.
  await sql({ sql: 'DELETE FROM pocket_pip_training_state WHERE user_id = ? AND routine_id = ?', args: [userId, next.id] });
  const setup = !wanted ? '' : !brief ? 'Automatic planning starts once the user says what they are training for.'
    : !ready ? 'Automatic planning needs a dedicated key, routines switched on, and Gym, COROS and Tasks access in “on its own” (Pip header).' : '';
  return { kind: 'training', brief: next.prompt, trainingDays: next.trainingDays, feedback: next.feedback.slice(-1), automatic: next.enabled ? 'on' : 'off', ...(setup ? { setup } : {}) };
}
export async function removeRoutine(userId, id) {
  await sql({ sql: 'DELETE FROM pocket_pip_routines WHERE user_id = ? AND id = ?', args: [userId, String(id)] });
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
const chatObject = async (userId, uid) => { const row = (await sql({ sql: "SELECT payload FROM pocket_objects WHERE user_id = ? AND collection = 'chats' AND uid = ?", args: [userId, uid] })).rows[0]; return row ? parse(row.payload) : null; };
const roomy = chat => chat && !chat.deleted && chat.turns.length < 1990 && JSON.stringify(chat).length < 2500000;
/** Check-ins and prompts get one chat per routine and month. Training reviews reply in the chat where the user last talked
 * training with Pip, else their latest chat, so it stays one conversation. */
async function routineChat(userId, routine, settings, now) {
  const { grants, dailyTokens, timezone, enabled, ...config } = settings;
  if (routine.kind === 'training') {
    let chat = routine.chat ? await chatObject(userId, routine.chat) : null;
    if (!roomy(chat)) {
      const latest = (await sql({ sql: "SELECT payload FROM pocket_objects WHERE user_id = ? AND collection = 'chats' AND json_extract(payload, '$.deleted') IS NULL ORDER BY revision DESC LIMIT 1", args: [userId] })).rows[0];
      chat = latest ? parse(latest.payload) : null;
      if (!roomy(chat)) chat = { uid: randomUUID(), title: 'Pip · training', created: now, updated: now, draft: '', context: [], turns: [], config };
      await sql({ sql: "UPDATE pocket_pip_routines SET payload = json_set(payload, '$.chat', ?) WHERE user_id = ? AND id = ?", args: [chat.uid, userId, routine.id] });
    }
    return chat;
  }
  const month = localDay(now, settings.timezone).slice(0, 7), uid = ('pip-routine-' + routine.id + '-' + month).replace(/[^a-zA-Z0-9_-]/g, '');
  const chat = await chatObject(userId, uid);
  if (chat?.deleted) return null;
  return chat || { uid, title: 'Pip · ' + routine.title, created: now, updated: now, draft: '', context: [], turns: [], config };
}
export async function runRoutine(userId, routine, { fetcher = fetch, now = Date.now(), force = false, trainingServices } = {}) {
  const saved = await stored(userId);
  if (!saved?.credentials || !saved.settings?.enabled) return { status: 'off' };
  const { settings } = saved, today = localDay(now, settings.timezone), used = saved.usedDay === today ? saved.usedTokens : 0;
  if (used >= settings.dailyTokens) return { status: 'limit', error: 'Today\'s token limit for Pip on its own is used up.' };
  let training, observation, checkpoint, dailyReview, authorized;
  if (routine.kind === 'training') {
    if (!TRAINING_GRANTS.every(grant => settings.grants.includes(grant))) return { status: 'off', error: 'Training planning needs Gym, COROS and Tasks access.' };
    if (routine.enabled === false) return { status: 'off', error: 'Ask Pip to plan your training automatically first.' };
    if (!routine.prompt) return { status: 'unchanged' };
    observation = await trainingObservation(userId, today, trainingServices);
    checkpoint = await trainingCheckpoint(userId, routine.id);
    const wall = wallClock(now, settings.timezone), [hour, minute] = routine.time.split(':').map(Number);
    dailyReview = checkpoint?.reviewDay !== today && routine.days.includes(wall.weekday) && wall.hour * 60 + wall.minute >= hour * 60 + minute;
    if (!force && !dailyReview && !trainingChanged(checkpoint, observation)) return { status: 'unchanged' };
    authorized = async () => {
      const latest = await stored(userId), current = (await routines(userId)).find(item => item.id === routine.id);
      return Boolean(latest?.credentials && latest.settings.enabled && current?.enabled && current.kind === 'training'
        && current.prompt === routine.prompt && JSON.stringify(current.trainingDays) === JSON.stringify(routine.trainingDays)
        && JSON.stringify(current.feedback || []) === JSON.stringify(routine.feedback || [])
        && TRAINING_GRANTS.every(grant => latest.settings.grants.includes(grant)));
    };
    training = await trainingRuntime(userId, routine, today, { ...trainingServices, observation, previous: checkpoint, authorized });
  }
  const chat = await routineChat(userId, routine, settings, now);
  if (!chat) return { status: 'skipped', error: 'This month\'s chat for the routine was deleted.' };
  const { key } = open(userId, saved.credentials), value = { ...pipConfig(settings), grants: settings.grants };
  const turn = { uid: randomUUID(), text: routine.kind === 'checkin' ? CHECKIN : training ? TRAINING_CHECK : routine.prompt, context: [], created: now, owner: BACKGROUND_OWNER, attempt: randomUUID(), answer: '', reasoning: '', error: '', status: 'streaming', usage: {}, activity: [], sources: [], phase: 'requesting' };
  chat.turns.push(turn);
  const view = { ...chat, config: value }, body = requestBody(view, turn);
  body.tools = body.tools.filter(name => !WRITE_TOOLS.includes(name) || training?.tools.includes(name));
  body.instructions += training ? '\n\nThis is the authorized proactive training routine. It replies in the user\'s ongoing Pip chat, where they talk with you about training; earlier turns there are your shared context. The training tools save automatically within its scope; no interactive confirmation is required. Calendar appointments are unavailable. ' : AWAY;
  if (training) body.messages.push({ role: 'user', content: training.prompt });
  const source = await serverSource(userId);
  // Imported here: the agent runtime and provider adapters load only when a routine runs.
  const { streamChat } = await import('../client/pip-stream.js');
  try {
    const reply = await streamChat(view, turn, { value, body, key, fetcher, deadlineMs: RUN_DEADLINE, coverage: contextCoverage(view, turn),
      onUpdate: update => Object.assign(turn, update),
      ...(training ? { previewTool: (value, name, input) => training.prepare(name, input), approve: training.approve } : {}),
      executeTool: async (value, name, input, signal, context) => {
        if (training?.isWrite(name)) return training.execute(name, input);
        const result = await runTool(value, name, input, signal, { ...context, source });
        training?.observe(name, input, result);
        return result;
      } });
    Object.assign(turn, reply, { status: 'done' });
  } catch (error) { Object.assign(turn, { status: 'failed', phase: 'failed', error: String(error?.message || 'The scheduled reply failed.').slice(0, 500) }); }
  turn.updated = chat.updated = Math.max(Date.now(), chat.updated + 1);
  // Only this turn is new; the merge keeps whatever the user wrote in the chat meanwhile.
  await writeObject(userId, 'chats', { ...chat, turns: [turn] }, { appendTurns: true });
  if (training?.complete && turn.status === 'done' && await authorized()) await rememberTraining(userId, routine.id, observation, dailyReview ? today : checkpoint?.reviewDay || '');
  const spent = (turn.usage?.input_tokens || 0) + (turn.usage?.output_tokens || 0);
  await sql({ sql: 'UPDATE pocket_pip_background SET used_day = ?, used_tokens = ? WHERE user_id = ?', args: [today, used + spent, userId] });
  return { status: turn.status, chat: chat.uid, turn: turn.uid, ...(turn.error ? { error: turn.error } : {}) };
}
/** Claims a routine so two jobs never run it at once, runs it and schedules its next time. */
export async function runClaimed(userId, id, { force = false, fetcher, now = Date.now(), trainingServices } = {}) {
  const claimed = (await sql({ sql: `UPDATE pocket_pip_routines SET lock_until = ? WHERE user_id = ? AND id = ? AND lock_until <= ? ${force ? '' : 'AND next_run <= ?'} RETURNING payload`,
    args: [now + 10 * 60000, userId, id, now, ...(force ? [] : [now])] })).rows[0];
  if (!claimed) throw Object.assign(new Error('This routine is already running.'), { status: 409 });
  const routine = parse(claimed.payload);
  let result;
  try { result = await runRoutine(userId, routine, { fetcher, now, force, trainingServices }); }
  catch (error) { result = { status: 'failed', error: String(error?.message || 'The routine could not run.').slice(0, 500) }; }
  const saved = await stored(userId);
  const current = (await routines(userId)).find(item => item.id === id);
  await sql({ sql: 'UPDATE pocket_pip_routines SET lock_until = 0, last_run = ?, last_error = ?, last_chat = ?, next_run = ? WHERE user_id = ? AND id = ?',
    args: [now, result.error || '', result.chat || current?.lastChat || '', current ? schedule(current, saved?.settings, Boolean(saved?.credentials)) : NEVER, userId, id] });
  return result;
}
export async function runPipJob({ fetcher, now = Date.now() } = {}) {
  const due = (await sql({ sql: 'SELECT user_id, id FROM pocket_pip_routines WHERE next_run <= ? AND lock_until <= ? ORDER BY next_run LIMIT 10', args: [now, now] })).rows;
  const deadline = Date.now() + JOB_BUDGET; let ran = 0;
  for (const row of due) {
    // Each run may use its whole research deadline; leave the rest for the next call.
    if (ran && Date.now() + RUN_DEADLINE > deadline) break;
    try { await runClaimed(String(row.user_id), String(row.id), { fetcher, now: Date.now() }); ran++; } catch (error) { if (error.status !== 409) throw error; }
  }
  return { due: due.length, ran, more: ran < due.length || due.length === 10 };
}
