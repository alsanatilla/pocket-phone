import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatStore, ReplyRunner, DEFAULT_CONFIG, config, identity, requestBody, streamReply, contextCoverage } from '../src/client/pip-core.js';
import { execute, accessFingerprint, historyPolicy, saveAccess } from '../src/client/pip-tools.js';
import { conversationMemory, MEMORY_LIMIT } from '../src/client/pip-memory.js';
import { activity } from '../src/client/pip-activity.js';
import { sanitizeObject, mergeObject, validObject } from '../src/shared/objects.js';
import { event, response, anthropicMessage, systemText, messageText } from './pip-provider-fixtures.mjs';

class Memory {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
function workspace(t) {
  const previous = { local: globalThis.localStorage, session: globalThis.sessionStorage, fetch: globalThis.fetch };
  const disk = new Memory(); globalThis.localStorage = disk; globalThis.sessionStorage = new Memory();
  t.after(() => { globalThis.localStorage = previous.local; globalThis.sessionStorage = previous.session; globalThis.fetch = previous.fetch; });
  const store = new ChatStore(disk), chat = store.create(); return { disk, store, chat };
}
const answer = text => anthropicMessage({ text });
const limited = () => anthropicMessage({ finish: 'max_tokens' });
function call(name, input, id = 'toolu_fixture', tokens = 8) {
  return anthropicMessage({ calls: [{ name, input, id }], output: tokens ?? 0 });
}
const memoryOf = body => JSON.parse(body.messages.at(-1).content.match(/<pocket_conversation_memory>\n(.*?)\n<\/pocket_conversation_memory>/s)[1]);
const row = (name, data, fields = {}) => ({ id: 'event-' + name, name, state: 'done', input: '{}', ended: 123, result: JSON.stringify(data), ...fields });
const prior = (uid, activity = [], fields = {}) => ({ uid, text: 'Earlier question', answer: 'Earlier final answer', status: 'done', context: [], activity, ...fields });
const current = () => ({ uid: 'current-turn', text: 'which stock should I buy?', context: [] });

test('current research requests receive the local date and timezone', t => {
  const { chat } = workspace(t); t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 8, 12).getTime() });
  const body = requestBody(chat, current());
  assert.match(body.instructions, /Today is 2026-10-08 \(.+\)/);
  assert.match(body.instructions, /verify publication dates/);
});

for (const provider of ['anthropic', 'compatible']) test(`${provider} synthesis preserves the actual stock question and attributes limits to the app`, async t => {
  const { chat } = workspace(t), turn = current();
  chat.config = config({ ...DEFAULT_CONFIG, provider, ...(provider === 'compatible' ? { model: 'fixture-model', baseUrl: 'https://model.example/v1' } : {}) });
  chat.turns = [prior('old', [], { text: 'Research cars and save a note', answer: 'I have not prepared the note.' }), turn];
  const sent = [];
  await streamReply(chat, turn, { key: 'fixture', fetcher: async (_, options) => {
    sent.push(JSON.parse(options.body));
    if (provider === 'anthropic') return response(sent.length === 1 ? limited() : answer('What is your investment horizon?'));
    return response(event({ choices: [{ index: 0, delta: { content: sent.length === 1 ? '' : 'What is your investment horizon?' }, finish_reason: sent.length === 1 ? 'length' : 'stop' }], usage: { completion_tokens: 8 } }) + 'data: [DONE]\n\n');
  } });
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].messages.filter(item => item.role === 'user'), sent[0].messages.filter(item => item.role === 'user'));
  assert.equal(messageText(sent[1].messages.at(-1)), turn.text);
  const system = systemText(sent[1]);
  assert.match(system, /app limit, not a user instruction/);
  assert.match(system, /earlier message must not replace the current answer/);
});

test('news snippets and dates survive a mixed Firecrawl search with five web hits', async t => {
  const { chat } = workspace(t), value = { ...chat.config, webSearch: true };
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, data: {
    web: Array.from({ length: 5 }, (_, i) => ({ title: 'Web ' + i, url: 'https://example.com/web-' + i, description: 'Web summary' })),
    news: [{ title: 'Current news', url: 'https://example.com/news', snippet: 'The actual news evidence', date: 'October 7, 2026' }]
  } }));
  const result = await execute(value, 'search_web', { query: 'cars', sources: ['web', 'news'], limit: 5 });
  assert.equal(result.results.length, 5);
  const news = result.results.find(item => item.source_type === 'news');
  assert.equal(news.description, 'The actual news evidence'); assert.equal(news.date, 'October 7, 2026');
});

test('HTTP-200 Firecrawl failures, blocked pages and empty pages are explicit errors', async t => {
  const { chat } = workspace(t), value = { ...chat.config, webSearch: true };
  for (const name of ['search_web', 'read_web_page']) {
    globalThis.fetch = async () => new Response(JSON.stringify({ success: false, error: 'provider-secret-message' }));
    const result = await execute(value, name, name === 'search_web' ? { query: 'cars' } : { url: 'https://example.com/cars' });
    assert.equal(result.error, 'web_unavailable'); assert.ok(!JSON.stringify(result).includes('provider-secret-message'));
  }
  for (const data of [{ markdown: 'Access denied', metadata: { statusCode: 403 } }, { markdown: '', metadata: { statusCode: 200 } }]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ success: true, data }));
    assert.equal((await execute(value, 'read_web_page', { url: 'https://example.com/cars' })).error, 'web_unavailable');
  }
});

