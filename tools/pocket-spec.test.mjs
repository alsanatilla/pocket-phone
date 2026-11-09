import test from 'node:test';
import assert from 'node:assert/strict';
import { pocketSpec, normalizeSpec, isLegacySpec, withoutLegacyCards } from '../src/shared/pocket-spec.js';

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

test('the retired card shape is told apart from the current one', () => {
  const legacy = { root: 'c', elements: { c: { type: 'Card', props: { title: 'Alt', subtitle: 'x' }, children: [] } } };
  const current = { root: 'c', elements: { c: { type: 'Card', props: { title: 'Neu', description: 'x' }, children: ['h'] }, h: { type: 'Hero', props: { value: '1' }, children: [] } } };
  assert.equal(isLegacySpec(legacy), true);
  assert.equal(isLegacySpec(current), false);
  assert.equal(isLegacySpec(pocketSpec('{"root":"c","elements":{"t":{"type":"Chart","props":{"chart":{"data":[1,2]}},"children":[]}}}')), true);
  assert.equal(isLegacySpec(pocketSpec('{"root":"c","elements":{"t":{"type":"Chart","props":{"kind":"bar","data":[{"label":"a","value":1}]},"children":[]}}}')), false);
});

test('a replayed answer keeps its prose but loses a retired-format card', () => {
  const legacy = 'Before.\n\n```pocket\n{"root":"c","elements":{"c":{"type":"Card","props":{"subtitle":"x"},"children":[]}}}\n```\n\nAfter.';
  const kept = 'Before.\n\n```pocket\n{"root":"c","elements":{"c":{"type":"Card","props":{"title":"x"},"children":[]}}}\n```\n\nAfter.';
  const stripped = withoutLegacyCards(legacy);
  assert.match(stripped, /Before\./);
  assert.match(stripped, /After\./);
  assert.match(stripped, /retired card format/);
  assert.doesNotMatch(stripped, /subtitle/);
  assert.equal(withoutLegacyCards(kept), kept);
});

test('a patch missing only closing brackets retains its chart data', () => {
  const chart = { type: 'Chart', props: { kind: 'bar', data: [{ label: 'A', value: 403 }], note: 'brackets } ] and "quotes"' }, children: [] };
  const source = patch('add', '/root', 'main') + '\n' + patch('add', '/elements/chart', chart).slice(0, -1);
  const spec = normalizeSpec(pocketSpec(source));
  assert.equal(spec.root, 'chart');
  assert.deepEqual(spec.elements.chart, chart);
});

test('repair does not accept incomplete strings, missing values or mismatched brackets', () => {
  for (const tail of ['{"type":"Text","props":{"content":"unfinished', '{"type":', '{"children":[}', '{"type":"Text",']) {
    const source = patch('add', '/root', 'main') + '\n{"op":"add","path":"/elements/bad","value":' + tail;
    assert.deepEqual(pocketSpec(source), { root: 'main' });
  }
});

test('a missing root wraps only top-level elements, without mutating the input', () => {
  const spec = { root: 'main', elements: {
    hero: { type: 'Hero', props: { value: '42' }, children: [] },
    grid: { type: 'Grid', props: {}, children: ['metric'] },
    metric: { type: 'Metric', props: { value: '7' }, children: [] },
  } };
  const normalized = normalizeSpec(spec);
  assert.equal(normalized.root, 'main');
  assert.deepEqual(normalized.elements.main.children, ['hero', 'grid']);
  assert.equal(normalized.elements.main.type, 'Stack');
  assert.equal(normalized.elements.grid, spec.elements.grid);
  assert.equal(spec.elements.main, undefined);
});

test('normalization preserves a valid root and leaves empty or cyclic trees alone', () => {
  for (const spec of [null, { root: 'main' }, { elements: {} },
    { root: 'main', elements: { main: { type: 'Text', children: [] }, extra: { type: 'Text', children: [] } } },
    { elements: { a: { children: ['b'] }, b: { children: ['a'] } } },
  ]) assert.equal(normalizeSpec(spec), spec);
});

test('an inferred root does not overwrite an existing main element', () => {
  const spec = { elements: {
    a: { type: 'Stack', children: ['main'] },
    main: { type: 'Text', children: [] },
    b: { type: 'Text', children: [] },
  } };
  const normalized = normalizeSpec(spec);
  assert.notEqual(normalized.root, 'main');
  assert.equal(normalized.elements.main, spec.elements.main);
  assert.deepEqual(normalized.elements[normalized.root].children, ['a', 'b']);
});

test('a card written as one nested tree becomes elements json-render can draw', () => {
  const value = { type: 'Stack', props: { gap: 'md' }, children: [
    { type: 'Chart', props: { kind: 'line', title: 'RDL', data: [{ label: 'W1', value: 110 }] } },
    { type: 'Text', props: { variant: 'muted' }, children: [{ text: 'Wiederholen' }, { text: 'statt erzwingen.' }] },
    { type: 'Button', props: { label: 'Plan anlegen' }, children: [{ type: 'Text', props: {}, children: [{ text: 'Erklärung' }] }] }] };
  const fromPatch = normalizeSpec(pocketSpec(patch('add', '/root', value)));
  assert.equal(fromPatch.root, 'stack');
  assert.deepEqual(fromPatch.elements.stack.children, ['chart', 'text', 'button']);
  assert.deepEqual(fromPatch.elements.text, { type: 'Text', props: { variant: 'muted', text: 'Wiederholen statt erzwingen.' }, children: [] });
  assert.deepEqual(fromPatch.elements.button.children, ['text_2']);
  // Text wrapped around elements groups them; its own words come first.
  const wrapped = normalizeSpec(pocketSpec(JSON.stringify({ type: 'Text', props: { variant: 'body' }, children: [{ type: 'Text', props: {}, children: [{ text: 'Die Kurve steigt.' }] }] })));
  assert.equal(wrapped.elements[wrapped.root].type, 'Stack');
  assert.deepEqual(wrapped.elements[wrapped.root].children.map(id => wrapped.elements[id].props.text), ['Die Kurve steigt.']);
  assert.equal(fromPatch.elements.chart.props.title, 'RDL');
  // The same tree as the whole spec, and ids that do not move while the tree grows.
  const whole = normalizeSpec(pocketSpec(JSON.stringify(value)));
  assert.deepEqual(whole, fromPatch);
  const partial = normalizeSpec(pocketSpec(patch('add', '/root', { ...value, children: value.children.slice(0, 1) })));
  assert.deepEqual(partial.elements.chart, fromPatch.elements.chart);
  // Flat specs are untouched.
  const flat = { root: 'a', elements: { a: { type: 'Text', props: { text: 'hi' }, children: [] } } };
  assert.equal(normalizeSpec(flat), flat);
});
