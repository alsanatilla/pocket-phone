import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransport, toCore, toSdk } from '../src/server/pip-agent-transport.js';
import { config, DEFAULT_CONFIG } from '../src/client/pip-core.js';
import { compatibleMessage, anthropicMessage, response, event } from './pip-provider-fixtures.mjs';

globalThis.AI_SDK_LOG_WARNINGS = false;
const compatible = config({ ...DEFAULT_CONFIG, provider: 'compatible', baseUrl: 'https://model.example/v1', model: 'fixture-model' });
const anthropic = config({ ...DEFAULT_CONFIG, provider: 'anthropic', model: 'claude-fixture', thinking: true });
const modelOf = value => ({ id: value.model, name: value.model, api: 'pocket-transport', provider: value.provider, baseUrl: value.baseUrl, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: value.maxTokens });
const tools = [{ name: 'lookup', description: 'Look something up.', parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } }];
const user = { role: 'user', content: 'Find it', timestamp: 1 };

// A fake provider: answers each request with the next wire (or Response) and records the request bodies.
function provider(...wires) {
  const bodies = [];
  return { bodies, fetcher: async (_url, request) => { bodies.push(JSON.parse(request.body)); const next = wires.shift(); return next instanceof Response ? next : response(next); } };
}
async function run(value, fake, messages, options = {}) {
  const transport = await createTransport(value, 'fixture-key', { fetcher: fake.fetcher, ...options });
  const stream = transport(modelOf(value), { systemPrompt: 'Be brief.', messages, tools }), events = [];
  for await (const item of stream) events.push(item);
  return { events, message: await stream.result() };
}
const result = (call, text = 'found') => ({ role: 'toolResult', toolCallId: call.id, toolName: call.name, content: [{ type: 'text', text }], isError: false, timestamp: 2 });

test('OpenAI-compatible thinking goes back as reasoning_content within the tool loop', async () => {
  const fake = provider(compatibleMessage({ delta: { reasoning_content: 'Check the notes first.' }, calls: [{ id: 'call_1', name: 'lookup', input: { q: 'notes' } }] }), compatibleMessage({ text: 'Done.' }));
  const first = await run(compatible, fake, [user]);
  assert.equal(first.message.stopReason, 'toolUse');
  assert.deepEqual(first.message.content.map(p => p.type), ['thinking', 'toolCall']);
  assert.ok(first.events.some(e => e.type === 'thinking_delta' && e.delta === 'Check the notes first.'));
  const call = first.message.content[1];
  const second = await run(compatible, fake, [user, first.message, result(call)]);
  assert.equal(second.message.content[0].text, 'Done.');
  const assistant = fake.bodies[1].messages.find(m => m.role === 'assistant');
  assert.equal(assistant.reasoning_content, 'Check the notes first.');
  assert.equal(assistant.tool_calls[0].id, 'call_1');
});

test('Anthropic thinking keeps its signature, and redacted thinking its data, into the next request', async () => {
  const redacted = [{ type: 'message_start', message: { id: 'msg_2', role: 'assistant', model: 'claude-fixture', content: [], usage: { input_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 7 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'redacted_thinking', data: 'opaque-data' } }, { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_2', name: 'lookup', input: {} } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"q":"more"}' } }, { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } }, { type: 'message_stop' }].map(event).join('');
  const fake = provider(anthropicMessage({ reasoning: 'Look it up.', signature: 'sig-1', calls: [{ id: 'toolu_1', name: 'lookup', input: { q: 'notes' } }] }), redacted, anthropicMessage({ text: 'Done.' }));
  const first = await run(anthropic, fake, [user]);
  const thinking = first.message.content[0];
  assert.equal(thinking.thinking, 'Look it up.'); assert.equal(thinking.thinkingSignature, 'sig-1');
  const second = await run(anthropic, fake, [user, first.message, result(first.message.content[1])]);
  assert.deepEqual(fake.bodies[1].messages[1].content[0], { type: 'thinking', thinking: 'Look it up.', signature: 'sig-1' });
  assert.equal(second.message.content[0].redacted, true);
  assert.equal(second.message.usage.cacheRead, 100); assert.equal(second.message.usage.cacheWrite, 7); assert.equal(second.message.usage.input, 5);
  assert.equal(second.message.usage.totalTokens, 5 + 100 + 7 + 9); assert.equal(second.message.usage.pocket.inputTokens, 112);
  // A checkpoint is structured-cloned between requests; the thinking must survive that too.
  const transcript = structuredClone([user, first.message, result(first.message.content[1]), second.message, result(second.message.content[1])]);
  await run(anthropic, fake, transcript);
  const replay = fake.bodies[2].messages.filter(m => m.role === 'assistant');
  assert.deepEqual(replay[0].content[0], { type: 'thinking', thinking: 'Look it up.', signature: 'sig-1' });
  assert.deepEqual(replay[1].content[0], { type: 'redacted_thinking', data: 'opaque-data' });
});

