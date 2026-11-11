import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatStore, DEFAULT_CONFIG, config, streamReply } from '../src/client/pip-core.js';
import { RESEARCH_LIMITS } from '../src/client/pip-limits.js';
import { compatibleMessage, response, systemText } from './pip-provider-fixtures.mjs';

// Lookups and the answer have separate token budgets. These run the real reply pipeline against a provider
// fixture: a round that only looks something up spends the lookups' budget, and the answer keeps the reply's.

class Memory {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
function workspace(t, maxTokens = 4096) {
  const previous = globalThis.localStorage; globalThis.localStorage = new Memory(); t.after(() => { globalThis.localStorage = previous; });
  return new ChatStore(globalThis.localStorage).create(config({ ...DEFAULT_CONFIG, provider: 'compatible', model: 'fixture-model', baseUrl: 'https://model.example/v1', maxTokens }));
}
let turns = 0;
const turn = text => ({ uid: 'budget-turn-' + ++turns, text, context: [] });
const usage = output => ({ prompt_tokens: 10, completion_tokens: output, total_tokens: output + 10 });
const provider = (sent, ...replies) => async (_url, options) => {
  sent.push(JSON.parse(options.body));
  assert.ok(replies.length, 'the fixture expected no further request');
  return response(replies.shift());
};
/** A finished lookup round with its own output usage, as the provider reports it. */
const lookup = (id, output, query) => compatibleMessage({ calls: [{ name: 'read_chat_history', input: { query }, id }], usage: usage(output) });
const CHART = { root: 'main', elements: [
  { id: 'main', type: 'Stack', props: { direction: 'vertical' }, children: ['km'] },
  { id: 'km', type: 'Chart', props: { kind: 'line', title: 'Weekly distance', unit: 'km', data: [{ label: 'W1', value: 22 }] }, children: [] }] };

test('six lookup rounds leave the answer its whole budget', async t => {
  const chat = workspace(t), sent = [];
  const result = await streamReply(chat, turn('Compare the two cars in my notes'), { key: 'fixture', fetcher: provider(sent,
    lookup('call_1', 700, 'blue car'), lookup('call_2', 700, 'grey car'), lookup('call_3', 700, 'prices'),
    lookup('call_4', 700, 'mileage'), lookup('call_5', 700, 'service'), lookup('call_6', 700, 'insurance'),
    compatibleMessage({ text: 'The blue car is the better buy.', usage: usage(900) })) });
  assert.equal(result.answer, 'The blue car is the better buy.');
  assert.equal(sent.length, 7);
  assert.equal(result.usage.output_tokens, 6 * 700 + 900);
});

test('a reply without lookups is charged exactly as before', async t => {
  const chat = workspace(t), sent = [];
  const result = await streamReply(chat, turn('Plan the answer'), { key: 'fixture', fetcher: provider(sent,
    compatibleMessage({ text: 'Planning.', calls: [{ name: 'update_plan', input: { steps: [{ text: 'Answer', status: 'done' }] }, id: 'call_plan' }], usage: usage(3000) }),
    compatibleMessage({ text: 'Finished.', usage: usage(8) })) });
  assert.equal(sent[0].max_tokens, 3072);
  // 4,096 − 3,000 = 1,096 left for the answer, less the 1,024 reserve for the closing text.
  assert.equal(sent[1].max_tokens, 72);
  assert.equal(result.answer, 'Finished.');
});

test('a round that draws a card is charged to the answer', async t => {
  const chat = workspace(t), sent = [];
  await streamReply(chat, turn('Show the weekly distance'), { key: 'fixture', fetcher: provider(sent,
    compatibleMessage({ text: 'Here it is.', calls: [{ name: 'show_card', input: CHART, id: 'call_card' }], usage: usage(3000) }),
    compatibleMessage({ text: 'Done.', usage: usage(8) })) });
  assert.equal(sent[1].max_tokens, 72);
});

test('a round with a lookup and a card is charged to the answer too', async t => {
  const chat = workspace(t), sent = [];
  await streamReply(chat, turn('Show the weekly distance and its history'), { key: 'fixture', fetcher: provider(sent,
    compatibleMessage({ calls: [{ name: 'read_chat_history', input: { query: 'distance' }, id: 'call_history' }, { name: 'show_card', input: CHART, id: 'call_card' }], usage: usage(3000) }),
    compatibleMessage({ text: 'Done.', usage: usage(8) })) });
  assert.equal(sent[1].max_tokens, 72);
});

test('the lookups budget ends research and the answer keeps its tokens', async t => {
  const chat = workspace(t), sent = [];
  const result = await streamReply(chat, turn('Compare the two cars in my notes'), { key: 'fixture', fetcher: provider(sent,
    lookup('call_1', 6000, 'blue car'), lookup('call_2', 6000, 'grey car'), lookup('call_3', 6000, 'prices'),
    compatibleMessage({ text: 'The blue car is the better buy.', usage: usage(900) })) });
  assert.equal(sent.length, 4);
  assert.ok(!sent[3].tools.some(tool => tool.function.name === 'read_chat_history'), 'the final round offers no lookup tools');
  assert.match(systemText(sent[3]), /Research token budget reached/);
  // The answer still has the reply's 4,096 tokens, less the reserve for the closing text.
  assert.equal(sent[3].max_tokens, 3072);
  assert.equal(result.answer, 'The blue car is the better buy.');
});

test('a pause stores the lookups budget and the resumed run keeps it', async t => {
  const chat = workspace(t), sent = [], paused = [], asking = turn('Save the blue car price');
  const durable = { checkpoint: null, settled: null, pause: async state => { paused.push(state); } };
  await assert.rejects(() => streamReply(chat, asking, { key: 'fixture', durable, fetcher: provider(sent,
    lookup('call_1', 7000, 'blue car'), lookup('call_2', 7000, 'blue car price'),
    compatibleMessage({ calls: [{ name: 'create_record', input: { kind: 'note', title: 'Blue car', text: '21,000 euros' }, id: 'call_write' }], usage: usage(100) })) }),
  error => error?.name === 'RunPaused');
  assert.equal(paused.length, 1);
  const checkpoint = paused[0];
  assert.equal(checkpoint.counters.researchTokens, RESEARCH_LIMITS.researchTokens - 14000);
  // Only the write round drew from the answer; the two lookups did not.
  assert.equal(checkpoint.counters.tokens, chat.config.maxTokens - 100);
  const result = await streamReply(chat, asking, { key: 'fixture', durable: { checkpoint, settled: new Map([['call_write', { approved: true }]]), pause: async () => {} },
    executeTool: async (value, name, input) => ({ kind: 'action', action: { tool: name, kind: input.kind, title: input.title, status: 'saved', href: '/notes/blue-car' } }),
    fetcher: provider(sent, compatibleMessage({ text: 'Saved the blue car price.', usage: usage(8) })) });
  assert.equal(result.answer, 'Saved the blue car price.');
});
