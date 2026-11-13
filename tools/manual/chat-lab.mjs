// The chat lab: Pip's chat in fixed states, photographed at phone and desktop size, and one reply measured while it
// is written. It is a tool for people and agents, not a test in the suite. Nothing touches .env, the real database
// or the network: the Node build runs on a scratch libSQL file in a temp directory and replies are played in through
// /internal/events, so no model is called.
//
// Build the Node target first (this script does not build):
//   POCKET_TARGET=node POCKET_ALLOW_PROXY=1 npx astro build
// Then, with a browser library outside the repo:
//   PUPPETEER_MODULE=/path/to/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js \
//     node tools/manual/chat-lab.mjs [--out <dir>] [--only <state>]
//
// `--only` takes state names from STATES below or `stream`, separated by commas. Pictures are <state>-phone.png and
// <state>-desktop.png; the measurement is stream.json. Both go to app/build/reports/chat-lab/ by default (ignored
// by git through **/build/). The stream is measured three times at phone size and the median is reported.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cardFence } from '../../src/shared/pocket-card-tool.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium';
const USER = 'lab-user';
const CONFIG = { provider: 'compatible', model: 'glm-5.3', baseUrl: 'https://opencode.ai/inference/go/openai/v1', maxTokens: 4096, thinking: false, webSearch: false };
const VIEWPORTS = {
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1 },
};
const NOW = Date.now();
const MINUTE = 60_000;
const LONG_URL = 'https://example.com/auswertung/schlaf-hrv-ruhepuls/sehr-langer-pfad-mit-vielen-segmenten/2026-11-11';
const LONG_WORD = 'Donaudampfschifffahrtsgesellschaft';

const sleep = ms => new Promise(done => setTimeout(done, ms));
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

// --- what the states show ---------------------------------------------------------------------------------------

const longCard = cardFence({
  root: 'g',
  elements: {
    g: { type: 'Grid', props: { columns: 2 }, children: ['a', 'b'] },
    a: { type: 'Metric', props: { label: 'Schlaf', value: '7 h 12', tone: 'accent' }, children: [] },
    b: { type: 'Metric', props: { label: 'HRV', value: '62', unit: 'ms' }, children: [] },
  },
}, { id: 'klong01' });

const pinnedCard = cardFence({
  root: 'g',
  elements: {
    g: { type: 'Grid', props: { columns: 2 }, children: ['a', 'b'] },
    a: { type: 'Metric', props: { label: 'Schlaf', value: '7 h 12', tone: 'accent' }, children: [] },
    b: { type: 'Metric', props: { label: 'Ruhepuls', value: '48', unit: 'bpm' }, children: [] },
  },
}, { id: 'kpinned1', pinned: NOW - 30 * MINUTE });

const streamCard = cardFence({
  root: 'g',
  elements: {
    g: { type: 'Grid', props: { columns: 2 }, children: ['a', 'b', 'c', 'd'] },
    a: { type: 'Metric', props: { label: 'Schlaf', value: '7 h 12', tone: 'accent' }, children: [] },
    b: { type: 'Metric', props: { label: 'HRV', value: '62', unit: 'ms' }, children: [] },
    c: { type: 'Text', props: { text: 'Ruhepuls 48, die Erholung ist gut.', variant: 'muted' }, children: [] },
    d: { type: 'Badge', props: { text: 'locker laufen' }, children: [] },
  },
}, { id: 'kstream1' });

const buildCard = cardFence({
  root: 'g',
  elements: {
    g: { type: 'Grid', props: { columns: 2 }, children: ['a', 'b', 'c', 'd'] },
    a: { type: 'Metric', props: { label: 'Schlaf', value: '7 h 12', tone: 'accent' }, children: [] },
    b: { type: 'Metric', props: { label: 'HRV', value: '62', unit: 'ms' }, children: [] },
    c: { type: 'Metric', props: { label: 'Ruhepuls', value: '48', unit: 'bpm' }, children: [] },
    d: { type: 'Text', props: { text: 'Heute locker laufen.', variant: 'muted' }, children: [] },
  },
}, { id: 'kbuild1' });

const fenceLines = fence => fence.split('\n').slice(1, -1);
const openFence = lines => '```pocket\n' + lines.map(line => line + '\n').join('');

const LONG_ANSWER = [
  `Kurz gesagt: **gut erholt**. Der Schlaf war mit 7 h 12 min etwas länger als dein Schnitt, die HRV blieb bei 62 ms und der Ruhepuls lag bei 48. Die Wortprobe ${LONG_WORD} und die Adresse ${LONG_URL} zeigen, ob der Text sauber umbricht.`,
  '',
  longCard,
  '',
  '## Was die Werte sagen',
  '',
  'Die Nacht war ruhig, und alle Werte liegen im Rahmen der letzten zwei Wochen.',
  '',
  '- Schlafdauer: 7 h 12 min, über deinem Schnitt',
  '- HRV: 62 ms, stabil',
  '- Ruhepuls: 48, niedrig',
  '',
  '| Tag | Lauf | km |',
  '|---|---|---|',
  '| Mo | locker | 8 |',
  '| Mi | Intervalle | 10 |',
  '| Sa | lang | 18 |',
  '',
  'Für die Berechnung des Tempos reicht eine kurze Funktion:',
  '',
  '```js',
  'const pace = distance / time;',
  'console.log(pace.toFixed(2));',
  '```',
  '',
  'Wenn du magst, plane ich die Woche um.',
].join('\n');

const longActivity = [
  { id: 'long-a1', kind: 'records', name: 'search_notes', title: 'search notes “Schlaf”', state: 'done', summary: '3 notes', input: '{"query":"Schlaf"}', result: '{"notes":3}', started: NOW - 640_000, ended: NOW - 637_000, sources: [] },
  { id: 'long-a2', kind: 'records', name: 'search_tasks', title: 'search tasks “Training”', state: 'done', summary: '2 tasks', input: '{"query":"Training"}', result: '{"tasks":2}', started: NOW - 637_000, ended: NOW - 635_000, sources: [] },
  { id: 'long-a3', kind: 'records', name: 'search_calendar', title: 'search calendar “Lauf”', state: 'done', summary: '1 appointment', input: '{"query":"Lauf"}', result: '{"appointments":1}', started: NOW - 635_000, ended: NOW - 633_000, sources: [] },
  { id: 'long-a4', kind: 'web', name: 'search_web', title: 'search web “hrv training readiness”', state: 'done', summary: '4 pages', input: '{"query":"hrv training readiness"}', result: '{"pages":4}', started: NOW - 633_000, ended: NOW - 628_000, sources: [] },
  { id: 'long-a5', kind: 'web', name: 'read_web_page', title: 'read web page “HRV and readiness”', state: 'done', summary: '1,240 words', input: '{"url":"https://example.com/hrv"}', result: '{"words":1240}', started: NOW - 628_000, ended: NOW - 624_000, sources: [] },
];

const STREAM_BEFORE = [
  'Guten Abend, hier ist die kurze Lage zu deinem Training und dem Schlaf der letzten Woche. Der Schlaf war mit 7 h 12 min etwas länger als dein Schnitt, die Herzfrequenzvariabilität blieb stabil bei 62 ms und der Ruhepuls lag bei 48 Schlägen pro Minute.',
  '',
  `Für die morgige Einheit heißt das: locker laufen, keine Intervalle. Die vollständige Auswertung liegt unter ${LONG_URL} und das lange Wort ${LONG_WORD} prüft den Umbruch. Am Samstag steht der lange Lauf an, danach ist ein ruhiger Tag sinnvoll.`,
  '',
  '',
].join('\n');

const STREAM_AFTER = [
  '## Was die Werte sagen',
  '',
  'Die Nacht war ruhig, und alle Werte liegen im Rahmen der letzten zwei Wochen. Besonders der niedrige Ruhepuls spricht für eine gute Erholung. Die Zahlen stammen aus deinen Aufzeichnungen der letzten Woche und aus dem Artikel über HRV und Erholung.',
  '',
  '- Schlafdauer: 7 h 12 min, über deinem Schnitt',
  '- HRV: 62 ms, stabil',
  '- Ruhepuls: 48, niedrig',
  '',
  '| Tag | Lauf | km |',
  '|---|---|---|',
  '| Mo | locker | 8 |',
  '| Mi | Intervalle | 10 |',
  '| Sa | lang | 18 |',
  '',
  'Für die Berechnung des Tempos reicht eine kurze Funktion:',
  '',
  '```js',
  'const pace = distance / time;',
  'console.log(pace.toFixed(2));',
  '```',
  '',
  'Wenn du möchtest, plane ich die kommende Woche um und achte darauf, dass die ruhigen Einheiten überwiegen. Sag einfach Bescheid, dann beginne ich mit der Planung.',
].join('\n');

/** Three words at a time, whitespace kept with the word before it, so the text grows exactly as it was written. */
function chunksOf(text, size = 3) {
  const words = text.match(/\S+\s*/g) ?? [];
  const chunks = [];
  for (let at = 0; at < words.length; at += size) chunks.push(words.slice(at, at + size).join(''));
  return chunks;
}

/** The whole measured reply as cumulative snapshots: prose three words at a time, the card one JSON line at a time. */
function streamSteps() {
  const steps = [];
  let answer = '';
  const push = (text, phase) => { answer += text; steps.push({ answer, phase }); };
  for (const chunk of chunksOf(STREAM_BEFORE)) push(chunk, 'writing');
  push('```pocket\n', 'drawing');
  for (const line of fenceLines(streamCard)) push(line + '\n', 'drawing');
  push('```\n\n', 'writing');
  for (const chunk of chunksOf(STREAM_AFTER)) push(chunk, 'writing');
  return { steps, full: answer, marker: chunksOf(STREAM_BEFORE)[0].trim().split(/\s+/).slice(0, 3).join(' ') };
}

const STREAM = streamSteps();
const STREAM_SOURCES = [
  { href: 'https://example.com/hrv', title: 'HRV and readiness' },
  { href: LONG_URL, title: 'Schlaf, HRV und Ruhepuls' },
];

const QUESTION = 'Wie war mein Schlaf diese Woche, und was soll ich heute trainieren?';
const WRITING_TEXT = 'Guten Abend, hier ist die kurze Lage zu deinem Training. Der Schlaf war mit 7 h 12 min etwas länger als dein Schnitt, und die HRV blieb stabil. Für die morgige Einheit heißt das: locker laufen, keine Intervalle, und am Nachmittag';
const BUILD_LINES = fenceLines(buildCard);

// --- the fixed states ------------------------------------------------------------------------------------------

function chatRecord(uid, title, turns, updated = NOW) {
  return { uid, title, created: NOW - 60 * MINUTE, updated, config: CONFIG, draft: '', context: [], turns };
}

function streamingTurn(uid, text, fields = {}) {
  return {
    uid, text, context: [], created: NOW - 20_000, updated: NOW - 10_000, owner: 'phone', attempt: 'req-' + uid,
    answer: '', reasoning: '', error: '', status: 'streaming', usage: {}, activity: [], sources: [], phase: 'requesting',
    ...fields,
  };
}