test('publication dates and page offsets remain accurate across cached reads', async t => {
  const { chat } = workspace(t), value = { ...chat.config, webSearch: true }, context = { cache: new Map() }; let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response(JSON.stringify({ success: true, data: { markdown: 'x'.repeat(6500), metadata: { title: 'Report', statusCode: 200, 'article:published_time': '2026-09-28', 'article:modified_time': '2026-10-07' } } })); };
  const first = await execute(value, 'read_web_page', { url: 'https://example.com/report', length: 4000 }, undefined, context);
  const second = await execute(value, 'read_web_page', { url: 'https://example.com/report', offset: first.next_offset }, undefined, context);
  assert.equal(first.published_at, '2026-09-28'); assert.equal(second.modified_at, '2026-10-07');
  assert.equal(first.truncated, true); assert.equal(second.offset, 4000); assert.equal(second.next_offset, null); assert.equal(requests, 1);
});

test('a proposal in the last research round reserves an answer even when output usage is zero', async t => {
  const { chat } = workspace(t), turn = current(), sent = [];
  turn.text = 'Research and prepare a note';
  const result = await streamReply(chat, turn, { key: 'fixture', fetcher: async (_, options) => {
    sent.push(JSON.parse(options.body)); const index = sent.length - 1;
    if (index < 8) return response(call('read_chat_history', { query: 'q' + index }, 'read-' + index, 1));
    if (index === 8) return response(call('propose_action', { kind: 'note', title: 'Research note', text: 'Verified findings' }, 'last-proposal', null));
    return response(answer('The note is ready for review.'));
  } });
  assert.equal(sent.length, 10); assert.ok(sent[9].tool_choice?.type === 'none' || !sent[9].tools?.length);
  assert.ok(sent[8].max_tokens + sent[9].max_tokens + 8 <= chat.config.maxTokens);
  assert.ok(result.activity.some(event => event.name === 'propose_action' && event.state === 'done'));
  assert.equal(result.answer, 'The note is ready for review.');
});

test('a provider that ignores the final research limit stays failed and resumable', async t => {
  const { store, chat } = workspace(t); let requests = 0;
  const runner = new ReplyRunner(store, { key: () => 'fixture', stream: (chat, turn, options) => streamReply(chat, turn, { ...options, fetcher: async () => response(++requests === 1 ? limited() : call('read_chat_history', {})) }) });
  await runner.send(chat.uid, { text: 'Research cars' });
  const saved = store.get(chat.uid).turns[0]; assert.equal(saved.status, 'failed'); assert.match(saved.error, /more tools after the research limit/);
  const replayed = requestBody(store.get(chat.uid), current()).messages;
  assert.equal(requests, 2); assert.equal(replayed[0].content, 'Research cars'); assert.match(replayed[1].content, /^\[No answer: this reply failed before it finished; its partial text is not repeated\.\]/);
  assert.ok(!replayed.some(item => item.role === 'assistant' && !item.content.startsWith('[No answer:')));
});

test('repeated failed calls do not execute again or exhaust all research rounds', async t => {
  const { chat } = workspace(t); let executions = 0, requests = 0;
  const result = await streamReply(chat, current(), { key: 'fixture', executeTool: async () => { executions++; return { error: 'history_unavailable', message: 'Unavailable' }; }, fetcher: async () => response(++requests < 3 ? call('read_chat_history', {}, 'call-' + requests) : answer('The lookup failed.')) });
  assert.equal(executions, 1); assert.equal(requests, 3);
  assert.ok(result.activity.some(event => event.result && JSON.parse(event.result).repeated));
});

test('invalid tool arguments return schema repair information without echoing values', async t => {
  const { chat } = workspace(t);
  const result = await execute(chat.config, 'propose_action', { kind: 'note', unexpected: 'private-value' });
  assert.equal(result.error, 'invalid_arguments'); assert.deepEqual(result.required_fields, ['kind', 'title', 'text']);
  assert.ok(result.allowed_fields.includes('title')); assert.ok(!JSON.stringify(result).includes('private-value'));
});

test('later turns recover actual observations and failures after the chat is reloaded', t => {
  const { disk, store, chat } = workspace(t), turn = current(); chat.config.webSearch = true;
  const observed = { source: 'https://example.com/report', title: 'Car report', text: 'Actual source evidence', published_at: '2026-10-07', request_identity: identity(chat.config), access_fingerprint: accessFingerprint(chat.config) };
  chat.turns = [prior('read-turn', [row('read_web_page', observed), row('search_web', { error: 'web_unavailable' }, { id: 'failed-search', state: 'failed' })], { reasoning: 'private reasoning trace' }), turn]; store.save(chat);
  const restored = new ChatStore(disk).get(chat.uid), memory = memoryOf(requestBody(restored, restored.turns.at(-1)));
  assert.equal(memory.recent_activity[0].events[0].result.text, 'Actual source evidence');
  assert.equal(memory.recent_activity[0].events[1].state, 'failed'); assert.equal(memory.recent_activity[0].events[1].error, 'web_unavailable');
  assert.ok(!JSON.stringify(memory).includes('private reasoning trace')); assert.equal(memory.historical, true);
});

