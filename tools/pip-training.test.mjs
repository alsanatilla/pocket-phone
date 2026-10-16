import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatStore, config, streamReply } from '../src/client/pip-core.js';
import { execute, recordSource, saveAccess, toolNames } from '../src/client/pip-tools.js';
import { saveTraining, trainingInstructions } from '../src/client/pip-training.js';
import { compatibleMessage, response } from './pip-provider-fixtures.mjs';

class Memory {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
function workspace(t) {
  const previous = globalThis.localStorage;
  globalThis.localStorage = new Memory();
  t.after(() => { globalThis.localStorage = previous; });
  const chat = new ChatStore(globalThis.localStorage).create(config({ provider: 'compatible', model: 'fixture-model', baseUrl: 'https://model.example/v1', maxTokens: 4096 }));
  saveAccess(chat.config, ['gym']);
  return chat;
}

test('normal Pip chat remembers training through the SDK and uses it in the next reply', async t => {
  const chat = workspace(t), state = { trainingReady: true, routines: [] }, saves = [];
  const source = recordSource(() => ({}), { training: async (uid, input) => {
    assert.equal(uid, chat.uid); saves.push(input);
    const previous = state.routines[0] || { kind: 'training', enabled: false, feedback: [] };
    state.routines = [{ ...previous, ...(input.brief ? { prompt: input.brief } : {}), ...(input.trainingDays ? { trainingDays: input.trainingDays } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}), feedback: [...previous.feedback, ...(input.feedback ? [{ at: Date.now(), text: input.feedback }] : [])] }];
    return { kind: 'training', automatic: state.routines[0].enabled ? 'on' : 'off' };
  } });
  const first = { uid: 'goals', text: 'I want a relaxed 10k and gym twice weekly. Weekends work. Please plan automatically.', context: [], created: 1 };
  chat.turns.push(first);
  let calls = 0;
  const run = (turn, input, answer, expected) => streamReply(chat, turn, { key: 'fixture', training: { instructions: trainingInstructions(state) },
    approve: () => { throw new Error('Preferences should not interrupt the conversation with a review.'); },
    executeTool: (value, name, args, signal, context) => execute(value, name, args, signal, { ...context, source }),
    fetcher: async (_, options) => {
      const request = JSON.parse(options.body);
      assert.ok(request.tools.some(tool => tool.function.name === 'update_training_preferences'));
      if (expected) assert.match(JSON.stringify(request.messages), expected);
      return response(++calls % 2 ? compatibleMessage({ calls: [{ name: 'update_training_preferences', id: 'remember-' + calls, input }] }) : compatibleMessage({ text: answer }));
    } });
  Object.assign(first, await run(first, { brief: 'Relaxed 10k and gym twice weekly.', trainingDays: [0, 6], enabled: true }, 'How did your last workout feel?'), { status: 'done' });
  const followup = { uid: 'feedback', text: 'My legs are sore. Pause automatic planning.', context: [], created: 2 };
  chat.turns.push(followup);
  const reply = await run(followup, { feedback: 'Legs sore after the last workout.', enabled: false }, 'Planning is paused. We can talk about recovery.', /Relaxed 10k and gym twice weekly/);
  assert.match(reply.answer, /paused/); assert.equal(saves.length, 2);
  assert.equal(state.routines[0].prompt, 'Relaxed 10k and gym twice weekly.'); assert.equal(state.routines[0].enabled, false);
  assert.ok(!toolNames(chat.config).includes('update_training_preferences'));
  saveAccess(chat.config, []);
  assert.ok(!toolNames({ ...chat.config, training: {} }).includes('update_training_preferences'));
});

test('parallel preference saves keep their order and queued saves stop after an account change', async t => {
  workspace(t);
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  globalThis.localStorage.setItem('pocket:active-account', 'account-a');
  const sent = []; let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  globalThis.fetch = async (_, options) => {
    const body = JSON.parse(options.body); sent.push(body);
    if (sent.length === 1) { entered(); await new Promise(resolve => { release = resolve; }); }
    return Response.json({ accountId: body.accountId, training: { kind: 'training', automatic: 'off' } });
  };
  const first = saveTraining('ordinary-chat', { brief: 'A relaxed 10k.' });
  const second = saveTraining('ordinary-chat', { feedback: 'Tired today.' });
  await started; assert.equal(sent.length, 1); release();
  await Promise.all([first, second]);
  assert.equal(sent.length, 2); assert.equal(sent[1].preferences.feedback, 'Tired today.');
  const late = saveTraining('ordinary-chat', { enabled: true });
  globalThis.localStorage.setItem('pocket:active-account', 'account-b');
  await assert.rejects(late, { name: 'AbortError' }); assert.equal(sent.length, 2);
});
