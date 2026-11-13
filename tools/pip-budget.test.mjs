import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatStore, DEFAULT_CONFIG, config, streamReply } from '../src/client/pip-core.js';
import { RESEARCH_LIMITS } from '../src/client/pip-limits.js';
import { compatibleMessage, event, response, systemText } from './pip-provider-fixtures.mjs';

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
/** Usage as a provider that thinks reports it: the reasoning tokens are part of the output tokens. */
const thinkingUsage = (output, reasoning) => ({ ...usage(output), completion_tokens_details: { reasoning_tokens: reasoning } });
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
  // A text round cut off at 3,000 tokens, 2,000 of them thinking: without lookups, thinking is the answer's too.
  const result = await streamReply(chat, turn('Write the answer'), { key: 'fixture', fetcher: provider(sent,
    compatibleMessage({ text: 'Half an ans', finish: 'length', usage: thinkingUsage(3000, 2000) }),
    compatibleMessage({ text: 'Finished.', usage: usage(8) })) });
  assert.equal(sent[0].max_tokens, 3072);
  // 4,096 − 3,000 = 1,096 left for the answer, less the 1,024 reserve for the closing text.
  assert.equal(sent[1].max_tokens, 72);
  assert.equal(result.answer, 'Finished.');
});

test('a round that only keeps the plan is paid from the lookups budget', async t => {
  const chat = workspace(t), sent = [];
  const result = await streamReply(chat, turn('Plan the answer'), { key: 'fixture', fetcher: provider(sent,
    compatibleMessage({ text: 'Planning.', calls: [{ name: 'update_plan', input: { steps: [{ text: 'Answer', status: 'done' }] }, id: 'call_plan' }], usage: usage(3000) }),
    compatibleMessage({ text: 'Finished.', usage: usage(8) })) });
  // The answer keeps all 4,096 tokens, less the reserve, as long as the round is not final.
  assert.equal(sent[1].max_tokens, 3072);
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
  // The round is final: the model is told research stopped and why. It still offers the lookups only so that a late
  // one is refused instead of failing the reply (see the late-lookup tests below).
  assert.match(systemText(sent[3]), /the app has stopped research for this reply/);
  assert.match(systemText(sent[3]), /Research token budget reached/);
  // The answer still has the reply's 4,096 tokens, less the reserve for the closing text.
  assert.equal(sent[3].max_tokens, 3072);
  assert.equal(result.answer, 'The blue car is the better buy.');
});

test('two late lookups are refused and the next round offers no tools at all', async t => {
  const chat = workspace(t), sent = [];
  const result = await streamReply(chat, turn('Compare the two cars in my notes'), { key: 'fixture', fetcher: provider(sent,
    lookup('call_1', 6000, 'blue car'), lookup('call_2', 6000, 'grey car'), lookup('call_3', 6000, 'prices'),
    lookup('call_4', 700, 'first late'), lookup('call_5', 700, 'second late'),
    compatibleMessage({ text: 'The blue car is the better buy.', usage: usage(900) })) });
  assert.equal(result.answer, 'The blue car is the better buy.', 'the reply finishes with the text of the third round');
  assert.equal(sent.length, 6);
  // The final rounds still offer the lookups, so a late request reaches Pocket and is refused there.
  assert.ok(sent[3].tools.some(tool => tool.function.name === 'read_chat_history'));
  assert.ok(sent[4].tools.some(tool => tool.function.name === 'read_chat_history'));
  assert.ok(!sent[5].tools?.length, 'after the second tolerated refusal the round offers no tools');
  assert.ok(sent[5].tool_choice === undefined || sent[5].tool_choice === 'none');
  const asked = result.activity.filter(row => row.name === 'read_chat_history');
  assert.deepEqual(asked.map(row => row.state), ['done', 'done', 'done', 'failed', 'failed']);
  for (const refused of asked.slice(3)) assert.match(refused.result, /research_budget_reached/);
});