test('saved actions survive more than twenty conversation pairs and older tool results remain queryable', async t => {
  const { store, chat } = workspace(t), turn = current();
  const action = row('propose_action', { kind: 'proposal', proposal: { kind: 'note', title: 'Car research', text: 'Findings' } }, { applied_href: '/notes/saved-note', applied: 321 });
  // The chat's first request is always pinned, so the saved action sits in the second turn, outside the replay window.
  chat.turns = [prior('first-turn'), prior('old-turn', [action]), ...Array.from({ length: 25 }, (_, i) => prior('pair-' + i)), turn]; store.save(chat);
  const restored = store.get(chat.uid), body = requestBody(restored, restored.turns.at(-1));
  assert.ok(!body.messages.some(message => message.role === 'assistant' && message.content.includes('[Pip prepared:')));
  assert.equal(memoryOf(body).actions[0].href, '/notes/saved-note');
  const found = await execute(restored.config, 'read_chat_history', { turn_id: 'old-turn' }, undefined, { chat: restored, turn: restored.turns.at(-1) });
  assert.equal(found.turns[0].events[0].action.status, 'applied_by_user'); assert.equal(found.turns[0].events[0].action.title, 'Car research');
});

test('revoking a source or changing the provider withholds its old tool payloads', async t => {
  const { chat } = workspace(t), turn = current(); saveAccess(chat.config, ['notes']);
  chat.turns = [prior('note-turn', [row('read_note', { title: 'Private record', text: 'private-note-evidence', request_identity: identity(chat.config), access_fingerprint: accessFingerprint(chat.config) }, { input: '{"id":"private-note-id"}' })]), turn];
  assert.match(JSON.stringify(memoryOf(requestBody(chat, turn))), /private-note-evidence/);
  saveAccess(chat.config, []);
  assert.ok(!JSON.stringify(memoryOf(requestBody(chat, turn))).includes('private-note-evidence'));
  const restricted = await execute(chat.config, 'read_chat_history', { turn_id: 'note-turn' }, undefined, { chat, turn });
  assert.ok(!JSON.stringify(restricted).includes('private-note-id'));
  saveAccess(chat.config, ['notes']); chat.config = config({ ...chat.config, provider: 'compatible', model: 'another-model', baseUrl: 'https://model.example/v1' }); saveAccess(chat.config, ['notes']);
  assert.ok(!JSON.stringify(memoryOf(requestBody(chat, turn))).includes('private-note-evidence'));
});

test('composite history caches are invalidated when web access changes', async t => {
  const { chat } = workspace(t), turn = current(), context = { chat, turn, cache: new Map() }; chat.config.webSearch = true;
  chat.turns = [prior('web-turn', [row('read_web_page', { text: 'web-evidence', request_identity: identity(chat.config) })]), turn];
  assert.match(JSON.stringify(await execute(chat.config, 'read_chat_history', {}, undefined, context)), /web-evidence/);
  chat.config.webSearch = false;
  const restricted = await execute(chat.config, 'read_chat_history', {}, undefined, context);
  assert.ok(!JSON.stringify(restricted).includes('web-evidence')); assert.equal(restricted.history_web_access, false);
});

test('bounded memory and paged history report omissions instead of claiming full recall', async t => {
  const { chat } = workspace(t), turn = current(); chat.config.webSearch = true;
  chat.turns = [...Array.from({ length: 45 }, (_, i) => prior('old-' + i, [row('read_web_page', { text: 'Evidence '.repeat(750), request_identity: identity(chat.config) }, { id: 'event-' + i })])), turn];
  const memory = conversationMemory(chat, turn, historyPolicy(chat.config));
  assert.ok(JSON.stringify(memory).length <= MEMORY_LIMIT); assert.ok(memory.omitted_activity_turns > 0);
  const first = await execute(chat.config, 'read_chat_history', { limit: 2 }, undefined, { chat, turn });
  assert.ok(JSON.stringify(first).length <= 8000); assert.ok(first.next_offset > 0);
  const next = await execute(chat.config, 'read_chat_history', { offset: first.next_offset, limit: 2 }, undefined, { chat, turn });
  assert.notEqual(next.turns[0].turn_id, first.turns[0].turn_id);
});

test('partial answers and failed proposals never become remembered successful actions', t => {
  const { chat } = workspace(t), turn = current();
  chat.turns = [prior('failed-turn', [row('propose_action', { kind: 'proposal', proposal: { kind: 'note', title: 'Never prepared' } }, { state: 'failed' })], { status: 'failed', answer: 'private partial answer' }), turn];
  const body = requestBody(chat, turn), memory = memoryOf(body);
  assert.deepEqual(memory.actions, []); assert.ok(!JSON.stringify(body).includes('private partial answer'));
  assert.equal(memory.recent_activity[0].events[0].state, 'failed');
});

