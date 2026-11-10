// Changing one card in a stored answer: pin it, remove it, list the cards in a reply, and name the card a message is
// about. Pure functions on the answer text, so the chat, Today and the server change a card the same way.

import { normalizeAnswer, segmentAnswer } from './pip-reply.js';
import { cardFence, cardMarks, replaceCard } from './pocket-card-tool.js';
import { pocketSpec } from './pocket-spec.js';

const CARD_ID = /^[a-z0-9]{4,24}$/;
/** The trailer a message carries on its own last line when it asks about one card. */
const ABOUT_CARD = /(?:^|\r?\n)[ \t]*\[about card ([a-z0-9]{4,24})\][ \t]*\r?$/;

/** The cards in an answer, in order: id, pin and update times (0 when unset), and the source a card is drawn from. */
export function cardsIn(answer) {
  const cards = [];
  for (const segment of segmentAnswer(String(answer ?? ''))) {
    if (segment.kind !== 'card') continue;
    const spec = pocketSpec(segment.source), marks = cardMarks(spec);
    if (!marks.id) continue;
    cards.push({ id: marks.id, pinned: marks.pinned ?? 0, updated: marks.updated ?? 0, source: segment.source });
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

/** The answer without card `id`, with the blank lines around it closed. Null when the answer has no such card. */
export function dropCard(answer, id) {
  // The card stood between blank lines: where it was, one blank line is left, and nothing else in the answer moves.
  const changed = replaceCard(answer, id, '\u0000');
  return changed === null ? null : normalizeAnswer(changed.replace(/\n*\u0000\n*/, '\n\n'));
}

/** The text and the card id its last line names, or an empty id when it names none. */
export function aboutCard(text) {
  const value = String(text ?? '');
  const match = ABOUT_CARD.exec(value);
  return match ? { text: value.slice(0, match.index).trim(), id: match[1] } : { text: value, id: '' };
}

/** The text with a trailer on its last line naming card `id`, replacing one that is already there. */
export function withCard(text, id) {
  const value = String(text ?? '');
  if (typeof id !== 'string' || !CARD_ID.test(id)) return value;
  const body = aboutCard(value).text.replace(/\s+$/, '');
  return (body ? body + '\n' : '') + '[about card ' + id + ']';
}
