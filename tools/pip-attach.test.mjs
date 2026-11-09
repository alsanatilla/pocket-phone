import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatStore, ReplyRunner } from '../src/client/pip-core.js';

// One chat, many tabs and devices: a reply that runs in a chat shows in every tab that has it open, and a message
// sent while one runs is not lost and does not become a broken reply.

class Memory {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
const ready = () => { const store = new ChatStore(new Memory()), chat = store.create(); return { store, chat }; };
const running = { runId: 'run-1', turnUid: 'turn-elsewhere', requestId: 'req-1', created: 1, turn: { text: 'Bau mir die Visualisierung', created: 1, attempt: 'req-1' } };

test('a reply running in the chat from another device shows here live and is kept when it ends', async () => {
  const { store, chat } = ready(), events = [];
  const follow = async (_chat, turn, options) => {
    assert.equal(turn, null); assert.equal(options.attach, true);
    options.onRun(running);
    options.onUpdate({ answer: 'Die Kurve', phase: 'writing' });
    options.onUpdate({ answer: 'Die Kurve steigt.' });
    return { answer: 'Die Kurve steigt.', reasoning: '', activity: [], sources: [], phase: 'done' };
  };
  const runner = new ReplyRunner(store, { remote: { available: async () => true, stream: async () => ({}), attach: follow }, onChange: event => events.push(event) });
  assert.equal(await runner.attach(chat.uid), true);
  const kept = store.get(chat.uid).turns.find(turn => turn.uid === 'turn-elsewhere');
  assert.equal(kept.text, 'Bau mir die Visualisierung'); assert.equal(kept.answer, 'Die Kurve steigt.'); assert.equal(kept.status, 'done');
  assert.deepEqual(events.map(event => event.type), ['started', 'delta', 'delta', 'delta', 'finished']);
  assert.equal(events[1].turn.answer, 'Die Kurve', 'each delta reaches the screen as it comes');
  assert.equal(runner.active, null);
});

test('nothing running: attaching changes nothing', async () => {
  const { store, chat } = ready(), events = [];
  const runner = new ReplyRunner(store, { remote: { available: async () => true, stream: async () => ({}), attach: async () => ({ none: true }) }, onChange: event => events.push(event) });
  assert.equal(await runner.attach(chat.uid), false);
  assert.equal(store.get(chat.uid).turns.length, 0); assert.deepEqual(events, []);
});

test('a message sent while another device’s reply runs goes back to the composer, and this tab shows that reply', async () => {
  const { store, chat } = ready(); let attached = 0;
  const refusal = Object.assign(new Error('Pip is still answering in this chat. Wait for it, or stop it first.'), { code: 'run_active', status: 409 });
  const runner = new ReplyRunner(store, { remote: { available: async () => true, stream: async () => { throw refusal; },
    attach: async (_chat, _turn, options) => { attached++; options.onRun(running); return { answer: 'Fertig.', activity: [], sources: [] }; } } });
  await assert.rejects(runner.send(chat.uid, { text: 'ok' }), /still answering/);
  await new Promise(resolve => setTimeout(resolve, 10));
  const saved = store.get(chat.uid);
  assert.equal(saved.draft, 'ok', 'the message waits in the composer');
  assert.ok(!saved.turns.some(turn => turn.text === 'ok'), 'no broken reply for it');
  assert.equal(attached, 1);
  assert.equal(saved.turns.find(turn => turn.uid === 'turn-elsewhere')?.answer, 'Fertig.');
});