test('user-kept records and edited approvals persist their actual title and status', t => {
  const { store, chat } = workspace(t), turn = prior('prepared-turn', [row('propose_action', { kind: 'proposal', proposal: { kind: 'note', title: 'Original title', text: 'Draft' } })]);
  chat.turns = [turn]; store.save(chat);
  store.recordApplied(chat.uid, turn.uid, 'event-propose_action', '/notes/approved', { kind: 'proposal', proposal: { kind: 'note', title: 'Edited title', text: 'Edited content' } });
  store.recordKept(chat.uid, turn.uid, 'thought', 'A thought I kept', '/thoughts/kept');
  const restored = store.get(chat.uid), memory = memoryOf(requestBody(restored, current()));
  assert.equal(memory.actions[0].title, 'Edited title'); assert.equal(memory.actions[0].status, 'applied_by_user');
  assert.equal(memory.actions[1].kind, 'thought'); assert.equal(memory.actions[1].href, '/thoughts/kept');
  assert.match(requestBody(restored, current()).messages.find(message => message.role === 'assistant').content, /Edited title/);
});

test('identical proposal calls refer to the existing proposal instead of making a second card', async t => {
  const { chat } = workspace(t); let requests = 0;
  const proposal = { kind: 'note', title: 'One note', text: 'One draft' };
  const result = await streamReply(chat, current(), { key: 'fixture', fetcher: async () => response(++requests < 3 ? call('propose_action', proposal, 'proposal-' + requests) : answer('The existing note is ready.')) });
  assert.equal(result.activity.filter(event => event.result && JSON.parse(event.result).kind === 'proposal').length, 1);
  assert.equal(result.activity.filter(event => event.result && JSON.parse(event.result).kind === 'existing_proposal').length, 1);
});

test('restart retains saved actions and the tool journal without reusing its observations', async t => {
  const { store, chat } = workspace(t); let calls = 0;
  const proposal = row('propose_action', { kind: 'proposal', proposal: { kind: 'note', title: 'Saved before restart', text: 'Draft' } });
  const runner = new ReplyRunner(store, { key: () => 'fixture', stream: async (chat, turn, options) => {
    if (++calls === 1) { options.onUpdate({ activity: [proposal], answer: 'Partial' }); throw new Error('Disconnected'); }
    assert.equal(options.resume, null); assert.equal(turn.activity[0].applied_href, '/notes/already-saved');
    assert.equal(memoryOf(requestBody(chat, turn)).actions[0].status, 'applied_by_user');
    return { answer: 'Finished', activity: turn.activity };
  } });
  await runner.send(chat.uid, { text: 'Prepare a note' }); const failed = store.get(chat.uid).turns[0];
  store.recordApplied(chat.uid, failed.uid, proposal.id, '/notes/already-saved');
  await runner.send(chat.uid, { retry: failed.uid });
  assert.equal(store.get(chat.uid).turns[0].activity[0].applied_href, '/notes/already-saved');
});

test('a reloaded streaming reply can explicitly Continue from its committed observations', async t => {
  const { store, chat } = workspace(t); chat.config.webSearch = true;
  const observed = row('read_web_page', { text: 'Committed evidence', request_identity: identity(chat.config), access_fingerprint: accessFingerprint(chat.config) });
  chat.turns = [prior('interrupted', [observed, { id: 'pending-tool', name: 'search_web', state: 'running' }], { status: 'streaming', answer: 'Unfinished', usage: { request_identity: identity(chat.config), web_access: true, read_access: '' } })]; store.save(chat);
  const runner = new ReplyRunner(store, { key: () => 'fixture', stream: async (_, turn, options) => {
    assert.equal(options.resume.observations.length, 1); assert.equal(options.resume.observations[0].name, 'read_web_page');
    assert.equal(turn.activity.find(event => event.id === 'pending-tool').state, 'stopped');
    return { answer: 'Resumed', activity: turn.activity };
  } });
  await runner.send(chat.uid, { resume: 'interrupted' }); assert.equal(store.get(chat.uid).turns[0].status, 'done');
});

test('late stream callbacks cannot write after the active account changes', async t => {
  const { disk, store, chat } = workspace(t); disk.setItem('pocket:active-account', 'account-a'); let update, finish;
  const runner = new ReplyRunner(store, { key: () => 'fixture', stream: (_, __, options) => { update = options.onUpdate; return new Promise(resolve => { finish = resolve; }); } });
  const pending = runner.send(chat.uid, { text: 'Question' }); disk.setItem('pocket:active-account', 'account-b');
  update({ answer: 'Wrong account data' }); assert.equal(runner.active.controller.signal.aborted, true);
  finish({ answer: 'Late answer' }); await pending; assert.equal(store.get(chat.uid).turns[0].answer, '');
});

