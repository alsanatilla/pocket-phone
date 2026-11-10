import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatStore, DEFAULT_CONFIG, config, streamReply } from '../src/client/pip-core.js';
import { segmentAnswer, answerText } from '../src/shared/pip-reply.js';
import { pocketSpec } from '../src/shared/pocket-spec.js';
import { cardProblems, cardFromTool, draftLines, drawCard } from '../src/shared/pocket-card-tool.js';
import { CARDS_PROMPT } from '../src/shared/pocket-cards.js';
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

// ---- a card stays alive: update_card changes it where it stands ----------------------------------------------------
const { replaceCard, cardIds, cardsAsRecords, cardFence } = await import('../src/shared/pocket-card-tool.js');
const { normalizeAnswer } = await import('../src/shared/pip-reply.js');
const withValue = value => ({ root: 'main', elements: [{ id: 'main', type: 'Metric', props: { label: 'Canyon Endurace', value, unit: '€' }, children: [] }] });
const cardsOf = answer => segmentAnswer(answer).filter(segment => segment.kind === 'card').map(segment => pocketSpec(segment.source));

test('a drawn card has an id the model is told, and update_card changes that card in the same reply', async t => {
  const chat = workspace(t), sent = [];
  const replies = [compatibleMessage({ text: 'The price today:', calls: [{ name: 'show_card', input: withValue(950), id: 'call_draw' }] })];
  const result = await streamReply(chat, turn(), { key: 'fixture', fetcher: async (_url, options) => {
    sent.push(JSON.parse(options.body));
    if (replies.length) return response(replies.shift());
    // The second round reads the id it was given and corrects the card; the third closes the reply.
    const id = /"id":"(k[a-z0-9]+)"/.exec(toolResults(sent.at(-1)).join(' '))?.[1];
    return response(sent.length === 2 ? compatibleMessage({ calls: [{ name: 'update_card', input: { id, ...withValue(899) }, id: 'call_update' }] }) : compatibleMessage({ text: 'Corrected: it dropped.' }));
  } });
  const [card] = cardsOf(result.answer);
  assert.equal(cardsOf(result.answer).length, 1, 'changed in place, not drawn twice');
  assert.match(card.id, /^k[a-z0-9]{6}$/); assert.equal(card.elements.main.props.value, 899); assert.ok(card.updated > 0);
  assert.deepEqual(segmentAnswer(result.answer).map(segment => segment.kind), ['prose', 'card', 'prose']);
  assert.match(toolResults(sent[2]).at(-1), /"updated":true/);
  // The id and the time survive the clean form a reply is stored in.
  assert.equal(normalizeAnswer(result.answer), result.answer);
});

