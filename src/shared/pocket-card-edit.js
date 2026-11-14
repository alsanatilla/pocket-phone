// Changing one card in a stored answer: pin it, remove it, list the cards in a reply, and name the card a message is
// about. Pure functions on the answer text, so the chat, Today and the server change a card the same way.

import { normalizeAnswer, segmentAnswer } from './pip-reply.js';
import { cardFence, cardMarks, replaceCard } from './pocket-card-tool.js';
import { pocketSpec } from './pocket-spec.js';

const CARD_ID = /^[a-z0-9]{4,24}$/;
/** The trailer a message carries on its own last line when it asks about one card. */
const ABOUT_CARD = /(?:^|\r?\n)[ \t]*\[about card ([a-z0-9]{4,24})\][ \t]*\r?$/;

/** The cards in an answer, in order: id, pin and update times (0 when unset), any threshold, and the source a card is drawn from. */
export function cardsIn(answer) {
  const cards = [];
  for (const segment of segmentAnswer(String(answer ?? ''))) {
    if (segment.kind !== 'card') continue;
    const spec = pocketSpec(segment.source), marks = cardMarks(spec);
    if (!marks.id) continue;
    cards.push({ id: marks.id, pinned: marks.pinned ?? 0, updated: marks.updated ?? 0, ...(marks.alert ? { alert: marks.alert } : {}), source: segment.source });
  }
  return cards;
}

/** The answer with card `id` pinned at `at`; 0 or no time unpins it. Null when the answer has no such card. */
export function pinCard(answer, id, at) {
  const card = cardsIn(answer).find(item => item.id === id);
  if (!card) return null;
  const spec = pocketSpec(card.source);
  if (!spec || !spec.elements) return null;
  const pinned = Number.isFinite(at) && at > 0 ? at : 0;
  return replaceCard(answer, id, cardFence(spec, { ...cardMarks(spec), pinned }));
}

/** The answer with a threshold on the card's figure; null when the card is not there. A missing side clears it. */
export function alertCard(answer, id, alert) {
  const card = cardsIn(answer).find(item => item.id === id);
  if (!card) return null;
  const spec = pocketSpec(card.source);
  if (!spec || !spec.elements) return null;
  const value = alert && (Number.isFinite(alert.below) || Number.isFinite(alert.above))
    ? { ...(Number.isFinite(alert.below) ? { below: alert.below } : {}), ...(Number.isFinite(alert.above) ? { above: alert.above } : {}) }
    : null;
  const marks = { ...cardMarks(spec) };
  delete marks.alert;
  return replaceCard(answer, id, cardFence(spec, { ...marks, ...(value ? { alert: value } : {}) }));
}

/** The answer without card `id`, with the blank lines around it closed. Null when the answer has no such card. */
export function dropCard(answer, id) {
  // The card stood between blank lines: where it was, one blank line is left, and nothing else in the answer moves.
  const changed = replaceCard(answer, id, '\u0000');
  return changed === null ? null : normalizeAnswer(changed.replace(/\n*\u0000\n*/, '\n\n'));
}

/**
 * The web address a card's figures come from, or '' when it names none. A Chart or Table carries its source as
 * `{ title, url }`; only a card with such an address can be kept current from it.
 */
export function sourceUrl(source) {
  const spec = pocketSpec(String(source ?? ''));
  if (!spec || !spec.elements || typeof spec.elements !== 'object') return '';
  for (const element of Object.values(spec.elements)) {
    const value = element && typeof element === 'object' ? element.props?.source : null;
    const url = value && typeof value === 'object' ? value.url : '';
    if (typeof url === 'string' && /^https?:\/\/[^\s]+$/i.test(url.trim())) return url.trim();
  }
  return '';
}

/** A short name for a card, from the first label it shows; '' when it shows none. */
export function cardName(source) {
  const spec = pocketSpec(String(source ?? ''));
  if (!spec || !spec.elements || typeof spec.elements !== 'object') return '';
  const shapes = { Heading: 'text', Hero: 'eyebrow', Metric: 'label', Gauge: 'label', Chart: 'title', Table: 'title', Card: 'title' };
  for (const element of Object.values(spec.elements)) {
    const key = element && shapes[element.type];
    const value = key && element.props?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 60);
  }
  return '';
}

