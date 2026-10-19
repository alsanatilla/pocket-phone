import test from 'node:test';
import assert from 'node:assert/strict';
import { excerpt, replyNotice, waitingNotice } from '../src/shared/pip-notice.js';

test('a notification reads a reply’s words, not its Markdown', () => {
  assert.equal(excerpt('Two tasks are **overdue**.'), 'Two tasks are overdue.');
  assert.equal(excerpt('## Plan\n\n- Read [the note](/notes/a) about `blue_car`\n> quoted *gently*'), 'Plan Read the note about blue_car quoted gently');
  assert.equal(excerpt('Keep my_file_name and snake_case as they are.'), 'Keep my_file_name and snake_case as they are.');
  assert.equal(excerpt('| a | b |\n|---|---|\n\n---\nafter'), 'a b after');
  const long = excerpt('word '.repeat(80));
  assert.ok(long.length <= 160 && long.endsWith('…'));
});

test('a notice names the chat once, links to it, and stays quiet about a stopped reply', () => {
  const chat = { uid: 'c1', title: 'Blue car' };
  assert.deepEqual(replyNotice(chat, { status: 'done', answer: 'It costs 21,000 euros.' }), { title: 'Pip · Blue car', body: 'It costs 21,000 euros.', href: '/pip/c1', tag: 'pip-c1' });
  assert.equal(replyNotice({ uid: 'c2', title: 'Pip · Morning check-in' }, { status: 'done', answer: '' }).title, 'Pip · Morning check-in');
  assert.equal(replyNotice(chat, { status: 'done', answer: '' }).body, 'Pip replied.');
  assert.equal(replyNotice(chat, { status: 'failed', error: 'The provider declined this reply.' }).body, 'Pip could not finish: The provider declined this reply.');
  assert.equal(replyNotice(chat, { status: 'stopped' }), null);
  assert.equal(waitingNotice(chat, ['save note “Blue car”', 'move appointment']).body, 'Waiting for your OK: save note “Blue car” · move appointment');
  assert.equal(waitingNotice(chat, []).body, 'Pip is waiting for you.');
});
