// A card is drawn by a tool call, show_card, never written into the answer text. This module is that tool's
// behaviour, shared by the tab, the server and the worker:
// - cardProblems says whether a card would draw as intended; an invalid card goes back to the model with these
//   words, so it corrects the card instead of the person seeing a broken one;
// - cardFence is how a drawn card is kept inside the stored answer, at the place it was drawn;
// - draftLines turns the arguments streamed so far into the elements that are already complete, so a card builds
//   up on screen while the model is still writing it;
// - a drawn card has an id and stays alive: update_card replaces it where it stands (replaceCard), in this reply or
//   an earlier one, so a figure that changed is corrected in place instead of drawn a second time;
// - cardsAsRecords replaces cards in replayed history by one line each, so the model sees that a card was drawn
//   there without seeing a text format it could copy.

import { CARD_ACTIONS, CARD_COMPONENTS, TONES } from './pocket-cards.js';
import { segmentAnswer } from './pip-reply.js';
import { pocketSpec, normalizeSpec } from './pocket-spec.js';

const CONTAINERS = new Set(['Stack', 'Grid', 'Card']);
/** The most a card's arguments may weigh: a chart of 60 points or a table of 40 rows fits. */
export const CARD_ARGUMENT_LIMIT = 24000;

/** The flat spec json-render draws, from show_card's arguments. */
export function cardFromTool(args) {
  if (!args || typeof args !== 'object' || !Array.isArray(args.elements)) return null;
  const elements = {};
  for (const item of args.elements) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id) continue;
    const { id, ...element } = item;
    elements[id] = { ...element, props: element.props && typeof element.props === 'object' && !Array.isArray(element.props) ? element.props : {}, children: Array.isArray(element.children) ? element.children : [] };
  }
  return { root: typeof args.root === 'string' ? args.root : '', elements };
}

/** What stops this card from drawing as intended; empty when it is fine. Worded for the model that wrote it. */
export function cardProblems(spec) {
  const out = [];
  const elements = spec?.elements;
  if (!elements || typeof elements !== 'object' || !Object.keys(elements).length) return ['elements is empty: add at least one element with an id'];
  if (!spec.root || !elements[spec.root]) out.push(`root "${spec.root}" is not the id of an element`);
  let visible = 0;
  for (const [id, element] of Object.entries(elements)) {
    const known = CARD_COMPONENTS[element.type];
    if (!known) { out.push(`${id}: "${element.type}" is not a component; use one of ${Object.keys(CARD_COMPONENTS).join(', ')}`); continue; }
    if (!CONTAINERS.has(element.type)) visible++;
    const props = element.props;
    for (const key of Object.keys(props)) if (!known[0].includes(key)) out.push(`${id}: ${element.type} has no prop "${key}"; its props are ${known[0].join(', ') || 'none'}`);
    if (element.children.length && !CONTAINERS.has(element.type)) out.push(`${id}: ${element.type} cannot hold children; only Stack, Grid and Card can`);
    for (const child of element.children) if (typeof child !== 'string' || !elements[child]) out.push(`${id}: child ${JSON.stringify(child).slice(0, 40)} is not the id of an element`);
    if (props.tone != null && !TONES.includes(props.tone)) out.push(`${id}: tone "${props.tone}" is not one of ${TONES.join(', ')}`);
    if (element.type === 'Chart') {
      const lines = Array.isArray(props.series) && props.series.length ? props.series.map(line => line?.data) : [props.data];
      if (!['area', 'bar', 'line'].includes(props.kind)) out.push(`${id}: Chart kind must be area, bar or line`);
      if (lines.some(points => !Array.isArray(points) || points.length < 2 || points.some(point => typeof point?.label !== 'string' || typeof point?.value !== 'number' || !Number.isFinite(point.value))))
        out.push(`${id}: Chart needs at least two points, each {"label": text, "value": number} (numbers, not strings)`);
    }
    if (element.type === 'Table' && (!Array.isArray(props.columns) || !props.columns.length || !Array.isArray(props.rows) || props.rows.some(row => !Array.isArray(row) || row.length !== props.columns.length)))
      out.push(`${id}: Table needs columns [names] and rows [[cells]], each row with one cell per column`);
    if (['Metric', 'Hero', 'Gauge'].includes(element.type) && (props.value === undefined || props.value === null || props.value === '')) out.push(`${id}: ${element.type} needs a value`);
    if (element.type === 'Button') {
      if (typeof props.label !== 'string' || !props.label.trim()) out.push(`${id}: Button needs a label`);
      const action = element.on?.press?.action;
      if (element.on && !Object.hasOwn(CARD_ACTIONS, String(action))) out.push(`${id}: Button action must be one of ${Object.keys(CARD_ACTIONS).join(', ')}`);
    }
    if (['Text', 'Heading', 'Badge'].includes(element.type) && (typeof props.text !== 'string' || !props.text.trim())) out.push(`${id}: ${element.type} needs text`);
  }
  if (!visible) out.push('the card shows nothing: add a Text, Metric, Chart, Table or another visible element');
  const reached = new Set(), walk = id => { if (reached.has(id) || !elements[id]) return; reached.add(id); elements[id].children.forEach(walk); };
  if (elements[spec.root]) { walk(spec.root); const lost = Object.keys(elements).filter(id => !reached.has(id)); if (lost.length) out.push(`not reachable from root, so never drawn: ${lost.slice(0, 5).join(', ')}; list them as children`); }
  return out.slice(0, 8);
}

