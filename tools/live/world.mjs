// The small world a live check runs in: a few notes, tasks and appointments in German and English, three canned web
// pages, and writes that are recorded instead of saved. No database, no account and no web request. Reads of notes,
// tasks and the calendar, cards, plans and chat history run through Pocket's real tools (pip-tools.js `execute`)
// over an in-memory record source, the way the server runs them over the account's synced copy.

import { config, requestBody, contextCoverage } from '../../src/client/pip-core.js';
import { execute, preview, recordSource } from '../../src/client/pip-tools.js';
import { MEMORY_INSTRUCTIONS } from '../../src/server/pip-memory-store.js';
import { effortLimits, effortNote } from '../../src/shared/pip-effort.js';

export const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
/** YYYY-MM-DD in the check's timezone, `offset` days from now. */
export function localDay(offset = 0, now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now + offset * 864e5));
}
/** A time on a day from today, in the process's local time (what Pocket's calendar search compares against). */
const at = (offset, hours, minutes = 0) => { const day = new Date(); day.setDate(day.getDate() + offset); day.setHours(hours, minutes, 0, 0); return +day; };

// What pip-runs.js adds to every chat reply's instructions (its NOTE constant is not exported; keep this in step).
const SERVER_NOTE = '\n\nThis reply runs on your Pocket account\'s server and is shared by your devices: another device sees the same answer, tool activity and any change waiting for approval, and answers it once. Provider keys stay on the server for this chat. Notes, tasks, thoughts, calendar, gym and COROS come from your synced account copy.';

// The two tour listings carry duration and fare: research-then-card stops lookups after the searches, and a model
// that has no figures rightly refuses to draw a comparison.
export const PAGES = [
  { url: 'https://ferries.example.org/bosphorus-short-tour', title: 'Short Bosphorus Tour from Eminönü – City Ferries',
    description: 'The short Bosphorus tour of the city ferries, from Eminönü pier: about 2 hours round trip, 150 TL per person.',
    text: '# Short Bosphorus Tour\n\nThe short Bosphorus tour leaves from Eminönü pier (Boğaz İskelesi). Saturday departures: 10:30, 12:30, 15:00 and 17:00. The round trip takes about 2 hours and turns at the Fatih Sultan Mehmet bridge without stops. Fare: 150 TL per person, Istanbulkart accepted. Buy tickets at the pier 30 minutes before departure.' },
  { url: 'https://cruises.example.org/turyol-bosphorus', title: 'Turyol Bosphorus Cruise – Eminönü',
    description: 'Hourly Bosphorus cruises by Turyol from the Eminönü pier: 90 minutes, 200 TL.',
    text: '# Turyol Bosphorus Cruise\n\nTuryol boats leave Eminönü every hour from 11:00 to 18:00, also on Saturdays. The cruise takes 90 minutes and goes up to the Rumeli Fortress and back. Fare: 200 TL, cash or card. No booking needed.' },
  { url: 'https://food.example.org/beyoglu-lokantas', title: 'Five lokantas in Beyoğlu for lunch',
    description: 'Where to eat a lokanta lunch in Beyoğlu.',
    text: '# Lokantas in Beyoğlu\n\n1. Hacı Abdullah – Ottoman dishes since 1888, near İstiklal; mains 350–500 TL.\n2. Asmalı Cavit – meyhane-style lunch in Asmalımescit; mains 300–450 TL.\n3. Lokanta Helvetia – small, daily-changing steam-table dishes; 200–300 TL.\n4. Çukur Meyhane – home cooking, closed Sundays; 250–400 TL.\n5. Pera Lokantası – kebabs and stews near Tünel; 300–420 TL.\nMost open 11:30–16:00; Saturdays are busy after 13:00.' },
];
/** Restaurant names only the canned food page holds: a deterministic marker for "the answer lists restaurants". */
export const RESTAURANTS = ['Hacı Abdullah', 'Asmalı Cavit', 'Lokanta Helvetia', 'Çukur Meyhane', 'Pera Lokantası'];

const page = (item, args = {}) => {
  const length = args.length ?? 6000, offset = args.offset ?? 0, end = Math.min(item.text.length, offset + length);
  return { source: item.url, url: item.url, title: item.title, text: item.text.slice(offset, end), offset, total_length: item.text.length, next_offset: end < item.text.length ? end : null, truncated: end < item.text.length };
};
function searchWeb(args) {
  const words = String(args.query || '').toLowerCase().split(/\W+/u).filter(word => word.length > 2);
  const score = item => words.filter(word => (item.title + ' ' + item.text).toLowerCase().includes(word)).length;
  const results = PAGES.map(item => [score(item), item]).filter(([n]) => n > 0).sort((a, b) => b[0] - a[0]).slice(0, args.limit ?? 5)
    .map(([, item]) => ({ title: item.title, url: item.url, description: item.description, source_type: 'web' }));
  return { source: 'web:firecrawl', query: String(args.query || ''), results };
}

