// How a reply is cut up for drawing while it streams. Pure functions of the text so far.
//
// A reply is prose with ```pocket blocks (cards) in between. Prose is drawn block by block: a block is settled
// once a blank line follows it, then rendered once by Pocket's Markdown renderer and never touched again; the
// block still being written is drawn directly with light inline formatting. Cards are compiled from their JSON
// Lines as each line completes, so their raw JSON is never on screen.

export type Segment =
  | { kind: "prose"; key: string; text: string }
  | { kind: "card"; key: string; source: string; closed: boolean };

const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/;

/** Splits a reply into prose and card segments. Keys stay stable as the text grows. */
export function segmentAnswer(text: string): Segment[] {
  const segments: Segment[] = [];
  let prose: string[] = [], card: string[] | null = null, code: string | null = null;
  const flushProse = () => {
    const value = prose.join("\n");
    if (value.trim()) segments.push({ kind: "prose", key: "p" + segments.length, text: value.replace(/^\n+/, "") });
    prose = [];
  };
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const fence = FENCE.exec(line);
    if (card) {
      if (fence && !fence[2]!.trim() && fence[1]!.startsWith("`")) {
        segments.push({ kind: "card", key: "c" + segments.length, source: card.join("\n"), closed: true });
        card = null;
      } else card.push(line);
      continue;
    }
    if (code) {
      prose.push(line);
      if (fence && fence[1]!.startsWith(code[0]!) && fence[1]!.length >= code.length && !fence[2]!.trim()) code = null;
      continue;
    }
    if (fence && fence[2]!.trim() === "pocket" && fence[1]!.startsWith("`")) { flushProse(); card = []; continue; }
    if (fence) code = fence[1]!;
    prose.push(line);
  }
  if (card) segments.push({ kind: "card", key: "c" + segments.length, source: card.join("\n"), closed: false });
  else flushProse();
  return segments;
}

/**
 * Prose as settled blocks plus the block still being written. Blocks are separated by blank lines outside code;
 * a fenced code block is one block. When the reply is finished, everything is settled.
 */
export function splitProse(text: string, streaming: boolean): { blocks: string[]; pending: string } {
  const blocks: string[] = [];
  let current: string[] = [], code: string | null = null;
  for (const line of text.split("\n")) {
    const fence = FENCE.exec(line);
    if (code) {
      current.push(line);
      if (fence && fence[1]!.startsWith(code[0]!) && fence[1]!.length >= code.length && !fence[2]!.trim()) code = null;
      continue;
    }
    if (fence) { code = fence[1]!; current.push(line); continue; }
    if (!line.trim()) {
      if (current.length) { blocks.push(current.join("\n")); current = []; }
      continue;
    }
    current.push(line);
  }
  const rest = current.join("\n");
  if (!streaming) return { blocks: rest.trim() ? [...blocks, rest] : blocks, pending: "" };
  return { blocks, pending: rest };
}

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong" | "em" | "code" | "link"; text: string };

/**
 * Inline formatting for text that is still being written: **strong**, *em* / _em_, `code`, [link](url).
 * Only complete pairs are formatted; an opening marker without its partner at the very end is hidden, so
 * "**impor" reads as "impor" instead of showing the asterisks.
 */
export function inlineTokens(text: string): Inline[] {
  const tokens: Inline[] = [];
  const pattern = /(\*\*|__)(?=\S)([\s\S]+?)(?<=\S)\1|`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|(?<![\w*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?!\*)|(?<![\w_])_(?=\S)([^_\n]+?)(?<=\S)_(?![\w_])/g;
  let last = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) tokens.push({ type: "text", text: text.slice(last, match.index) });
    if (match[2] !== undefined) tokens.push({ type: "strong", text: match[2] });
    else if (match[3] !== undefined) tokens.push({ type: "code", text: match[3] });
    else if (match[4] !== undefined) tokens.push({ type: "link", text: match[4] });
    else tokens.push({ type: "em", text: (match[6] ?? match[7])! });
    last = match.index + match[0].length;
  }
  let tail = text.slice(last);
  // An unfinished marker at the end: hide it until its partner arrives.
  // It only opens at the start of a word (after a space, a bracket or the line start), never inside snake_case.
  tail = tail.replace(/(^|[\s([])(\*\*|__|\*|_|`)(?=\S|$)([^*_`]*)$/, (_whole, before: string, _marker: string, rest: string) => before + rest)
    .replace(/\[([^\]\n]*)(\]\([^)\s]*)?$/, "$1");
  if (tail) tokens.push({ type: "text", text: tail });
  return tokens;
}

export type PendingShape =
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string }
  | { kind: "paragraph"; text: string };

/** The shape of the block being written, so it looks like what it will become. */
export function pendingShape(block: string): PendingShape {
  const heading = /^(#{1,6})\s+(.*)$/.exec(block);
  if (heading && !block.includes("\n")) return { kind: "heading", level: heading[1]!.length, text: heading[2]! };
  if (FENCE.test(block.split("\n")[0]!)) return { kind: "code", text: block.split("\n").slice(1).filter(line => !FENCE.test(line)).join("\n") };
  const lines = block.split("\n");
  const item = /^\s*([-*+]|\d{1,9}[.)])\s+(.*)$/;
  if (lines.every(line => item.test(line) || /^\s{2,}\S/.test(line))) {
    const items: string[] = [];
    for (const line of lines) { const match = item.exec(line); if (match) items.push(match[2]!); else if (items.length) items[items.length - 1] += " " + line.trim(); }
    return { kind: "list", ordered: /^\s*\d/.test(lines[0]!), items };
  }
  if (lines.every(line => /^\s*>/.test(line))) return { kind: "quote", text: lines.map(line => line.replace(/^\s*>\s?/, "")).join("\n") };
  return { kind: "paragraph", text: block };
}
