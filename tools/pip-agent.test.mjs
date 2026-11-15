import test from 'node:test';
import assert from 'node:assert/strict';
import { streamChat, MAX_REQUESTS } from '../src/server/pip-agent.js';
import { config, DEFAULT_CONFIG } from '../src/client/pip-core.js';
import { segmentAnswer } from '../src/shared/pip-reply.js';
import { anthropicMessage, compatibleMessage, event, response, systemText } from './pip-provider-fixtures.mjs';

// The server loop runs the real OpenClaw Agent and the real transport against provider HTTP fixtures: a recording
// fetcher answers each model request in turn.

const value = config({ ...DEFAULT_CONFIG, provider: 'compatible', baseUrl: 'https://model.example/v1', model: 'fixture-model' });
const input = { kind: 'note', title: 'One', text: 'First note' };
const call = text => compatibleMessage({ calls: [{ id: 'reused', name: 'create_record', input: { ...input, text } }] });
const CHART = { root: 'main', elements: [
  { id: 'main', type: 'Stack', props: { direction: 'vertical' }, children: ['km'] },
  { id: 'km', type: 'Chart', props: { kind: 'line', title: 'Weekly distance', unit: 'km', data: [{ label: 'W1', value: 22 }, { label: 'W2', value: 26 }] }, children: [] }] };
const frame = (delta, finish = null) => event({ id: 'chatcmpl_fixture', object: 'chat.completion.chunk', created: 1791500000, model: 'fixture-model', choices: [{ index: 0, delta, finish_reason: finish }] });
const lookup = (id, query) => compatibleMessage({ calls: [{ name: 'read_chat_history', input: { query }, id }] });
const plan = id => compatibleMessage({ calls: [{ name: 'update_plan', input: { steps: [{ text: 'Answer', status: 'active' }] }, id }] });
/** A recording fetcher: each request body is kept, each reply is the next wire (or a function of the request). */
const provider = (sent, ...replies) => async (_url, request) => {
  const body = JSON.parse(request.body); sent.push(body);
  assert.ok(replies.length, 'the fixture expected no further request');
  const next = replies.shift();
  return typeof next === 'function' ? next(body, request) : response(next);
};
/** A stream that sends its first bytes and then nothing more, until the request is aborted. */
const stall = (wire = '') => (_body, request) => new Response(new ReadableStream({ start(controller) {
  if (wire) controller.enqueue(new TextEncoder().encode(wire));
  request.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
} }), { headers: { 'content-type': 'text/event-stream' } });
const setup = (tools, fields = {}) => {
  const chat = { uid: 'chat', config: value, turns: [] }, turn = { uid: 'turn-' + Math.random().toString(36).slice(2), text: 'Question', ...fields };
  const updates = [];
  return { chat, turn, updates, options: { value, key: 'fixture', onUpdate: update => updates.push(update), body: { instructions: 'Answer.', tools, messages: [{ role: 'user', content: turn.text }] },
    executeTool: async (_value, name, args) => name === 'read_chat_history' ? { kind: 'history', results: [{ title: 'Earlier', text: 'Found ' + (args.query || '') }] } : (await import('../src/client/pip-tools.js')).execute(_value, name, args) } };
};
const toolResults = body => body.messages.filter(m => m.role === 'tool').map(m => String(m.content));

test('OpenClaw requires a new approval when a later assistant turn reuses a provider call id', async () => {
  const chat = { uid: 'chat', config: value, turns: [] }, turn = { uid: 'turn', text: 'Save two notes' };
  let checkpoint, writes = [], messages = [];
  const options = {
    value, key: 'fixture', body: { instructions: 'Save the requested notes.', tools: ['create_record'], messages: [{ role: 'user', content: turn.text }] },
    previewTool: async (_value, _name, args) => ({ action: { kind: 'note', title: args.title } }),
    executeTool: async (_value, _name, args, _signal, context) => { writes.push({ text: args.text, eventId: context.eventId }); return { kind: 'action', action: { status: 'saved', title: args.title, href: '/notes/saved' } }; },
    fetcher: async (_url, request) => { messages.push(JSON.parse(request.body)); return response(call(messages.length === 1 ? 'First note' : 'Second note')); },
    durable: { pause: async state => { checkpoint = structuredClone(state); } },
  };
  await assert.rejects(streamChat(chat, turn, options), { name: 'RunPaused' });
  assert.equal(writes.length, 0);
  const first = checkpoint;
  await assert.rejects(streamChat(chat, turn, { ...options, durable: { ...options.durable, checkpoint: first, settled: new Map([['reused', { approved: true }]]) } }), { name: 'RunPaused' });
  assert.deepEqual(writes.map(w => w.text), ['First note']);
  assert.equal(checkpoint.pending[0].input.text, 'Second note');
  assert.notEqual(checkpoint.pending[0].rowId, writes[0].eventId);
});