/** A fresh world for one run: its records, the writes it saw, and the tools a reply calls. */
export function createWorld() {
  const now = Date.now();
  const documents = {
    'notes.json': { notes: [
      { uid: 'n-istanbul', text: 'Istanbul trip ideas\n\nSaturday free. Want a proper lokanta lunch in Beyoğlu and a short boat trip. Hotel is in Karaköy.', created: now - 5 * 864e5, updated: now - 2 * 864e5 },
      { uid: 'n-einkauf', text: 'Einkaufsliste\n\nMilch, Brot, Tomaten, Kaffee', created: now - 3 * 864e5, updated: now - 864e5 },
      { uid: 'n-wohnung', text: 'Wohnung\n\nDie Heizung im Bad tropft. Vermieter Herr Krause: 0151 2345678.', created: now - 10 * 864e5, updated: now - 4 * 864e5 },
    ] },
    'tasks.json': { tasks: [
      { uid: 't-steuer', text: 'Steuererklärung abschicken', due: localDay(1), done: false, steps: [], created: now - 6 * 864e5, updated: now - 864e5 },
      { uid: 't-rad', text: 'Fahrrad zur Werkstatt bringen', due: localDay(1), done: false, steps: [], created: now - 4 * 864e5, updated: now - 864e5 },
      { uid: 't-visa', text: 'Check passport validity for Turkey', due: localDay(3), done: false, steps: [], created: now - 8 * 864e5, updated: now - 3 * 864e5 },
    ] },
    'parking.json': { thoughts: [] },
    'gym.json': { workouts: [] },
  };
  const appointments = [
    { uid: 'a-zahnarzt', title: 'Zahnarzt Dr. Weber', when: at(1, 9, 30), minutes: 45 },
    { uid: 'a-team', title: 'Team-Meeting Projekt Nord', when: at(1, 14), minutes: 60 },
    { uid: 'a-flight', title: 'Flight to Istanbul', when: at(4, 7, 15), minutes: 210 },
  ];
  const source = recordSource(name => documents[name] || {}, { appointments: () => appointments, appointment: id => appointments.find(item => item.uid === id) || null });
  const world = { documents, appointments, source, saves: [], previews: [], approvals: [], webCalls: [], earlierChanges: [] };

  world.previewTool = async (value, name, input, signal) => {
    if (name === 'remove_job') return { error: 'job_not_found', message: 'There is no such job.' };
    const ready = await preview(value, name, input, signal, source);
    world.previews.push({ name, input: structuredClone(input), error: ready.error || '' });
    return ready;
  };
  world.executeTool = async (value, name, input, signal, context = {}) => {
    if (name === 'search_web') { world.webCalls.push({ name, input }); return searchWeb(input); }
    if (name === 'read_web_page') {
      world.webCalls.push({ name, input });
      const found = PAGES.find(item => item.url === String(input.url || '').replace(/\/$/, '') || item.url === input.url);
      return found ? page(found, input) : { error: 'web_unavailable', message: 'The page could not be retrieved.' };
    }
    if (name === 'create_record' || name === 'change_record') {
      const ready = await preview(value, name, input, signal, source); if (ready.error) return ready;
      world.saves.push({ name, input: structuredClone(input), eventId: context.eventId });
      return { kind: 'action', action: { ...ready.action, status: 'saved', href: (name === 'create_record' ? '/' + input.kind + 's/' : '/records/') + 'saved-' + world.saves.length } };
    }
    if (name === 'remember') return { kind: 'memory', saved: true, id: 'm' + Math.random().toString(36).slice(2, 7), text: String(input.text || '') };
    if (name === 'forget') return { kind: 'memory', forgotten: false, id: String(input.id || '') };
    if (name === 'list_jobs') return { kind: 'jobs', jobs: [] };
    if (['create_job', 'change_job', 'remove_job', 'start_assignment', 'update_scratch'].includes(name)) return { error: 'unavailable_in_check', message: 'This is not available right now.' };
    return execute(value, name, input, signal, { ...context, source });
  };
  world.saveTurn = async changed => { world.earlierChanges.push(structuredClone(changed)); };
  return world;
}

/**
 * The request value of a chat reply on the server: the person's provider settings, notes/tasks/calendar access, web
 * search on, and the memory and jobs a server reply has (pip-runs.js).
 */
export function chatValue({ provider = 'compatible', baseUrl, model, maxTokens = 4096 }) {
  return { ...config({ provider, baseUrl, model, maxTokens, thinking: false, webSearch: true }), timezone: TIMEZONE,
    grants: ['notes', 'tasks', 'calendar'], memory: true, jobs: true, assignments: true, assignment: false };
}

/**
 * The chat, the new turn and the request body exactly as pip-runs.js builds them: requestBody, then the date, the
 * server note, the memory instructions and the effort note appended to the instructions. `effort` stands in for the
 * JEV judgment (none | quick | thorough); `research` overrides the limits it would give.
 */
export function chatRequest(value, { text, turns = [], effort = 'quick', research }) {
  const created = Date.now();
  const chat = { uid: 'live-check-chat', title: 'Live check', created, updated: created, draft: '', context: [], config: value, turns: structuredClone(turns) };
  const turn = { uid: 'live-turn-' + created.toString(36), text, context: [], created, attempt: 'live-attempt-' + created.toString(36) };
  chat.turns.push(turn);
  const body = requestBody(chat, turn);
  body.instructions += '\n\nToday is ' + localDay(0) + ' (' + TIMEZONE + ').' + SERVER_NOTE;
  body.instructions += '\n\n' + MEMORY_INSTRUCTIONS;
  const note = effortNote(effort);
  if (note) body.instructions += '\n\n' + note;
  const limits = research || effortLimits(effort);
  return { chat, turn, body, coverage: contextCoverage(chat, turn), ...(limits ? { research: limits } : {}) };
}