test('older exact tool results can be reconstructed in pages without refetching a source', async t => {
  const { chat } = workspace(t), turn = current(); chat.config.webSearch = true;
  const observed = row('read_web_page', { text: 'Historical evidence '.repeat(300), request_identity: identity(chat.config) });
  chat.turns = [prior('old-source', [observed]), turn]; let offset = 0, reconstructed = '', pages = 0;
  do {
    const result = await execute(chat.config, 'read_chat_history', { event_id: observed.id, result_offset: offset, result_length: 2000 }, undefined, { chat, turn });
    assert.ok(!result.error); assert.ok(JSON.stringify(result).length <= 8000);
    reconstructed += result.result_text; offset = result.next_result_offset; pages++;
  } while (offset !== null && pages < 10);
  assert.equal(reconstructed, observed.result); assert.ok(pages > 1);
  chat.config.webSearch = false;
  const restricted = await execute(chat.config, 'read_chat_history', { event_id: observed.id }, undefined, { chat, turn });
  assert.equal(restricted.result_text, undefined);
});

test('long completed answers page exactly, match past the excerpt and keep partial answers unreadable', async t => {
  const { chat } = workspace(t), turn = current(), context = { chat, turn }, read = args => execute(chat.config, 'read_chat_history', args, undefined, context);
  // Quotes, newlines and emoji lengthen the JSON, so pages must shrink to stay within the cap.
  const long = 'Plan "A"\n🌱 step\\'.repeat(530) + ' TAIL-ONLY marker.', split = text => /[\ud800-\udbff]$/.test(text);
  chat.turns = [prior('long-turn', [], { answer: long }), prior('stopped-turn', [], { status: 'stopped', answer: 'PARTIAL-MARKER' }), prior('failed-turn', [], { status: 'failed', answer: 'FAILED-MARKER' }), turn];
  assert.ok(long.length >= 9000);
  // Character 1,200 falls inside an emoji here, so the excerpt stops one character early rather than splitting it.
  const listed = (await read({ turn_id: 'long-turn' })).turns[0];
  assert.equal(listed.answer.length, 1199); assert.ok(!split(listed.answer)); assert.equal(listed.answer_total_length, long.length); assert.equal(listed.next_answer_offset, 1199);
  let reconstructed = listed.answer, offset = listed.next_answer_offset, pages = 0;
  do {
    const page = await read({ turn_id: 'long-turn', answer_offset: offset }), { access_fingerprint, request_identity, ...bare } = page;
    assert.ok(!page.error); assert.equal(page.answer_offset, offset); assert.equal(page.historical, true); assert.ok(!split(page.answer_text)); assert.ok(JSON.stringify(bare).length <= 6200); assert.ok(JSON.stringify(page).length <= 8000);
    reconstructed += page.answer_text; offset = page.next_answer_offset; pages++;
  } while (offset !== null && pages < 20);
  assert.equal(reconstructed, long); assert.ok(pages > 1);
  const found = await read({ query: 'tail-only' });
  assert.equal(found.matched, 1); assert.equal(found.turns[0].turn_id, 'long-turn'); assert.ok(!JSON.stringify(found).includes('TAIL-ONLY'));
  assert.ok((await read({ turn_id: 'long-turn', answer_offset: found.turns[0].answer_match_offset })).answer_text.startsWith('TAIL-ONLY'));
  for (const marker of ['PARTIAL-MARKER', 'FAILED-MARKER']) assert.equal((await read({ query: marker })).matched, 0);
  for (const turn_id of ['stopped-turn', 'failed-turn', 'missing-turn', 'current-turn']) {
    const refused = await read({ turn_id, answer_offset: 0 });
    assert.equal(refused.error, 'history_answer_not_found'); assert.ok(!/PARTIAL|FAILED/.test(JSON.stringify(refused)));
  }
  assert.equal((await read({ answer_offset: 0 })).error, 'history_answer_not_found');
});

test('saved action markers survive the activity cap after later research', t => {
  const { chat } = workspace(t), turn = current();
  const saved = row('propose_action', { kind: 'proposal', proposal: { kind: 'note', title: 'Remember this save' } }, { applied_href: '/notes/saved', applied: 100 });
  const reads = Array.from({ length: 80 }, (_, i) => row('search_web', { results: [] }, { id: 'later-read-' + i }));
  const bounded = activity([saved, ...reads]); assert.equal(bounded.length, 64);
  assert.ok(bounded.some(event => event.applied_href === '/notes/saved'));
  chat.turns = [prior('saved-turn', bounded), turn]; assert.equal(memoryOf(requestBody(chat, turn)).actions[0].title, 'Remember this save');
});

test('the account sync codec preserves saved-action memory when a stale chat arrives', t => {
  const { store, chat } = workspace(t); chat.turns = [prior('kept-turn')]; store.save(chat);
  const stale = sanitizeObject('chats', store.get(chat.uid));
  store.recordKept(chat.uid, 'kept-turn', 'note', 'Synced note', '/notes/synced');
  const currentValue = sanitizeObject('chats', store.get(chat.uid)); assert.equal(validObject('chats', currentValue), true);
  stale.updated = currentValue.updated + 100;
  const merged = mergeObject('chats', currentValue, stale), restored = { ...merged, turns: merged.turns.map(turn => ({ ...turn, activity: activity(turn.activity) })) };
  assert.equal(memoryOf(requestBody(restored, current())).actions[0].href, '/notes/synced');
});