// 1, 10: each request has the reply limit as its cap; the ceiling ends a runaway with what it has.
test('every request has the same output cap, and a reply ends at the request ceiling with its card, its text and a notice', async () => {
  const { chat, turn, updates, options } = setup(['show_card', 'update_plan']), sent = [];
  const first = compatibleMessage({ text: 'Here is the chart.', calls: [{ name: 'show_card', input: CHART, id: 'call_card' }] });
  await assert.rejects(streamChat(chat, turn, { ...options, fetcher: provider(sent, first, ...Array.from({ length: 20 }, (_, i) => plan('plan_' + i))) }), /limit of 12 model requests/);
  assert.equal(sent.length, MAX_REQUESTS);
  assert.ok(sent.every(body => body.max_tokens === value.maxTokens), 'max_tokens ' + sent.map(body => body.max_tokens));
  assert.match(systemText(sent.at(-1)), /this is the last model request this reply may make/);
  assert.doesNotMatch(systemText(sent.at(-2)), /last model request/);
  const last = updates.at(-1);
  assert.equal(last.phase, 'failed');
  assert.match(last.answer, /^Here is the chart\./);
  assert.equal(segmentAnswer(last.answer).filter(s => s.kind === 'card').length, 1);
  assert.match(last.answer, /limit of 12 model requests\. Continue when you’re ready\./);
  assert.ok(last.activity.every(row => !['queued', 'running', 'awaiting'].includes(row.state)));
});

// 2: a cut-off message is written again; past two in a row the reply keeps its partial text.
test('a reply cut at the reply limit is written again, and the cut-off text becomes working notes', async () => {
  const { chat, turn, options } = setup([]), sent = [];
  const result = await streamChat(chat, turn, { ...options, fetcher: provider(sent, compatibleMessage({ text: 'Half an ans', finish: 'length' }), compatibleMessage({ text: 'Finished.' })) });
  assert.equal(sent.length, 2);
  assert.equal(result.answer, 'Finished.');
  assert.match(result.reasoning, /Half an ans/);
  // The truncated message is not sent back: the model writes the answer again.
  assert.ok(!JSON.stringify(sent[1].messages).includes('Half an ans'));
});

test('a model that always overruns ends after two retries with its partial text and the notice', async () => {
  const { chat, turn, updates, options } = setup([]), sent = [];
  const cut = text => compatibleMessage({ text, finish: 'length' });
  await assert.rejects(streamChat(chat, turn, { ...options, fetcher: provider(sent, cut('One'), cut('Two'), cut('The partial answer')) }), /reply limit per message was reached/);
  assert.equal(sent.length, 3);
  const last = updates.at(-1);
  assert.equal(last.phase, 'failed');
  assert.match(last.answer, /^The partial answer\n\nThe reply limit per message was reached\. Continue when you’re ready\./);
});