const EMPTY_CHAT = chatRecord('labempty', 'New chat', []);
const LONG_CHAT = chatRecord('lablong', 'Schlaf und Training', [{
  uid: 'long-turn-1', text: 'Wie hab ich geschlafen und was soll ich heute trainieren? Bitte mit Karte und Quellen.',
  context: [], created: NOW - 12 * MINUTE, updated: NOW - 11 * MINUTE, owner: 'phone', attempt: 'attempt-long',
  answer: LONG_ANSWER, reasoning: 'Ich schaue zuerst in die Schlafdaten und danach in den Kalender …', error: '',
  status: 'done', usage: { runtime: 'pocket-server', input_tokens: 12400, output_tokens: 3100, request_identity: 'compatible|' + CONFIG.baseUrl + '|' + CONFIG.model }, activity: longActivity,
  sources: [{ href: 'https://example.com/hrv', title: 'HRV and readiness' }, { href: LONG_URL, title: 'Schlaf, HRV und Ruhepuls' }],
  phase: 'done',
}]);
const FAILED_CHAT = chatRecord('labfailed', 'Fehlgeschlagen', [{
  uid: 'failed-turn-1', text: 'Fass mir die letzte Woche zusammen.', context: [], created: NOW - 9 * MINUTE,
  updated: NOW - 8 * MINUTE, owner: 'phone', attempt: 'attempt-failed', answer: '', reasoning: '', error: 'The provider did not answer (502). Try again.',
  status: 'failed', usage: {}, sources: [], phase: 'failed', activity: [{
    id: 'failed-a1', kind: 'web', name: 'search_web', title: 'search web “last week training”', state: 'failed',
    summary: 'The provider did not answer (502)', input: '{"query":"last week training"}', result: '{"error":"provider"}',
    started: NOW - 500_000, ended: NOW - 495_000, sources: [],
  }],
}]);

const APPROVAL_ROW = {
  id: 'row-approval', kind: 'tool', name: 'create_record', title: 'create record “Blue car”',
  input: '{"kind":"note","title":"Blue car","text":"21,000 euros"}', state: 'awaiting', summary: 'waiting for your approval',
  result: '{"kind":"approval","action":{"kind":"note","title":"Blue car","text":"21,000 euros"},"requires_confirmation":true}',
  started: NOW - 40_000, ended: 0, sources: [],
};
const APPROVAL_TURN = streamingTurn('approval-turn-1', 'Speichere den Preis für das blaue Auto als Notiz.', {
  phase: 'waiting for your approval', activity: [APPROVAL_ROW],
});
const APPROVAL_CHAT = chatRecord('labapproval', 'Notiz speichern', [APPROVAL_TURN]);

// A reply that set up a job (the line under it says so) after a job's own report, as it lands in the big chat.
const SCHEDULED_ROW = {
  id: 'row-scheduled', kind: 'tool', name: 'create_job', title: 'set up a job · Bike prices', state: 'done', summary: 'scheduled · Bike prices',
  input: '{"kind":"prompt","title":"Bike prices","prompt":"Remind me to check the bike prices.","time":"08:00","days":["mon"]}',
  result: '{"kind":"job","done":"scheduled","id":"jlab01","title":"Bike prices","type":"prompt","schedule":"Mon 08:00","enabled":true,"to":"home","next":"2026-11-16 08:00","timezone":"Europe/Berlin"}',
  started: NOW - 50_000, ended: NOW - 49_000, sources: [],
};
const SCHEDULED_CHAT = chatRecord('labscheduled', 'Erinnerungen', [{
  uid: 'scheduled-turn-0', text: 'Due tomorrow (job)', context: [], created: NOW - 14 * MINUTE, updated: NOW - 14 * MINUTE, owner: 'pip-routine', attempt: 'attempt-job',
  answer: 'Tomorrow: the dentist at 09:30, and the tax form is due. Nothing else is open.', reasoning: '', error: '', status: 'done', usage: {}, activity: [], sources: [], phase: 'done',
}, {
  uid: 'scheduled-turn-1', text: 'Erinnere mich jeden Montag um 8, die Fahrradpreise zu prüfen.', context: [], created: NOW - 60_000, updated: NOW - 48_000, owner: 'phone', attempt: 'attempt-scheduled',
  answer: 'Mache ich: jeden Montag um 08:00 erinnere ich dich hier daran.', reasoning: '', error: '', status: 'done', usage: {}, activity: [SCHEDULED_ROW], sources: [], phase: 'done',
}], NOW - 3 * 24 * 60 * MINUTE); // older than the other chats, so the list the dialog state uses keeps its order

const PINNED_CHAT = chatRecord('labpinned', 'Schlafkarte', [{
  uid: 'pinned-turn-1', text: 'Zeig mir meine Schlafwerte als Karte.', context: [], created: NOW - 15 * MINUTE,
  updated: NOW - 14 * MINUTE, owner: 'phone', attempt: 'attempt-pinned',
  answer: 'Deine Schlafwerte als Karte:\n\n' + pinnedCard + '\n\nDie Karte bleibt auf Today sichtbar, bis du sie wieder löst.',
  reasoning: '', error: '', status: 'done', usage: {}, activity: [], sources: [], phase: 'done',
}]);

// Pip's one big chat as two segments: an old one of forty short exchanges and the current one of five. They are
// written like every other chat, and the page joins them oldest first.
function homeTurn(prefix, index, created) {
  return {
    uid: prefix + '-turn-' + index, text: 'Frage ' + index, context: [], created, updated: created + 1000,
    owner: 'phone', attempt: 'home-attempt-' + index, answer: 'Antwort ' + index + '.', reasoning: '', error: '',
    status: 'done', usage: {}, activity: [], sources: [], phase: 'done',
  };
}
const HOME_EARLIER_CHAT = {
  uid: 'labhome1', title: 'pip', titled: true, home: true, created: NOW - 180 * MINUTE, updated: NOW - 100 * MINUTE,
  config: CONFIG, draft: '', context: [],
  turns: Array.from({ length: 40 }, (_, index) => homeTurn('home-a', index + 1, NOW - (150 - index) * MINUTE)),
};
const HOME_CURRENT_CHAT = {
  uid: 'labhome2', title: 'pip', titled: true, home: true, created: NOW - 90 * MINUTE, updated: NOW - 2 * MINUTE,
  config: CONFIG, draft: '', context: [],
  turns: Array.from({ length: 5 }, (_, index) => homeTurn('home-b', 41 + index, NOW - (20 - index) * MINUTE)),
};

const THINKING_TURN = streamingTurn('thinking-turn-1', QUESTION);
const TOOL_TURN = streamingTurn('tool-turn-1', 'Was steht heute an? Suche in meinen Notizen und im Web.', {
  phase: 'searching',
  activity: [
    { id: 'tool-a1', kind: 'records', name: 'search_notes', title: 'search notes “Training”', state: 'done', summary: '2 notes', input: '{"query":"Training"}', result: '{"notes":2}', started: NOW - 9000, ended: NOW - 8000, sources: [] },
    { id: 'tool-a2', kind: 'web', name: 'search_web', title: 'search web “hrv training readiness”', state: 'running', summary: '', input: '{"query":"hrv training readiness"}', started: NOW - 3000, ended: 0, sources: [] },
  ],
});
const WRITING_TURN = streamingTurn('writing-turn-1', QUESTION, {
  phase: 'writing', answer: WRITING_TEXT,
  activity: [{ id: 'writing-a1', kind: 'records', name: 'search_notes', title: 'search notes “Schlaf”', state: 'done', summary: '3 notes', input: '{"query":"Schlaf"}', result: '{"notes":3}', started: NOW - 9000, ended: NOW - 8000, sources: [] }],
});
// Two messages sent while the reply above is written: they wait their turn on the server (a run row `waiting`
// whose config names its chat's queue), one of them as long as a person writes when they hand over a task.
const QUEUED_TURN = streamingTurn('queued-turn-1', QUESTION, { phase: 'writing', answer: WRITING_TEXT });
const QUEUED_MESSAGES = [
  'Und danach: Plane mir den langen Lauf am Samstag, mit Strecke, Tempo und wann ich losgehen sollte, damit ich vor dem Regen zurück bin.',
  'Erinnere mich morgen an die Donaudampfschifffahrtsgesellschaft.',
];
const BUILDING_TURN = streamingTurn('building-turn-1', 'Zeig mir die Werte als Karte.', {
  phase: 'drawing',
  answer: 'Die Werte als Karte:\n\n' + openFence(BUILD_LINES.slice(0, 5)),
});

// The memory page: four lasting facts, one learned in an existing chat and one as long as the store allows.
const MEMORY_LONG = 'Trains for a half marathon in April, follows a plan that builds the long run every second weekend with easy runs in between and one interval session, takes a full rest day after the longest run so the knees stay quiet, and keeps a paper log of every run read back on every Sunday.';
const MEMORY_ROWS = [
  { text: 'Keeps Sundays free and prefers to train early, before work.', chat: 'lablong' },
  { text: 'Trains for a half marathon in April.' },
  { text: 'Likes short answers without preamble.' },
  { text: MEMORY_LONG },
];
const MEMORY_CHAT = 'lablong';

// Pip on its own and the settings screen: two jobs, one whose last run failed, and the two accounts a person has
// connected, so both pages show what they show after being used rather than an empty first visit.
const JOB_ROWS = [
  { kind: 'checkin', title: 'Morning check-in', time: '07:30', days: [1, 2, 3, 4, 5], delivery: 'notify' },
  {
    kind: 'watch', title: 'Bike prices', prompt: 'Tell me when a used road bike under 900 € shows up near Berlin.',
    every: 120, activeHours: { start: '08:00', end: '22:00' }, delivery: 'notify',
  },
];

// The notes and tasks lists: six notes (one pinned, one title as long as a phone line allows) and tasks in every
// group the page can draw (overdue, today with one done, this week with steps, later).
const NOTE_TITLE_120 = 'Notes from the harbour walks, the fish market and the ferry terminal, with a long stop on the pier before the rain came.';
const NOTE_ROWS = [
  { uid: 'labnote1', title: 'Lighthouse', line: 'The keeper leaves the light on until the last ferry has passed the point.', pinned: true, days: 0 },
  { uid: 'labnote2', title: 'Blue car', line: 'The dealer in Almada has the estate, 21,000 euros, with the service history.', pinned: false, days: 1 },
  { uid: 'labnote3', title: NOTE_TITLE_120, line: 'Everything smelled of salt and diesel, and nobody was in a hurry.', pinned: false, days: 2 },
  { uid: 'labnote4', title: 'Sunday run', line: 'Eight kilometres along the river, slow at the start and easy at the end.', pinned: false, days: 5 },
  { uid: 'labnote5', title: 'Lisbon in April', line: 'Book the flat near the market before the prices climb for the holiday.', pinned: false, days: 9 },
  { uid: 'labnote6', title: 'Insurance', line: 'The renewal letter wants an answer before the end of the month.', pinned: false, days: 14 },
];

const dayFromNow = offset => {
  const at = new Date(NOW);
  at.setDate(at.getDate() + offset);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
};
const TASK_ROWS = [
  { uid: 'labtask1', text: 'Send the insurance form', due: dayFromNow(-2), done: false, important: true, steps: [] },
  { uid: 'labtask2', text: 'Call the dentist about the crown', due: dayFromNow(0), done: false, important: false, steps: [] },
  { uid: 'labtask3', text: 'Water the plants on the balcony', due: dayFromNow(0), done: true, important: false, steps: [] },
  { uid: 'labtask4', text: 'Plan the long run for Saturday', due: dayFromNow(3), done: false, important: true, steps: [
    { text: 'Pick a route', done: true }, { text: 'Check the weather', done: true },
    { text: 'Fill the bottles', done: false }, { text: 'Send the route to Sam', done: false },
  ] },
  { uid: 'labtask5', text: 'Book the train to Lisbon', due: dayFromNow(20), done: false, important: false, steps: [] },
];

/** Forgets everything this account remembered, so a state starts from a known list. */
async function resetMemory(ctx) {
  for (const entry of await ctx.memory.listMemory(USER)) await ctx.memory.forget(USER, entry.id);
}