const coverageOf = body => { const match = body.messages.at(-1).content.match(/<pocket_history_coverage>\n(.*?)\n<\/pocket_history_coverage>/s); return match && JSON.parse(match[1]); };
const chars = messages => messages.reduce((sum, message) => sum + message.content.length, 0);
const alternates = body => body.messages.every((message, i) => message.role === (i % 2 ? 'assistant' : 'user'));

test('a long chat pins its first request and keeps replay, pin and coverage within the budget', t => {
  const { chat } = workspace(t), turn = current();
  chat.turns = [...Array.from({ length: 30 }, (_, i) => prior('turn-' + i, [], { text: (i ? 'Question ' + i : 'FIRST-GOAL-MARKER plan my trip') + ' ' + 'q'.repeat(100), answer: 'a'.repeat(4000) })), turn];
  const body = requestBody(chat, turn), coverage = coverageOf(body);
  assert.ok(alternates(body)); assert.ok(body.messages.length <= 41); assert.ok(chars(body.messages) <= 60000);
  assert.match(body.messages[0].content, /^FIRST-GOAL-MARKER/); assert.equal(body.messages[1].content, 'a'.repeat(4000));
  assert.match(body.messages.at(-3).content, /^Question 29 /); assert.ok(!body.messages.at(-1).content.includes('<pocket_conversation_memory>'));
  assert.equal(coverage.first_request_pinned, true); assert.equal(coverage.replayed_turns, (body.messages.length - 1) / 2); assert.equal(coverage.replayed_turns + coverage.omitted_turns, 30);
  assert.equal(coverage.omitted[0].turn_id, 'turn-' + (30 - coverage.replayed_turns)); assert.ok(body.messages.at(-1).content.endsWith('Current user request:\n' + turn.text));
});

test('the coverage notice lists omitted turns newest first within a hard cap beside conversation memory', t => {
  const { chat } = workspace(t), turn = current();
  const saved = row('propose_action', { kind: 'proposal', proposal: { kind: 'note', title: 'Kept plan' } }, { applied_href: '/notes/kept', applied: 1 });
  chat.turns = [...Array.from({ length: 200 }, (_, i) => prior('turn-' + i, i === 3 ? [saved] : [], { text: 'Request ' + i + ' "quoted"\n' + 'r'.repeat(300), answer: 'a'.repeat(4000), ...(i % 7 ? {} : { status: 'stopped' }) })), turn];
  const body = requestBody(chat, turn), last = body.messages.at(-1).content, coverage = coverageOf(body);
  const block = last.slice(last.indexOf('Replay coverage'), last.indexOf('</pocket_history_coverage>') + '</pocket_history_coverage>'.length);
  assert.ok(block.length <= 2000); assert.match(block, /read_chat_history using its turn_id/); assert.match(block, /answer_offset/);
  assert.ok(coverage.omitted.length > 0 && coverage.unlisted_omitted > 0); assert.equal(coverage.omitted.length + coverage.unlisted_omitted, coverage.omitted_turns); assert.equal(coverage.omitted_turns, 200 - coverage.replayed_turns);
  coverage.omitted.forEach((entry, i) => {
    assert.equal(entry.turn_id, 'turn-' + (200 - coverage.replayed_turns - i)); assert.ok(entry.request.length <= 120 && !entry.request.includes('\n'));
    assert.equal(entry.reply_status, chat.turns.find(item => item.uid === entry.turn_id).status);
  });
  assert.equal(memoryOf(body).actions[0].href, '/notes/kept'); assert.ok(alternates(body)); assert.ok(chars(body.messages) <= 60000);
  assert.match(body.messages[1].content, /^\[No answer: the user stopped this reply/);
});

test('a stopped turn keeps its question, a fixed marker and its prepared line, never its partial', t => {
  const { chat } = workspace(t), turn = current();
  const saved = row('propose_action', { kind: 'proposal', proposal: { kind: 'note', title: 'Trip plan', text: 'Draft' } }, { applied_href: '/notes/trip' });
  chat.turns = [prior('stopped-turn', [saved], { text: 'Plan the trip and save a note', status: 'stopped', answer: 'PARTIAL-ANSWER' }), turn];
  const body = requestBody(chat, turn);
  assert.deepEqual(body.messages.map(message => message.role), ['user', 'assistant', 'user']); assert.equal(body.messages[0].content, 'Plan the trip and save a note');
  assert.equal(body.messages[1].content, '[No answer: the user stopped this reply before it finished; its partial text is not repeated.]\n\n[Pip prepared: note "Trip plan" (saved by the user)]');
  assert.ok(!JSON.stringify(body).includes('PARTIAL-ANSWER')); assert.ok(!body.messages.at(-1).content.includes('<pocket_history_coverage>'));
});

test('an oversized first request is clipped with a pointer to its exact answer offset', t => {
  const { chat } = workspace(t), turn = current(), answer = 'b'.repeat(30000);
  chat.turns = [prior('first-turn', [], { text: 'FIRST-GOAL ' + 'q'.repeat(9000), answer }), ...Array.from({ length: 30 }, (_, i) => prior('turn-' + i, [], { answer: 'a'.repeat(3000) })), turn];
  const body = requestBody(chat, turn), [request, reply] = body.messages, offset = Number(reply.content.match(/turn_id "first-turn" and answer_offset (\d+)\.\]$/)[1]);
  assert.ok(request.content.startsWith('FIRST-GOAL ')); assert.match(request.content, /turn_id "first-turn" and request_offset \d+\.\]$/); assert.ok(request.content.length + reply.content.length <= 12000);
  assert.ok(offset > 1000); assert.equal(reply.content.slice(0, offset), answer.slice(0, offset)); assert.ok(reply.content.slice(offset).startsWith('\n\n[Clipped for length'));
  assert.ok(chars(body.messages) <= 60000); assert.ok(alternates(body));
  chat.turns = [chat.turns[0], turn];
  assert.equal(requestBody(chat, turn).messages[1].content, answer, 'a chat that fits is replayed whole');
});