/**
 * The text and the card id its last line names, or an empty id when it names none. A plan block (planRequest) before
 * the trailer is for the model, not for the person: it is cut from `text` and returned as `plan`.
 */
export function aboutCard(text) {
  const value = String(text ?? '');
  const match = ABOUT_CARD.exec(value);
  if (!match) return { text: value, id: '' };
  const body = value.slice(0, match.index), plan = PLAN_BLOCK.exec(body);
  return plan ? { text: body.slice(0, plan.index).trim(), id: match[1], plan: plan[0].trim() } : { text: body.trim(), id: match[1] };
}

/** The block a plan request carries: a header line, then one line per item, right before the card trailer. */
const PLAN_BLOCK = /(?:^|\n)\[plan [^\n]*\](?:\n- [^\n]*)*\s*$/;
/** What the person asks when they turn a plan into appointments and tasks; the shown line of the message. */
export const PLAN_ASK = 'Add this plan to my calendar and tasks.';
const PLAN_ITEMS = 50, PLAN_LINE = 240;
const oneLine = value => typeof value === 'string' || typeof value === 'number' ? String(value).replace(/\s+/g, ' ').trim() : '';

/**
 * The plan a card draws: its Timeline items in order, with the plan's title. Null when the card draws no Timeline
 * with items, so only a plan offers to be saved as appointments and tasks.
 */
export function cardPlan(source) {
  const spec = pocketSpec(String(source ?? ''));
  if (!spec || !spec.elements || typeof spec.elements !== 'object') return null;
  const timelines = Object.values(spec.elements).filter(element => element?.type === 'Timeline' && Array.isArray(element.props?.items));
  const items = timelines.flatMap(element => element.props.items).filter(item => item && typeof item === 'object' && oneLine(item.title))
    .map(item => ({ time: oneLine(item.time), title: oneLine(item.title), detail: oneLine(item.detail) }));
  if (!items.length) return null;
  const title = timelines.map(element => oneLine(element.props.title)).find(Boolean) || cardName(source);
  return { title, items };
}

/** "Fri 2026-11-13": the local day a card was drawn, so the model can place "tomorrow" or "Saturday" in a plan. */
const drawnDay = at => {
  const date = new Date(at);
  if (!Number.isFinite(+date) || at <= 0) return '';
  const pad = number => String(number).padStart(2, '0');
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()] + ' ' + date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
};

/**
 * The message that asks Pip to save a plan card as appointments and tasks. The plan's items travel in the message,
 * built from the stored card: a replayed card past the history budget is shortened to three entries, and the person
 * should not have to retype what the card shows. Null when the card draws no plan.
 */
export function planRequest(source, id, drawn = 0) {
  const plan = cardPlan(source);
  if (!plan || !CARD_ID.test(String(id))) return null;
  const day = drawnDay(drawn);
  const lines = plan.items.slice(0, PLAN_ITEMS).map(item => ('- ' + (item.time || 'no time') + ' · ' + item.title + (item.detail ? ' · ' + item.detail : '')).slice(0, PLAN_LINE));
  if (plan.items.length > PLAN_ITEMS) lines.push('- … ' + (plan.items.length - PLAN_ITEMS) + ' more items in the card');
  const header = '[plan' + (plan.title ? ' “' + plan.title.slice(0, 80) + '”' : '') + (day ? ' · drawn ' + day : '') + ' · items as time · title · detail]';
  return withCard(PLAN_ASK + '\n\n' + header + '\n' + lines.join('\n'), id);
}

/** The text with a trailer on its last line naming card `id`, replacing one that is already there. */
export function withCard(text, id) {
  const value = String(text ?? '');
  if (typeof id !== 'string' || !CARD_ID.test(id)) return value;
  const body = aboutCard(value).text.replace(/\s+$/, '');
  return (body ? body + '\n' : '') + '[about card ' + id + ']';
}
