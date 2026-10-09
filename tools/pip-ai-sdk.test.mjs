import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatStore, DEFAULT_CONFIG, config, streamReply } from '../src/client/pip-core.js';
import { saveAccess } from '../src/client/pip-tools.js';
import { anthropicMessage, compatibleMessage, event, response, messageText } from './pip-provider-fixtures.mjs';

class Memory {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
const turn = () => ({ uid: 'sdk-turn', text: 'Research and prepare a note', context: [] });
function workspace(t, settings = {}) {
  const previous = globalThis.localStorage; globalThis.localStorage = new Memory(); t.after(() => { globalThis.localStorage = previous; });
  const chat = new ChatStore(globalThis.localStorage).create(config({ ...DEFAULT_CONFIG, ...settings })); return chat;
}
const proposal = { kind: 'note', title: 'Pip test', text: 'Blue car' };

test('SDK carries Anthropic signed reasoning and exact tool IDs into the next model call', async t => {
  const chat = workspace(t, { thinking: true }), sent = [];
  const result = await streamReply(chat, turn(), { key: 'fixture', fetcher: async (_, options) => {
    sent.push(JSON.parse(options.body));
    return response(sent.length === 1 ? anthropicMessage({ reasoning: 'Read the request.', signature: 'private-fixture-signature', text: 'Preparing the note.', calls: [{ name: 'propose_action', input: proposal, id: 'toolu_exact' }] }) : anthropicMessage({ text: 'The note is ready.' }));
  } });
  assert.equal(sent.length, 2); assert.equal(sent[0].thinking.type, 'adaptive');
  const assistant = sent[1].messages.find(message => message.role === 'assistant');
  assert.ok(assistant.content.some(part => part.type === 'thinking' && part.signature === 'private-fixture-signature'));
  assert.ok(assistant.content.some(part => part.type === 'tool_use' && part.id === 'toolu_exact' && part.input.text === 'Blue car'));
  const toolResult = sent[1].messages.flatMap(message => Array.isArray(message.content) ? message.content : []).find(part => part.type === 'tool_result');
  assert.equal(toolResult.tool_use_id, 'toolu_exact'); assert.match(JSON.stringify(toolResult.content), /Blue car/);
  assert.equal(result.answer, 'The note is ready.'); assert.match(result.reasoning, /Preparing the note/);
  assert.equal(result.activity.filter(row => row.state === 'done').length, 1); assert.ok(!JSON.stringify(result).includes('private-fixture-signature'));
});

test('compatible SDK continuations match out-of-order tool results by their original IDs', async t => {
  const chat = workspace(t, { provider: 'compatible', model: 'fixture', baseUrl: 'https://model.example/v1' }), sent = [];
  const result = await streamReply(chat, turn(), { key: 'fixture', executeTool: async (_, name, input) => {
    if (input.query === 'slow') await new Promise(resolve => setTimeout(resolve, 15));
    return { source: 'history', query: input.query, turns: [] };
  }, fetcher: async (_, options) => {
    sent.push(JSON.parse(options.body));
    return response(sent.length === 1 ? compatibleMessage({ calls: [{ name: 'read_chat_history', input: { query: 'slow' }, id: 'call_slow' }, { name: 'read_chat_history', input: { query: 'fast' }, id: 'call_fast' }] }) : compatibleMessage({ text: 'Both lookups finished.' }));
  } });
  const outputs = new Map(sent[1].messages.filter(message => message.role === 'tool').map(message => [message.tool_call_id, JSON.parse(message.content)]));
  assert.equal(outputs.get('call_slow').query, 'slow'); assert.equal(outputs.get('call_fast').query, 'fast');
  assert.equal(result.activity.filter(row => row.state === 'done').length, 2); assert.equal(result.answer, 'Both lookups finished.');
});

test('SDK read batches stay within three slots and preparations wait for preceding reads', async t => {
  const chat = workspace(t), finished = new Set(); let active = 0, peak = 0, requests = 0, prepared = false;
  const calls = Array.from({ length: 6 }, (_, index) => ({ name: 'read_chat_history', input: { query: String(index) }, id: 'read_' + index }));
  calls.push({ name: 'propose_action', input: proposal, id: 'prepare' }, { name: 'read_chat_history', input: { query: 'after' }, id: 'after' });
  await streamReply(chat, turn(), { key: 'fixture', executeTool: async (_, name, input) => {
    if (name === 'propose_action') { assert.equal(finished.size, 6); prepared = true; return { kind: 'proposal', proposal }; }
    if (input.query === 'after') assert.equal(prepared, true);
    active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 15)); active--; finished.add(input.query);
    return { source: 'history', turns: [] };
  }, fetcher: async () => response(++requests === 1 ? anthropicMessage({ calls }) : anthropicMessage({ text: 'Finished.' })) });
  assert.ok(peak > 1 && peak <= 3); assert.equal(requests, 2); assert.equal(finished.size, 7); assert.equal(prepared, true);
});