test('Continue does not replay the turn it continues', async t => {
  const { store, chat } = workspace(t); let body;
  chat.turns = [prior('earlier'), prior('stopped-turn', [], { text: 'Research trains', status: 'stopped', answer: 'UNFINISHED-PARTIAL' })]; store.save(chat);
  const runner = new ReplyRunner(store, { key: () => 'fixture', stream: async (chat, turn, options) => { body = requestBody(chat, turn, options.resume); return { answer: 'Resumed', activity: turn.activity }; } });
  await runner.send(chat.uid, { resume: 'stopped-turn' });
  const history = JSON.stringify(body.messages.slice(0, -1));
  assert.deepEqual(body.messages.map(message => message.role), ['user', 'assistant', 'user']); assert.equal(body.messages[0].content, 'Earlier question');
  assert.ok(!history.includes('Research trains') && !history.includes('UNFINISHED-PARTIAL') && !JSON.stringify(body.messages).includes('[No answer:'));
  assert.match(body.messages.at(-1).content, /^Research trains[\s\S]*explicitly chose Continue/);
});

test('an oversized latest exchange keeps its question and a recoverable answer excerpt', t => {
  const { chat } = workspace(t), turn = current();
  chat.turns = [prior('first', [], { text: 'First goal' }), ...Array.from({ length: 20 }, (_, i) => prior('middle-' + i)), prior('latest', [], { text: 'LATEST QUESTION', answer: 'x'.repeat(58000) }), turn];
  const body = requestBody(chat, turn), preview = contextCoverage(chat, turn), recorded = coverageOf(body);
  assert.equal(body.messages[0].content, 'First goal'); assert.equal(body.messages.at(-3).content, 'LATEST QUESTION');
  assert.match(body.messages.at(-2).content, /turn_id "latest" and answer_offset \d+\.\]$/);
  assert.ok(chars(body.messages) <= 60000); assert.ok(preview.selected_ids.includes('latest')); assert.ok(preview.clipped_ids.includes('latest'));
  assert.equal(preview.replayed, recorded.replayed_turns); assert.equal(preview.omitted, recorded.omitted_turns); assert.deepEqual(preview.clipped_ids, recorded.clipped_turn_ids);
});

test('a large draft reserves history space for both the first goal and latest exchange', t => {
  const { chat } = workspace(t), turn = { ...current(), text: 'd'.repeat(16000), context: Array.from({ length: 3 }, (_, i) => ({ kind: 'note', title: 'Source ' + i, text: 's'.repeat(8000) })) };
  chat.turns = [prior('first', [], { text: 'FIRST GOAL ' + 'q'.repeat(8000), answer: 'a'.repeat(30000) }), prior('latest', [], { text: 'LATEST QUESTION ' + 'q'.repeat(8000), answer: 'a'.repeat(20000) }), turn];
  const body = requestBody(chat, turn), preview = contextCoverage(chat, turn);
  assert.match(body.messages[0].content, /^FIRST GOAL /); assert.match(body.messages.at(-3).content, /^LATEST QUESTION /);
  assert.deepEqual(preview.selected_ids, ['first', 'latest']); assert.deepEqual(preview.clipped_ids, ['first', 'latest']); assert.ok(chars(body.messages) <= 60000);
});

test('clipped original requests and attached snapshots remain exactly recoverable', async t => {
  const { chat } = workspace(t), turn = current(), request = 'FIRST GOAL ' + 'q'.repeat(15000) + ' REQUEST TAIL', attachment = 'ATTACHED SNAPSHOT ' + '🌱'.repeat(3000);
  chat.turns = [prior('first', [], { text: request, answer: 'Short answer', context: [{ kind: 'note', title: 'Snapshot', text: attachment }] }), ...Array.from({ length: 25 }, (_, i) => prior('middle-' + i)), turn];
  const body = requestBody(chat, turn); assert.match(body.messages[0].content, /turn_id "first" and request_offset \d+\.\]$/);
  const context = { chat, turn }; let offset = 0, reconstructed = '';
  do {
    const page = await execute(chat.config, 'read_chat_history', { turn_id: 'first', request_offset: offset }, undefined, context);
    assert.ok(!page.error); assert.ok(page.request_text.length > 0); assert.ok(JSON.stringify(page).length <= 8000);
    reconstructed += page.request_text; assert.ok(page.next_request_offset === null || page.next_request_offset > offset); offset = page.next_request_offset;
  } while (offset !== null);
  assert.equal(reconstructed, request + '\n\nAttached Pocket context:\n--- note: Snapshot ---\n' + attachment);
  const match = await execute(chat.config, 'read_chat_history', { query: 'ATTACHED SNAPSHOT' }, undefined, context);
  assert.equal(match.matched, 1); assert.ok(match.turns[0].request_match_offset > 15000);
});