test('A busy provider is retried after onRetry, not reported as unreachable', async () => {
  const busy = new Response('{"error":{"message":"overloaded"}}', { status: 429, headers: { 'content-type': 'application/json', 'retry-after-ms': '1' } });
  const fake = provider(busy, compatibleMessage({ text: 'Here.' }));
  let retries = 0, ticks = 0;
  const { message } = await run(compatible, fake, [user], { onRetry: () => retries++, clock: () => ticks++ });
  assert.equal(message.stopReason, 'stop', message.errorMessage);
  assert.equal(message.content[0].text, 'Here.');
  assert.equal(fake.bodies.length, 2); assert.equal(retries, 1); assert.ok(ticks > 1);
});

test('maxOutputTokens is read at every request when it is a function', async () => {
  const fake = provider(compatibleMessage({ text: 'a' }), compatibleMessage({ text: 'b' }));
  const left = [900, 250];
  const transport = await createTransport(compatible, 'k', { fetcher: fake.fetcher, maxOutputTokens: () => left.shift() });
  for (let i = 0; i < 2; i++) await transport(modelOf(compatible), { messages: [user], tools: [] }).result();
  assert.deepEqual(fake.bodies.map(b => b.max_tokens), [900, 250]);
  const fixed = provider(compatibleMessage({ text: 'c' }));
  await (await createTransport(compatible, 'k', { fetcher: fixed.fetcher }))(modelOf(compatible), { messages: [user] }).result();
  assert.equal(fixed.bodies[0].max_tokens, compatible.maxTokens);
});