test('a message cut off in the middle of a tool call is dropped and asked again', async () => {
  const { chat, turn, options } = setup(['read_chat_history']), sent = [];
  const cut = frame({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_cut', type: 'function', function: { name: 'read_chat_history', arguments: '{"que' } }] }) + frame({}, 'length') + 'data: [DONE]\r\n\r\n';
  const result = await streamChat(chat, turn, { ...options, fetcher: provider(sent, cut, compatibleMessage({ text: 'Answered.' })) });
  assert.equal(result.answer, 'Answered.');
  assert.ok(!result.activity.some(row => row.state === 'queued' || row.state === 'running'));
});

// 3: deadline and silence finish with the partial answer; the person's stop is a stop.
test('the research deadline keeps the partial answer and says so', async () => {
  const { chat, turn, updates, options } = setup([]), sent = [];
  await assert.rejects(streamChat(chat, turn, { ...options, deadlineMs: 150, fetcher: provider(sent, stall(frame({ role: 'assistant', content: 'Partial answer' }))) }), /five-minute research deadline was reached/);
  const last = updates.at(-1);
  assert.equal(last.phase, 'failed');
  assert.match(last.answer, /^Partial answer\n\nThe five-minute research deadline was reached/);
});

test('a silent provider ends the reply with the idle message and the partial answer', async () => {
  const { chat, turn, updates, options } = setup([]), sent = [];
  await assert.rejects(streamChat(chat, turn, { ...options, timeoutMs: 100, fetcher: provider(sent, stall(frame({ role: 'assistant', content: 'Partial answer' }))) }), /stopped responding for 90 seconds/);
  assert.match(updates.at(-1).answer, /^Partial answer\n\nThe provider stopped responding/);
});

test('stopping the reply is a stop, not a deadline', async () => {
  const { chat, turn, options } = setup([]), sent = [], stop = new AbortController();
  const running = streamChat(chat, turn, { ...options, signal: stop.signal, onUpdate: update => { if (update.answer.includes('Partial')) stop.abort(); }, fetcher: provider(sent, stall(frame({ role: 'assistant', content: 'Partial answer' }))) });
  await assert.rejects(running, error => error.name === 'AbortError' && error.message === 'Stopped');
});

test('time spent waiting for an approval counts against neither the deadline nor the idle limit', async () => {
  const { chat, turn, options } = setup(['create_record']), sent = [];
  const result = await streamChat(chat, turn, { ...options, deadlineMs: 200, timeoutMs: 100,
    previewTool: async (_value, _name, args) => ({ action: { kind: 'note', title: args.title } }),
    approve: async requests => { await new Promise(resolve => setTimeout(resolve, 300)); return new Map(requests.map(r => [r.toolCallId, { approved: true }])); },
    executeTool: async (_value, name, args) => ({ kind: 'action', action: { tool: name, title: args.title, status: 'saved', href: '/notes/one' } }),
    fetcher: provider(sent, compatibleMessage({ calls: [{ name: 'create_record', input, id: 'call_write' }] }), compatibleMessage({ text: 'Saved.' })) });
  assert.equal(result.answer, 'Saved.');
});

// 4: retries show.
test('a busy provider shows that it is retrying', async () => {
  const { chat, turn, updates, options } = setup([]), sent = [];
  const busy = () => new Response(JSON.stringify({ error: { message: 'busy' } }), { status: 503, headers: { 'content-type': 'application/json' } });
  const result = await streamChat(chat, turn, { ...options, fetcher: provider(sent, busy, compatibleMessage({ text: 'Done.' })) });
  assert.equal(result.answer, 'Done.');
  assert.ok(updates.some(update => update.phase === 'provider busy · retrying'));
});

// The regression that started the migration: cards stay drawable once lookups are refused.
test('after research stops, a lookup is refused with a result and a card is still drawn', async () => {
  const { chat, turn, options } = setup(['read_chat_history', 'show_card']), sent = [];
  const result = await streamChat(chat, turn, { ...options, research: { enough: async () => true }, fetcher: provider(sent,
    lookup('call_1', 'distance'), lookup('call_2', 'more distance'),
    compatibleMessage({ text: 'Your weeks:', calls: [{ name: 'show_card', input: CHART, id: 'call_card' }] }),
    compatibleMessage({ text: 'Keep week three easy.' })) });
  const rows = result.activity.filter(row => row.name === 'read_chat_history');
  assert.deepEqual(rows.map(row => row.state), ['done', 'failed']);
  assert.match(rows[1].result, /research_budget_reached/);
  assert.match(toolResults(sent[2]).at(-1), /cards, plans and approved saves remain available/);
  assert.ok(sent[2].tools.some(tool => tool.function.name === 'show_card'), 'show_card is still offered');
  assert.match(systemText(sent[2]), /the app has stopped research.*still drawn by calling show_card/s);
  assert.deepEqual(segmentAnswer(result.answer).map(s => s.kind), ['prose', 'card', 'prose']);
});

test('a card stand-in written as text never reaches the stored answer', async () => {
  const { chat, turn, options } = setup(['show_card']), sent = [];
  const result = await streamChat(chat, turn, { ...options, fetcher: provider(sent, compatibleMessage({ text: 'Prices below.\n\n[card: Table “Prices”]\n\nThat is all.' })) });
  assert.doesNotMatch(result.answer, /\[card/);
  assert.match(result.answer, /Prices below\.[\s\S]*That is all\./);
});

// 5: thinking streams into reasoning; text before a lookup is working notes; text up to a card stays.
test('thinking streams into the reasoning, and text before a lookup becomes working notes while text up to a card stays', async () => {
  const { chat, turn, updates, options } = setup(['read_chat_history', 'show_card']), sent = [];
  const result = await streamChat(chat, turn, { ...options, fetcher: provider(sent,
    compatibleMessage({ text: 'First the chart.', calls: [{ name: 'show_card', input: CHART, id: 'call_card' }], delta: { reasoning_content: 'Weighing the weeks.' } }),
    compatibleMessage({ text: 'Let me check the history too.', calls: [{ name: 'read_chat_history', input: { query: 'runs' }, id: 'call_history' }] }),
    compatibleMessage({ text: 'Nothing earlier to compare with.' })) });
  assert.match(result.reasoning, /Weighing the weeks\./);
  assert.match(result.reasoning, /Let me check the history too\./);
  assert.ok(updates.some(update => update.phase === 'thinking'));
  assert.deepEqual(segmentAnswer(result.answer).map(s => s.kind), ['prose', 'card', 'prose']);
  assert.match(result.answer, /^First the chart\./);
  assert.doesNotMatch(result.answer, /Let me check/);
});

// 6: a card builds on screen while its arguments stream.
test('while a card is written, its complete elements are on screen, and never anything invalid', async () => {
  const { chat, turn, updates, options } = setup(['show_card']);
  const args = JSON.stringify(CHART), parts = [args.slice(0, 40), args.slice(40, 140), args.slice(140)];
  const wire = frame({ role: 'assistant', content: 'Your weeks:' })
    + frame({ tool_calls: [{ index: 0, id: 'call_card', type: 'function', function: { name: 'show_card', arguments: parts[0] } }] })
    + frame({ tool_calls: [{ index: 0, function: { arguments: parts[1] } }] })
    + frame({ tool_calls: [{ index: 0, function: { arguments: parts[2] } }] })
    + frame({}, 'tool_calls') + event({ id: 'chatcmpl_fixture', object: 'chat.completion.chunk', created: 1791500000, model: 'fixture-model', choices: [], usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 } }) + 'data: [DONE]\r\n\r\n';
  const replies = [wire, compatibleMessage({ text: 'Done.' })];
  const result = await streamChat(chat, turn, { ...options, fetcher: async () => response(replies.shift(), 4096) });
  const drafts = updates.map(u => u.answer).filter(answer => /```pocket\n/.test(answer) && !/\n```\n/.test(answer));
  assert.ok(drafts.some(answer => answer.includes('/elements/main')), 'the first element showed before the card was finished');
  for (const answer of updates.map(u => u.answer)) for (const segment of segmentAnswer(answer).filter(item => item.kind === 'card'))
    for (const line of segment.source.split('\n').filter(Boolean)) assert.doesNotThrow(() => JSON.parse(line));
  assert.equal(segmentAnswer(result.answer).filter(s => s.kind === 'card').length, 1);
});

// 7: saved writes, repeated failures, cache, a throwing tool.
test('an already-saved write is refused without asking for approval again', async () => {
  const saved = { id: 'turn:0:old', name: 'create_record', state: 'done', input: JSON.stringify(input), result: '{}', applied_href: '/notes/one', started: 1, ended: 2 };
  const { chat, turn, options } = setup(['create_record'], { activity: [saved] }), sent = [];
  let paused = 0, writes = 0;
  const result = await streamChat(chat, turn, { ...options, durable: { pause: async () => { paused++; } },
    previewTool: async (_value, _name, args) => ({ action: { kind: 'note', title: args.title } }),
    executeTool: async () => { writes++; return { kind: 'action', action: { status: 'saved', href: '/notes/two' } }; },
    fetcher: provider(sent, compatibleMessage({ calls: [{ name: 'create_record', input, id: 'call_again' }] }), compatibleMessage({ text: 'It is already saved.' })) });
  assert.equal(paused, 0); assert.equal(writes, 0);
  assert.equal(result.answer, 'It is already saved.');
  assert.match(toolResults(sent[1])[0], /existing_proposal/);
  assert.equal(JSON.parse(result.activity.at(-1).result).kind, 'existing_proposal');
});

test('an identical failed lookup is answered from its failure, and an identical lookup from cache', async () => {
  const { chat, turn, options } = setup(['read_chat_history']), sent = [];
  let executions = 0;
  const result = await streamChat(chat, turn, { ...options, executeTool: async (_value, _name, args) => { executions++; return args.query === 'bad' ? { error: 'history_unavailable', message: 'Unavailable' } : { kind: 'history', results: [] }; },
    fetcher: provider(sent, lookup('a', 'good'), lookup('b', 'good'), lookup('c', 'bad'), lookup('d', 'bad'), compatibleMessage({ text: 'Done.' })) });
  assert.equal(executions, 2);
  const answers = result.activity.map(row => JSON.parse(row.result));
  assert.equal(answers[1].cached, true);
  assert.equal(answers[3].repeated, true);
  // Repeats cost nothing and end nothing here: going round in circles is OpenClaw's loop guard to decide.
  assert.doesNotMatch(systemText(sent[4]), /stopped research/);
});

test('a tool that throws becomes a tool result, not a failed reply', async () => {
  const { chat, turn, options } = setup(['read_chat_history']), sent = [];
  const result = await streamChat(chat, turn, { ...options, executeTool: async () => { throw new Error('database down'); },
    fetcher: provider(sent, lookup('call_1', 'x'), compatibleMessage({ text: 'The history could not be read.' })) });
  assert.equal(result.answer, 'The history could not be read.');
  assert.match(toolResults(sent[1])[0], /data_unavailable/);
  assert.equal(result.activity[0].state, 'failed');
});

test('invalid tool arguments become a tool error', async () => {
  const { chat, turn, options } = setup(['create_record']), sent = [];
  const result = await streamChat(chat, turn, { ...options, approve: async () => new Map(),
    fetcher: provider(sent, compatibleMessage({ calls: [{ name: 'create_record', input: { kind: 'nonsense' }, id: 'call_bad' }] }), compatibleMessage({ text: 'Could not save it.' })) });
  assert.equal(result.answer, 'Could not save it.');
  assert.equal(result.activity[0].state, 'failed');
});

// 8: usage as the old loop recorded it.
test('usage records cache tokens and the last request as the old loop did', async () => {
  const anthropic = config({ ...DEFAULT_CONFIG, provider: 'anthropic' }), sent = [];
  const { chat, turn, options } = setup(['update_plan']);
  const result = await streamChat(chat, turn, { ...options, value: anthropic, fetcher: provider(sent,
    anthropicMessage({ usage: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 30 }, calls: [{ name: 'update_plan', input: { steps: [{ text: 'Answer', status: 'done' }] } }] }),
    anthropicMessage({ usage: { input_tokens: 7, cache_read_input_tokens: 9, cache_creation_input_tokens: 11 }, text: 'Finished' })) });
  assert.equal(result.usage.input_tokens, 17);
  assert.equal(result.usage.cache_read_input_tokens, 29);
  assert.equal(result.usage.cache_creation_input_tokens, 41);
  assert.equal(result.usage.last_input_tokens, 27);
  assert.equal(result.usage.last_output_tokens, 8);
});

// 9: a failed reply publishes a settled final state before it throws.
test('a provider failure publishes the partial answer with every row settled', async () => {
  const { chat, turn, updates, options } = setup(['read_chat_history']), sent = [];
  const broken = () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(frame({ role: 'assistant', content: 'Partly', tool_calls: [{ index: 0, id: 'call_x', type: 'function', function: { name: 'read_chat_history', arguments: '{"qu' } }] })));
    setTimeout(() => controller.error(new Error('connection reset')), 10);
  } }), { headers: { 'content-type': 'text/event-stream' } });
  await assert.rejects(streamChat(chat, turn, { ...options, fetcher: provider(sent, broken) }));
  const last = updates.at(-1);
  assert.equal(last.phase, 'failed');
  assert.ok(last.activity.length >= 1);
  assert.ok(last.activity.every(row => !['queued', 'running', 'awaiting'].includes(row.state)), JSON.stringify(last.activity));
});