/** Gives the account the four entries the memory picture shows, oldest first. */
async function seedMemory(ctx) {
  await resetMemory(ctx);
  for (const row of MEMORY_ROWS) await ctx.memory.remember(USER, row.text, { chat: row.chat || '' });
}

/** The notes and tasks records as synced documents, the way the phone leaves them. */
function labDocuments() {
  return {
    'notes.json': { v: 1, notes: NOTE_ROWS.map((row, index) => ({
      uid: row.uid, text: row.title + '\n\n' + row.line, pinned: row.pinned,
      created: NOW - (row.days + 3) * 24 * 3600_000, updated: NOW - row.days * 24 * 3600_000 + index, deleted: false,
    })) },
    'tasks.json': { v: 1, tasks: TASK_ROWS.map((row, index) => ({
      uid: row.uid, text: row.text, done: row.done, due: row.due, important: row.important, steps: row.steps, list: '',
      created: NOW - (20 - index) * 3600_000, updated: NOW - index * 60_000, deleted: false,
    })), lists: [], next: { uid: '', updated: 0 } },
  };
}

/** A key on the account, sealed the way the vault stores it; unlike saveKey it makes no DNS lookup. */
async function seedKey(ctx, provider, baseUrl, key) {
  const endpoint = ctx.keys.endpoint(provider, baseUrl);
  await ctx.execute({
    sql: `INSERT INTO pocket_pip_keys (user_id, endpoint, provider, sealed, hint, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, endpoint) DO UPDATE SET provider = excluded.provider, sealed = excluded.sealed, hint = excluded.hint, updated_at = excluded.updated_at`,
    args: [USER, endpoint, provider, ctx.secrets.seal(USER, { provider, endpoint, key }), key.slice(-4), NOW],
  });
}

/** The settings screen's data: two connected accounts, how Pip is set up, and some of what it may read. */
async function seedSettings(page, ctx) {
  await ctx.execute({ sql: 'DELETE FROM pocket_pip_keys WHERE user_id = ?', args: [USER] });
  await seedKey(ctx, 'compatible', CONFIG.baseUrl, 'lab-opencode-key-1234');
  await seedKey(ctx, 'compatible', 'https://openrouter.ai/api/v1', 'lab-openrouter-key-5678');
  await page.evaluate(({ scope, endpoint, config }) => {
    localStorage.setItem(scope + 'pocket:pip-settings', JSON.stringify(config));
    localStorage.setItem(scope + 'pocket:pip-access:compatible|' + endpoint, JSON.stringify(['notes', 'tasks', 'thoughts']));
  }, { scope: `pocket:account:${USER}:`, endpoint: CONFIG.baseUrl, config: CONFIG });
}

/** The jobs screen's data: its own key and settings, two routines, and a failed run on the watch. */
async function seedJobs(ctx) {
  for (const table of ['pocket_pip_routines', 'pocket_pip_routine_runs', 'pocket_pip_routine_memory', 'pocket_pip_background']) {
    await ctx.execute({ sql: 'DELETE FROM ' + table + ' WHERE user_id = ?', args: [USER] });
  }
  await ctx.background.saveBackground(USER, {
    ...CONFIG, grants: ['notes', 'tasks', 'thoughts'], dailyTokens: 200_000, timezone: 'Europe/Berlin', enabled: true, useAccountKey: false,
  }, 'lab-background-key-12345678');
  let state = null;
  for (const row of JOB_ROWS) state = await ctx.background.saveRoutine(USER, row);
  const failed = state.routines.find(routine => routine.title === 'Bike prices');
  await ctx.background.recordRun(USER, failed.id, { status: 'failed', error: 'The provider did not answer (502).' }, NOW - 50 * MINUTE);
  await ctx.execute({
    sql: 'UPDATE pocket_pip_routines SET last_run = ?, last_error = ? WHERE user_id = ? AND id = ?',
    args: [NOW - 50 * MINUTE, 'The provider did not answer (502).', USER, failed.id],
  });
}

// --- Today and assignments ------------------------------------------------------------------------------------
// Each of these states has an account of its own, seeded once at its own moment of the day (`at`): the page's clock
// is moved there, so the morning and the evening look as they would, whatever time the lab runs. Lengths are real
// ones: a 120-character task, German words, sixteen tasks in the morning.

