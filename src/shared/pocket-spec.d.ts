// Types for pocket-spec.js: a card's spec from a finished JSON object or from JSON Lines of patches so far
// (a half-written last line is skipped). The server's Markdown renderer and the React chat both use it.
export function pocketSpec(text: string): { root?: string; elements?: Record<string, unknown>; [key: string]: unknown } | null;
/** Whether a spec was written in the retired card format (Section, Fields, Chart with chart.data, …). */
export function isLegacySpec(spec: unknown): boolean;
/** The same reply with retired-format card fences replaced, so replayed history cannot teach the old shape. */
export function withoutLegacyCards(text: string): string;
