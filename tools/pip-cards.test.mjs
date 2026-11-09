import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatStore, DEFAULT_CONFIG, config, streamReply } from '../src/client/pip-core.js';
import { segmentAnswer, answerText } from '../src/shared/pip-reply.js';
import { pocketSpec } from '../src/shared/pocket-spec.js';
import { cardProblems, cardFromTool, draftLines, drawCard } from '../src/shared/pocket-card-tool.js';
import { compatibleMessage, event, response } from './pip-provider-fixtures.mjs';

// Pip draws with one tool, show_card. These run the real reply pipeline against a provider fixture: where a card
// lands in the answer, what the model hears when a card is wrong, and what is on screen while one is written.

class Memory {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
function workspace(t) {
  const previous = globalThis.localStorage; globalThis.localStorage = new Memory(); t.after(() => { globalThis.localStorage = previous; });
  return new ChatStore(globalThis.localStorage).create(config({ ...DEFAULT_CONFIG, provider: 'compatible', model: 'fixture-model', baseUrl: 'https://model.example/v1' }));
}
const turn = () => ({ uid: 'card-turn', text: 'Show my running distance', context: [] });
const CHART = { root: 'main', elements: [
  { id: 'main', type: 'Stack', props: { direction: 'vertical' }, children: ['km'] },
  { id: 'km', type: 'Chart', props: { kind: 'line', title: 'Weekly distance', unit: 'km', data: [{ label: 'W1', value: 22 }, { label: 'W2', value: 26 }, { label: 'W3', value: 31 }] }, children: [] }] };
const provider = (sent, ...replies) => async (_url, options) => { sent.push(JSON.parse(options.body)); return response(replies.shift()); };
const toolResults = request => request.messages.filter(message => message.role === 'tool').map(message => String(message.content));

test('a card lands where the model called show_card, between the text before and after it', async t => {
  const chat = workspace(t), sent = [];
  const result = await streamReply(chat, turn(), { key: 'fixture', fetcher: provider(sent,
    compatibleMessage({ text: 'You ran further every week.', calls: [{ name: 'show_card', input: CHART, id: 'call_card' }] }),
    compatibleMessage({ text: 'Keep week four easy.' })) });
  const segments = segmentAnswer(result.answer);
  assert.deepEqual(segments.map(segment => segment.kind), ['prose', 'card', 'prose']);
  assert.equal(segments[0].text.trim(), 'You ran further every week.');
  assert.equal(segments[2].text.trim(), 'Keep week four easy.');
  const spec = pocketSpec(segments[1].source);
  assert.equal(spec.root, 'main'); assert.equal(spec.elements.km.props.title, 'Weekly distance');
  // The text before the card is part of the answer, not working notes.
  assert.ok(!result.reasoning.includes('further every week'));
  // The tool is offered, and the model was told the card shows, without the card being sent back to it.
  assert.ok(sent[0].tools.some(tool => tool.function.name === 'show_card'));
  assert.match(toolResults(sent[1])[0], /"drawn":true/);
  assert.ok(toolResults(sent[1])[0].length < 200);
  // The activity keeps no copy of the card either.
  const row = result.activity.find(item => item.name === 'show_card');
  assert.equal(row.state, 'done'); assert.equal(row.input, '{}');
});

test('a card that would not draw goes back to the model with what is wrong, and the corrected one is drawn', async t => {
  const chat = workspace(t), sent = [];
  const wrong = { root: 'main', elements: [{ id: 'main', type: 'Chart', props: { kind: 'pie', data: [{ label: 'W1', value: '22' }] }, children: [] }] };
  const result = await streamReply(chat, turn(), { key: 'fixture', fetcher: provider(sent,
    compatibleMessage({ text: 'Here it is.', calls: [{ name: 'show_card', input: wrong, id: 'call_wrong' }] }),
    compatibleMessage({ calls: [{ name: 'show_card', input: CHART, id: 'call_right' }] }),
    compatibleMessage({ text: 'That is the trend.' })) });
  const told = toolResults(sent[1])[0];
  assert.match(told, /card_invalid/); assert.match(told, /kind must be area, bar or line/); assert.match(told, /numbers, not strings/);
  const segments = segmentAnswer(result.answer);
  assert.deepEqual(segments.map(segment => segment.kind), ['prose', 'card', 'prose']);
  assert.equal(segments.filter(segment => segment.kind === 'card').length, 1, 'only the valid card is in the answer');
  assert.equal(answerText(result.answer), 'Here it is.\n\nThat is the trend.');
});

test('text before a lookup is still working notes, but what was written up to a drawn card stays', async t => {
  const chat = workspace(t), sent = [];
  const result = await streamReply(chat, turn(), { key: 'fixture', fetcher: provider(sent,
    compatibleMessage({ text: 'First the chart.', calls: [{ name: 'show_card', input: CHART, id: 'call_card' }] }),
    compatibleMessage({ text: 'Let me check the history too.', calls: [{ name: 'read_chat_history', input: {}, id: 'call_history' }] }),
    compatibleMessage({ text: 'Nothing earlier to compare with.' })) });
  assert.equal(answerText(result.answer), 'First the chart.\n\nNothing earlier to compare with.');
  assert.equal(segmentAnswer(result.answer).filter(segment => segment.kind === 'card').length, 1);
  assert.match(result.reasoning, /Let me check the history too\./);
});

test('while a card is written, the elements already complete are on screen, and never anything invalid', async t => {
  const chat = workspace(t), seen = [];
  const args = JSON.stringify(CHART), parts = [args.slice(0, 40), args.slice(40, 140), args.slice(140)];
  const frame = (delta, finish = null) => event({ id: 'chatcmpl_fixture', object: 'chat.completion.chunk', created: 1791500000, model: 'fixture-model', choices: [{ index: 0, delta, finish_reason: finish }] });
  const wire = frame({ role: 'assistant', content: 'Your weeks:' })
    + frame({ tool_calls: [{ index: 0, id: 'call_card', type: 'function', function: { name: 'show_card', arguments: parts[0] } }] })
    + frame({ tool_calls: [{ index: 0, function: { arguments: parts[1] } }] })
    + frame({ tool_calls: [{ index: 0, function: { arguments: parts[2] } }] })
    + frame({}, 'tool_calls') + event({ id: 'chatcmpl_fixture', object: 'chat.completion.chunk', created: 1791500000, model: 'fixture-model', choices: [], usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 } }) + 'data: [DONE]\r\n\r\n';
  const replies = [wire, compatibleMessage({ text: 'Done.' })];
  await streamReply(chat, turn(), { key: 'fixture', fetcher: async () => response(replies.shift(), 4096), onUpdate: update => seen.push(update.answer) });
  const drafts = seen.filter(answer => /```pocket\n/.test(answer) && !/\n```\n/.test(answer));
  assert.ok(drafts.length >= 1, 'an open card stood in the answer while it was written');
  for (const answer of seen) {
    for (const segment of segmentAnswer(answer).filter(item => item.kind === 'card')) {
      for (const line of segment.source.split('\n').filter(Boolean)) assert.doesNotThrow(() => JSON.parse(line), 'every line on screen is a whole patch');
    }
    assert.doesNotMatch(answerText(answer), /"elements"|\{"/, 'no card JSON in the prose');
  }
  assert.ok(drafts.some(answer => answer.includes('/elements/main')), 'the first element showed before the card was finished');
});

test('draftLines waits for whole elements; cardProblems names what to fix', () => {
  const args = JSON.stringify(CHART);
  assert.equal(draftLines(args.slice(0, 20)), '{"op":"add","path":"/root","value":"main"}');
  assert.equal(draftLines(args.slice(0, args.indexOf('"km"') + 30)).split('\n').length, 2, 'root and the one finished element');
  assert.equal(draftLines(args).split('\n').length, 3);
  assert.deepEqual(cardProblems(cardFromTool(CHART)), []);
  assert.match(drawCard({ root: 'a', elements: [{ id: 'a', type: 'Stack', props: {}, children: ['b'] }] }).message, /child "b" is not the id of an element.*shows nothing/);
  assert.match(drawCard({ root: 'a', elements: [{ id: 'a', type: 'Metric', props: { label: 'x', value: 1 } }, { id: 'b', type: 'Text', props: { text: 'lost' } }] }).message, /not reachable from root.*b/);
  assert.match(drawCard({ root: 'a', elements: [{ id: 'a', type: 'Table', props: { columns: ['A', 'B'], rows: [['1']] } }] }).message, /one cell per column/);
  assert.match(drawCard({ root: 'a', elements: [{ id: 'a', type: 'Pie', props: {} }] }).message, /"Pie" is not a component/);
});