test('simultaneous identical SDK reads share one execution', async t => {
  const chat = workspace(t); let executions = 0, requests = 0;
  const result = await streamReply(chat, turn(), { key: 'fixture', executeTool: async () => { executions++; await new Promise(resolve => setTimeout(resolve, 10)); return { source: 'history', turns: [] }; },
    fetcher: async () => response(++requests === 1 ? anthropicMessage({ calls: [{ name: 'read_chat_history', input: { query: 'same', limit: 2 }, id: 'first' }, { name: 'read_chat_history', input: { limit: 2, query: 'same' }, id: 'second' }] }) : anthropicMessage({ text: 'Finished.' })) });
  assert.equal(executions, 1); assert.equal(result.activity.filter(row => row.state === 'done').length, 2);
  assert.ok(result.activity.some(row => JSON.parse(row.result).cached));
});

test('a revoked permission withholds an in-flight result from SDK continuation and history', async t => {
  const chat = workspace(t), sent = []; saveAccess(chat.config, ['notes']);
  const result = await streamReply(chat, turn(), { key: 'fixture', executeTool: async () => { saveAccess(chat.config, []); return { text: 'PRIVATE NOTE EVIDENCE' }; }, fetcher: async (_, options) => {
    sent.push(JSON.parse(options.body)); return response(sent.length === 1 ? anthropicMessage({ calls: [{ name: 'read_note', input: { id: 'private-note' } }] }) : anthropicMessage({ text: 'Notes access was disabled.' }));
  } });
  assert.equal(result.activity[0].state, 'failed'); assert.equal(JSON.parse(result.activity[0].result).error, 'access_disabled');
  assert.ok(!JSON.stringify(sent[1]).includes('PRIVATE NOTE EVIDENCE')); assert.ok(!JSON.stringify(result).includes('PRIVATE NOTE EVIDENCE'));
});

test('a malformed completed SDK tool call cannot prepare a record', async t => {
  const chat = workspace(t); let requests = 0, executions = 0;
  const result = await streamReply(chat, turn(), { key: 'fixture', executeTool: async () => { executions++; return { kind: 'proposal', proposal }; },
    fetcher: async () => response(++requests === 1 ? anthropicMessage({ calls: [{ name: 'propose_action', raw: '{"title":' }] }) : anthropicMessage({ text: 'The tool arguments were incomplete.' })) });
  assert.equal(executions, 0); assert.equal(requests, 2); assert.ok(result.activity.every(row => row.state === 'failed'));
  assert.ok(!result.activity.some(row => row.result && JSON.parse(row.result).kind === 'proposal'));
});

test('oversized SDK arguments are rejected before tool execution', async t => {
  const chat = workspace(t); let executions = 0;
  await assert.rejects(streamReply(chat, turn(), { key: 'fixture', executeTool: async () => { executions++; return {}; }, fetcher: async () => response(anthropicMessage({ calls: [{ name: 'propose_action', input: { ...proposal, text: 'x'.repeat(9000) } }] })) }), /too large|oversized/);
  assert.equal(executions, 0);
});

