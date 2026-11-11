// Types for pip-effort.js: how much looking-up a message deserves.
export type EffortLevel = "none" | "quick" | "thorough";
export const EFFORT_LEVELS: readonly EffortLevel[];
/** The JEV questions object for one effort judgment: one choice named `effort`. */
export function effortQuestions(): {
  effort: { type: "choice"; instructions: string; criteria: Record<EffortLevel, string> };
};
/** The JEV state object for one message: its text, attachments and the last two finished turns before it. */
export function effortState(
  turn: { text?: string; context?: unknown[] },
  earlier?: Array<{ text?: string; answer?: string; status?: string }>,
): {
  assistant: string;
  message: string;
  attached: number;
  recent: Array<{ asked: string; answered: string }>;
};
/** The level JEV chose, or null when its answer is not one of Pocket's levels. */
export function effortFromAnswers(answers: unknown): EffortLevel | null;
/** The lookup and web-call limits a level allows, or null when it leaves today's limits alone. */
export function effortLimits(level: string | null | undefined): { lookups: number; webCalls: number } | null;
/** The sentence the model reads for a level; nothing for thorough. */
export function effortNote(level: string | null | undefined): string;
