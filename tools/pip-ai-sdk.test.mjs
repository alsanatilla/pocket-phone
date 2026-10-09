import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatStore, DEFAULT_CONFIG, config, streamReply } from '../src/client/pip-core.js';
import { saveAccess } from '../src/client/pip-tools.js';
import { notes } from '../src/client/store.js';
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
  globalThis.localStorage.setItem('pocket:notes.json', JSON.stringify({ notes: [] }));
  const chat = new ChatStore(globalThis.localStorage).create(config({ ...DEFAULT_CONFIG, ...settings })); return chat;
}
const proposal = { kind: 'note', title: 'Pip test', text: 'Blue car' };
// The user approves every write as the model asked for it, or with the edits given here.
const approveAll = (edits = {}, seen = []) => async requests => { seen.push(...requests); return new Map(requests.map(request => [request.toolCallId, { approved: true, ...(edits[request.toolCallId] ? { input: edits[request.toolCallId] } : {}) }])); };
const toolMessages = request => request.messages.flatMap(message => Array.isArray(message.content) ? message.content : []);

test('SDK carries Anthropic signed reasoning and exact tool IDs into the next model call', async t => {
  const chat = workspace(t, { thinking: true }), sent = [];
  const result = await streamReply(chat, turn(), { key: 'fixture', fetcher: async (_, options) => {
    sent.push(JSON.parse(options.body));
    return response(sent.length === 1 ? anthropicMessage({ reasoning: 'Read the request.', signature: 'private-fixture-signature', text: 'Saving the note.', calls: [{ name: 'create_record', input: proposal, id: 'toolu_exact' }] }) : anthropicMessage({ text: 'The note is saved.' }));
  }, approve: approveAll() });
  assert.equal(sent.length, 2); assert.equal(sent[0].thinking.type, 'adaptive');
  const assistant = sent[1].messages.find(message => message.role === 'assistant');
  assert.ok(assistant.content.some(part => part.type === 'thinking' && part.signature === 'private-fixture-signature'));
  assert.ok(assistant.content.some(part => part.type === 'tool_use' && part.id === 'toolu_exact' && part.input.text === 'Blue car'));
  const toolResult = toolMessages(sent[1]).find(part => part.type === 'tool_result');
  assert.equal(toolResult.tool_use_id, 'toolu_exact'); assert.match(JSON.stringify(toolResult.content), /"status\\?":\\?"saved/);
  assert.equal(result.answer, 'The note is saved.'); assert.match(result.reasoning, /Saving the note/);
  assert.equal(result.activity.filter(row => row.state === 'done').length, 1); assert.ok(!JSON.stringify(result).includes('private-fixture-signature'));
  assert.match(result.activity[0].applied_href, /^\/notes\/pip-/); assert.equal(notes.list().length, 1);
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

test('a write waits for approval while reads run, then saves once with the user\'s edits', async t => {
  const chat = workspace(t), sent = [], seen = [], updates = [];
  const result = await streamReply(chat, turn(), { key: 'fixture', onUpdate: update => updates.push(update), fetcher: async (_, options) => {
    sent.push(JSON.parse(options.body));
    return response(sent.length === 1 ? anthropicMessage({ calls: [{ name: 'create_record', input: proposal, id: 'toolu_write' }, { name: 'read_chat_history', input: { query: 'cars' }, id: 'toolu_read' }] }) : anthropicMessage({ text: 'Saved your edited note.' }));
  }, approve: approveAll({ toolu_write: { kind: 'note', title: 'Edited title', text: 'Edited text' } }, seen) });
  assert.equal(seen.length, 1); assert.equal(seen[0].toolName, 'create_record'); assert.deepEqual(seen[0].input, proposal);
  const waiting = updates.find(update => update.phase === 'waiting for your approval');
  assert.equal(waiting.activity.find(row => row.name === 'create_record').state, 'awaiting'); assert.equal(waiting.activity.find(row => row.name === 'read_chat_history').state, 'done');
  assert.equal(sent.length, 2);
  assert.ok(sent[1].messages.find(message => message.role === 'assistant').content.some(part => part.type === 'tool_use' && part.input.title === 'Edited title'));
  assert.deepEqual(toolMessages(sent[1]).filter(part => part.type === 'tool_result').map(part => part.tool_use_id).sort(), ['toolu_read', 'toolu_write']);
  const write = result.activity.find(row => row.name === 'create_record');
  assert.equal(write.state, 'done'); assert.equal(JSON.parse(write.result).action.title, 'Edited title');
  assert.equal(notes.list().length, 1); assert.match(notes.list()[0].text, /^# Edited title\n\nEdited text/);
  assert.equal(result.answer, 'Saved your edited note.');
});

test('a declined write never runs and the model is told it was declined', async t => {
  const chat = workspace(t), sent = [];
  const result = await streamReply(chat, turn(), { key: 'fixture', fetcher: async (_, options) => {
    sent.push(JSON.parse(options.body));
    return response(sent.length === 1 ? anthropicMessage({ calls: [{ name: 'create_record', input: proposal, id: 'toolu_write' }] }) : anthropicMessage({ text: 'Understood, nothing was saved.' }));
  }, approve: async requests => new Map(requests.map(request => [request.toolCallId, { approved: false }])) });
  assert.equal(notes.list().length, 0); assert.equal(sent.length, 2);
  assert.match(JSON.stringify(toolMessages(sent[1]).find(part => part.type === 'tool_result')), /declined/);
  const write = result.activity.find(row => row.name === 'create_record');
  assert.equal(write.state, 'done'); assert.equal(write.applied_href, undefined); assert.equal(JSON.parse(write.result).action.status, 'declined');
});

test('a write is refused without asking when the change cannot apply', async t => {
  const chat = workspace(t); saveAccess(chat.config, ['tasks']); let asked = 0, requests = 0;
  const result = await streamReply(chat, turn(), { key: 'fixture', approve: async () => { asked++; return new Map(); },
    fetcher: async () => response(++requests === 1 ? anthropicMessage({ calls: [{ name: 'change_record', input: { change: 'complete_task', id: 'missing-task' } }] }) : anthropicMessage({ text: 'That task no longer exists.' })) });
  assert.equal(asked, 0); assert.equal(requests, 2);
  assert.equal(result.activity[0].state, 'failed'); assert.equal(JSON.parse(result.activity[0].result).error, 'task_not_found');
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
  const result = await streamReply(chat, turn(), { key: 'fixture', executeTool: async () => { executions++; return {}; }, approve: approveAll(),
    fetcher: async () => response(++requests === 1 ? anthropicMessage({ calls: [{ name: 'create_record', raw: '{"title":' }] }) : anthropicMessage({ text: 'The tool arguments were incomplete.' })) });
  assert.equal(executions, 0); assert.equal(requests, 2); assert.ok(result.activity.every(row => row.state === 'failed'));
  assert.equal(notes.list().length, 0);
});

test('schema-invalid arguments never run, and the stored activity keeps no echoed values', async t => {
  const chat = workspace(t), sent = []; let executions = 0;
  const result = await streamReply(chat, turn(), { key: 'fixture', executeTool: async () => { executions++; return {}; }, approve: approveAll(), fetcher: async (_, options) => {
    sent.push(JSON.parse(options.body));
    return response(sent.length === 1 ? anthropicMessage({ calls: [{ name: 'create_record', input: { kind: 'note', title: 'x', unexpected: 'private-value' } }] }) : anthropicMessage({ text: 'Corrected.' }));
  } });
  assert.equal(executions, 0); assert.match(JSON.stringify(toolMessages(sent[1]).find(part => part.type === 'tool_result')), /Invalid input for tool create_record/);
  assert.equal(result.activity[0].state, 'failed'); assert.ok(![result.activity[0].result, result.activity[0].summary].join(' ').includes('private-value'));
});

test('oversized SDK arguments are rejected before tool execution', async t => {
  const chat = workspace(t); let executions = 0;
  await assert.rejects(streamReply(chat, turn(), { key: 'fixture', executeTool: async () => { executions++; return {}; }, fetcher: async () => response(anthropicMessage({ calls: [{ name: 'create_record', input: { ...proposal, text: 'x'.repeat(9000) } }] })) }), /too large|oversized/);
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
    return response(sent.length === 1 ? compatibleMessage({ calls: [{ name: 'create_record', input: proposal }], delta: { reasoning: 'Prepare the requested note.', reasoning_details: [encrypted] } }) : compatibleMessage({ text: 'The note is ready.' }));
  }, approve: approveAll() });
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

// Qwen3-Coder and Nemotron templates write calls as text when their host does not parse them.
const xmlCall = (name, input) => '<tool_call>\n<function=' + name + '>\n' + Object.entries(input).map(([key, value]) => '<parameter=' + key + '>\n' + (typeof value === 'string' ? value : JSON.stringify(value)) + '\n</parameter>\n').join('') + '</function>\n</tool_call>';
test('a tool call written as text runs as an SDK tool call instead of becoming the answer', async t => {
  const chat = workspace(t, { provider: 'compatible', model: 'fixture', baseUrl: 'https://model.example/v1' }), sent = []; let executed;
  const result = await streamReply(chat, turn(), { key: 'fixture', executeTool: async (_, name, input) => { executed = { name, input }; return { source: 'history', turns: [] }; }, fetcher: async (_, options) => {
    sent.push(JSON.parse(options.body));
    return response(sent.length === 1 ? compatibleMessage({ text: 'Let me check. ' + xmlCall('read_chat_history', { query: 'cars', limit: 2 }) }) : compatibleMessage({ text: 'Nothing earlier mentions cars.' }));
  } });
  assert.deepEqual(executed, { name: 'read_chat_history', input: { query: 'cars', limit: 2 } });
  assert.equal(sent.length, 2); assert.ok(sent[1].messages.some(message => message.role === 'tool'));
  assert.equal(result.answer, 'Nothing earlier mentions cars.'); assert.ok(!JSON.stringify(result).includes('<tool_call>'));
});

test('a text tool call that would save something still waits for approval', async t => {
  const chat = workspace(t, { provider: 'compatible', model: 'fixture', baseUrl: 'https://model.example/v1' }), seen = []; let requests = 0;
  const result = await streamReply(chat, turn(), { key: 'fixture', approve: approveAll({}, seen),
    fetcher: async () => response(++requests === 1 ? compatibleMessage({ text: xmlCall('create_record', { kind: 'task', title: '2026 trend report', text: 'Six trends' }) }) : compatibleMessage({ text: 'Saved the task.' })) });
  assert.equal(seen.length, 1); assert.deepEqual(seen[0].input, { kind: 'task', title: '2026 trend report', text: 'Six trends' });
  assert.equal(result.activity[0].name, 'create_record'); assert.ok(result.activity[0].applied_href); assert.equal(result.answer, 'Saved the task.');
});

test('a text tool call split across stream chunks and JSON-style calls are both recognized', async t => {
  const chat = workspace(t, { provider: 'compatible', model: 'fixture', baseUrl: 'https://model.example/v1' }); let requests = 0; const executed = [];
  const split = '<tool_call>{"name": "read_chat_history", "arguments": {"query": "trip"}}</tool_call>';
  const wire = split.match(/.{1,5}/gs).map(text => event({ id: 'c', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })).join('')
    + event({ id: 'c', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) + 'data: [DONE]\r\n\r\n';
  const result = await streamReply(chat, turn(), { key: 'fixture', executeTool: async (_, name, input) => { executed.push(input); return { source: 'history', turns: [] }; },
    fetcher: async () => response(++requests === 1 ? wire : compatibleMessage({ text: 'Done.' })) });
  assert.deepEqual(executed, [{ query: 'trip' }]); assert.equal(result.answer, 'Done.');
});

test('text that only mentions a tool call stays the answer', async t => {
  const chat = workspace(t, { provider: 'compatible', model: 'fixture', baseUrl: 'https://model.example/v1' });
  const text = 'Models write <tool_call> blocks; this sentence is not one.';
  const result = await streamReply(chat, turn(), { key: 'fixture', fetcher: async () => response(compatibleMessage({ text })) });
  assert.equal(result.answer, text);
});