test('update_card changes a card in an earlier reply, tells the path that keeps the chat, and names the cards when the id is wrong', async t => {
  const chat = workspace(t), kept = [];
  const old = cardFence({ root: 'main', elements: { main: { type: 'Metric', props: { label: 'Canyon Endurace', value: 950, unit: '€' }, children: [] } } }, { id: 'kprice1' });
  chat.turns = [{ uid: 'earlier', text: 'Watch the bike', answer: 'Lowest so far:\n\n' + old + '\n\nI keep looking.', status: 'done', created: 1, updated: 5, context: [], activity: [] }];
  const sent = [];
  const result = await streamReply(chat, { uid: 'now', text: 'Any change?', context: [] }, { key: 'fixture', saveTurn: changed => { kept.push(structuredClone(changed)); },
    fetcher: provider(sent,
      compatibleMessage({ calls: [{ name: 'update_card', input: { id: 'kwrong9', ...withValue(899) }, id: 'call_wrong' }] }),
      compatibleMessage({ calls: [{ name: 'update_card', input: { id: 'kprice1', ...withValue(899) }, id: 'call_right' }] }),
      compatibleMessage({ text: 'It dropped to 899 €; the card above is current.' })) });
  // The model saw the earlier card as a record with its id, never as a format.
  const replayed = sent[0].messages.find(message => message.role === 'assistant');
  assert.match(String(replayed.content), /\[card kprice1 drawn here with show_card: Metric “Canyon Endurace”; change it with update_card\]/);
  assert.doesNotMatch(String(replayed.content), /```|"elements"/);
  assert.match(toolResults(sent[1])[0], /card_not_found.*Cards here: kprice1/);
  assert.match(toolResults(sent[2]).at(-1), /"updated":true.*an earlier reply/);
  assert.equal(kept.length, 1); assert.equal(kept[0].uid, 'earlier'); assert.ok(kept[0].updated > 5);
  const [card] = cardsOf(kept[0].answer);
  assert.equal(card.id, 'kprice1'); assert.equal(card.elements.main.props.value, 899); assert.ok(card.updated > 0);
  assert.match(kept[0].answer, /^Lowest so far:\n\n```pocket[\s\S]*```\n\nI keep looking\.$/, 'the words around the card are untouched');
  assert.equal(cardsOf(result.answer).length, 0, 'no second card in the new reply');
});

test('cards are found and replaced by id only', () => {
  const a = cardFence({ root: 'm', elements: { m: { type: 'Text', props: { text: 'a' }, children: [] } } }, { id: 'kaaaa11' });
  const b = cardFence({ root: 'm', elements: { m: { type: 'Text', props: { text: 'b' }, children: [] } } }, { id: 'kbbbb22' });
  const legacy = '```pocket\n{"op":"add","path":"/root","value":"m"}\n{"op":"add","path":"/elements/m","value":{"type":"Text","props":{"text":"old"},"children":[]}}\n```';
  const text = 'One\n\n' + a + '\n\nTwo\n\n' + legacy + '\n\n' + b;
  assert.deepEqual(cardIds(text), ['kaaaa11', 'kbbbb22']);
  assert.equal(replaceCard(text, 'kzzzz99', a), null);
  const changed = replaceCard(text, 'kbbbb22', cardFence({ root: 'm', elements: { m: { type: 'Text', props: { text: 'B!' }, children: [] } } }, { id: 'kbbbb22', updated: 7 }));
  assert.ok(changed.startsWith('One\n\n' + a + '\n\nTwo\n\n' + legacy)); assert.match(changed, /"B!"/); assert.doesNotMatch(changed, /"text":"b"/);
  assert.match(cardsAsRecords(text), /\[card drawn here with show_card: Text\]/, 'a card from before ids is a record without one');
});

// ---- a card record is not prose: a model may copy one, the person must never see it ---------------------------------
const RECORD_WITH_ID = '[card k1a2b3c drawn here with show_card: Metric “HRV”; change it with update_card]';
const RECORD_WITHOUT_ID = '[card drawn here with show_card: Text]';

test('a card record line is dropped alone and between prose paragraphs, in both forms', () => {
  for (const record of [RECORD_WITH_ID, RECORD_WITHOUT_ID]) {
    assert.deepEqual(segmentAnswer(record), []);
    assert.equal(normalizeAnswer(record), '');
    const text = 'Before the card.\n\n' + record + '\n\nAfter the card.';
    const segments = segmentAnswer(text);
    assert.equal(segments.length, 1, 'the record leaves one prose segment');
    assert.equal(segments[0].kind, 'prose');
    assert.match(segments[0].text, /Before the card\./);
    assert.match(segments[0].text, /After the card\./);
    assert.doesNotMatch(segments[0].text, /drawn here with show_card/);
    assert.deepEqual(normalizeAnswer(text).split('\n').filter(line => line.trim()), ['Before the card.', 'After the card.']);
  }
});

test('prose about a card, and a line that merely starts with [card, stay in the answer', () => {
  const prose = 'I drew a card here with show_card earlier.';
  const line = '[card game tonight]';
  assert.equal(normalizeAnswer(prose), prose);
  assert.equal(answerText(prose), prose);
  assert.equal(normalizeAnswer(line), line);
  assert.equal(answerText(line), line);
  assert.equal(normalizeAnswer(prose + '\n\n' + line), prose + '\n\n' + line);
  // A record a model made up after the real ones goes too.
  assert.equal(normalizeAnswer('Added W4.\n\n[card kb7k749 updated with show_card: Chart “Weekly distance”]'), 'Added W4.');
  assert.equal(normalizeAnswer('[card kb7k749 changed with update_card]'), '');
});

test('the record cardsAsRecords writes for a real card is the line an answer drops', () => {
  const fence = cardFence(cardFromTool(withValue(950)), { id: 'kprice1' });
  const record = cardsAsRecords('Lowest so far:\n\n' + fence + '\n\nI keep looking.').split('\n').find(line => line.startsWith('[card '));
  assert.equal(record, '[card kprice1 drawn here with show_card: Metric “Canyon Endurace”; change it with update_card]');
  assert.deepEqual(segmentAnswer(record), []);
  assert.equal(normalizeAnswer(record), '');
  const oldRecord = cardsAsRecords(cardFence(cardFromTool(withValue(950))));
  assert.equal(oldRecord, '[card drawn here with show_card: Metric “Canyon Endurace”]');
  assert.deepEqual(segmentAnswer(oldRecord), []);
});

test('the cards prompt says that describing a change does not change the card', () => {
  assert.match(CARDS_PROMPT, /When the person asks to change, correct or add to something a card in this chat shows, call update_card; describing the change in words does not change the card\./);
});

test('a reply that copies a card record into its text is stored without the record', async t => {
  const chat = workspace(t), sent = [];
  const result = await streamReply(chat, turn(), { key: 'fixture', fetcher: provider(sent,
    compatibleMessage({ text: 'HRV is 58 ms now.\n\n' + RECORD_WITH_ID + '\n\nRest is unchanged.' })) });
  assert.doesNotMatch(result.answer, /drawn here with show_card/);
  assert.ok(!result.answer.includes('k1a2b3c'));
  assert.deepEqual(result.answer.split('\n').filter(line => line.trim()), ['HRV is 58 ms now.', 'Rest is unchanged.']);
});