const HOUR = 60 * MINUTE;
/** The latest past moment at hh:mm, so nothing seeded lies in the server's future. */
const momentAt = (hour, minute) => { const date = new Date(NOW); date.setHours(hour, minute, 0, 0); if (date.getTime() > NOW) date.setDate(date.getDate() - 1); return date.getTime(); };
const dayOf = (at, offset = 0) => { const date = new Date(at); date.setDate(date.getDate() + offset); return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'); };
const atDay = (at, offset, hour, minute = 0) => { const date = new Date(at); date.setDate(date.getDate() + offset); date.setHours(hour, minute, 0, 0); return date.getTime(); };
const TASK_120 = 'Write to the Hausverwaltung about the broken intercom in the stairwell and the missing name plate on the third floor door';
const MORNING_TASKS = [
  ['Submit the tax return', -2], ['Call the landlord', 0], [TASK_120, 0], ['Renew bike insurance', 0], ['Kündigung des Fitnessstudios abschicken', -1],
  ['Book the train to Leipzig for Monday', 0], ['Pick up the parcel at the Packstation', 0], ['Pay the electricity bill', -3], ['Reply to Marta about dinner', 0],
  ['Order contact lenses', 0], ['Sign the ' + LONG_WORD + ' form', 0], ['Water the plants on the balcony', 0], ['Back up the phone', -1],
  ['Return the library books', 0], ['Send Jonas the photos from Saturday', 0], ['Check the tyre pressure', 0],
];
const BIKE_BRIEF = 'Compare the current prices of the Canyon Grail 7, the Rose Backroad GRX and the Cube Nuroad Race in my size, with stock and delivery time, and say which is the best buy.';
const BIKE_REPORT = 'The **Canyon Grail 7** is the cheapest of the three at 1,899 euros, 180 under the next, and it is in stock in your size. The Rose Backroad dropped 100 euros this week.\n\n| bike | price | stock |\n|---|---:|---|\n| Canyon Grail 7 | 1,899 € | in stock |\n| Rose Backroad GRX | 2,079 € | 3 weeks |\n| Cube Nuroad Race | 2,149 € | in stock |\n\nIf you want one, tell me and I will add a task to order it.';
const lookupRows = (prefix, count, at) => Array.from({ length: count }, (_, index) => ({ id: prefix + '-l' + index, kind: 'web', name: index % 2 ? 'read_web_page' : 'search_web', title: (index % 2 ? 'read web page “' : 'search web “') + ['Canyon Grail 7', 'canyon.com', 'Rose Backroad GRX', 'rosebikes.de', 'Cube Nuroad Race', 'cube.eu'][index % 6] + '”',
  state: 'done', summary: index % 2 ? '1,100 words' : '5 pages', input: '{}', result: '{}', started: at + index * 7000, ended: at + index * 7000 + 6000, sources: [] }));
const doneTurn = (uid, text, answer, created, fields = {}) => ({ uid, text, context: [], created, updated: created + 30_000, owner: 'phone', attempt: 'attempt-' + uid,
  answer, reasoning: '', error: '', status: 'done', usage: {}, activity: [], sources: [], phase: 'done', ...fields });
const homeOf = (user, turns, at) => ({ uid: 'home-' + user.replace(/[^a-z0-9]/g, ''), title: 'pip', titled: true, home: true, created: at - 30 * HOUR, updated: at, config: CONFIG, draft: '', context: [], turns });

/** A fresh account, with its tasks, appointments and notes as synced documents. */
async function seedAccount(ctx, user, { tasks = [], events = [], notes = [] } = {}) {
  await ctx.execute({ sql: 'INSERT OR IGNORE INTO pocket_user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)', args: [user, 'Ada', user + '@example.com', NOW, NOW] });
  await ctx.workspace.syncDocuments(user, {
    'tasks.json': { v: 1, tasks: tasks.map((row, index) => ({ uid: 'task-' + index, text: row.text, done: Boolean(row.done), due: row.due || '', important: false, steps: [], list: '',
      created: row.created || NOW - 3 * 24 * HOUR, updated: row.updated || NOW - 2 * 24 * HOUR + index, deleted: false })), lists: [], next: { uid: '', updated: 0 } },
    'agenda.json': { v: 1, events: events.map((row, index) => ({ uid: 'event-' + index, title: row.title, when: row.when, minutes: row.minutes, remindAt: 0, task_uid: '', created: NOW - 3 * 24 * HOUR, updated: NOW - 2 * 24 * HOUR, deleted: false })) },
    'notes.json': { v: 1, notes },
  });
}
/** Pip on its own for the account, a morning check-in, and its run that reported `turn` in `chat`. */
async function seedBrief(ctx, user, chat, turn, at) {
  await ctx.background.saveBackground(user, { ...CONFIG, grants: ['notes', 'tasks', 'calendar'], dailyTokens: 200_000, timezone: 'Europe/Berlin', enabled: true, useAccountKey: false }, 'lab-background-key-12345678');
  const state = await ctx.background.saveRoutine(user, { kind: 'checkin', title: 'Morning check-in', time: '07:30', days: [0, 1, 2, 3, 4, 5, 6], delivery: 'notify' });
  await ctx.background.recordRun(user, state.routines.find(routine => routine.kind === 'checkin').id, { status: 'done', chat, turn }, at);
}
/** An assignment's run row as the server keeps it, with the events that date its start and end. */
async function seedAssignment(ctx, user, { id, title, brief = BIKE_BRIEF, state, created, started = created, ended = 0, origin, report = null, error = '', lookups = 0, retryOf = '' }) {
  const status = state === 'working' ? 'running' : state;
  const config = { ...CONFIG, grants: ['notes', 'tasks'], timezone: 'Europe/Berlin', lane: '@assign', assignment: { title, brief, origin, ...(retryOf ? { retryOf } : {}) }, ...(report ? { delivered: report.chat } : {}) };
  const turn = { uid: report?.turn || 'turn-' + id, text: brief, context: [], created, updated: ended || created, owner: 'pip-assignment', attempt: 'attempt-' + id, answer: '', reasoning: '', error,
    status: state === 'working' ? 'streaming' : state, usage: {}, activity: lookupRows(id, lookups, started), sources: [], phase: state === 'working' ? 'searching' : state };
  await ctx.execute({ sql: `INSERT OR REPLACE INTO pocket_pip_runs (user_id, run_id, chat_uid, request_id, turn_uid, device, status, turn, checkpoint, config, device_tools, lease_id, lease_until, expires_at, created, updated)
    VALUES (?, ?, ?, ?, ?, '', ?, ?, NULL, ?, '[]', ?, ?, 0, ?, ?)`, args: [user, id, '@assign-' + id, 'as-' + id, turn.uid, status, JSON.stringify(turn), JSON.stringify(config),
    state === 'working' ? 'lab-lease' : '', state === 'working' ? NOW + 12 * HOUR : 0, created, ended || started] });
  for (const [kind, at] of [['started', started], ...(ended ? [[state, ended]] : [])]) {
    await ctx.execute({ sql: 'INSERT INTO pocket_pip_run_events (user_id, run_id, kind, data, created) VALUES (?, ?, ?, ?, ?)', args: [user, id, kind, '{}', at] });
  }
}
/** A reply in `chat` waiting for the person to approve saving `title`. */
async function seedDecision(ctx, user, { runId, chat, kind, title, at }) {
  const row = { id: 'row-' + runId, kind: 'tool', name: 'create_record', title: 'create record “' + title + '”', input: JSON.stringify({ kind, title }), state: 'awaiting', summary: 'waiting for your approval',
    result: JSON.stringify({ kind: 'approval', action: { kind, title }, requires_confirmation: true }), started: at, ended: 0, sources: [] };
  const turn = streamingTurn('turn-' + runId, 'Save “' + title + '” as a ' + kind + '.', { created: at, updated: at, phase: 'waiting for your approval', activity: [row] });
  await ctx.objects.writeObject(user, 'chats', { uid: chat, title: chat === 'labflat' ? 'Wohnung' : 'Fahrrad', created: at - HOUR, updated: at, config: CONFIG, draft: '', context: [], turns: [turn] });
  await ctx.execute({ sql: `INSERT INTO pocket_pip_runs (user_id, run_id, chat_uid, request_id, turn_uid, device, status, turn, checkpoint, config, device_tools, lease_id, lease_until, expires_at, created, updated)
    VALUES (?, ?, ?, ?, ?, 'phone', 'awaiting', ?, NULL, ?, '[]', '', 0, ?, ?, ?)`, args: [user, runId, chat, 'req-' + runId, turn.uid, JSON.stringify(turn), JSON.stringify(CONFIG), NOW + 12 * HOUR, at, at] });
  await ctx.execute({ sql: `INSERT INTO pocket_pip_run_requests (user_id, run_id, request_id, kind, tool, call_id, row_id, payload, state, created) VALUES (?, ?, ?, 'write', 'create_record', ?, ?, ?, 'pending', ?)`,
    args: [user, runId, 'approval-' + runId, 'call-' + runId, row.id, JSON.stringify({ action: { kind, title } }), at] });
}
const pinnedChat = (user, at) => ({ uid: 'pinned-' + user.replace(/[^a-z0-9]/g, ''), title: 'Schlafkarte', created: at - 26 * HOUR, updated: at - 25 * HOUR, config: CONFIG, draft: '', context: [],
  turns: [doneTurn('pinned-' + user, 'Zeig mir meine Schlafwerte als Karte.', 'Deine Schlafwerte als Karte:\n\n' + pinnedCard + '\n\nDie Karte bleibt auf Today sichtbar.', at - 25 * HOUR)] });

const SEEDS = {
  async 'lab-today-morning'(ctx, user, at) {
    await seedAccount(ctx, user, {
      tasks: MORNING_TASKS.map(([text, offset]) => ({ text, due: dayOf(at, offset) })),
      events: [{ title: 'Dentist, Dr. Weber', when: atDay(at, 0, 10, 30), minutes: 45 }, { title: 'Lunch with Jonas', when: atDay(at, 0, 13), minutes: 60 }, { title: 'Climbing at the Boulderhalle with Sam and Lea', when: atDay(at, 0, 18, 30), minutes: 120 }],
    });
    const home = homeOf(user, [
      doneTurn('m-watch', 'Train strike watch (job)', 'GDL strike called for Monday; your 07:12 to Leipzig is affected. The S-Bahn runs as usual.', at - 2 * HOUR - 20 * MINUTE, { owner: 'pip-routine' }),
      doneTurn('m-brief', 'Morning check-in (job)', 'Dentist at 10:30, so leave by 10:05. The tax return is two days late: it is the one thing worth doing before noon.\n\nThe bike prices are still being compared; the report follows in a few minutes.', at - 60 * MINUTE, { owner: 'pip-routine' }),
      doneTurn('m-report', 'Flat insurance (assignment)', 'Your current tariff is fine; switching to the cheapest comparable one saves 14 euros a year, not worth the paperwork.', at - 50 * MINUTE, { owner: 'pip-assignment' }),
    ], at - 50 * MINUTE);
    await ctx.objects.writeObject(user, 'chats', home);
    await ctx.objects.writeObject(user, 'chats', pinnedChat(user, at));
    await seedBrief(ctx, user, home.uid, 'm-brief', at - 59 * MINUTE);
    await seedAssignment(ctx, user, { id: 'lab-m-bike', title: 'Bike prices', state: 'working', created: at - 47 * MINUTE, started: at - 46 * MINUTE, origin: { chat: home.uid, turn: 'origin' }, lookups: 3 });
    await seedAssignment(ctx, user, { id: 'lab-m-flat', title: 'Flat insurance', state: 'done', created: at - 9 * HOUR, started: at - 9 * HOUR, ended: at - 50 * MINUTE, origin: { chat: home.uid, turn: 'origin2' }, report: { chat: home.uid, turn: 'm-report' }, lookups: 6 });
    return at - 10 * HOUR - 50 * MINUTE;
  },
  async 'lab-today-evening'(ctx, user, at) {
    const day = dayOf(at);
    await seedAccount(ctx, user, {
      tasks: [{ text: 'Submit the tax return', due: dayOf(at, -2) }, { text: 'Pack the climbing bag', due: dayOf(at, 1) }, { text: 'Reply to Marta about dinner', due: day },
        { text: 'Call the landlord', due: day, done: true, updated: at - 6 * HOUR }, { text: 'Renew bike insurance', due: day, done: true, updated: at - 4 * HOUR },
        { text: TASK_120, due: day, done: true, updated: at - 3 * HOUR }, { text: 'Water the plants on the balcony', done: true, updated: at - HOUR }],
      events: [{ title: 'Flat viewing, Lindenstraße 12', when: atDay(at, 1, 9), minutes: 45 }, { title: 'Dinner at Marta’s', when: atDay(at, 1, 19), minutes: 150 }],
      notes: [{ uid: 'day-' + day + '-lab', text: '# ' + day + '\n\nLong day; the viewing tomorrow matters more than the tax return.', pinned: false, created: at - 2 * HOUR, updated: at - 2 * HOUR, deleted: false }],
    });
    const home = homeOf(user, [
      doneTurn('e-brief', 'Morning check-in (job)', 'Dentist at 10:30, so leave by 10:05. The tax return is two days late.', at - 12 * HOUR, { owner: 'pip-routine' }),
      doneTurn('e-report', 'Bike prices (assignment)', BIKE_REPORT, at - 4 * HOUR - 10 * MINUTE, { owner: 'pip-assignment' }),
      doneTurn('e-watch', 'Train strike watch (job)', 'The strike was called off; your Monday train runs.', at - 2 * HOUR, { owner: 'pip-routine' }),
    ], at - 2 * HOUR);
    await ctx.objects.writeObject(user, 'chats', home);
    await ctx.objects.writeObject(user, 'chats', pinnedChat(user, at));
    await seedBrief(ctx, user, home.uid, 'e-brief', at - 12 * HOUR + MINUTE);
    await seedAssignment(ctx, user, { id: 'lab-e-bike', title: 'Bike prices', state: 'done', created: at - 5 * HOUR, ended: at - 4 * HOUR - 10 * MINUTE, origin: { chat: home.uid, turn: 'origin' }, report: { chat: home.uid, turn: 'e-report' }, lookups: 6 });
    return at - 6 * HOUR - 25 * MINUTE;
  },
  async 'lab-today-empty'(ctx, user) { await seedAccount(ctx, user); return 0; },
  async 'lab-today-decision'(ctx, user, at) {
    await seedAccount(ctx, user, {
      tasks: [{ text: 'Submit the tax return', due: dayOf(at, -2) }, { text: 'Call the landlord', due: dayOf(at) }],
      events: [{ title: 'Dentist, Dr. Weber', when: atDay(at, 0, 10, 30), minutes: 45 }],
    });
    await seedDecision(ctx, user, { runId: 'lab-d1', chat: 'labflat', kind: 'task', title: 'Call Ms. Brandt about the deposit', at: at - 18 * MINUTE });
    await seedDecision(ctx, user, { runId: 'lab-d2', chat: 'labbike', kind: 'note', title: 'Canyon Grail 7: 1,899 euros, in stock in size M', at: at - 35 * MINUTE });
    await seedAssignment(ctx, user, { id: 'lab-d-train', title: 'Train times to Leipzig', state: 'failed', created: at - 2 * HOUR, ended: at - 92 * MINUTE, origin: { chat: 'labflat', turn: 'x' }, lookups: 1, error: 'The provider did not answer (502). Try again in a few minutes.' });
    return at - 10 * HOUR - 50 * MINUTE;
  },
};
/** The big chat with an assignment handed off, a message meanwhile, and (when done) the report under them. */
async function seedAssignmentChat(ctx, user, state) {
  await seedAccount(ctx, user);
  const at = NOW - 6 * MINUTE, home = homeOf(user, [], NOW);
  const started = { id: 'row-assign', kind: 'tool', name: 'start_assignment', title: 'start an assignment · Bike prices', state: 'done', summary: 'started · Bike prices', input: JSON.stringify({ title: 'Bike prices', brief: BIKE_BRIEF }),
    result: JSON.stringify({ kind: 'assignment', done: 'started', id: 'lab-a-bike', title: 'Bike prices' }), started: at + 2000, ended: at + 2500, sources: [] };
  home.turns = [
    doneTurn('a-origin', 'Find out what the three bikes on my list cost now and tell me later.', 'I am looking into it in the background. Keep writing; the report will arrive here when it is done, usually within a few minutes.', at, { activity: [started] }),
    doneTurn('a-meanwhile', 'Meanwhile: is the dentist at 10:30 or 11?', '10:30, at Dr. Weber’s. Leave by 10:05 to be on time.', at + MINUTE),
    ...(state === 'done' ? [doneTurn('a-report', 'Bike prices (assignment)', BIKE_REPORT, NOW - 2 * MINUTE, { owner: 'pip-assignment', activity: lookupRows('a-report', 6, at + 10_000),
      sources: [{ href: 'https://www.canyon.com/de-de/gravel-bikes/grail-7', title: 'canyon.com' }, { href: 'https://www.rosebikes.de/backroad-grx', title: 'rosebikes.de' }, { href: 'https://www.cube.eu/nuroad-race', title: 'cube.eu' }] })] : []),
  ];
  await ctx.objects.writeObject(user, 'chats', home);
  await seedAssignment(ctx, user, { id: 'lab-a-bike', title: 'Bike prices', state, created: at + 2500, started: at + 3000, ended: state === 'working' ? 0 : NOW - 2 * MINUTE,
    origin: { chat: home.uid, turn: 'a-origin' }, report: state === 'done' ? { chat: home.uid, turn: 'a-report' } : null, lookups: state === 'failed' ? 2 : 3,
    error: state === 'failed' ? 'The provider could not be reached (502). Try again in a few minutes.' : '' });
}

const openToday = async (page, ctx, state, wanted) => {
  await page.goto(ctx.origin + '/#/today', { waitUntil: 'domcontentloaded' });
  await untilFor(page, state, 'Today with its data', 15000, words => words.every(word => document.body.innerText.includes(word)), wanted);
};
const TODAY_STATES = [
  { name: 'today-morning', account: 'lab-today-morning', at: () => momentAt(8, 30),
    async run(page, ctx) { await openToday(page, ctx, 'today-morning', ['leave by 10:05', 'Bike prices', 'Dentist, Dr. Weber', 'Check the tyre pressure']); },
    text: ['today', /from pip/i, 'since', 'Bike prices', 'working', 'Flat insurance', 'Train strike watch', /appointments/i, /tasks/i, '2 days late'], scroll: 'top' },
  { name: 'today-morning-end', account: 'lab-today-morning', at: () => momentAt(8, 30),
    async run(page, ctx) { await openToday(page, ctx, 'today-morning-end', ['Check the tyre pressure', 'Schlafkarte']); },
    text: [/pinned/i, 'Schlafkarte', 'Check the tyre pressure'], scroll: 'bottom' },
  { name: 'today-evening', account: 'lab-today-evening', at: () => momentAt(19, 30),
    async run(page, ctx) { await openToday(page, ctx, 'today-evening', ['evening', 'Flat viewing', 'Pack the climbing bag', 'Bike prices']); },
    text: ['evening', /tomorrow/i, 'Flat viewing, Lindenstraße 12', /tasks/i, 'Renew bike insurance', /the day/i, 'Bike prices', 'Train strike watch'], scroll: 'top' },
  { name: 'today-empty', account: 'lab-today-empty', at: () => momentAt(8, 30),
    async run(page, ctx) { await openToday(page, ctx, 'today-empty', ['Nothing due and nothing planned today.']); },
    text: ['Nothing due and nothing planned today. Ask pip anything below.'], selectors: ['textarea[aria-label="Message Pip"]'], scroll: 'top' },
  { name: 'today-decision', account: 'lab-today-decision', at: () => momentAt(8, 30),
    async run(page, ctx) { await openToday(page, ctx, 'today-decision', ['Call Ms. Brandt', 'Train times to Leipzig']); },
    text: [/waiting for you/i, 'save task “Call Ms. Brandt about the deposit”', 'Wohnung', 'Failed: The provider did not answer (502).'], scroll: 'top' },
  ...['working', 'done', 'failed'].map(state => ({
    name: 'assignment-' + state, account: 'lab-assign-' + state,
    async run(page, ctx) {
      await page.goto(ctx.origin + '/#/pip', { waitUntil: 'domcontentloaded' });
      const line = state === 'working' ? 'assignment · working · 3 lookups' : state === 'done' ? 'assignment · reported' : 'Bike prices failed:';
      await untilFor(page, 'assignment-' + state, 'the assignment line', 15000, line => document.body.innerText.includes(line), line);
      // The report is long: the picture starts at the reply that handed the work off, so its line and the report show.
      if (state === 'done') { await page.evaluate(() => { document.querySelector('[data-turn="a-origin"]')?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -110); }); await sleep(300); }
    },
    text: ['Find out what the three bikes', 'Meanwhile', ...(state === 'done' ? ['Canyon Grail 7', '· assignment'] : state === 'working' ? ['stop'] : ['try again'])],
    scroll: state === 'done' ? 'keep' : 'bottom',
    seed: (ctx, user) => seedAssignmentChat(ctx, user, state),
  })),
];