test('JSON-escaped history pages always advance and reconstruct their complete answers', async t => {
  const { chat } = workspace(t), turn = current(), context = { chat, turn };
  for (const unit of ['\\', '\n', '"\n', '\u0000', '🌱\\']) {
    const answer = unit.repeat(3500); chat.turns = [prior('escaped-answer', [], { answer }), turn];
    let offset = 0, reconstructed = '', pages = 0;
    do {
      const page = await execute(chat.config, 'read_chat_history', { turn_id: 'escaped-answer', answer_offset: offset }, undefined, context);
      assert.ok(!page.error); assert.ok(page.answer_text.length > 0); assert.ok(JSON.stringify(page).length <= 8000);
      reconstructed += page.answer_text; assert.ok(page.next_answer_offset === null || page.next_answer_offset > offset); offset = page.next_answer_offset;
      assert.ok(++pages < 30);
    } while (offset !== null);
    assert.equal(reconstructed, answer);
  }
});

test('escaped history listings retain a readable first match and valid recovery offsets', async t => {
  const { chat } = workspace(t), turn = current();
  chat.turns = [prior('escaped-listing', [], { text: '"\n'.repeat(1000), answer: '"\n'.repeat(600) }), turn];
  const result = await execute(chat.config, 'read_chat_history', { query: '"' }, undefined, { chat, turn });
  assert.equal(result.matched, 1); assert.equal(result.turns.length, 1); assert.equal(result.next_offset, null); assert.ok(JSON.stringify(result).length <= 8000);
  assert.ok(result.turns[0].request.length > 0 && result.turns[0].answer.length > 0);
  const page = await execute(chat.config, 'read_chat_history', { turn_id: 'escaped-listing', request_offset: result.turns[0].next_request_offset }, undefined, { chat, turn });
  assert.ok(page.request_text.length > 0); assert.equal(result.turns[0].request + page.request_text, chat.turns[0].text);
});

test('an arbitrary history offset inside an emoji normalizes to its full character', async t => {
  const { chat } = workspace(t), turn = current(); chat.turns = [prior('emoji', [], { answer: '🌱Hello' }), turn];
  const page = await execute(chat.config, 'read_chat_history', { turn_id: 'emoji', answer_offset: 1 }, undefined, { chat, turn });
  assert.equal(page.answer_offset, 0); assert.equal(page.answer_text, '🌱Hello'); assert.equal(page.next_answer_offset, null);
});

test('older history continuation offsets stay usable beyond two thousand turns', async t => {
  const { chat } = workspace(t), turn = current(), context = { chat, turn };
  chat.turns = [...Array.from({ length: 2005 }, (_, i) => prior('turn-' + i)), turn];
  const first = await execute(chat.config, 'read_chat_history', { offset: 2000, limit: 2 }, undefined, context);
  assert.equal(first.next_offset, 2002);
  const next = await execute(chat.config, 'read_chat_history', { offset: first.next_offset, limit: 2 }, undefined, context);
  assert.ok(!next.error); assert.deepEqual(next.turns.map(item => item.turn_id), ['turn-2', 'turn-1']);
  const last = await execute(chat.config, 'read_chat_history', { offset: next.next_offset, limit: 2 }, undefined, context);
  assert.deepEqual(last.turns.map(item => item.turn_id), ['turn-0']); assert.equal(last.next_offset, null);
});

test('last-request usage includes Anthropic cache tokens and does not reuse earlier round totals', async t => {
  const { chat } = workspace(t); chat.turns = [prior('first')];
  for (const reported of [true, false]) {
    let requests = 0;
    const result = await streamReply(chat, current(), { key: 'fixture', fetcher: async () => {
      const usage = ++requests === 1 ? { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 30 } : reported ? { input_tokens: 7, cache_read_input_tokens: 9, cache_creation_input_tokens: 11 } : null;
      return response(anthropicMessage({ usage: usage || { input_tokens: 0 }, ...(requests === 1 ? { calls: [{ name: 'update_plan', input: { steps: [{ text: 'Answer the question', status: 'done' }] } }] } : { text: 'Finished' }) }));
    } });
    assert.equal(requests, 2); assert.equal(result.usage.input_tokens, reported ? 17 : 10);
    assert.equal(result.usage.last_input_tokens, reported ? 27 : 0); assert.equal(result.usage.last_output_tokens, 8);
    assert.deepEqual(result.usage.history_replay.selected_ids, ['first']); assert.equal(result.usage.history_replay.total, 1);
  }
});