test('Tool arguments stream as deltas before one toolcall_end with the parsed arguments', async () => {
  const wire = [{ type: 'message_start', message: { id: 'msg', role: 'assistant', model: 'claude-fixture', content: [], usage: { input_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_s', name: 'lookup', input: {} } },
    ...['{"q":', '"stre', 'amed"}'].map(partial_json => ({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json } })),
    { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 } }, { type: 'message_stop' }].map(event).join('');
  const seen = [];
  const transport = await createTransport({ ...anthropic, thinking: false }, 'k', { fetcher: provider(wire).fetcher });
  const stream = transport(modelOf(anthropic), { messages: [user], tools });
  for await (const e of stream) if (e.type.startsWith('toolcall')) seen.push({ type: e.type, delta: e.delta, json: e.partial.content[e.contentIndex].partialJson, args: e.toolCall?.arguments });
  assert.deepEqual(seen.map(e => e.type), ['toolcall_start', 'toolcall_delta', 'toolcall_delta', 'toolcall_delta', 'toolcall_end']);
  assert.equal(seen.filter(e => e.delta).map(e => e.delta).join(''), '{"q":"streamed"}');
  assert.deepEqual(seen.at(-1).args, { q: 'streamed' });
  const message = await stream.result();
  assert.equal('partialJson' in message.content[0], false);
  assert.equal(message.stopReason, 'toolUse');
});

test('A tool call written as text (textToolCalls) still streams once and ends once', async () => {
  const fake = provider(compatibleMessage({ text: 'Looking. <tool_call>{"name":"lookup","arguments":{"q":"text"}}</tool_call>' }));
  const { events, message } = await run(compatible, fake, [user]);
  const calls = events.filter(e => e.type.startsWith('toolcall'));
  assert.deepEqual(calls.map(e => e.type), ['toolcall_start', 'toolcall_delta', 'toolcall_end']);
  assert.deepEqual(JSON.parse(calls[1].delta), { q: 'text' });
  assert.deepEqual(calls[2].toolCall.arguments, { q: 'text' });
  assert.equal(message.stopReason, 'toolUse');
  assert.equal(message.content.find(p => p.type === 'text').text.trim(), 'Looking.');
});

test('A content filter finish is an error saying the provider declined', async () => {
  const { events, message } = await run(compatible, provider(compatibleMessage({ text: 'I', finish: 'content_filter' })), [user]);
  assert.equal(message.stopReason, 'error');
  assert.equal(message.errorMessage, 'The provider declined this reply.');
  assert.equal(events.at(-1).type, 'error');
});

test('A length finish stays length and keeps the partial text; a cut-off call is dropped', async () => {
  const wire = event({ id: 'c', object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'Partial answer', tool_calls: [{ index: 0, id: 'call_cut', type: 'function', function: { name: 'lookup', arguments: '{"q":"unfin' } }] }, finish_reason: 'length' }] }) + 'data: [DONE]\r\n\r\n';
  const { events, message } = await run(compatible, provider(wire), [user]);
  assert.equal(events.at(-1).type, 'done'); assert.equal(message.stopReason, 'length');
  assert.equal(message.content[0].text, 'Partial answer');
  assert.equal(message.content.some(p => p.type === 'toolCall' && 'partialJson' in p), false);
});

test('An aborted request stays aborted', async () => {
  const controller = new AbortController(); controller.abort();
  const { message } = await run(compatible, provider(compatibleMessage({ text: 'x' })), [user], { signal: controller.signal });
  assert.equal(message.stopReason, 'aborted');
});

test('No empty assistant message reaches the provider; history converts cleanly', async () => {
  const model = modelOf(compatible);
  const history = toCore([{ role: 'user', content: 'Hi' }, { role: 'assistant', content: '' }, { role: 'user', content: 'Again' },
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'replay_0', toolName: 'show_card', input: { a: 1 } }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'replay_0', toolName: 'show_card', output: { type: 'json', value: { kind: 'card', drawn: true } } }] },
    { role: 'assistant', content: [{ type: 'text', text: '' }] }], model);
  assert.deepEqual(history.map(m => m.role), ['user', 'user', 'assistant', 'toolResult']);
  assert.equal(history[0].content, 'Hi');
  assert.deepEqual(JSON.parse(history[3].content[0].text), { kind: 'card', drawn: true });
  // Thinking alone, and an errored reply with nothing in it, are not sent either.
  const onlyThinking = { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }], api: 'x', provider: 'x', model: 'x', usage: {}, stopReason: 'length', timestamp: 3 };
  const empty = { ...onlyThinking, content: [], stopReason: 'error' };
  assert.deepEqual(toSdk([...history, onlyThinking, empty]).map(m => m.role), ['user', 'user', 'assistant', 'tool']);
  const fake = provider(compatibleMessage({ text: 'ok' }));
  await run(compatible, fake, [...history, onlyThinking, empty, { role: 'user', content: 'Go on', timestamp: 4 }]);
  for (const m of fake.bodies[0].messages.filter(m => m.role === 'assistant')) assert.ok(m.content || m.tool_calls?.length, JSON.stringify(m));
  assert.equal(fake.bodies[0].messages.filter(m => m.role === 'assistant').length, 1);
});
