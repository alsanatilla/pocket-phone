// Types for pip-reply.js: a reply cut into prose and cards, and its stored form.
export type Segment =
  | { kind: "prose"; key: string; text: string }
  | { kind: "card"; key: string; source: string; closed: boolean };
/** Splits a reply into prose and card segments. Keys stay stable as the text grows. */
export function segmentAnswer(text: string): Segment[];
/** A card's source as canonical JSON Lines, or null when it holds no card. */
export function canonicalCard(source: string): string | null;
/** The stored form of a finished reply: fenced flat cards, no debris. Idempotent. */
export function normalizeAnswer(text: string): string;
/** The reply's prose without its cards. */
export function answerText(text: string): string;
