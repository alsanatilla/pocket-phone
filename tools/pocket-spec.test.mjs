import test from 'node:test';
import assert from 'node:assert/strict';
import { pocketSpec } from '../src/shared/pocket-spec.js';

// A reply can carry a finished spec or the JSONL patch stream json-render writes. The stream is what makes a card
// appear while the model is still typing, so the parser must tolerate a line that is not finished yet.

const patch = (op, path, value) => JSON.stringify(value === undefined ? { op, path } : { op, path, value });

test('a finished spec passes straight through', () => {
  const spec = { root: 'c', elements: { c: { type: 'Card', props: {}, children: [] } } };
  assert.deepEqual(pocketSpec(JSON.stringify(spec)), spec);
});

test('a patch stream builds the tree in order', () => {
  const text = [
    patch('add', '/root', 'c'),
    patch('add', '/elements/c', { type: 'Card', props: { title: 'Heute' }, children: ['t'] }),
    patch('add', '/elements/t', { type: 'Text', props: { content: 'hi' }, children: [] })
  ].join('\n');
  const spec = pocketSpec(text);
  assert.equal(spec.root, 'c');
  assert.equal(spec.elements.c.props.title, 'Heute');
  assert.equal(spec.elements.t.props.content, 'hi');
});

test('a half-written last line is skipped, not thrown on', () => {
  const text = [
    patch('add', '/root', 'c'),
    patch('add', '/elements/c', { type: 'Card', props: { title: 'x' }, children: [] }),
    '{"op":"add","path":"/elements/t","value":{"type":"Text","props":{"conte'
  ].join('\n');
  const spec = pocketSpec(text);
  assert.equal(spec.elements.c.props.title, 'x');
  assert.equal(spec.elements.t, undefined);
});

test('later patches replace earlier props', () => {
  const text = [
    patch('add', '/elements/c', { type: 'Card', props: { title: 'a' }, children: [] }),
    patch('replace', '/elements/c/props/title', 'b')
  ].join('\n');
  assert.equal(pocketSpec(text).elements.c.props.title, 'b');
});

test('remove deletes an element from the map', () => {
  const text = [
    patch('add', '/elements/c', { type: 'Card', props: {}, children: ['t'] }),
    patch('add', '/elements/t', { type: 'Text', props: { content: 'x' }, children: [] }),
    patch('remove', '/elements/t')
  ].join('\n');
  assert.equal(pocketSpec(text).elements.t, undefined);
});

test('prose is not a spec', () => {
  assert.equal(pocketSpec('just some words'), null);
  assert.equal(pocketSpec('{"not":"a patch"}'), null);
});