const STATES = [
  {
    name: 'empty',
    async run(page, ctx) {
      await openStaticChat(page, ctx, 'empty', 'labempty', 'Ask about anything you keep in Pocket.');
    },
    text: ['Ask about anything you keep in Pocket.', 'pip'],
  },
  {
    name: 'long',
    async run(page, ctx) {
      await openStaticChat(page, ctx, 'long', 'lablong', 'Was die Werte sagen');
      await until(page, 'long', 'the rendered table and code', () => Boolean(document.querySelector('main table')) && Boolean(document.querySelector('main pre')));
    },
    text: ['Was die Werte sagen', 'Intervalle', 'const pace = distance / time;', '5 steps · 16 s', LONG_WORD, 'sehr-langer-pfad-mit-vielen-segmenten', 'HRV and readiness'],
    selectors: ['main table', 'main pre', '[data-card="klong01"]', '[aria-label="Card options"]'],
  },
  {
    name: 'long-top',
    async run(page, ctx) {
      await openStaticChat(page, ctx, 'long-top', 'lablong', 'Was die Werte sagen');
      await until(page, 'long-top', 'the rendered table and code', () => Boolean(document.querySelector('main table')) && Boolean(document.querySelector('main pre')));
    },
    text: ['Was die Werte sagen', LONG_WORD],
    scroll: 'top',
    async check(page) {
      const at = await page.evaluate(() => window.scrollY);
      if (at > 4) throw new Error('the page is not at the top (' + at + 'px)');
    },
  },
  {
    name: 'home',
    async run(page, ctx) {
      await openHome(page, ctx, 'home');
    },
    text: ['pip', 'Frage 45', 'Antwort 45.', 'Frage 16'],
    async check(page) {
      const seen = await page.evaluate(() => document.querySelectorAll('main article').length);
      if (seen !== 30) throw new Error('home shows ' + seen + ' turns, not the last 30');
      const body = await page.evaluate(() => document.body.innerText);
      if (body.includes('Frage 15')) throw new Error('a turn behind the button is already on screen');
    },
  },
  {
    name: 'home-earlier',
    async run(page, ctx) {
      await openHome(page, ctx, 'home-earlier');
      await scrollPage(page, 'top');
      await until(page, 'home-earlier', 'the earlier messages button', () => document.body.innerText.includes('earlier messages'));
    },
    text: ['earlier messages', 'Frage 16'],
    scroll: 'keep',
    async check(page) {
      const before = await page.evaluate(() => {
        const button = [...document.querySelectorAll('main button')].find(item => item.textContent.trim() === 'earlier messages');
        const message = [...document.querySelectorAll('main p')].find(item => item.textContent === 'Frage 16');
        return { height: button ? button.getBoundingClientRect().height : 0, top: message ? message.getBoundingClientRect().top : null };
      });
      if (!before.height) throw new Error('the earlier messages button is not on screen');
      if (page.viewport()?.width <= 400 && before.height < 44) throw new Error('the earlier messages button is ' + before.height + 'px tall');
      if (before.top === null) throw new Error('the first visible message was not found');
      await page.evaluate(() => {
        const button = [...document.querySelectorAll('main button')].find(item => item.textContent.trim() === 'earlier messages');
        button?.click();
      });
      await until(page, 'home-earlier', 'the earlier messages button to go', () => !document.body.innerText.includes('earlier messages'));
      const after = await page.evaluate(() => {
        const message = [...document.querySelectorAll('main p')].find(item => item.textContent === 'Frage 16');
        return message ? message.getBoundingClientRect().top : null;
      });
      if (after === null) throw new Error('the first message disappeared');
      const moved = Math.abs(after - before.top);
      if (moved > 4) throw new Error('the message moved ' + Math.round(moved) + 'px');
    },
  },
  {
    name: 'failed',
    async run(page, ctx) {
      await openStaticChat(page, ctx, 'failed', 'labfailed', 'The provider did not answer (502).');
    },
    text: ['The provider did not answer (502).', 'start over'],
  },
  {
    name: 'approval',
    async run(page, ctx) {
      await until(page, 'approval', 'the chat in this tab', key => localStorage.getItem(key) !== null, chatKey('labapproval'));
      await ctx.insertRun({
        runId: 'approval-run', chat: 'labapproval', requestId: 'approval-req', turn: APPROVAL_TURN, status: 'awaiting',
        expiresAt: NOW + 12 * 3600_000,
        requests: [{ requestId: 'approval-req', kind: 'write', tool: 'create_record', callId: 'approval-call', rowId: 'row-approval', payload: { action: { kind: 'note', title: 'Blue car', text: '21,000 euros' } } }],
      });
      await page.goto(ctx.origin + '/#/pip?chat=labapproval', { waitUntil: 'domcontentloaded' });
      await until(page, 'approval', 'the reply to attach', () => Boolean(document.querySelector('[aria-label="Stop the reply"]')));
      await until(page, 'approval', 'the approval buttons', () => document.body.innerText.includes('decline') && document.body.innerText.includes('review'));
    },
    text: [/needs your approval/i, 'Blue car', 'decline', 'review'],
  },
  {
    name: 'scheduled',
    async run(page, ctx) {
      await openStaticChat(page, ctx, 'scheduled', 'labscheduled', 'scheduled: Mon 08:00');
    },
    text: ['Due tomorrow (job)', 'scheduled: Mon 08:00 · Bike prices', 'jobs'],
    async check(page) {
      const link = await page.evaluate(() => [...document.querySelectorAll('main a')].find(item => item.textContent === 'jobs')?.getAttribute('href') || '');
      if (!link.includes('jobs')) throw new Error('the line under the reply does not link to jobs');
      const ledger = await page.evaluate(() => document.body.innerText.includes('set up a job'));
      if (ledger) throw new Error('the job step is listed as a lookup as well as said under the reply');
    },
  },
  {
    name: 'card-menu',
    async run(page, ctx) {
      await openStaticChat(page, ctx, 'card-menu', 'lablong', 'Was die Werte sagen');
      await until(page, 'card-menu', 'the rendered table and code', () => Boolean(document.querySelector('main table')) && Boolean(document.querySelector('main pre')));
      await page.click('[aria-label="Card options"]');
      await until(page, 'card-menu', 'the card menu', () => Boolean(document.querySelector('[role="menu"]')));
    },
    text: ['pin to today', 'refresh', 'remove'],
    selectors: ['[role="menu"]'],
    scroll: 'keep',
  },
  {
    name: 'today-pinned',
    async run(page, ctx) {
      await until(page, 'today-pinned', 'the pinned chat in this tab', key => localStorage.getItem(key) !== null, chatKey('labpinned'));
      await page.goto(ctx.origin + '/#/today', { waitUntil: 'domcontentloaded' });
      await until(page, 'today-pinned', 'the pinned card', () => Boolean(document.querySelector('[data-card="kpinned1"]')) && document.body.innerText.includes('Schlafkarte'));
    },
    text: ['Schlafkarte', 'Schlaf', '7 h 12', /pinned/i],
    selectors: ['[data-card="kpinned1"]'],
    scroll: 'top',
  },
  {
    name: 'notes',
    async run(page, ctx) {
      await page.goto(ctx.origin + '/#/notes', { waitUntil: 'domcontentloaded' });
      await until(page, 'notes', 'the seeded notes', () => document.body.innerText.includes('Lighthouse') && document.body.innerText.includes('Insurance'));
    },
    text: ['notes', /pinned/i, /recent/i, 'Lighthouse', NOTE_TITLE_120, 'Insurance'],
    selectors: ['main input[type="search"]'],
    scroll: 'top',
  },
  {
    name: 'tasks',
    async run(page, ctx) {
      await page.goto(ctx.origin + '/#/tasks', { waitUntil: 'domcontentloaded' });
      await until(page, 'tasks', 'the seeded tasks', () => document.body.innerText.includes('Send the insurance form') && document.body.innerText.includes('Call the dentist'));
    },
    text: ['tasks', /overdue/i, /today/i, 'Send the insurance form', 'Call the dentist about the crown'],
    selectors: ['main input[aria-label="New task"]'],
    scroll: 'top',
  },
  {
    name: 'chat-list',
    async run(page, ctx) {
      await openStaticChat(page, ctx, 'chat-list', 'lablong', 'Was die Werte sagen');
      await page.click('button[aria-label="All chats"]');
      await until(page, 'chat-list', 'the list of chats', () => {
        const dialog = document.querySelector('[role="dialog"]');
        return Boolean(dialog) && dialog.innerText.includes('Schlafkarte') && dialog.innerText.includes('ongoing');
      });
    },
    text: ['chats', 'pip', 'ongoing · 45 messages', 'Schlaf und Training', 'Notiz speichern', 'Fehlgeschlagen', 'Schlafkarte'],
    selectors: ['[role="dialog"]'],
    scroll: 'keep',
    async check(page) {
      const first = await page.evaluate(() => document.querySelector('[role="dialog"] [aria-current], [role="dialog"] button[type="button"]:not([data-slot])')?.innerText ?? '');
      const list = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? '');
      if (list.indexOf('pip') < 0 || list.indexOf('pip') > list.indexOf('Schlafkarte')) throw new Error('the pip row is not first: ' + JSON.stringify(first));
      if (/New chat/.test(list)) throw new Error('an empty chat is listed');
    },
  },
  {
    name: 'memory',
    async run(page, ctx) {
      await seedMemory(ctx);
      await until(page, 'memory', 'the remembered chat in this tab', key => localStorage.getItem(key) !== null, chatKey(MEMORY_CHAT));
      await page.goto(ctx.origin + '/#/memory', { waitUntil: 'domcontentloaded' });
      await until(page, 'memory', 'the remembered lines', () => document.body.innerText.includes('half marathon') && document.body.innerText.includes('Schlaf und Training'));
    },
    text: ['What pip remembers about you. It reads this in every reply.', MEMORY_LONG, 'Likes short answers without preamble.', 'Trains for a half marathon in April.', 'Schlaf und Training'],
    selectors: ['input[placeholder="add something pip should remember"]'],
    scroll: 'top',
  },
  {
    name: 'memory-empty',
    async run(page, ctx) {
      await resetMemory(ctx);
      await page.goto(ctx.origin + '/#/memory', { waitUntil: 'domcontentloaded' });
      await until(page, 'memory-empty', 'the empty memory page', () => document.body.innerText.includes('Nothing yet. Pip remembers lasting things you tell it'));
    },
    text: ['What pip remembers about you. It reads this in every reply.', 'Nothing yet. Pip remembers lasting things you tell it, and you can add some here.', 'remember'],
    selectors: ['input[placeholder="add something pip should remember"]'],
    scroll: 'top',
  },
  {
    name: 'settings',
    async run(page, ctx) {
      await seedSettings(page, ctx);
      await page.goto(ctx.origin + '/#/settings', { waitUntil: 'domcontentloaded' });
      await until(page, 'settings', 'the connected accounts', () => document.body.innerText.includes('OpenCode Go') && document.body.innerText.includes('connected') && document.body.innerText.includes('OpenRouter'));
    },
    text: ['settings', 'AI connections', 'OpenCode Go', 'OpenRouter', 'Anthropic', 'connected', 'what pip may read', 'this month'],
    scroll: 'top',
    async check(page) {
      const notes = await page.evaluate(() => [...document.querySelectorAll('[role="switch"]')]
        .find(node => node.getAttribute('aria-label') === 'Notes')?.getAttribute('aria-checked'));
      if (notes !== 'true') throw new Error('the seeded read access is not shown');
    },
  },
  {
    name: 'jobs',
    async run(page, ctx) {
      await seedJobs(ctx);
      await page.goto(ctx.origin + '/#/jobs', { waitUntil: 'domcontentloaded' });
      await until(page, 'jobs', 'the two jobs and the failed run', () => document.body.innerText.includes('Morning check-in') && document.body.innerText.includes('Bike prices') && document.body.innerText.includes('last failed'));
    },
    text: ['jobs', 'Morning check-in', 'Bike prices', 'last failed', 'recent runs'],
    scroll: 'top',
  },
  {
    name: 'job-editor',
    async run(page, ctx) {
      await seedJobs(ctx);
      await page.goto(ctx.origin + '/#/jobs', { waitUntil: 'domcontentloaded' });
      await until(page, 'job-editor', 'the jobs', () => document.body.innerText.includes('Bike prices'));
      await page.click('button[aria-label="Options for Bike prices"]');
      await until(page, 'job-editor', 'the job menu', () => Boolean(document.querySelector('[role="menu"]')));
      await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent.trim() === 'edit')?.click());
      await until(page, 'job-editor', 'the editor', () => Boolean(document.querySelector('[role="dialog"]')) && document.body.innerText.includes('report in pip'));
    },
    text: ['edit job', 'notify me', 'report in pip', 'Its reports go to a chat of its own.', 'save'],
    selectors: ['[role="dialog"] [role="switch"][aria-label="Report in pip"]'],
    scroll: 'keep',
  },
  {
    name: 'dialog',
    async run(page, ctx) {
      await openStaticChat(page, ctx, 'dialog', 'lablong', 'Was die Werte sagen');
      await page.click('button[aria-label="All chats"]');
      await until(page, 'dialog', 'the options for the chat', () => Boolean(document.querySelector('button[aria-label="Options for Schlaf und Training"]')));
      await page.click('button[aria-label="Options for Schlaf und Training"]');
      await until(page, 'dialog', 'the rename item', () => Boolean(document.querySelector('[role="menu"] [role="menuitem"]')));
      await page.click('[role="menu"] [role="menuitem"]');
      await until(page, 'dialog', 'the rename prompt', () => Boolean(document.querySelector('[role="alertdialog"]')));
    },
    text: ['Rename chat', 'cancel', 'save'],
    selectors: ['[role="alertdialog"]'],
    scroll: 'keep',
  },
  {
    name: 'model-list',
    async run(page, ctx) {
      await openStaticChat(page, ctx, 'model-list', 'lablong', 'Was die Werte sagen');
      await page.click('button[aria-label="Choose model"]');
      await until(page, 'model-list', 'the model list', () => Boolean(document.querySelector('[aria-label="Chat models"]')));
      await untilFor(page, 'model-list', 'the model list to finish loading', 20000, () => {
        const list = document.querySelector('[aria-label="Chat models"]');
        return Boolean(list) && !list.innerText.includes('Loading models') && list.innerText.includes('connect');
      });
    },
    text: ['OpenCode Go', 'GLM 5.3', 'connect'],
    selectors: ['[aria-label="Chat models"]'],
    scroll: 'keep',
  },
  {
    name: 'thinking',
    async run(page, ctx) {
      await openStreamingState(page, ctx, 'thinking', chatRecord('labthinking', 'Lage', [THINKING_TURN]), 'thinking-run', 'thinking-req', THINKING_TURN);
      await until(page, 'thinking', 'the thinking line', () => document.body.innerText.includes('linking up'));
    },
    text: [QUESTION, 'linking up'],
    selectors: ['[aria-label="Stop the reply"]'],
  },
  {
    name: 'tool',
    async run(page, ctx) {
      await openStreamingState(page, ctx, 'tool', chatRecord('labtool', 'Lage', [TOOL_TURN]), 'tool-run', 'tool-req', TOOL_TURN);
      await until(page, 'tool', 'both lookups', () => document.body.innerText.includes('search notes') && document.body.innerText.includes('search web'));
    },
    text: ['search notes', 'search web'],
    selectors: ['[aria-label="Stop the reply"]'],
  },
  {
    name: 'writing',
    async run(page, ctx) {
      await openStreamingState(page, ctx, 'writing', chatRecord('labwriting', 'Lage', [WRITING_TURN]), 'writing-run', 'writing-req', WRITING_TURN);
      await until(page, 'writing', 'the half-written sentence', () => document.body.innerText.includes('am Nachmittag') && Boolean(document.querySelector('.caret')));
    },
    text: ['Guten Abend', 'am Nachmittag'],
    selectors: ['.caret', '[aria-label="Stop the reply"]'],
  },
  {
    name: 'queued',
    async run(page, ctx) {
      const chat = 'labqueued';
      for (const [index, text] of QUEUED_MESSAGES.entries()) {
        const turn = { ...streamingTurn('queued-wait-' + index, text), phase: 'requesting' };
        await ctx.insertRun({ runId: 'queued-wait-run-' + index, chat, requestId: 'queued-wait-req-' + index, turn, status: 'waiting', created: NOW + index + 1,
          config: { lane: chat, header: { uid: chat, title: 'Lage', created: NOW, config: CONFIG }, grants: null, timezone: 'Europe/Berlin' } });
      }
      await openStreamingState(page, ctx, 'queued', chatRecord(chat, 'Lage', [QUEUED_TURN]), 'queued-run', 'queued-req', QUEUED_TURN);
      await until(page, 'queued', 'both queued messages', () => document.body.innerText.includes('langen Lauf') && document.body.innerText.includes('Donaudampfschifffahrtsgesellschaft'));
    },
    text: ['Guten Abend', 'langen Lauf', 'Donaudampfschifffahrtsgesellschaft', 'queued', 'take back'],
    selectors: ['[aria-label="Stop the reply"]', '[aria-label^="Take back"]'],
  },
  {
    // The person stopped the reply while the two messages waited: the queue is paused until resume or clear.
    name: 'queue-paused',
    async run(page, ctx) {
      const chat = 'labpaused';
      for (const [index, text] of QUEUED_MESSAGES.entries()) {
        const turn = { ...streamingTurn('paused-wait-' + index, text), phase: 'requesting' };
        await ctx.insertRun({ runId: 'paused-wait-run-' + index, chat, requestId: 'paused-wait-req-' + index, turn, status: 'held', created: NOW + index + 1,
          config: { lane: chat, header: { uid: chat, title: 'Lage', created: NOW, config: CONFIG }, grants: null, timezone: 'Europe/Berlin' } });
      }
      const stopped = { ...streamingTurn('paused-turn-1', QUESTION, { answer: WRITING_TEXT }), status: 'stopped', phase: 'stopped', error: 'Stopped. Continue or retry when you’re ready.' };
      await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: chatKey(chat), value: chatRecord(chat, 'Lage', [stopped]) });
      await page.goto(ctx.origin + '/#/pip?chat=' + encodeURIComponent(chat), { waitUntil: 'domcontentloaded' });
      await until(page, 'queue-paused', 'the paused queue', () => document.body.innerText.includes('2 messages wait'));
    },
    text: ['Guten Abend', 'langen Lauf', 'paused', '2 messages wait', 'resume', 'clear'],
  },
  {
    name: 'card-building',
    async run(page, ctx) {
      await openStreamingState(page, ctx, 'card-building', chatRecord('labbuilding', 'Karte', [BUILDING_TURN]), 'building-run', 'building-req', BUILDING_TURN);
      await until(page, 'card-building', 'the first two card elements', () => document.body.innerText.includes('7 h 12'));
    },
    text: ['Schlaf', '7 h 12'],
    selectors: ['[data-card="kbuild1"]', '[aria-label="Stop the reply"]'],
    async check(page) {
      const body = await page.evaluate(() => document.body.innerText);
      if (body.includes('Ruhepuls')) throw new Error('the last card elements are already on screen');
    },
  },  ...TODAY_STATES,
];