// 11: durable batches with several writes.
test('a batch of two writes waits until both are settled, and an invalid edit is a tool error', async () => {
  const { chat, turn, options } = setup(['create_record']), sent = [];
  let checkpoint, writes = [];
  const durableOptions = { ...options, previewTool: async (_value, _name, args) => ({ action: { kind: 'note', title: args.title } }),
    executeTool: async (_value, name, args) => { writes.push(args.title); return { kind: 'action', action: { tool: name, title: args.title, status: 'saved', href: '/notes/' + args.title } }; } };
  const two = compatibleMessage({ calls: [{ name: 'create_record', input: { ...input, title: 'A' }, id: 'call_a' }, { name: 'create_record', input: { ...input, title: 'B' }, id: 'call_b' }] });
  await assert.rejects(streamChat(chat, turn, { ...durableOptions, fetcher: provider(sent, two), durable: { pause: async state => { checkpoint = structuredClone(state); } } }), { name: 'RunPaused' });
  assert.deepEqual(checkpoint.pending.map(item => item.toolCallId), ['call_a', 'call_b']);
  // Only one is settled: the run pauses again as it was, and nothing is written.
  let again;
  await assert.rejects(streamChat(chat, turn, { ...durableOptions, fetcher: provider(sent), durable: { checkpoint, settled: new Map([['call_a', { approved: true }]]), pause: async state => { again = structuredClone(state); } } }), { name: 'RunPaused' });
  assert.equal(writes.length, 0);
  assert.deepEqual(again.pending.map(item => item.toolCallId), ['call_a', 'call_b']);
  const result = await streamChat(chat, turn, { ...durableOptions, fetcher: provider(sent, compatibleMessage({ text: 'Saved A.' })),
    durable: { checkpoint: again, settled: new Map([['call_a', { approved: true }], ['call_b', { approved: true, input: { kind: 'nonsense' } }]]), pause: async () => { throw new Error('no pause expected'); } } });
  assert.deepEqual(writes, ['A']);
  assert.equal(result.answer, 'Saved A.');
  assert.match(toolResults(sent.at(-1)).join('\n'), /invalid_arguments/);
});

