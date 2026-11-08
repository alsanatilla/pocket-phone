import test from 'node:test';
import assert from 'node:assert/strict';
import { defineCatalog } from '@json-render/core';
import { schema, standardComponentDefinitions } from '@json-render/chat';

// Pocket renders a fenced ```pocket block itself, but the spec has to stay compatible with the real json-render
// catalog: if a reply validates here, the same card works in the Vercel examples and the Chat SDK bot.

const catalog = defineCatalog(schema, { components: standardComponentDefinitions });
const element = (type, props = {}, children = []) => ({ type, props, children });

const spec = () => ({
  root: 'card',
  state: {},
  elements: {
    card: element('Card', { title: 'Woche', subtitle: '3 fällig' }, ['txt', 'fields', 'table', 'chart', 'rule', 'acts']),
    txt: element('Text', { content: 'Ein Termin, drei Aufgaben.' }),
    fields: element('Fields', {}, ['f1']),
    f1: element('Field', { label: 'next', value: 'Flüge Lissabon buchen' }),
    table: element('Table', { headers: ['Tag', 'Was'], rows: [['Di', 'Physio']], caption: 'Woche 45' }),
    chart: element('Chart', { title: 'Gym', chart: { data: [1, 3, 0, 2] } }),
    rule: element('Divider', {}),
    acts: element('Actions', {}, ['b1', 'b2']),
    b1: element('Button', { label: 'verschieben', style: 'primary' }),
    b2: element('LinkButton', { label: 'mehr', url: 'https://example.com' })
  }
});

test('the card catalogue validates against the real json-render catalog', () => {
  const result = catalog.validate(spec());
  assert.equal(result.success, true, result.success ? '' : JSON.stringify(result.error?.message));
});

test('every component Pocket renders is one of theirs', () => {
  const types = new Set(Object.values(spec().elements).map(node => node.type));
  for (const type of types) assert.ok(type in standardComponentDefinitions, `${type} is not a standard component`);
});

test('an element without a children array is rejected, which is why Pocket always writes one', () => {
  const broken = spec();
  delete broken.elements.txt.children;
  assert.equal(catalog.validate(broken).success, false);
});

test('the nested shorthand is Pocket-only: it is not a valid json-render spec', () => {
  assert.equal(catalog.validate({ type: 'card', title: 'x', children: [] }).success, false);
});