// --- browser and page helpers ----------------------------------------------------------------------------------

const chatKey = uid => `pocket:account:${USER}:pocket:pip-chat:${uid}`;

/** Poll a Node-side condition; the DOM's own waits use until(). */
async function waitNode(state, what, test, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { if (await test()) return; } catch { /* a navigation may be replacing the page under the check */ }
    await sleep(50);
  }
  throw new Error(`${state}: ${what} did not appear within ${timeout}ms`);
}

/** Wait for something in the page; a missing thing fails with the state's name. */
async function untilFor(page, state, what, timeout, fn, ...args) {
  try {
    await page.waitForFunction(fn, { polling: 50, timeout }, ...args);
  } catch {
    throw new Error(`${state}: ${what} did not appear within ${Math.round(timeout / 1000)}s`);
  }
}
const until = (page, state, what, fn, ...args) => untilFor(page, state, what, 8000, fn, ...args);

async function launchBrowser() {
  let puppeteer;
  try {
    puppeteer = (await import(process.env.PUPPETEER_MODULE || 'puppeteer-core')).default;
  } catch (error) {
    throw new Error('The browser library could not be loaded. Set PUPPETEER_MODULE to puppeteer-core\'s entry (' + (error.message || error) + ')');
  }
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
  });
}

/**
 * A fresh page on the app, ready to use: the account is signed in, the first sync is done and the live socket has
 * said hello. Attaching to a running reply needs that socket, so it is a condition here rather than a wait later.
 */