test('a pause between the first and the second tolerated lookup keeps the count', async t => {
  const chat = workspace(t), sent = [], paused = [], asking = turn('Save the blue car price');
  let seen = [];
  const durable = { checkpoint: null, settled: null, pause: async state => { paused.push(state); } };
  await assert.rejects(() => streamReply(chat, asking, { key: 'fixture', durable, onUpdate: update => { seen = update.activity; }, fetcher: provider(sent,
    lookup('call_1', 6000, 'blue car'), lookup('call_2', 6000, 'grey car'), lookup('call_3', 6000, 'prices'),
    lookup('call_4', 700, 'first late'),
    compatibleMessage({ calls: [{ name: 'create_record', input: { kind: 'note', title: 'Blue car', text: '21,000 euros' }, id: 'call_write' }], usage: usage(100) })) }),
  error => error?.name === 'RunPaused');
  assert.equal(paused.length, 1);
  const checkpoint = paused[0];
  assert.equal(checkpoint.counters.lateLookups, 1, 'the first tolerated refusal is in the checkpoint');
  assert.deepEqual(seen.filter(row => row.name === 'read_chat_history').map(row => row.state), ['done', 'done', 'done', 'failed']);
  const result = await streamReply(chat, asking, { key: 'fixture', durable: { checkpoint, settled: new Map([['call_write', { approved: true }]]), pause: async () => {} },
    executeTool: async (value, name, input) => ({ kind: 'action', action: { tool: name, kind: input.kind, title: input.title, status: 'saved', href: '/notes/blue-car' } }),
    fetcher: provider(sent, lookup('call_5', 700, 'second late'), compatibleMessage({ text: 'Saved the blue car price.', usage: usage(8) })) });
  assert.equal(result.answer, 'Saved the blue car price.');
  // The count came back with the checkpoint: the second late lookup is the second refusal, so the round after it
  // already offers no tools, and the text arrives in that one.
  assert.ok(!sent[6].tools?.length, 'the round after the second tolerated refusal offers no tools');
  const after = result.activity.filter(row => row.name === 'read_chat_history');
  assert.deepEqual(after.map(row => row.state), ['failed']);
  assert.match(after[0].result, /research_budget_reached/);
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
  // The two lookups and the write round all end in tool calls: the lookups' budget paid for them, the answer kept its.
  assert.equal(checkpoint.counters.researchTokens, RESEARCH_LIMITS.researchTokens - 14000 - 100);
  assert.equal(checkpoint.counters.tokens, chat.config.maxTokens);
  const result = await streamReply(chat, asking, { key: 'fixture', durable: { checkpoint, settled: new Map([['call_write', { approved: true }]]), pause: async () => {} },
    executeTool: async (value, name, input) => ({ kind: 'action', action: { tool: name, kind: input.kind, title: input.title, status: 'saved', href: '/notes/blue-car' } }),
    fetcher: provider(sent, compatibleMessage({ text: 'Saved the blue car price.', usage: usage(8) })) });
  assert.equal(result.answer, 'Saved the blue car price.');
  // The resumed round is capped at the 1,900 lookups' tokens it had left plus the reserve; a fresh budget gives 3,072.
  assert.equal(sent[3].max_tokens, 1900 + 1024);
});

// A model that thinks before every call and before its answer (GLM 5.3 in real thorough replies): its provider
// reports the thinking as reasoning tokens inside the output tokens, and honours max_tokens.
const thinkingLookup = (id, query) => compatibleMessage({ calls: [{ name: 'read_chat_history', input: { query }, id }], usage: thinkingUsage(700, 600) });

test('a model that thinks before its answer gets what is left of the lookups budget to think in', async t => {
  const chat = workspace(t), sent = [], lookups = [thinkingLookup('call_1', 'blue car'), thinkingLookup('call_2', 'grey car'), thinkingLookup('call_3', 'prices')];
  const result = await streamReply(chat, turn('Compare the two cars in my notes'), { key: 'fixture', fetcher: async (_url, options) => {
    const body = JSON.parse(options.body); sent.push(body);
    if (lookups.length) return response(lookups.shift());
    // It needs 5,500 tokens of thinking before it writes; a smaller allowance ends in the middle of that thinking.
    if (body.max_tokens < 6000) return response(compatibleMessage({ finish: 'length', delta: { reasoning_content: 'Thinking…' }, usage: thinkingUsage(body.max_tokens, body.max_tokens) }));
    return response(compatibleMessage({ text: 'The blue car is the better buy.', delta: { reasoning_content: 'Thought it through.' }, usage: thinkingUsage(6000, 5500) }));
  } });
  assert.equal(result.answer, 'The blue car is the better buy.');
  assert.equal(sent.length, 4);
  // 16,000 − 3 × 700 = 13,900 left for looking up: the answer's 3,072 plus that, capped at it plus the reserve.
  assert.equal(sent[3].max_tokens, 13900 + 1024);
});

test('an answer pays its thinking from the lookups budget and its text from the answer', async t => {
  const chat = workspace(t), sent = [], paused = [];
  const durable = { checkpoint: null, settled: null, pause: async state => { paused.push(state); } };
  await assert.rejects(() => streamReply(chat, turn('Show the blue car and save its price'), { key: 'fixture', durable, fetcher: provider(sent,
    thinkingLookup('call_1', 'blue car'),
    compatibleMessage({ text: 'Here it is.', calls: [{ name: 'show_card', input: CHART, id: 'call_card' }], usage: thinkingUsage(2500, 2000) }),
    compatibleMessage({ calls: [{ name: 'create_record', input: { kind: 'note', title: 'Blue car', text: '21,000 euros' }, id: 'call_write' }], usage: usage(100) })) }),
  error => error?.name === 'RunPaused');
  const { counters } = paused[0];
  // The card round wrote 500 tokens of the answer and thought 2,000: only the 500 left the answer's budget.
  assert.equal(counters.tokens, chat.config.maxTokens - 500);
  assert.equal(counters.researchTokens, RESEARCH_LIMITS.researchTokens - 700 - 2000 - 100);
  assert.equal(counters.thinking, 600 + 2000);
});

