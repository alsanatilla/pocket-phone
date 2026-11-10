import test from 'node:test';
import assert from 'node:assert/strict';
import { answerOf, applyOps, blocksOf, diffReply, emptyReply, replyOf, segmentsOf } from '../src/shared/pip-blocks.js';
import { segmentAnswer } from '../src/shared/pip-reply.js';
import { subscribe } from '../src/server/pocket-events.js';
import * as stream from '../src/server/pip-run-stream.js';

// A reply streams as numbered changes to its blocks. The server cuts the answer once and sends what changed; the
// browser applies it. These check that both ends agree at every point of a reply, and what a late or lossy
// follower gets.

const P = (path, value) => JSON.stringify({ op: 'add', path, value });
const CARD = [P('/root', 'main'), P('/elements/main', { type: 'Stack', props: {}, children: ['m'] }), P('/elements/m', { type: 'Metric', props: { label: 'km', value: 38 }, children: [] })];
const FENCE = '```pocket\n' + CARD.join('\n') + '\n```';
const ANSWER = 'You ran further every week.\n\n' + FENCE + '\n\nKeep week four **easy**.\n\n- one\n- two';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('applying the changes gives the follower exactly the server\'s blocks, at every point of a reply', () => {
  const follower = emptyReply(); let before = emptyReply(), sent = 0, whole = 0;
  for (let end = 1; end <= ANSWER.length; end += 3) {
    const turn = { answer: ANSWER.slice(0, end), reasoning: 'Thinking'.slice(0, Math.min(8, end)), activity: end > 40 ? [{ id: 'a', state: 'done' }] : [], sources: [], phase: 'writing', model: 'm', usage: {} };
    const next = structuredClone(replyOf(turn)), ops = diffReply(before, next);
    sent += JSON.stringify(ops).length; whole += JSON.stringify(next).length;
    assert.ok(applyOps(follower, structuredClone(ops)));
    assert.deepEqual(follower, next, 'at ' + end);
    before = next;
  }
  assert.deepEqual(segmentsOf(follower.blocks), segmentAnswer(ANSWER).map(segment => segment.kind === 'prose' ? { ...segment, text: segment.text.trimEnd() } : segment), 'the same segments and keys the finished answer has');
  assert.deepEqual(blocksOf(answerOf(follower.blocks)), follower.blocks, 'the text the blocks stand for cuts into the same blocks');
  assert.ok(sent < whole / 8, `changes are small: ${sent} bytes instead of ${whole}`);
});

test('a card that is withdrawn or replaced reaches the follower too', () => {
  const follower = emptyReply(); let before = emptyReply();
  const step = answer => { const next = replyOf({ answer }), ops = diffReply(before, next); assert.ok(applyOps(follower, structuredClone(ops))); before = next; return ops; };
  step('Here it is.\n\n```pocket\n' + CARD[0] + '\n' + CARD[1] + '\n');
  assert.equal(follower.blocks[1].closed, false);
  // The draft gives way: the model's call was invalid and it writes on instead.
  assert.deepEqual(step('Here it is.').map(op => op.o), ['cut']);
  assert.equal(follower.blocks.length, 1);
  step('Here it is.\n\n' + FENCE + '\n\n');
  assert.deepEqual(follower.blocks.map(block => [block.kind, block.closed]), [['prose', true], ['card', true]]);
  // A change that does not fit what the follower holds is refused, not half applied.
  assert.equal(applyOps(emptyReply(), [{ o: 'append', i: 3, s: 'x' }]), false);
});

test('the run stream numbers its changes, replays what a follower missed, and gives a latecomer the whole state', async () => {
  stream.forgetRuns();
  const heard = [], stop = subscribe('u1', event => { if (event.kind === 'delta') heard.push(event); });
  try {
    const turn = { answer: '', reasoning: '', activity: [], sources: [], phase: 'writing', model: 'm', usage: {} };
    const feed = () => stream.feed('u1', { type: 'run', kind: 'progress', runId: 'r1', chat: 'c1', requestId: 'q1', turn });
    for (const part of ['You ran ', 'further.', '\n\n' + FENCE, '\n\nKeep it easy.']) { turn.answer += part; feed(); feed(); await sleep(50); }
    assert.deepEqual(heard.map(event => event.seq), [1, 2, 3, 4], 'one numbered event per change, however often it was fed');
    assert.equal(heard[0].chat, 'c1'); assert.equal(heard[0].requestId, 'q1');
    // A follower that has 2 gets 3 and 4; one with nothing gets the state in one event.
    assert.deepEqual(stream.resume('u1', 'r1', 2).events.map(event => event.seq), [3, 4]);
    const late = stream.resume('u1', 'r1', 0), follower = emptyReply();
    assert.equal(late.events.length, 1); assert.equal(late.events[0].seq, 4);
    assert.ok(applyOps(follower, late.events[0].ops));
    assert.equal(answerOf(follower.blocks), turn.answer);
    // Another account learns nothing about the run; an unknown run is simply not streamed here.
    assert.deepEqual(stream.resume('u2', 'r1', 0), { seq: 0, events: [] });
    assert.deepEqual(stream.resume('u1', 'nope', 0), { seq: 0, events: [] });
    // A step of the run sends what is pending at once, and its end closes the stream.
    turn.answer += ' Done.'; feed(); stream.settle('r1', true);
    assert.equal(heard.at(-1).seq, 5); assert.deepEqual(heard.at(-1).ops, [{ o: 'append', i: 2, s: ' Done.' }]);
    assert.deepEqual(stream.resume('u1', 'r1', 0), { seq: 0, events: [] });
  } finally { stop(); stream.forgetRuns(); }
});
