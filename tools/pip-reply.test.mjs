import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAnswer, answerText, segmentAnswer } from '../src/shared/pip-reply.js';
import { excerpt, replyNotice } from '../src/shared/pip-notice.js';

// Every finished reply leaves the model through normalizeAnswer, wherever it ran. What it stores is what every
// reader gets: the chat, the classic app, push text, search and the model's own history.

const P = (path, value) => JSON.stringify({ op: 'add', path, value });
const tree = P('/root', { type: 'Stack', props: { direction: 'vertical' }, children: [
  { type: 'Metric', props: { label: 'Ziel', value: 150, unit: 'kg' } },
  { type: 'Text', props: { variant: 'muted' }, children: [{ text: 'Wiederholen statt erzwingen.' }] }] });
const gemma = `Fortschrittskurve:\n\npocket\n\n${tree}\n</parameter>\n</function>\n\nViel Erfolg!   \n\n\n`;

test('a reply in any card shape is stored with fenced, flat cards and no debris', () => {
  const stored = normalizeAnswer(gemma);
  assert.match(stored, /^Fortschrittskurve:\n\n```pocket\n\{"op":"add","path":"\/root","value":"stack"\}\n/);
  assert.match(stored, /\n```\n\nViel Erfolg!$/);
  assert.doesNotMatch(stored, /parameter|function|^pocket$/m);
  const card = segmentAnswer(stored).find(segment => segment.kind === 'card');
  assert.equal(card.closed, true);
  for (const line of card.source.split('\n')) {
    const patch = JSON.parse(line);
    assert.ok(patch.path === '/root' || patch.path.startsWith('/elements/'));
    if (patch.value?.children) assert.ok(patch.value.children.every(child => typeof child === 'string'), 'children are ids');
  }
});

test('normalizing is idempotent and leaves plain prose and code alone', () => {
  const once = normalizeAnswer(gemma);
  assert.equal(normalizeAnswer(once), once);
  const prose = 'Plain answer.\n\n```js\nconst x = {"op":"add"};\n```\n\n- one\n- two';
  assert.equal(normalizeAnswer(prose), prose);
});

test('a card that holds nothing is dropped instead of stored', () => {
  assert.equal(normalizeAnswer('Hier:\n\n```pocket\n{"op":"add","path":"/root","value":"missing"}\n```\n\nDanach.'), 'Hier:\n\nDanach.');
  assert.equal(normalizeAnswer('Hier:\n\n```pocket\nnot json\n```'), 'Hier:');
});

test('push text and search read the prose, never card JSON', () => {
  const stored = normalizeAnswer(gemma);
  assert.equal(answerText(stored), 'Fortschrittskurve:\n\nViel Erfolg!');
  const notice = replyNotice({ uid: 'c1', title: 'RDL' }, { status: 'done', answer: stored });
  assert.doesNotMatch(notice.body, /op|path|elements|\{/);
  assert.match(notice.body, /Fortschrittskurve: Viel Erfolg!/);
  assert.equal(excerpt('a'), 'a');
});