test('thinking longer than a reply keeps does not fail the reply', async t => {
  const chat = workspace(t), sent = [], thought = index => ({ reasoning_content: String(index).repeat(10000) });
  const result = await streamReply(chat, turn('Compare the two cars in my notes'), { key: 'fixture', fetcher: provider(sent,
    compatibleMessage({ calls: [{ name: 'read_chat_history', input: { query: 'blue' }, id: 'call_1' }], delta: thought(1), usage: thinkingUsage(3000, 2900) }),
    compatibleMessage({ calls: [{ name: 'read_chat_history', input: { query: 'grey' }, id: 'call_2' }], delta: thought(2), usage: thinkingUsage(3000, 2900) }),
    compatibleMessage({ text: 'The blue car is the better buy.', delta: thought(3), usage: thinkingUsage(3000, 2900) })) });
  assert.equal(result.answer, 'The blue car is the better buy.');
  // Past 24,000 characters the newest 16,000 stay: all of the last round's thinking, and the end of the one before.
  assert.equal(result.reasoning.length, 16000);
  assert.ok(result.reasoning.endsWith('3'.repeat(10000)));
});

test('long thinking is replaced once in a while, not with every token', async t => {
  const chat = workspace(t), sent = [], seen = [];
  // 60 chunks of 1,000 characters of thinking, then the answer: 60,000 characters in one round.
  const thinking = Array.from({ length: 60 }, (_, index) => event({ id: 'chatcmpl_fixture', object: 'chat.completion.chunk', created: 1791500000, model: 'fixture-model',
    choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: String(index % 10).repeat(1000) }, finish_reason: null }] })).join('');
  const result = await streamReply(chat, turn('Think it through'), { key: 'fixture', onUpdate: update => seen.push(update.reasoning), fetcher: async (_url, options) => {
    sent.push(JSON.parse(options.body));
    return response(thinking + compatibleMessage({ text: 'Done.', usage: thinkingUsage(2000, 1900) }), 4096);
  } });
  assert.equal(result.answer, 'Done.');
  assert.ok(seen.every(text => text.length <= 24000));
  // Each update either adds to the thinking shown before or replaces it; at 1,000 characters a chunk, the 60,000
  // characters cross the limit about every 8,000 of them, so a handful of replacements, not one per chunk after it.
  const replaced = seen.filter((text, index) => index && !text.startsWith(seen[index - 1])).length;
  assert.ok(replaced >= 3 && replaced <= 6, 'replaced ' + replaced + ' times');
  assert.ok(result.reasoning.endsWith('9'.repeat(1000)));
});

test('in a final round the lookups budget pays only what it has left, and the answer the rest', async t => {
  const chat = workspace(t), sent = [];
  const result = await streamReply(chat, turn('Compare the two cars in my notes'), { key: 'fixture', fetcher: provider(sent,
    lookup('call_1', 6000, 'blue car'), lookup('call_2', 6000, 'grey car'), lookup('call_3', 6000, 'prices'),
    compatibleMessage({ calls: [{ name: 'update_plan', input: { steps: [{ text: 'Answer', status: 'active' }] }, id: 'call_plan' }], usage: usage(1000) }),
    compatibleMessage({ text: 'The blue car is the better buy.', usage: usage(900) })) });
  assert.equal(result.answer, 'The blue car is the better buy.');
  assert.match(systemText(sent[3]), /Research token budget reached/);
  // The lookups' budget was spent, so the plan round in the final round is the answer's: 4,096 − 1,000, less the reserve.
  assert.equal(sent[4].max_tokens, 4096 - 1000 - 1024);
});

test('a model that always thinks through its whole allowance stays within both budgets and the reserve', async t => {
  const chat = workspace(t), sent = [];
  // Every round thinks until max_tokens: the first ones end in a lookup, the rest are cut off before any text.
  await assert.rejects(() => streamReply(chat, turn('Compare the two cars in my notes'), { key: 'fixture', fetcher: async (_url, options) => {
    const body = JSON.parse(options.body); sent.push(body);
    const full = thinkingUsage(body.max_tokens, body.max_tokens), reasoning = { reasoning_content: 'Thinking…' };
    if (sent.length <= 3) return response(compatibleMessage({ calls: [{ name: 'read_chat_history', input: { query: 'q' + sent.length }, id: 'call_' + sent.length }], delta: reasoning, usage: full }));
    return response(compatibleMessage({ finish: 'length', delta: reasoning, usage: full }));
  } }), /reply token limit was reached/);
  const spent = sent.reduce((sum, body) => sum + body.max_tokens, 0);
  assert.ok(spent <= chat.config.maxTokens + RESEARCH_LIMITS.researchTokens + 1024, 'offered ' + spent);
  // After a lookup, thinking may use what the lookups' budget has left: more than four rounds' usual allowance.
  assert.ok(spent > chat.config.maxTokens + 3 * 3072, 'offered ' + spent);
});