const pointer = id => '/elements/' + String(id).replace(/~/g, '~0').replace(/\//g, '~1');
const CARD_ID = /^[a-z0-9]{4,24}$/;
/** A new card's id: short enough for a model to repeat, random enough to be the only one in a chat. */
export const newCardId = () => 'k' + Array.from(crypto.getRandomValues(new Uint8Array(6)), byte => (byte % 36).toString(36)).join('');
const lines = (spec, { id = '', updated = 0 } = {}) => [
  ...(id ? [JSON.stringify({ op: 'add', path: '/id', value: id })] : []),
  ...(updated ? [JSON.stringify({ op: 'add', path: '/updated', value: updated })] : []),
  JSON.stringify({ op: 'add', path: '/root', value: spec.root }),
  ...Object.entries(spec.elements).map(([key, element]) => JSON.stringify({ op: 'add', path: pointer(key), value: element }))];
/**
 * A drawn card as it is kept in the answer: a pocket fence of JSON Lines, the same form every reader knows. Its id
 * is how it is found again; `updated` is when it was last changed after it was drawn.
 */
export const cardFence = (spec, mark = {}) => '```pocket\n' + lines(spec, mark).join('\n') + '\n```';

const FENCES = /```pocket[ \t]*\n([\s\S]*?)\n```/g;
/** The ids of the cards in a text, in order. */
export const cardIds = text => [...String(text || '').matchAll(FENCES)].map(match => pocketSpec(match[1])?.id).filter(id => typeof id === 'string' && CARD_ID.test(id));
/** The text with the card `id` replaced by `fence`, or null when no such card is in it. */
export function replaceCard(text, id, fence) {
  const source = String(text || '');
  for (const match of source.matchAll(FENCES)) {
    if (pocketSpec(match[1])?.id === id) return source.slice(0, match.index) + fence + source.slice(match.index + match[0].length);
  }
  return null;
}

/** "Chart “Weekly distance” + Text" for labels and for the record a replayed reply carries. */
export function cardSummary(spec) {
  const seen = Object.values(spec?.elements || {}).filter(element => element && !CONTAINERS.has(element.type)).slice(0, 4)
    .map(element => { const title = element.props?.title ?? element.props?.label; return element.type + (typeof title === 'string' && title ? ' “' + title.slice(0, 40) + '”' : ''); });
  return seen.join(' + ') || 'card';
}

/** show_card as Pocket runs it: the card to place in the answer, or why it was not drawn. */
export function drawCard(args) {
  const spec = cardFromTool(args);
  const problems = spec ? cardProblems(spec) : ['elements must be a list of {id, type, props, children}'];
  if (problems.length) return { error: 'card_invalid', message: 'The card was not drawn. Correct these and call show_card again: ' + problems.join('; ') + '.' };
  const id = newCardId();
  return { kind: 'card', drawn: true, id, card: cardFence(spec, { id }), shows: cardSummary(spec) };
}

/** update_card as Pocket checks it: the new card and the id it replaces, or why it cannot. Placing it is the reply's job. */
export function reviseCard(args) {
  const id = String(args?.id || '').trim();
  if (!CARD_ID.test(id)) return { error: 'card_not_found', message: 'Give the id of the card to change: show_card\'s result and the "[card <id> …]" records in earlier replies name it.' };
  const spec = cardFromTool(args);
  const problems = spec ? cardProblems(spec) : ['elements must be a list of {id, type, props, children}'];
  if (problems.length) return { error: 'card_invalid', message: 'The card was not changed. Correct these and call update_card again: ' + problems.join('; ') + '.' };
  return { kind: 'card', revise: true, id, spec, shows: cardSummary(spec) };
}

/**
 * The elements already complete in arguments that are still being written ({"root":"main","elements":[{…},{…},{"id…),
 * as the JSON Lines a pocket fence holds. Nothing invalid is ever returned: a half-written element waits.
 */
export function draftLines(partial) {
  const text = String(partial || ''), out = [];
  const root = /"root"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text);
  if (root) { try { out.push(JSON.stringify({ op: 'add', path: '/root', value: JSON.parse('"' + root[1] + '"') })); } catch { /* not a string yet */ } }
  const list = /"elements"\s*:\s*\[/.exec(text);
  if (!list) return out.join('\n');
  let depth = 0, start = -1, inString = false, escaped = false;
  for (let index = list.index + list[0].length; index < text.length; index++) {
    const char = text[index];
    if (escaped) { escaped = false; continue; }
    if (inString) { if (char === '\\') escaped = true; else if (char === '"') inString = false; continue; }
    if (char === '"') { inString = true; continue; }
    if (char === '{' || char === '[') { if (char === '{' && depth === 0) start = index; depth++; }
    else if (char === '}' || char === ']') {
      if (depth === 0) break; // the end of the elements list
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          const spec = cardFromTool({ elements: [JSON.parse(text.slice(start, index + 1))] }), [id] = Object.keys(spec?.elements || {});
          if (id && CARD_COMPONENTS[spec.elements[id].type]) out.push(JSON.stringify({ op: 'add', path: pointer(id), value: spec.elements[id] }));
        } catch { /* not an element */ }
        start = -1;
      }
    }
  }
  return out.join('\n');
}

/**
 * A reply as the model should read it again: each card replaced by one line saying a card was drawn there. The
 * fence is how Pocket stores a card, not something a model may write, so replayed history never shows it.
 */
export function cardsAsRecords(text) {
  const source = String(text ?? '');
  if (!source.includes('```') && !source.includes('"op"')) return source;
  return segmentAnswer(source).map(segment => {
    if (segment.kind === 'prose') return segment.text.replace(/\s+$/, '');
    const spec = normalizeSpec(pocketSpec(segment.source));
    const id = typeof spec?.id === 'string' && CARD_ID.test(spec.id) ? spec.id : '';
    return '[card' + (id ? ' ' + id : '') + ' drawn here with show_card: ' + (spec?.elements ? cardSummary(spec) : 'card') + (id ? '; change it with update_card' : '') + ']';
  }).filter(Boolean).join('\n\n');
}