test('SDK retries a busy HTTP provider twice and emits one answer', async t => {
  const chat = workspace(t), updates = []; let requests = 0;
  const result = await streamReply(chat, turn(), { key: 'fixture', onUpdate: update => updates.push(update), fetcher: async () => ++requests < 3 ? new Response('private provider error', { status: 429, headers: { 'retry-after-ms': '1' } }) : response(anthropicMessage({ text: 'Recovered.' })) });
  assert.equal(requests, 3); assert.equal(result.answer, 'Recovered.'); assert.ok(updates.some(update => update.phase === 'provider busy · retrying'));
  assert.ok(!JSON.stringify(updates).includes('private provider error'));
});

test('an interrupted SDK stream preserves the partial and never automatically repeats it', async t => {
  const chat = workspace(t), updates = []; let requests = 0;
  await assert.rejects(streamReply(chat, turn(), { key: 'fixture', onUpdate: update => updates.push(update), fetcher: async () => { requests++; return response(anthropicMessage({ text: 'Partial answer.', complete: false }) + event({ type: 'error', error: { type: 'overloaded_error', message: 'private provider error' } })); } }), /interrupted|temporarily unavailable/);
  assert.equal(requests, 1); assert.ok(updates.some(update => update.answer === 'Partial answer.'));
  assert.ok(!JSON.stringify(updates).includes('private provider error'));
});

test('OpenRouter SDK preserves free fallback models and encrypted reasoning across tools', async t => {
  const chat = workspace(t, { provider: 'compatible', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free' }), sent = [];
  const encrypted = { type: 'reasoning.encrypted', data: 'PRIVATE ENCRYPTED REASONING', id: 'reasoning_fixture', format: 'anthropic-claude-v1', index: 0 };
  const result = await streamReply(chat, turn(), { key: 'fixture', fetcher: async (_, options) => {
    sent.push(JSON.parse(options.body));
    return response(sent.length === 1 ? compatibleMessage({ calls: [{ name: 'propose_action', input: proposal }], delta: { reasoning: 'Prepare the requested note.', reasoning_details: [encrypted] } }) : compatibleMessage({ text: 'The note is ready.' }));
  } });
  assert.equal(sent[0].model, 'nvidia/nemotron-3-super-120b-a12b:free'); assert.deepEqual(sent[0].models, ['nvidia/nemotron-3-super-120b-a12b:free', 'inclusionai/ling-3.0-flash-sante:free', 'openrouter/free']);
  assert.match(JSON.stringify(sent[1].messages.find(message => message.role === 'assistant')), /PRIVATE ENCRYPTED REASONING/);
  assert.ok(!JSON.stringify(result).includes('PRIVATE ENCRYPTED REASONING')); assert.equal(result.answer, 'The note is ready.');
});

test('OpenAI SDK uses its native completion token field while keeping the current question', async t => {
  const chat = workspace(t, { provider: 'compatible', baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-sol' }); let sent;
  const result = await streamReply(chat, turn(), { key: 'fixture', fetcher: async (_, options) => { sent = JSON.parse(options.body); return response(compatibleMessage({ text: 'Answered.' })); } });
  assert.ok(sent.max_completion_tokens > 0); assert.equal(sent.max_tokens, undefined); assert.equal(messageText(sent.messages.at(-1)), turn().text);
  assert.equal(result.answer, 'Answered.');
});

test('missing compatible SDK usage clears last-request counts while retaining earlier totals', async t => {
  const chat = workspace(t, { provider: 'compatible', model: 'fixture', baseUrl: 'https://model.example/v1' }); let requests = 0;
  const result = await streamReply(chat, turn(), { key: 'fixture', fetcher: async () => response(++requests === 1 ? compatibleMessage({ calls: [{ name: 'update_plan', input: { steps: [{ text: 'Answer', status: 'done' }] } }] }) : compatibleMessage({ text: 'Answered.', usage: null })) });
  assert.equal(result.usage.input_tokens, 10); assert.equal(result.usage.output_tokens, 8); assert.equal(result.usage.last_input_tokens, undefined); assert.equal(result.usage.last_output_tokens, undefined);
});
