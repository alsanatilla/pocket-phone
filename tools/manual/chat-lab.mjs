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
// `--only` takes one state name from STATES below or `stream`. Pictures are <state>-phone.png and
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
  status: 'done', usage: { runtime: 'pocket-server' }, activity: longActivity,
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

const PINNED_CHAT = chatRecord('labpinned', 'Schlafkarte', [{
  uid: 'pinned-turn-1', text: 'Zeig mir meine Schlafwerte als Karte.', context: [], created: NOW - 15 * MINUTE,
  updated: NOW - 14 * MINUTE, owner: 'phone', attempt: 'attempt-pinned',
  answer: 'Deine Schlafwerte als Karte:\n\n' + pinnedCard + '\n\nDie Karte bleibt auf Today sichtbar, bis du sie wieder löst.',
  reasoning: '', error: '', status: 'done', usage: {}, activity: [], sources: [], phase: 'done',
}]);

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

/** Forgets everything this account remembered, so a state starts from a known list. */
async function resetMemory(ctx) {
  for (const entry of await ctx.memory.listMemory(USER)) await ctx.memory.forget(USER, entry.id);
}

/** Gives the account the four entries the memory picture shows, oldest first. */
async function seedMemory(ctx) {
  await resetMemory(ctx);
  for (const row of MEMORY_ROWS) await ctx.memory.remember(USER, row.text, { chat: row.chat || '' });
}

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
    text: ['Was die Werte sagen', 'Intervalle', 'const pace = distance / time;', 'Notes + Tasks + Calendar + Web · 5 steps', LONG_WORD, 'sehr-langer-pfad-mit-vielen-segmenten', 'HRV and readiness'],
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
      await until(page, 'today-pinned', 'the pinned card', () => Boolean(document.querySelector('[aria-label="Pinned cards"]')) && document.body.innerText.includes('Schlafkarte'));
    },
    text: ['Schlafkarte', 'Schlaf', '7 h 12'],
    selectors: ['[aria-label="Pinned cards"]', '[data-card="kpinned1"]'],
    scroll: 'top',
  },
  {
    name: 'chat-list',
    async run(page, ctx) {
      await openStaticChat(page, ctx, 'chat-list', 'lablong', 'Was die Werte sagen');
      await page.click('button[aria-label="All chats"]');
      await until(page, 'chat-list', 'the list of chats', () => {
        const dialog = document.querySelector('[role="dialog"]');
        return Boolean(dialog) && dialog.innerText.toLowerCase().includes('5 conversations');
      });
    },
    text: [/5 conversations/i, 'Schlaf und Training', 'Notiz speichern', 'Fehlgeschlagen', 'Schlafkarte', 'New chat'],
    selectors: ['[role="dialog"]'],
    scroll: 'keep',
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
  },
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
async function openPage(ctx, viewport, state) {
  const page = await ctx.browser.newPage();
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

async function signIn(ctx) {
  const page = await ctx.browser.newPage();
  await page.setViewport(VIEWPORTS.phone);
  const { signInLink } = ctx;
  await page.goto(ctx.origin + signInLink(USER, ctx.origin).replace(ctx.origin, ''), { waitUntil: 'domcontentloaded' });
  await page.goto(ctx.origin + '/', { waitUntil: 'domcontentloaded' });
  await waitNode('sign-in', 'the account to be active', () => page.evaluate(id => localStorage.getItem('pocket:active-account') === id, USER), 20000);
  await page.close();
}

/** Open one of the chats written to the scratch database and wait for the text a person would look for. */
async function openStaticChat(page, ctx, state, uid, text) {
  await until(page, state, 'the chat in this tab', key => localStorage.getItem(key) !== null, chatKey(uid));
  await page.goto(ctx.origin + '/#/pip?chat=' + encodeURIComponent(uid), { waitUntil: 'domcontentloaded' });
  await until(page, state, 'the seeded reply', wanted => document.body.innerText.includes(wanted), text);
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
    const present = expected instanceof RegExp ? expected.test(body) : body.includes(expected);
    if (!present) throw new Error('missing text ' + String(expected));
  }
  for (const selector of state.selectors ?? []) if (!(await page.$(selector))) throw new Error('missing element ' + selector);
}

async function capture(ctx, state, viewportName) {
  const page = await openPage(ctx, VIEWPORTS[viewportName], state.name);
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
    return last?.querySelector(':scope > div.border-l-2') ?? null;
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
  const only = option('--only');
  const valid = [...STATES.map(state => state.name), 'stream'];
  if (only && !valid.includes(only)) throw new Error('Unknown state "' + only + '". Use one of: ' + valid.join(', '));
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
    const memory = await import('file://' + join(ROOT, 'src/server/pip-memory-store.js'));
    const { ensureSchema, execute } = database;
    await ensureSchema();
    await execute({
      sql: 'INSERT INTO pocket_user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)',
      args: [USER, 'Ada', 'ada@example.com', NOW, NOW],
    });

    const insertRun = async ({ runId, chat, requestId, turn, status, expiresAt = 0, requests = [] }) => {
      await execute({
        sql: `INSERT OR IGNORE INTO pocket_pip_runs (user_id, run_id, chat_uid, request_id, turn_uid, device, status, turn, checkpoint, config, device_tools, lease_id, lease_until, expires_at, created, updated)
          VALUES (?, ?, ?, ?, ?, 'phone', ?, ?, NULL, ?, '[]', ?, ?, ?, ?, ?)`,
        args: [USER, runId, chat, requestId, turn.uid, status, JSON.stringify(turn), JSON.stringify(CONFIG),
          status === 'running' ? 'chat-lab-lease' : '', status === 'running' ? NOW + 12 * 3600_000 : 0, expiresAt, NOW, NOW],
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

    for (const chat of [EMPTY_CHAT, LONG_CHAT, FAILED_CHAT, APPROVAL_CHAT, PINNED_CHAT]) await objects.writeObject(USER, 'chats', chat);

    const ctx = { browser: null, origin, out, eventsSecret, insertRun, finishRun, signInLink: auth.signInLink, memory };
    browser = ctx.browser = await launchBrowser();
    await signIn(ctx);
    console.log('chat lab → ' + out);

    const selected = only ? STATES.filter(state => state.name === only) : STATES;
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
    if (!only || only === 'stream') {
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
    if (!failures.length) console.log('chat lab: done' + (!only || only === 'stream' ? ', measured stream written to ' + join(out, 'stream.json') : ''));
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