async function openPage(ctx, viewport, state, shift = 0, visit = null) {
  const page = await ctx.browser.newPage();
  // The page's clock, moved to the state's moment; everything else (timers, the server) keeps real time.
  if (shift) await page.evaluateOnNewDocument(shift => {
    const Real = Date;
    globalThis.Date = class extends Real { constructor(...args) { super(...(args.length ? args : [Real.now() + shift])); } static now() { return Real.now() + shift; } };
  }, shift);
  if (visit) await page.evaluateOnNewDocument(({ user, at }) => {
    try { if (!localStorage.getItem('pocket:today-seen:' + user)) localStorage.setItem('pocket:today-seen:' + user, String(at)); } catch { /* about:blank has no storage */ }
  }, visit);
  page.__errors = [];
  page.on('pageerror', error => page.__errors.push(error.message));
  await page.setViewport(viewport);
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  const socket = { opened: false, hello: false };
  cdp.on('Network.webSocketCreated', event => { if (String(event.url).includes('/api/live')) socket.opened = true; });
  cdp.on('Network.webSocketFrameReceived', event => {
    if (!socket.opened) return;
    try { if (JSON.parse(event.response.payloadData).type === 'hello') socket.hello = true; } catch { /* not the hello frame */ }
  });
  await page.goto(ctx.origin + '/', { waitUntil: 'domcontentloaded' });
  await untilFor(page, state, 'the signed-in account', 15000, () => {
    const link = document.querySelector('a[aria-label^="Account and sync:"]');
    const label = (link?.getAttribute('aria-label') || '').toLowerCase();
    return label.length > 0 && !/sign in|local|offline|failed|syncing/.test(label);
  });
  await waitNode(state, 'the live socket', () => socket.hello, 15000);
  return page;
}

async function signIn(ctx, user = USER) {
  const page = await ctx.browser.newPage();
  await page.setViewport(VIEWPORTS.phone);
  const { signInLink } = ctx;
  await page.goto(ctx.origin + signInLink(user, ctx.origin).replace(ctx.origin, ''), { waitUntil: 'domcontentloaded' });
  await page.goto(ctx.origin + '/', { waitUntil: 'domcontentloaded' });
  await waitNode('sign-in', 'the account to be active', () => page.evaluate(id => localStorage.getItem('pocket:active-account') === id, user), 20000);
  await page.close();
  ctx.current = user;
}

/** Open one of the chats written to the scratch database and wait for the text a person would look for. */
async function openStaticChat(page, ctx, state, uid, text) {
  await until(page, state, 'the chat in this tab', key => localStorage.getItem(key) !== null, chatKey(uid));
  await page.goto(ctx.origin + '/#/pip?chat=' + encodeURIComponent(uid), { waitUntil: 'domcontentloaded' });
  await until(page, state, 'the seeded reply', wanted => document.body.innerText.includes(wanted), text);
}

/** Wait for both home segments to reach the tab, then open home; an early visit would start an empty third one. */
async function openHome(page, ctx, state) {
  await until(page, state, 'the home segments in this tab', keys => keys.every(key => localStorage.getItem(key) !== null), [chatKey('labhome1'), chatKey('labhome2')]);
  await page.goto(ctx.origin + '/#/pip', { waitUntil: 'domcontentloaded' });
  await until(page, state, 'the joined conversation', () => document.body.innerText.includes('Frage 45') && document.body.innerText.includes('Antwort 45.'));
}

/** Seed a streaming chat in the tab's storage, put its run row in place, then open the chat. */
async function openStreamingState(page, ctx, state, chat, runId, requestId, turn) {
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: chatKey(chat.uid), value: chat });
  await ctx.insertRun({ runId, chat: chat.uid, requestId, turn, status: 'running' });
  await page.goto(ctx.origin + '/#/pip?chat=' + encodeURIComponent(chat.uid), { waitUntil: 'domcontentloaded' });
  await until(page, state, 'the reply to attach', () => Boolean(document.querySelector('[aria-label="Stop the reply"]')));
}

async function scrollPage(page, where) {
  await page.evaluate(where => {
    const root = document.scrollingElement || document.documentElement;
    root.scrollTo(0, where === 'top' ? 0 : root.scrollHeight);
  }, where);
}

/** Does this picture show what the state's row says? Raw card JSON, a pocket fence or an empty page fails it. */
async function checkState(page, state) {
  const body = await page.evaluate(() => document.body.innerText);
  const main = await page.evaluate(() => document.querySelector('main')?.innerText ?? '');
  if (main.trim().length < 20) throw new Error('the page is empty');
  if (body.includes('```pocket')) throw new Error('a pocket fence is on screen');
  if (/"op"\s*:\s*"add"/.test(body) || /"elements"\s*:/.test(body)) throw new Error('raw card JSON is on screen');
  for (const expected of state.text ?? []) {
    // Labels are drawn in capitals by a style rule, and innerText returns them as drawn: compare without case.
    const present = expected instanceof RegExp ? expected.test(body) : body.toLowerCase().includes(expected.toLowerCase());
    if (!present) throw new Error('missing text ' + String(expected));
  }
  for (const selector of state.selectors ?? []) if (!(await page.$(selector))) throw new Error('missing element ' + selector);
}

async function capture(ctx, state, viewportName) {
  const user = state.account || USER, at = state.at?.() ?? 0;
  if (state.account && !ctx.seeded.has(user)) {
    ctx.seeded.add(user);
    // A Today seed answers when the person last left Today (0: never, a first visit on this device).
    const visit = state.seed ? (await state.seed(ctx, user), 0) : await SEEDS[user](ctx, user, at);
    if (visit) ctx.visits.set(user, visit);
  }
  if (ctx.current !== user) await signIn(ctx, user);
  const page = await openPage(ctx, VIEWPORTS[viewportName], state.name, at ? at - Date.now() : 0, ctx.visits.get(user) ? { user, at: ctx.visits.get(user) } : null);
  try {
    await state.run(page, ctx);
    if (state.scroll !== 'keep') await scrollPage(page, state.scroll ?? 'bottom');
    await sleep(300);
    await page.screenshot({ path: join(ctx.out, `${state.name}-${viewportName}.png`) });
    await checkState(page, state);
    if (state.check) await state.check(page);
    console.log(`  ✓ ${state.name}-${viewportName}.png`);
  } catch (error) {
    const message = String(error.message || error);
    const extra = page.__errors.length ? ' (page error: ' + page.__errors[0] + ')' : '';
    await page.screenshot({ path: join(ctx.out, `${state.name}-${viewportName}-failed.png`) }).catch(() => {});
    throw new Error(message.startsWith(state.name + ':') ? message + extra : `${state.name}: ${message}${extra}`);
  } finally {
    await page.close();
  }
}

// --- the stream measurement ------------------------------------------------------------------------------------

const LAB_SCRIPT = ({ marker }) => {
  const container = (() => {
    const articles = document.querySelectorAll('main article');
    const last = articles[articles.length - 1];
    return last?.querySelector(':scope > [data-reply]') ?? null;
  })();
  if (!container) throw new Error('the reply container was not found');
  const lab = {
    running: true, start: performance.now(), last: performance.now(), marker,
    frames: [], follow: [], longTasks: [], shifts: [],
    removed: 0, removedVisible: 0, lastChange: performance.now(), firstWordAt: 0,
    markdown: [], markdownInFlight: 0, raf: 0, container,
  };
  window.__chatLab = lab;
  const stamps = new WeakMap();
  const stamp = (node, at) => {
    if (!node || node.nodeType !== 1 || stamps.has(node)) return;
    stamps.set(node, at);
    for (const child of node.children) stamp(child, at);
  };
  stamp(container, performance.now());
  const changes = new MutationObserver(records => {
    const at = performance.now();
    lab.lastChange = at;
    for (const record of records) {
      if (record.type !== 'childList') continue;
      for (const removed of record.removedNodes) {
        if (removed.nodeType !== 1) continue;
        lab.removed += 1;
        const since = stamps.get(removed) ?? lab.start;
        if (at - since > 100) lab.removedVisible += 1;
      }
      for (const added of record.addedNodes) if (added.nodeType === 1) stamp(added, at);
    }
  });
  changes.observe(container, { childList: true, subtree: true, characterData: true });
  const frame = now => {
    if (!lab.running) return;
    if (lab.last) lab.frames.push(now - lab.last);
    lab.last = now;
    const root = document.scrollingElement || document.documentElement;
    lab.follow.push(root.scrollHeight - (window.scrollY + window.innerHeight));
    if (!lab.firstWordAt && container?.textContent?.includes(marker)) lab.firstWordAt = now;
    lab.raf = requestAnimationFrame(frame);
  };
  lab.raf = requestAnimationFrame(frame);
  try {
    new PerformanceObserver(list => { for (const entry of list.getEntries()) lab.longTasks.push(entry.duration); }).observe({ type: 'longtask', buffered: false });
  } catch { /* a Chromium without longtask still measures the rest */ }
  try {
    new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) lab.shifts.push(entry.value); }).observe({ type: 'layout-shift', buffered: false });
  } catch { /* … */ }
  try {
    new PerformanceObserver(list => { for (const entry of list.getEntries()) if (entry.name.includes('/api/markdown')) lab.markdown.push(entry.duration); }).observe({ type: 'resource', buffered: false });
  } catch { /* … */ }
  // A reply is not settled while a Markdown request is still being drawn; count those still open.
  const original = window.fetch;
  window.fetch = function (input, init) {
    const url = String(input?.url ?? input);
    if (!url.includes('/api/markdown')) return original.call(this, input, init);
    lab.markdownInFlight += 1;
    return original.call(this, input, init).finally(() => { lab.markdownInFlight -= 1; });
  };
};

async function installLab(page, marker) {
  await page.evaluate(LAB_SCRIPT, { marker });
}

async function readLab(page) {
  return page.evaluate(() => {
    const lab = window.__chatLab;
    lab.running = false;
    cancelAnimationFrame(lab.raf);
    return {
      frames: lab.frames, follow: lab.follow, longTasks: lab.longTasks,
      shift: lab.shifts.reduce((sum, value) => sum + value, 0),
      removed: lab.removed, removedVisible: lab.removedVisible,
      lastChange: lab.lastChange, firstWordAt: lab.firstWordAt,
      markdown: lab.markdown, timeOrigin: performance.timeOrigin,
    };
  });
}

async function waitQuiet(page, state) {
  await untilFor(page, state, 'the reply to settle', 10000, () => {
    const lab = window.__chatLab;
    return Boolean(lab) && lab.markdownInFlight === 0 && performance.now() - lab.lastChange > 600;
  });
}

const play = async (ctx, event) => {
  const response = await fetch(ctx.origin + '/internal/events', {
    method: 'POST',
    headers: { 'x-pocket-events': ctx.eventsSecret, 'content-type': 'application/json' },
    body: JSON.stringify({ userId: USER, event }),
  });
  if (response.status !== 204) throw new Error('the event could not be played in (' + response.status + ')');
};

function summarize(raw, firstSentAt, doneSentAt) {
  if (!raw.firstWordAt) throw new Error('the first words never reached the DOM');
  const frames = [...raw.frames].sort((a, b) => a - b);
  const at = fraction => frames.length ? frames[Math.min(frames.length - 1, Math.max(0, Math.ceil(fraction * frames.length) - 1))] : 0;
  const markdown = [...raw.markdown].sort((a, b) => a - b);
  return {
    frames: { count: frames.length, p50: round(median(frames)), p95: round(at(0.95)), worst: round(frames.at(-1) ?? 0) },
    longTasks: { count: raw.longTasks.length, totalMs: round(raw.longTasks.reduce((sum, value) => sum + value, 0)) },
    layoutShift: round(raw.shift, 4),
    follow: { max: round(raw.follow.length ? Math.max(...raw.follow) : 0), above4: raw.follow.filter(gap => gap > 4).length },
    swaps: { removed: raw.removed, visible: raw.removedVisible },
    markdownRequests: { count: markdown.length, medianMs: round(median(markdown)) },
    firstWord: round(raw.firstWordAt + raw.timeOrigin - firstSentAt),
    settle: round(Math.max(0, raw.lastChange + raw.timeOrigin - doneSentAt)),
  };
}