test('a device tool the device did not answer is a result the model hears', async () => {
  const { chat, turn, options } = setup(['read_chat_history']), sent = [];
  const result = await streamChat(chat, turn, { ...options, deviceTools: ['read_chat_history'], approve: async requests => new Map(requests.map(r => [r.toolCallId, { approved: false }])),
    fetcher: provider(sent, lookup('call_device', 'x'), compatibleMessage({ text: 'The device did not answer.' })) });
  assert.equal(result.answer, 'The device did not answer.');
  assert.match(toolResults(sent[1])[0], /device_unavailable/);
});

// Going round in circles is decided by OpenClaw's loop detection, not counted by Pocket. Its module needs the Node
// version the server runs on, so on an older local Node this is skipped (and lookups run unguarded, as logged).
test('OpenClaw’s loop guard warns about and then blocks a lookup repeated without progress, and research ends', { skip: Number(process.versions.node.split('.')[0]) < 24 && 'OpenClaw’s harness runtime needs Node 24' }, async () => {
  const { chat, turn, options } = setup(['read_chat_history']), sent = [];
  const same = count => compatibleMessage({ calls: Array.from({ length: count }, (_, index) => ({ name: 'read_chat_history', input: { query: 'again' }, id: 'call_same_' + count + '_' + index })) });
  const result = await streamChat({ ...chat, uid: 'chat-loop-guard' }, { ...turn, uid: 'turn-loop-guard' }, { ...options, // The guard decides when a call is admitted, and a message's lookups are admitted together: the repeats must
  // span several messages for it to have seen their outcomes.
    fetcher: provider(sent, same(7), same(8), same(9), same(10), compatibleMessage({ text: 'I kept asking the same thing.' })) });
  const results = toolResults(sent[4]).join('\n');
  assert.match(results, /Tool-loop warning after \d+ repeated calls/);
  assert.match(results, /CRITICAL: Called read_chat_history with identical outcomes \d+ times/);
  assert.match(systemText(sent[4]), /the app has stopped research.*The same lookup was repeated without progress/s);
  assert.equal(result.answer, 'I kept asking the same thing.');
});
