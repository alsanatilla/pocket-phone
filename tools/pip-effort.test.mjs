import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compatibleMessage, response } from './pip-provider-fixtures.mjs';

// A real libSQL file database; no Turso account or paid model call is used.
const folder = mkdtempSync(join(tmpdir(), 'pocket-pip-effort-'));
process.env.TURSO_DATABASE_URL = 'file:' + join(folder, 'pocket.db').replaceAll('\\', '/');
process.env.TURSO_AUTH_TOKEN = 'fixture-token'; process.env.POCKET_ENCRYPTION_SECRET = 'fixture-secret';
const { ensureSchema, execute, database } = await import('../src/server/database.js');
const { syncDocuments } = await import('../src/server/workspace.js');
const { saveBackground } = await import('../src/server/pip-background.js');
const { saveKey } = await import('../src/server/pip-keys.js');
const { JEV_ENDPOINT, JEV_MODEL } = await import('../src/shared/girder-jev.js');
const { EFFORT_LEVELS, effortFromAnswers, effortLimits, effortNote, effortQuestions, effortState, enoughFromAnswers, enoughQuestions, enoughState } = await import('../src/shared/pip-effort.js');
const runs = await import('../src/server/pip-runs.js');
await ensureSchema();
test.after(() => { database().close(); try { rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch {} });

const OPENROUTER = 'https://openrouter.ai/api/v1', OPENROUTER_KEY = 'sk-or-fixture-effort-0123456789';
const SETTINGS = { provider: 'compatible', model: 'fixture-model', baseUrl: 'https://model.example/v1', maxTokens: 2048, grants: ['notes', 'tasks'], dailyTokens: 50000, timezone: 'Europe/Berlin', enabled: true };
const VAULT_CONFIG = { provider: 'compatible', model: 'fixture-model', baseUrl: 'https://model.example/v1', maxTokens: 2048, thinking: false, webSearch: false };
let users = 0;
async function account({ openrouter = true } = {}) {
  const id = 'user-' + ++users, now = Date.now();
  await execute({ sql: 'INSERT INTO pocket_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', args: [id, 'Fixture', id + '@example.com', now, now] });
  await syncDocuments(id, {
    'notes.json': { v: 1, notes: [{ uid: 'note-car', text: '# Car research\n\nThe blue car costs 21,000 euros.', pinned: false, created: now, updated: now, deleted: false }] },
    'agenda.json': { v: 1, events: [] }
  });
  await saveBackground(id, SETTINGS, 'fixture-key-123456');
  if (openrouter) await saveKey(id, { provider: 'compatible', baseUrl: OPENROUTER, key: OPENROUTER_KEY });
  return id;
}
const header = (uid, title = 'Pip run') => ({ uid, title, created: Date.now(), config: VAULT_CONFIG });
const failure = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const answers = (name, choice) => new Response(JSON.stringify({ answers: { [name]: { type: 'choice', choice } } }), { status: 200, headers: { 'content-type': 'application/json' } });
const noLevel = () => new Response(JSON.stringify({ answers: {} }), { status: 200, headers: { 'content-type': 'application/json' } });

// What a chat-completions endpoint refuses: a tool call without its result before the next message, a result for
// a call it never made, or an empty tool message. The double answers those with 400, as the provider would.
function compatibleProblem(request) {
  const open = new Set();
  for (const message of request.messages) {
    if (message.role === 'tool') {
      if (!open.delete(message.tool_call_id)) return 'Invalid parameter: tool message ' + message.tool_call_id + ' does not follow its tool call.';
      if (typeof message.content !== 'string' || !message.content) return 'Invalid parameter: empty tool message.';
      continue;
    }
    if (open.size) return 'An assistant message with tool_calls must be followed by tool messages for each call: ' + [...open].join(', ');
    for (const call of message.role === 'assistant' ? message.tool_calls || [] : []) open.add(call.id);
  }
  return open.size ? 'Unanswered tool calls: ' + [...open].join(', ') : '';
}
/** A provider double: checks every request like the endpoint does, then streams the next prepared reply. */
const provider = (sent, ...replies) => async (url, options) => {
  const request = JSON.parse(options.body); sent.push(request);
  assert.equal(options.headers.authorization, 'Bearer fixture-key-123456');
  const problem = compatibleProblem(request);
  if (problem) return failure(400, { error: { message: problem, type: 'invalid_request_error' } });
  if (!replies.length) return failure(400, { error: { message: 'The fixture expected no further request.', type: 'invalid_request_error' } });
  return response(replies.shift());
};
/**
 * One fetcher for both services: a request to JEV_ENDPOINT is recorded and answered by the question it names —
 * `effort` with the level, `enough` with no (an old test never reaches that question) — anything else goes to the
 * provider double. Routing on the url comes first because the provider checks the chat key.
 */
const judged = (sent, jev, choice, ...replies) => {
  const serve = provider(sent, ...replies);
  return async (url, options) => {
    if (String(url) === JEV_ENDPOINT) {
      const body = JSON.parse(options.body), name = body.questions?.enough ? 'enough' : 'effort';
      jev.push({ headers: options.headers, body });
      return answers(name, name === 'effort' ? choice : 'no');
    }
    return serve(url, options);
  };
};
/**
 * A JEV double that answers by the question's name: `plan.effort` for the level, and `plan.enough` in order for
 * each enough question (the last answer repeats). An answer may be a Response (to fail), or a function that
 * answers or throws. Every request it saw is kept in `jev`.
 */
const judging = (sent, jev, plan, ...replies) => {
  const serve = provider(sent, ...replies), asked = { effort: 0, enough: 0 };
  return async (url, options) => {
    if (String(url) !== JEV_ENDPOINT) return serve(url, options);
    const body = JSON.parse(options.body), name = body.questions?.effort ? 'effort' : body.questions?.enough ? 'enough' : '';
    jev.push({ headers: options.headers, body });
    const index = asked[name]++, listed = name === 'effort' ? plan.effort : plan.enough;
    const given = Array.isArray(listed) ? listed[Math.min(index, listed.length - 1)] : listed;
    const answer = typeof given === 'function' ? await given(name, body) : given;
    return answer instanceof Response ? answer : answers(name, answer);
  };
};
const lookups = (count, prefix = 'q') => compatibleMessage({ calls: Array.from({ length: count }, (_, index) => ({ name: 'search_notes', input: { query: prefix + index }, id: 'call_' + prefix + index })) });
const CARD = { root: 'main', elements: [{ id: 'main', type: 'Metric', props: { label: 'Blue car', value: '21000', unit: 'EUR' }, children: [] }] };
const rows = (view, name) => view.run.turn.activity.filter(item => item.name === name);

test('the levels, their limits and their note are the ones the brief names', () => {
  assert.deepEqual(EFFORT_LEVELS, ['none', 'quick', 'thorough']);
  const questions = effortQuestions();
  assert.equal(questions.effort.type, 'choice');
  assert.match(questions.effort.instructions, /How much looking-up/);
  assert.deepEqual(Object.keys(questions.effort.criteria), ['none', 'quick', 'thorough']);
  for (const level of EFFORT_LEVELS) assert.equal(effortFromAnswers({ effort: { type: 'choice', choice: level } }), level);
  assert.equal(effortFromAnswers({ effort: { type: 'noul', noul: 0.9 } }), null, 'a wrong answer type is no level');
  assert.equal(effortFromAnswers({ effort: { type: 'choice', choice: 'deep' } }), null, 'an unknown choice is no level');
  assert.equal(effortFromAnswers({ effort: { type: 'choice' } }), null);
  assert.equal(effortFromAnswers({}), null);
  assert.equal(effortFromAnswers(null), null);
  assert.deepEqual(effortLimits('none'), { lookups: 1, webCalls: 0 });
  assert.deepEqual(effortLimits('quick'), { lookups: 3, webCalls: 2 });
  assert.deepEqual(effortLimits('thorough'), { lookups: 10, webCalls: 5 });
  assert.equal(effortLimits('unknown'), null);
  assert.equal(effortLimits(null), null);
  assert.equal(effortNote('none'), 'Pocket judged that this message needs no looking-up: answer directly; look something up only if you cannot answer without it.');
  assert.equal(effortNote('quick'), 'Pocket judged that this message needs one or two lookups: make them and answer.');
  assert.equal(effortNote('thorough'), 'Pocket judged that this message deserves thorough looking-up: up to ten lookups. Search with other words only when the first words found nothing, read what you found once, then answer.');
});

test('the JEV state cuts long text and sends finished prose, never a card source or a streaming turn', () => {
  const card = '```pocket\n{"op":"add","path":"/root","value":"main"}\n{"op":"add","path":"/elements/main","value":{"type":"Metric","props":{"label":"Car","value":"21000"}}}\n```';
  const turns = [
    { text: 'an older question', answer: 'An older answer.', status: 'done' },
    { text: 'A'.repeat(3000), answer: 'First answer.', status: 'done' },
    { text: 'B'.repeat(500), answer: card + '\n\nThe card and its prose.', status: 'done' },
    { text: 'C'.repeat(500), answer: 'Still writing', status: 'streaming' }
  ];
  const state = effortState({ text: 'D'.repeat(2500), context: [{ title: 'a', text: 'x' }, { title: 'b', text: 'y' }] }, turns);
  assert.equal(state.assistant, 'A personal assistant that can read the person\'s notes, tasks and calendar and search the web.');
  assert.equal(state.message.length, 2000, 'the message is cut at 2,000 characters');
  assert.equal(state.attached, 2);
  assert.deepEqual(state.recent.map(item => item.asked), ['A'.repeat(400), 'B'.repeat(400)], 'the last two finished turns, each cut');
  assert.equal(state.recent[0].answered, 'First answer.');
  assert.equal(state.recent[1].answered, 'The card and its prose.');
  assert.ok(!JSON.stringify(state).includes('"op"'), 'no card source is sent to the judge');
  assert.ok(!JSON.stringify(state).includes('Still writing'), 'a streaming turn is skipped');
});

test('none: one lookup runs, the next is refused, and the reply still finishes with the model’s text', async () => {
  const userId = await account(), sent = [], jev = [];
  const view = await runs.submitRun(userId, { requestId: 'req-effort-none', chat: header('chat-effort-none'), text: 'Danke, das reicht.', device: 'browser-1' },
    { fetcher: judged(sent, jev, 'none', lookups(2, 'none'), compatibleMessage({ text: 'Gern geschehen.' })) });
  assert.equal(view.run.status, 'done', view.run.turn.error);
  assert.equal(view.run.turn.answer, 'Gern geschehen.');
  assert.equal(view.run.turn.usage.effort, 'none');
  const made = rows(view, 'search_notes');
  assert.equal(made.length, 2);
  assert.equal(made[0].state, 'done', 'the first lookup runs');
  assert.equal(made[1].state, 'failed', 'the second is refused');
  assert.match(made[1].result, /research_budget_reached/);
  assert.match(String(sent[0].messages[0].content), /Pocket judged that this message needs no looking-up/);
  assert.equal(jev.length, 1, 'JEV is asked once');
});

test('quick: three lookups run, the fourth is refused, and a card after that still draws', async () => {
  const userId = await account(), sent = [], jev = [];
  const view = await runs.submitRun(userId, { requestId: 'req-effort-quick', chat: header('chat-effort-quick'), text: 'Vergleiche zwei Angebote.', device: 'browser-1' },
    { fetcher: judged(sent, jev, 'quick', lookups(4, 'quick'), compatibleMessage({ calls: [{ name: 'show_card', input: CARD, id: 'call_draw' }] }), compatibleMessage({ text: 'Hier ist das Ergebnis.' })) });
  assert.equal(view.run.status, 'done', view.run.turn.error);
  assert.equal(view.run.turn.usage.effort, 'quick');
  const made = rows(view, 'search_notes');
  assert.deepEqual(made.map(item => item.state), ['done', 'done', 'done', 'failed']);
  assert.match(made[3].result, /research_budget_reached/);
  assert.equal(rows(view, 'show_card').length, 1, 'a card is never refused by the lookup limit');
  assert.match(view.run.turn.answer, /```pocket/);
  assert.ok(view.run.turn.answer.endsWith('Hier ist das Ergebnis.'), 'the reply still finishes with the model’s text');
  assert.match(String(sent[0].messages[0].content), /needs one or two lookups: make them and answer/);
});

test('thorough: five lookups all run, the instructions get the thorough note, and the level is kept in the usage', async () => {
  const userId = await account(), sent = [], jev = [];
  const view = await runs.submitRun(userId, { requestId: 'req-effort-thorough', chat: header('chat-effort-thorough'), text: 'Recherchiere den Gebrauchtwagenmarkt gründlich.', device: 'browser-1' },
    { fetcher: judged(sent, jev, 'thorough', lookups(5, 'thorough'), compatibleMessage({ text: 'Der Markt ist angespannt.' })) });
  assert.equal(view.run.status, 'done', view.run.turn.error);
  assert.equal(view.run.turn.usage.effort, 'thorough');
  const made = rows(view, 'search_notes');
  assert.equal(made.length, 5);
  assert.ok(made.every(item => item.state === 'done'), 'today’s limits still allow five lookups');
  assert.match(String(sent[0].messages[0].content), /deserves thorough looking-up: up to ten lookups/);
});

test('the judge gets the OpenRouter key, the model, the message and the chat’s earlier turn', async () => {
  const userId = await account(), sent = [], jev = [];
  const fetcher = judged(sent, jev, 'quick', compatibleMessage({ text: 'Das blaue Auto kostet 21.000 Euro.' }));
  await runs.submitRun(userId, { requestId: 'req-effort-first', chat: header('chat-effort-judge'), text: 'Was sagen meine Notizen zum blauen Auto?', device: 'browser-1' }, { fetcher });
  assert.equal(jev.length, 1);
  const sentAgain = [], jevAgain = [];
  const second = await runs.submitRun(userId, { requestId: 'req-effort-second', chat: header('chat-effort-judge'), text: 'Und die Versicherung?', device: 'browser-1' },
    { fetcher: judged(sentAgain, jevAgain, 'none', compatibleMessage({ text: 'Dazu steht nichts in deinen Notizen.' })) });
  assert.equal(second.run.status, 'done', second.run.turn.error);
  assert.equal(jevAgain.length, 1, 'the second message is judged once');
  const request = jevAgain[0];
  assert.equal(request.headers.authorization, 'Bearer ' + OPENROUTER_KEY, 'the account’s OpenRouter key, not the chat’s');
  assert.equal(request.body.model, JEV_MODEL);
  assert.equal(request.body.state.message, 'Und die Versicherung?');
  assert.deepEqual(request.body.state.recent, [{ asked: 'Was sagen meine Notizen zum blauen Auto?', answered: 'Das blaue Auto kostet 21.000 Euro.' }]);
  assert.equal(request.body.questions.effort.type, 'choice');
});

test('a JEV that fails leaves the reply on today’s limits and writes no effort', async () => {
  const cases = [
    ['status 500', () => failure(500, { error: 'JEV is down' })],
    ['a rejected request', () => { throw new Error('JEV could not be reached'); }],
    ['an answer with no level', () => new Response(JSON.stringify({ answers: {} }), { status: 200, headers: { 'content-type': 'application/json' } })]
  ];
  for (const [name, answer] of cases) {
    const userId = await account(), sent = [];
    const serve = provider(sent, lookups(5, 'fallback'), compatibleMessage({ text: 'Ohne JEV geht es auch.' }));
    const view = await runs.submitRun(userId, { requestId: 'req-effort-fails-' + userId, chat: header('chat-effort-fails-' + userId), text: 'Recherchiere das gründlich.', device: 'browser-1' },
      { fetcher: async (url, options) => String(url) === JEV_ENDPOINT ? answer() : serve(url, options) });
    assert.equal(view.run.status, 'done', name + ': ' + view.run.turn.error);
    assert.equal('effort' in view.run.turn.usage, false, name + ': no level is stored');
    assert.deepEqual(rows(view, 'search_notes').map(item => item.state), ['done', 'done', 'done', 'done', 'done'], name + ': five lookups run');
  }
});

test('without an OpenRouter key JEV is never asked', async () => {
  const userId = await account({ openrouter: false }), sent = [];
  let judgedRequests = 0;
  const serve = provider(sent, compatibleMessage({ text: 'Hallo.' }));
  const view = await runs.submitRun(userId, { requestId: 'req-effort-no-key', chat: header('chat-effort-no-key'), text: 'Hallo!', device: 'browser-1' },
    { fetcher: async (url, options) => { if (String(url) === JEV_ENDPOINT) { judgedRequests++; throw new Error('JEV must not be asked without an OpenRouter key.'); } return serve(url, options); } });
  assert.equal(view.run.status, 'done', view.run.turn.error);
  assert.equal(judgedRequests, 0);
  assert.equal('effort' in view.run.turn.usage, false);
});

test('a run paused for an approval is judged once, keeps its level, and counts its lookups across the pause', async () => {
  const userId = await account(), sent = [], jev = [];
  const round = compatibleMessage({ calls: [
    { name: 'search_notes', input: { query: 'before-0' }, id: 'call_before_0' },
    { name: 'search_notes', input: { query: 'before-1' }, id: 'call_before_1' },
    { name: 'create_record', input: { kind: 'note', title: 'Blue car', text: '21,000 euros' }, id: 'call_write' }
  ] });
  const submitted = await runs.submitRun(userId, { requestId: 'req-effort-pause', chat: header('chat-effort-pause'), text: 'Merke dir den Preis.', device: 'phone-1' },
    { fetcher: judged(sent, jev, 'quick', round) });
  assert.equal(submitted.run.status, 'awaiting', 'waiting failed: ' + submitted.run.turn.error);
  assert.equal(submitted.requests[0].tool, 'create_record');
  assert.equal(jev.length, 1);
  const decided = await runs.decideRun(userId, { runId: submitted.run.runId, requestId: submitted.requests[0].id, approved: true, device: 'browser-1' },
    { fetcher: judged(sent, jev, 'quick', compatibleMessage({ calls: [
      { name: 'search_notes', input: { query: 'after-0' }, id: 'call_after_0' },
      { name: 'search_notes', input: { query: 'after-1' }, id: 'call_after_1' }
    ] }), compatibleMessage({ text: 'Notiert.' })) });
  assert.equal(decided.run.status, 'done', 'continue failed: ' + decided.run.turn.error);
  assert.equal(jev.length, 1, 'the continued run keeps its level instead of asking JEV again');
  assert.equal(decided.run.turn.usage.effort, 'quick');
  assert.deepEqual(rows(decided, 'search_notes').map(item => item.state), ['done', 'done', 'done', 'failed']);
  assert.match(rows(decided, 'search_notes')[3].result, /research_budget_reached/);
  assert.equal(decided.run.turn.answer, 'Notiert.');
});

const enoughRequests = jev => jev.filter(item => item.body.questions?.enough);
const script = (rounds, calls = 2) => Array.from({ length: rounds }, (_, index) => lookups(calls, 'round' + index));

test('enough state keeps the last twelve finished lookups, cut short, and never sends cards, writes or failures', () => {
  const questions = enoughQuestions();
  assert.equal(questions.enough.type, 'choice');
  assert.match(questions.enough.instructions, /good answer .* with what it has looked up so far/);
  assert.deepEqual(Object.keys(questions.enough.criteria), ['yes', 'no']);
  assert.equal(enoughFromAnswers({ enough: { type: 'choice', choice: 'yes' } }), true);
  assert.equal(enoughFromAnswers({ enough: { type: 'choice', choice: 'no' } }), false);
  assert.equal(enoughFromAnswers({ enough: { type: 'noul', noul: 0.8 } }), null, 'a wrong answer type is no answer');
  assert.equal(enoughFromAnswers({ enough: { type: 'choice', choice: 'maybe' } }), null, 'an unknown choice is no answer');
  assert.equal(enoughFromAnswers({}), null);
  assert.equal(enoughFromAnswers(null), null);
  const rows = [
    { name: 'show_card', state: 'done', title: 'A card', result: '{"drawn":true}' },
    { name: 'create_record', state: 'done', title: 'A saved note', result: '{"status":"saved"}' },
    { name: 'search_notes', state: 'failed', title: 'A failed lookup', result: '{"error":"data_unavailable"}' },
    ...Array.from({ length: 14 }, (_, index) => ({
      name: 'search_notes', state: 'done', title: index + 'T'.repeat(140), result: index + 'R'.repeat(340)
    }))
  ];
  const state = enoughState({ text: 'M'.repeat(2500) }, rows);
  assert.equal(state.message.length, 2000, 'the message is cut at 2,000 characters');
  assert.equal(state.found.length, 12, 'only the last twelve lookups are sent');
  assert.equal(state.found[0].did.length, 120, 'what a lookup did is cut at 120 characters');
  assert.equal(state.found[0].got.length, 300, 'what it found is cut at 300 characters');
  assert.ok(state.found[0].did.startsWith('2'), 'the first sent lookup is the third of the fourteen');
  assert.ok(state.found.at(-1).did.startsWith('13'), 'newest last');
  const body = JSON.stringify(state);
  for (const left of ['A card', 'A saved note', 'A failed lookup']) assert.ok(!body.includes(left), left + ' is not a lookup');
  assert.deepEqual(enoughState({ text: 'Same', activity: rows }).found.length, 12, 'the turn activity is used when no rows are given');
});

test('recording only: four rounds of lookups all run and the first yes records where the reply stood', async () => {
  const userId = await account(), sent = [], jev = [];
  const view = await runs.submitRun(userId, { requestId: 'req-enough-record', chat: header('chat-enough-record'), text: 'Vergleiche die zwei Autos aus meinen Notizen gründlich.', device: 'browser-1' },
    { fetcher: judging(sent, jev, { effort: 'thorough', enough: ['no', 'yes', 'no', 'no'] }, ...script(4), compatibleMessage({ text: 'Der blaue Wagen ist günstiger.' })) });
  assert.equal(view.run.status, 'done', view.run.turn.error);
  assert.equal(view.run.turn.answer, 'Der blaue Wagen ist günstiger.', 'the reply is the model’s own');
  assert.equal(view.run.turn.usage.effort, 'thorough');
  assert.equal(view.run.turn.usage.enoughAt, 4, 'yes came after four finished lookups');
  assert.ok(view.run.turn.usage.enoughAsked >= 2, 'at least the no and the yes were asked');
  assert.deepEqual(rows(view, 'search_notes').map(item => item.state), Array(8).fill('done'), 'recording alone stops nothing');
  const asked = enoughRequests(jev);
  assert.equal(view.run.turn.usage.enoughAsked, asked.length);
  assert.equal(asked[0].body.state.message, 'Vergleiche die zwei Autos aus meinen Notizen gründlich.');
  assert.equal(asked[1].body.state.found.length, 4, 'the second question sees the first two rounds of lookups');
  assert.doesNotMatch(String(asked[0].body.state.found[0].got), /"op"/, 'a card source is never sent');
});

test('with stopping on, the lookups after the yes are refused and the model writes the final text', async () => {
  process.env.PIP_ENOUGH_STOPS = '1';
  try {
    const userId = await account(), sent = [], jev = [];
    const view = await runs.submitRun(userId, { requestId: 'req-enough-stop', chat: header('chat-enough-stop'), text: 'Recherchiere die zwei Autos gründlich.', device: 'browser-1' },
      { fetcher: judging(sent, jev, { effort: 'thorough', enough: ['no', 'yes'] }, ...script(4), compatibleMessage({ text: 'Mehr brauche ich nicht.' })) });
    assert.equal(view.run.status, 'done', view.run.turn.error);
    assert.equal(view.run.turn.answer, 'Mehr brauche ich nicht.', 'the reply finishes with the model’s text');
    const made = rows(view, 'search_notes');
    assert.deepEqual(made.map(item => item.state), [...Array(4).fill('done'), ...Array(4).fill('failed')]);
    for (const refused of made.slice(4)) assert.match(refused.result, /research_budget_reached/);
    assert.equal(view.run.turn.usage.effort, 'thorough');
    assert.equal(view.run.turn.usage.enoughAt, 4);
    assert.equal(view.run.turn.usage.enoughAsked, 2, 'once the yes ends research it is not asked again');
  } finally {
    delete process.env.PIP_ENOUGH_STOPS;
  }
});

test('a JEV that fails on the second question changes nothing and the reply finishes', async () => {
  const cases = [
    ['status 500', () => failure(500, { error: 'JEV is down' })],
    ['a timeout', () => { throw Object.assign(new Error('The judge timed out'), { name: 'AbortError' }); }]
  ];
  for (const [name, fail] of cases) {
    const userId = await account(), sent = [], jev = [];
    const view = await runs.submitRun(userId, { requestId: 'req-enough-fails-' + userId, chat: header('chat-enough-fails-' + userId), text: 'Recherchiere das gründlich.', device: 'browser-1' },
      { fetcher: judging(sent, jev, { effort: 'thorough', enough: ['no', fail] }, ...script(4), compatibleMessage({ text: 'Ich habe genug gefunden.' })) });
    assert.equal(view.run.status, 'done', name + ': ' + view.run.turn.error);
    assert.equal(view.run.turn.answer, 'Ich habe genug gefunden.', name + ': the reply is the model’s own');
    assert.deepEqual(rows(view, 'search_notes').map(item => item.state), Array(8).fill('done'), name + ': every lookup runs');
    assert.equal('enoughAt' in view.run.turn.usage, false, name + ': no yes is recorded');
    assert.equal(view.run.turn.usage.enoughAsked, enoughRequests(jev).length, 'the question was still counted');
  }
});

test('quick and no level never send the enough question', async () => {
  for (const [label, slug, effort] of [
    ['quick', 'quick', 'quick'],
    ['no level', 'none', new Response(JSON.stringify({ answers: {} }), { status: 200, headers: { 'content-type': 'application/json' } })]
  ]) {
    const userId = await account(), sent = [], jev = [];
    const view = await runs.submitRun(userId, { requestId: 'req-enough-' + slug, chat: header('chat-enough-' + slug), text: 'Was sagen meine Notizen?', device: 'browser-1' },
      { fetcher: judging(sent, jev, { effort, enough: () => { throw new Error('The enough question must not be asked.'); } }, lookups(2, 'quiet'), compatibleMessage({ text: 'Die Notiz nennt 21.000 Euro.' })) });
    assert.equal(view.run.status, 'done', label + ': ' + view.run.turn.error);
    assert.equal(enoughRequests(jev).length, 0, label + ': no enough question reaches JEV');
  }
});

test('the enough question is asked at most six times in a reply', async () => {
  const userId = await account(), sent = [], jev = [];
  const view = await runs.submitRun(userId, { requestId: 'req-enough-six', chat: header('chat-enough-six'), text: 'Recherchiere neun Runden lang.', device: 'browser-1' },
    { fetcher: judging(sent, jev, { effort: 'thorough', enough: 'no' }, ...script(9, 1), compatibleMessage({ text: 'Genug.' })) });
  assert.equal(enoughRequests(jev).length, 6, 'never a seventh question');
  // The continuation limit makes the ninth round final: its lookup is refused, and the model writes the answer.
  assert.equal(view.run.status, 'done', view.run.turn.error);
  assert.equal(view.run.turn.answer, 'Genug.');
  const made = rows(view, 'search_notes');
  assert.deepEqual(made.map(item => item.state), [...Array(8).fill('done'), 'failed']);
  assert.match(made[8].result, /research_budget_reached/);
});

test('the enough count and the lookups last asked about survive a pause', async () => {
  const userId = await account(), sent = [], jev = [];
  const plan = { effort: 'thorough', enough: 'no' };
  const submitted = await runs.submitRun(userId, { requestId: 'req-enough-pause', chat: header('chat-enough-pause'), text: 'Recherchiere und merke dir den Preis.', device: 'phone-1' },
    { fetcher: judging(sent, jev, plan, lookups(2, 'before'), compatibleMessage({ calls: [{ name: 'create_record', input: { kind: 'note', title: 'Blue car', text: '21,000 euros' }, id: 'call_note' }] })) });
  assert.equal(submitted.run.status, 'awaiting', 'waiting failed: ' + submitted.run.turn.error);
  assert.equal(enoughRequests(jev).length, 1, 'asked once before the pause');
  const decided = await runs.decideRun(userId, { runId: submitted.run.runId, requestId: submitted.requests[0].id, approved: true, device: 'browser-1' },
    { fetcher: judging(sent, jev, plan, compatibleMessage({ text: 'Notiert.' })) });
  assert.equal(decided.run.status, 'done', 'continue failed: ' + decided.run.turn.error);
  assert.equal(decided.run.turn.answer, 'Notiert.');
  assert.equal(enoughRequests(jev).length, 1, 'no new lookup was made, so the question is not repeated after the pause');
  assert.equal(decided.run.turn.usage.enoughAsked, 1);
  assert.equal('enoughAt' in decided.run.turn.usage, false);
});

test('a final round reached by the lookups’ ceiling refuses one more lookup instead of failing', async () => {
  const userId = await account(), sent = [], jev = [];
  const view = await runs.submitRun(userId, { requestId: 'req-late-ceiling', chat: header('chat-late-ceiling'), text: 'Vergleiche die zwei Angebote.', device: 'browser-1' },
    { fetcher: judging(sent, jev, { effort: 'quick' }, lookups(4, 'ceiling'), lookups(1, 'after'), compatibleMessage({ text: 'Der blaue Wagen ist günstiger.' })) });
  assert.equal(view.run.status, 'done', view.run.turn.error);
  assert.equal(view.run.turn.answer, 'Der blaue Wagen ist günstiger.', 'the reply finishes with the model’s text');
  const made = rows(view, 'search_notes');
  assert.deepEqual(made.map(item => item.state), ['done', 'done', 'done', 'failed', 'failed']);
  for (const refused of made.slice(3)) assert.match(refused.result, /research_budget_reached/);
  assert.ok(sent[1].tools.some(tool => tool.function.name === 'search_notes'), 'the final round still offers the lookups, so the request reaches Pocket');
});

test('a final round reached by the continuation limit also refuses a late lookup instead of failing', async () => {
  const userId = await account(), sent = [], jev = [];
  const view = await runs.submitRun(userId, { requestId: 'req-late-continuation', chat: header('chat-late-continuation'), text: 'Recherchiere lange.', device: 'browser-1' },
    { fetcher: judging(sent, jev, { effort: noLevel() },
      ...Array.from({ length: 8 }, (_, index) => lookups(1, 'round' + index)), lookups(1, 'after'), compatibleMessage({ text: 'Genug recherchiert.' })) });
  assert.equal(view.run.status, 'done', view.run.turn.error);
  assert.equal(view.run.turn.answer, 'Genug recherchiert.');
  const made = rows(view, 'search_notes');
  assert.deepEqual(made.map(item => item.state), [...Array(8).fill('done'), 'failed']);
  assert.match(made[8].result, /research_budget_reached/);
  assert.ok(sent[8].tools.some(tool => tool.function.name === 'search_notes'), 'the ninth, final round still offers the lookups');
});

test('thorough: ten lookups run, the eleventh is refused, and the note says how many', async () => {
  const userId = await account(), sent = [], jev = [];
  const view = await runs.submitRun(userId, { requestId: 'req-thorough-ten', chat: header('chat-thorough-ten'), text: 'Recherchiere den Markt gründlich.', device: 'browser-1' },
    { fetcher: judging(sent, jev, { effort: 'thorough', enough: 'no' },
      ...Array.from({ length: 5 }, (_, index) => lookups(2, 'ten' + index)), lookups(1, 'over'), compatibleMessage({ text: 'Zehn Quellen reichen.' })) });
  assert.equal(view.run.status, 'done', view.run.turn.error);
  assert.equal(view.run.turn.answer, 'Zehn Quellen reichen.');
  assert.equal(view.run.turn.usage.effort, 'thorough');
  const made = rows(view, 'search_notes');
  assert.deepEqual(made.map(item => item.state), [...Array(10).fill('done'), 'failed']);
  assert.match(made[10].result, /research_budget_reached/);
  assert.match(String(sent[0].messages[0].content), /deserves thorough looking-up: up to ten lookups/);
});

test('thorough: five web lookups run and the sixth is refused', async () => {
  const userId = await account(), sent = [], jev = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, data: { web: [{ title: 'Car', url: 'https://example.com/car', description: 'A car.' }] } }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const view = await runs.submitRun(userId, { requestId: 'req-web-five', chat: { ...header('chat-web-five'), config: { ...VAULT_CONFIG, webSearch: true } }, text: 'Suche im Netz nach dem Auto.', device: 'browser-1' },
      { fetcher: judging(sent, jev, { effort: 'thorough', enough: 'no' },
        ...Array.from({ length: 5 }, (_, index) => compatibleMessage({ calls: [{ name: 'search_web', input: { query: 'car ' + index }, id: 'call_web' + index }] })), compatibleMessage({ calls: [{ name: 'search_web', input: { query: 'car over' }, id: 'call_web_over' }] }), compatibleMessage({ text: 'Fünf Suchen reichen.' })) });
    assert.equal(view.run.status, 'done', view.run.turn.error);
    assert.equal(view.run.turn.answer, 'Fünf Suchen reichen.');
    const made = rows(view, 'search_web');
    assert.deepEqual(made.map(item => item.state), ['done', 'done', 'done', 'done', 'done', 'failed']);
    assert.match(made[5].result, /research_budget_reached/);
  } finally {
    globalThis.fetch = saved;
  }
});

test('a pause in the first final round keeps the tolerance, and the answer still gets its round after it', async () => {
  const userId = await account(), sent = [], jev = [];
  const submitted = await runs.submitRun(userId, { requestId: 'req-late-pause', chat: header('chat-late-pause'), text: 'Recherchiere acht Runden und merke dir den Preis.', device: 'phone-1' },
    { fetcher: judging(sent, jev, { effort: noLevel() },
      ...Array.from({ length: 8 }, (_, index) => lookups(1, 'pause' + index)),
      compatibleMessage({ calls: [{ name: 'create_record', input: { kind: 'note', title: 'Blue car', text: '21,000 euros' }, id: 'call_write' }] })) });
  assert.equal(submitted.run.status, 'awaiting', 'waiting failed: ' + submitted.run.turn.error);
  assert.equal(submitted.requests[0].tool, 'create_record');
  // The eighth lookup round is the first final one; the write there pauses. After it, two late lookups and the answer
  // need a round past the usual continuation limit, which must not end the reply before it writes.
  const decided = await runs.decideRun(userId, { runId: submitted.run.runId, requestId: submitted.requests[0].id, approved: true, device: 'browser-1' },
    { fetcher: judging(sent, jev, { effort: noLevel() }, lookups(1, 'late-a'), lookups(1, 'late-b'), compatibleMessage({ text: 'Nach acht Runden und zwei Absagen: die Antwort.' })) });
  assert.equal(decided.run.status, 'done', 'continue failed: ' + decided.run.turn.error);
  assert.equal(decided.run.turn.answer, 'Nach acht Runden und zwei Absagen: die Antwort.');
  const made = decided.run.turn.activity.filter(item => item.name === 'search_notes');
  assert.deepEqual(made.map(item => item.state), [...Array(8).fill('done'), 'failed', 'failed']);
  for (const refused of made.slice(8)) assert.match(refused.result, /research_budget_reached/);
});

test('no level: eleven lookups all run, as today', async () => {
  const userId = await account(), sent = [], jev = [];
  const view = await runs.submitRun(userId, { requestId: 'req-no-level-eleven', chat: header('chat-no-level-eleven'), text: 'Recherchiere ohne JEV.', device: 'browser-1' },
    { fetcher: judging(sent, jev, { effort: noLevel() }, lookups(5, 'plain-a'), lookups(5, 'plain-b'), lookups(1, 'plain-c'), compatibleMessage({ text: 'Elf Quellen reichen.' })) });
  assert.equal(view.run.status, 'done', view.run.turn.error);
  assert.equal(view.run.turn.answer, 'Elf Quellen reichen.');
  assert.equal('effort' in view.run.turn.usage, false);
  assert.deepEqual(rows(view, 'search_notes').map(item => item.state), Array(11).fill('done'));
  assert.doesNotMatch(String(sent[0].messages[0].content), /Pocket judged/);
});
