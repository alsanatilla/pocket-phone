import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cardFence } from '../src/shared/pocket-card-tool.js';

// A routine on the gateway: the fake follows a script of responses, so Pocket's placement is what is tested.
const card = cardFence({ root: 'main', elements: { main: { type: 'Text', props: { text: '72' }, children: [] } } }, { id: 'kcard123' });
const changed = { root: 'main', elements: { main: { type: 'Text', props: { text: '58' }, children: [] } } };
let script = [];
const server = createServer((req, res) => {
  req.resume(); req.on('end', () => {
    const step = script.shift() || { text: 'done' };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (event, data) => res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
    send('response.created', { response: { id: 'r' + Math.random().toString(36).slice(2, 6) } });
    if (step.call) send('response.output_item.done', { item: { type: 'function_call', name: step.call, call_id: 'c1', arguments: JSON.stringify(step.arguments || {}) } });
    if (step.text) send('response.output_text.delta', { delta: step.text });
    send('response.completed', { response: { id: 'resp_1', status: 'completed', usage: { output_tokens: 5 } } });
    res.end();
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
process.env.PIP_GATEWAY_URL = 'http://127.0.0.1:' + server.address().port;
process.env.PIP_GATEWAY_TOKEN = 'test-token';
test.after(() => server.close());
const { gatewayRoutine, gatewayChat, gatewayInput } = await import('../src/server/pip-gateway-run.js');

test('the chat becomes Responses input, one message per side of a turn', () => {
  assert.deepEqual(gatewayInput([{ text: 'Q one?', answer: 'A one.' }, { text: 'Q two?', answer: '' }]), [
    { role: 'user', content: 'Q one?' }, { role: 'assistant', content: 'A one.' }, { role: 'user', content: 'Q two?' }]);
});

test('a drawn card is placed where the reply stands, and the text follows it', async () => {
  script = [{ call: 'show_card', arguments: { root: 'main' } }, { text: 'Here is your reading.' }];
  const chat = { turns: [{ uid: 't1', text: 'How is my recovery?', answer: '' }] }, updates = [];
  const result = await gatewayRoutine({ chat, turn: chat.turns[0], value: {}, body: { instructions: 'Be brief.', tools: ['show_card'] },
    execute: async (name) => name === 'show_card' ? { card, id: 'kcard123', shows: 'a reading' } : { error: 'unexpected' },
    onUpdate: update => updates.push(update) });
  assert.match(result.answer, /```pocket/);
  assert.match(result.answer, /Here is your reading\.$/);
  assert.ok(result.answer.indexOf('```pocket') < result.answer.indexOf('Here is your reading.'));
  assert.deepEqual(result.activity.map(row => row.name), ['show_card']);
  assert.equal(result.usage.output_tokens, 5);
  assert.ok(updates.some(update => String(update.answer).includes('pocket')));
  const input = requests[start].body.input;
  assert.deepEqual(input.at(-1), { type: 'message', role: 'user', content: 'Now?' }, 'the current message is in the input');
  assert.equal(input.some(item => item.role === 'assistant' && item.content === ''), false);
});

test('an update_card changes the card in an earlier turn of the same chat', async () => {
  script = [{ call: 'update_card', arguments: { id: 'kold123' } }, { text: 'Changed.' }];
  const earlier = cardFence(changed, { id: 'kold123', pinned: 4242 });
  const chat = { turns: [{ uid: 'old', text: 'Earlier?', answer: 'Before.\n\n' + earlier + '\n\nAfter.' }, { uid: 't2', text: 'Now?', answer: '' }] };
  const result = await gatewayRoutine({ chat, turn: chat.turns[1], value: {}, body: { instructions: '', tools: ['update_card'] },
    execute: async (name) => name === 'update_card' ? { revise: true, id: 'kold123', spec: changed } : { error: 'unexpected' } });
  assert.match(chat.turns[0].answer, /"58"/);
  assert.match(chat.turns[0].answer, /\/pinned/);
  assert.match(chat.turns[0].answer, /4242/);
  assert.equal(result.answer, 'Changed.');
});

test('a chat reply places a card in its own answer and keeps the person\'s message in the input', async () => {
  script = [{ call: 'show_card', arguments: {} }, { text: 'Done.' }];
  const start = requests.length;
  const chat = { turns: [{ uid: 'old', text: 'Earlier question', answer: 'Earlier answer' }, { uid: 't1', text: 'Now?', answer: '' }] };
  const updates = [];
  const result = await gatewayChat({ chat, turn: chat.turns[1], value: {}, body: { instructions: 'Be brief.', tools: ['show_card'] },
    execute: async name => name === 'show_card' ? { card, id: 'kcard123' } : { error: 'unexpected' }, onUpdate: update => updates.push(update) });
  assert.match(result.answer, /```pocket/);
  assert.match(result.answer, /Done\.$/);
  assert.ok(result.answer.indexOf('```pocket') < result.answer.indexOf('Done.'));
  assert.ok(updates.some(update => String(update.answer).includes('pocket')));
  const input = requests[start].body.input;
  assert.deepEqual(input.at(-1), { type: 'message', role: 'user', content: 'Now?' }, 'the current message is in the input');
  assert.equal(input.some(item => item.role === 'assistant' && item.content === ''), false);
});
