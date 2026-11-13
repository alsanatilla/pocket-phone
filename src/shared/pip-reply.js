// A reply as the model wrote it, cut into prose and cards, and the same reply in the one form Pocket stores.
//
// Models write cards in many shapes: fenced as asked, without the fence, as a nested tree, with tool-call tags
// after them. segmentAnswer finds them while a reply streams (pure, cheap, keys stable as the text grows).
// normalizeAnswer runs once when a reply ends, wherever it ran (tab, Vercel, worker): every card becomes a fenced
// block of flat JSON Lines and the debris goes, so every reader (chat, classic app, push text, search, the
// model's own history) gets the same clean answer and none of them has to repair it again.

import { pocketSpec, normalizeSpec } from './pocket-spec.js';

const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/;
/** A JSON-render patch line, the start of a card even when the model forgot the fence. */
const PATCH = /^\s*\{\s*"op"\s*:/;
/** Closing tags of a tool call a model wrote as text; never meant for the reader. */
const TOOL_DEBRIS = /^\s*<\/?(?:parameter|function|tool_call)\b[^>]*>\s*$/;
/** DeepSeek's own tool-call markup, written as text when a call was not sent as one: no line of it is for the reader. */
const DSML = /<\/?｜DSML｜/;
/**
 * A card record a model copied into its answer: a whole line, in either form cardsAsRecords writes, or one a model
 * made up after it ("[card k… updated with show_card: …]", "[card: Table “Prices”]"). These standalone records and colon-prefixed placeholders draw nothing.
 */
export const CARD_RECORD = /^\s*\[card(?::[^\]]*|(?: [a-z0-9]{4,24})? [a-z ]{1,24}with (?:show|update)_card\b[^\]]*)\]\s*$/;
/** A code fence a model may wrap a card in instead of ```pocket: no language, or JSON. */
const CARD_LIKE = /^(?:json|jsonl|jsonc|json-render)?$/i;

/** Splits a reply into prose and card segments. Keys stay stable as the text grows. */
export function segmentAnswer(text) {
  const segments = [];
  let prose = [], card = null, code = null;
  // A card some models write without its fence: an optional lone "pocket" line, then patch lines. It ends at the
  // first line that is neither a patch nor blank. `held` keeps a lone "pocket" line (and blank lines after it) until
  // the next line shows whether a card starts there.
  let bare = null, held = null;
  // A plain or JSON code fence holds a card when its first line is a patch: `opening` keeps the fence until that line
  // shows which it is, so a card never flashes as code while it streams. `closer` is the fence a card must end with.
  let opening = null, closer = '```';
  const endBare = () => {
    if (bare) segments.push({ kind: "card", key: "c" + segments.length, source: bare.join("\n"), closed: true });
    bare = null;
  };
  const flushProse = () => {
    const value = prose.join("\n");
    if (value.trim()) segments.push({ kind: "prose", key: "p" + segments.length, text: value.replace(/^\n+/, "") });
    prose = [];
  };
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const fence = FENCE.exec(line);
    if (opening) {
      if (!line.trim()) { opening.lines.push(line); continue; }
      if (PATCH.test(line)) { flushProse(); card = [line]; closer = opening.marker; opening = null; continue; }
      // Ordinary code: the fence and what it held so far go back, and this line is its first.
      prose.push(...opening.lines); code = opening.marker; opening = null;
    }
    if (!card && !code) {
      if (bare) {
        if (PATCH.test(line) || !line.trim()) { bare.push(line); continue; }
        endBare();
      }
      if (held) {
        if (!line.trim()) { held.push(line); continue; }
        if (PATCH.test(line)) { held = null; flushProse(); bare = [line]; continue; }
        prose.push(...held); held = null;
      }
      if (line.trim() === "pocket") { held = [line]; continue; }
      if (PATCH.test(line)) { flushProse(); bare = [line]; continue; }
      if (TOOL_DEBRIS.test(line)) continue;
      if (DSML.test(line)) continue;
      if (CARD_RECORD.test(line)) continue;
    }
    if (card) {
      if (fence && !fence[2].trim() && fence[1][0] === closer[0] && fence[1].length >= closer.length) {
        segments.push({ kind: "card", key: "c" + segments.length, source: card.join("\n"), closed: true });
        card = null;
      } else card.push(line);
      continue;
    }
    if (code) {
      prose.push(line);
      if (fence && fence[1].startsWith(code[0]) && fence[1].length >= code.length && !fence[2].trim()) code = null;
      continue;
    }
    if (fence && fence[2].trim() === "pocket" && fence[1].startsWith("`")) { flushProse(); card = []; closer = fence[1]; continue; }
    if (fence && CARD_LIKE.test(fence[2].trim())) { opening = { marker: fence[1], lines: [line] }; continue; }
    if (fence) code = fence[1];
    prose.push(line);
  }
  // A lone "pocket", or a fence whose first line has not come yet, may still become a card; neither shows meanwhile.
  if (card) segments.push({ kind: "card", key: "c" + segments.length, source: card.join("\n"), closed: false });
  else if (bare) segments.push({ kind: "card", key: "c" + segments.length, source: bare.join("\n"), closed: false });
  else flushProse();
  return segments;
}


/** A card's source as canonical JSON Lines (root first, then each element), or null when it holds no card. */
export function canonicalCard(source) {
  const spec = normalizeSpec(pocketSpec(source));
  if (!spec || typeof spec.root !== 'string' || !spec.elements || typeof spec.elements !== 'object' || !spec.elements[spec.root]) return null;
  // A drawn card's id, the time it was last changed, the time it was pinned and any threshold stay with it.
  const lines = [...(typeof spec.id === 'string' && /^[a-z0-9]{4,24}$/.test(spec.id) ? [JSON.stringify({ op: 'add', path: '/id', value: spec.id })] : []),
    ...(Number.isFinite(spec.updated) && spec.updated > 0 ? [JSON.stringify({ op: 'add', path: '/updated', value: spec.updated })] : []),
    ...(Number.isFinite(spec.pinned) && spec.pinned > 0 ? [JSON.stringify({ op: 'add', path: '/pinned', value: spec.pinned })] : []),
    ...(spec.alert && (Number.isFinite(spec.alert.below) || Number.isFinite(spec.alert.above)) ? [JSON.stringify({ op: 'add', path: '/alert', value: spec.alert })] : []),
    JSON.stringify({ op: 'add', path: '/root', value: spec.root })];
  for (const [id, element] of Object.entries(spec.elements)) if (element && typeof element === 'object') lines.push(JSON.stringify({ op: 'add', path: '/elements/' + id.replace(/~/g, '~0').replace(/\//g, '~1'), value: element }));
  return lines.join('\n');
}

/**
 * The stored form of a finished reply: prose as written, each card as a ```pocket fence of flat JSON Lines, no
 * tool-call debris, no card that holds nothing. Idempotent: a normalized answer comes back unchanged.
 */
export function normalizeAnswer(text) {
  const parts = [];
  for (const segment of segmentAnswer(String(text ?? ''))) {
    if (segment.kind === 'prose') { const prose = segment.text.replace(/\s+$/, ''); if (prose.trim()) parts.push(prose); continue; }
    const card = canonicalCard(segment.source);
    if (card) parts.push('```pocket\n' + card + '\n```');
  }
  return parts.join('\n\n');
}

/** Prose only: cards removed. For text that cannot show a card, such as a push notification or a search index. */
export function answerText(text) {
  return segmentAnswer(String(text ?? '')).filter(segment => segment.kind === 'prose').map(segment => segment.text.trim()).filter(Boolean).join('\n\n');
}