function streamMedian(runs) {
  const pick = path => {
    const values = runs.map(run => path.split('.').reduce((value, key) => value[key], run));
    return round(median(values));
  };
  return {
    frames: { count: Math.round(median(runs.map(run => run.frames.count))), p50: pick('frames.p50'), p95: pick('frames.p95'), worst: pick('frames.worst') },
    longTasks: { count: Math.round(median(runs.map(run => run.longTasks.count))), totalMs: pick('longTasks.totalMs') },
    layoutShift: pick('layoutShift'),
    follow: { max: pick('follow.max'), above4: Math.round(median(runs.map(run => run.follow.above4))) },
    swaps: { removed: Math.round(median(runs.map(run => run.swaps.removed))), visible: Math.round(median(runs.map(run => run.swaps.visible))) },
    markdownRequests: { count: Math.round(median(runs.map(run => run.markdownRequests.count))), medianMs: pick('markdownRequests.medianMs') },
    firstWord: pick('firstWord'),
    settle: pick('settle'),
  };
}

async function measureStream(ctx) {
  const runs = [];
  for (let index = 1; index <= 3; index++) {
    const runId = 'stream-run-' + index, requestId = 'stream-req-' + index, chat = 'streamchat' + index;
    const state = 'stream run ' + index;
    const turn = streamingTurn('stream-turn-' + index, QUESTION, { attempt: requestId });
    let page;
    try {
      page = await openPage(ctx, VIEWPORTS.phone, state);
      // A fresh rendering of the same reply: no Markdown from an earlier run may stand in for a request.
      await page.evaluate(key => localStorage.removeItem(key), `pocket:account:${USER}:pocket:markdown-cache:v1`);
      await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: chatKey(chat), value: chatRecord(chat, 'Lage', [turn]) });
      await ctx.insertRun({ runId, chat, requestId, turn, status: 'running' });
      await page.goto(ctx.origin + '/#/pip?chat=' + encodeURIComponent(chat), { waitUntil: 'domcontentloaded' });
      await until(page, state, 'the reply to attach', () => Boolean(document.querySelector('[aria-label="Stop the reply"]')));
      await page.bringToFront();
      await installLab(page, STREAM.marker);

      let current = turn, firstSentAt = 0;
      for (const [step, snapshot] of STREAM.steps.entries()) {
        current = { ...turn, answer: snapshot.answer, phase: snapshot.phase, updated: Date.now() };
        if (step === 0) firstSentAt = Date.now();
        await play(ctx, { type: 'run', kind: 'progress', runId, chat, requestId, turn: current });
        await sleep(40);
      }
      await sleep(80);
      const final = { ...current, answer: STREAM.full, status: 'done', phase: 'done', sources: STREAM_SOURCES, updated: Date.now() };
      await ctx.finishRun(runId, final);
      const doneSentAt = Date.now();
      await play(ctx, { type: 'run', kind: 'done', runId, chat, requestId });
      await until(page, state, 'the reply to finish', () => !document.querySelector('[aria-label="Stop the reply"]'));
      await waitQuiet(page, state);

      const body = await page.evaluate(() => document.body.innerText);
      if (body.includes('```pocket') || /"op"\s*:\s*"add"/.test(body)) throw new Error('raw card data on screen');
      if (!body.includes('beginne ich mit der Planung')) throw new Error('the last words are not on screen');
      if (!body.includes('7 h 12')) throw new Error('the card is not on screen');

      runs.push(summarize(await readLab(page), firstSentAt, doneSentAt));
      console.log(`  ✓ ${state} measured`);
    } catch (error) {
      const message = String(error.message || error);
      throw new Error(message.startsWith('stream:') ? message : `stream: run ${index}: ${message}`);
    } finally {
      await page?.close();
    }
  }
  const report = { runs, median: streamMedian(runs) };
  writeFileSync(join(ctx.out, 'stream.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  return report;
}

// --- scratch server and seeds -----------------------------------------------------------------------------------

async function freePort() {
  return new Promise((done, fail) => {
    const socket = createServer();
    socket.on('error', fail);
    socket.listen(0, '127.0.0.1', () => {
      const { port } = socket.address();
      socket.close(() => done(port));
    });
  });
}

async function startServer(origin, dir) {
  const env = {
    ...process.env,
    TURSO_DATABASE_URL: 'file:' + join(dir, 'db.sqlite'),
    TURSO_AUTH_TOKEN: 'scratch',
    BETTER_AUTH_SECRET: 'scratch-secret-0123456789abcdef0123',
    POCKET_ENCRYPTION_SECRET: 'scratch-enc',
    BETTER_AUTH_URL: origin,
    PORT: String(new URL(origin).port),
    HOST: '127.0.0.1',
    PIP_RUNS_MODE: 'inprocess',
    POCKET_EVENTS_SECRET: 'chat-lab-events-secret',
  };
  Object.assign(process.env, env);
  const server = spawn(process.execPath, ['services/server/web.mjs'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  server.stdout.on('data', data => { output += data; });
  server.stderr.on('data', data => { output += data; });
  const end = Date.now() + 20000;
  while (Date.now() < end && !output.includes('Pocket web listening')) {
    if (server.exitCode !== null) throw new Error('The server stopped while starting:\n' + output);
    await sleep(50);
  }
  if (!output.includes('Pocket web listening')) {
    server.kill('SIGTERM');
    throw new Error('The server did not start within 20s:\n' + output);
  }
  return server;
}

async function main() {
  if (!existsSync(join(ROOT, 'dist/server/entry.mjs'))) {
    console.error('dist/server/entry.mjs is missing. Build the Node target first:\n  POCKET_TARGET=node POCKET_ALLOW_PROXY=1 npx astro build');
    process.exit(1);
  }
  const argv = process.argv.slice(2);
  const option = name => {
    const at = argv.indexOf(name);
    if (at < 0) return '';
    const value = argv[at + 1];
    if (!value || value.startsWith('--')) throw new Error(name + ' needs a value');
    return value;
  };
  const out = resolve(process.cwd(), option('--out') || join(ROOT, 'app/build/reports/chat-lab'));
  const only = option('--only'), wanted = only ? only.split(',') : [];
  const valid = [...STATES.map(state => state.name), 'stream'];
  for (const name of wanted) if (!valid.includes(name)) throw new Error('Unknown state "' + name + '". Use one of: ' + valid.join(', '));
  mkdirSync(out, { recursive: true });

  const dir = mkdtempSync(join(existsSync('/tmp/opencode') ? '/tmp/opencode' : tmpdir(), 'pocket-chat-lab-'));
  const port = await freePort();
  const origin = 'http://127.0.0.1:' + port;
  const eventsSecret = 'chat-lab-events-secret';
  let server, browser;
  const failures = [];
  try {
    server = await startServer(origin, dir);
    const database = await import('file://' + join(ROOT, 'src/server/database.js'));
    const auth = await import('file://' + join(ROOT, 'src/server/auth.js'));
    const objects = await import('file://' + join(ROOT, 'src/server/objects.js'));
    const workspace = await import('file://' + join(ROOT, 'src/server/workspace.js'));
    const memory = await import('file://' + join(ROOT, 'src/server/pip-memory-store.js'));
    const secrets = await import('file://' + join(ROOT, 'src/server/secrets.js'));
    const keys = await import('file://' + join(ROOT, 'src/server/pip-keys.js'));
    const background = await import('file://' + join(ROOT, 'src/server/pip-background.js'));
    const { ensureSchema, execute } = database;
    await ensureSchema();
    await execute({
      sql: 'INSERT INTO pocket_user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)',
      args: [USER, 'Ada', 'ada@example.com', NOW, NOW],
    });

    const insertRun = async ({ runId, chat, requestId, turn, status, expiresAt = 0, requests = [], config = CONFIG, created = NOW }) => {
      await execute({
        sql: `INSERT OR IGNORE INTO pocket_pip_runs (user_id, run_id, chat_uid, request_id, turn_uid, device, status, turn, checkpoint, config, device_tools, lease_id, lease_until, expires_at, created, updated)
          VALUES (?, ?, ?, ?, ?, 'phone', ?, ?, NULL, ?, '[]', ?, ?, ?, ?, ?)`,
        args: [USER, runId, chat, requestId, turn.uid, status, JSON.stringify(turn), JSON.stringify(config),
          status === 'running' ? 'chat-lab-lease' : '', status === 'running' ? NOW + 12 * 3600_000 : 0, expiresAt, created, created],
      });
      for (const request of requests) {
        await execute({
          sql: `INSERT OR IGNORE INTO pocket_pip_run_requests (user_id, run_id, request_id, kind, tool, call_id, row_id, payload, state, created)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
          args: [USER, runId, request.requestId, request.kind, request.tool, request.callId, request.rowId, JSON.stringify(request.payload || {}), NOW],
        });
      }
    };
    const finishRun = async (runId, turn) => {
      await execute({
        sql: `UPDATE pocket_pip_runs SET status = 'done', turn = ?, lease_id = '', lease_until = 0, updated = ? WHERE user_id = ? AND run_id = ?`,
        args: [JSON.stringify(turn), Date.now(), USER, runId],
      });
    };

    for (const chat of [EMPTY_CHAT, LONG_CHAT, FAILED_CHAT, APPROVAL_CHAT, PINNED_CHAT, SCHEDULED_CHAT, HOME_EARLIER_CHAT, HOME_CURRENT_CHAT]) await objects.writeObject(USER, 'chats', chat);
    await workspace.syncDocuments(USER, labDocuments());

    const ctx = { browser: null, origin, out, eventsSecret, insertRun, finishRun, signInLink: auth.signInLink, memory, execute, secrets, keys, background, objects, workspace,
      current: '', seeded: new Set(), visits: new Map() };
    browser = ctx.browser = await launchBrowser();
    await signIn(ctx);
    console.log('chat lab → ' + out);

    const selected = only ? STATES.filter(state => wanted.includes(state.name)) : STATES;
    for (const state of selected) {
      for (const viewport of ['phone', 'desktop']) {
        // Capturing many states opens more pages than Better Auth's one-minute limit counts; clearing the scratch
        // database's rate-limit rows keeps that harness budget from turning a picture into a sign-in page.
        await execute({ sql: 'DELETE FROM pocket_rate_limit' });
        try {
          await capture(ctx, state, viewport);
        } catch (error) {
          failures.push(error.message);
          console.error('  ✗ ' + error.message);
        }
      }
    }
    if (!only || wanted.includes('stream')) {
      await execute({ sql: 'DELETE FROM pocket_rate_limit' });
      try {
        await measureStream(ctx);
      } catch (error) {
        failures.push(String(error.message || error));
        console.error('  ✗ ' + String(error.message || error));
      }
    }
    const pictures = selected.flatMap(state => ['phone', 'desktop'].map(viewport => join(out, `${state.name}-${viewport}.png`)));
    const missing = pictures.filter(file => !existsSync(file));
    if (missing.length) failures.push('missing pictures: ' + missing.join(', '));
    if (!failures.length) console.log('chat lab: done' + (!only || wanted.includes('stream') ? ', measured stream written to ' + join(out, 'stream.json') : ''));
  } finally {
    await browser?.close().catch(() => {});
    if (server) {
      server.kill('SIGTERM');
      await sleep(100);
    }
    rmSync(dir, { recursive: true, force: true });
  }
  if (failures.length) throw new Error(failures.length + ' check(s) failed:\n  ' + failures.join('\n  '));
}

main().catch(error => {
  console.error('chat lab failed:', error.message);
  process.exitCode = 1;
});
