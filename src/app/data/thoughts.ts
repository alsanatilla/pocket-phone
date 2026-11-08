import { parking, thought, thoughtParked, parkThought, thoughtStatus } from "../../client/store.js";
import { noteProseLines } from "../../shared/note-lines.js";
import type { Thought } from "./types.ts";

// Thoughts: Parking, and the ">> call Sam @tomorrow" lines in notes that park into it.
// Same rules as the classic editor and NoteThoughts.java on the phone: a line parks once the cursor has left it
// (a half-typed ">> cal" never parks), and an old line revisited unchanged never parks again.

export const openThoughts = (): Thought[] => parking.open();
export const parkThoughtText = (text: string, due = 0): Thought => parking.park(text, due);

/** Handled-line counts per thought key. */
export type Seen = Map<string, number>;

/** The thought lines of `text` that already exist in Parking. */
export function initialSeen(uid: string | null, text: string): Seen {
  const seen: Seen = new Map();
  for (const { line } of noteProseLines(text)) {
    const item = thought(line);
    if (item && thoughtParked(uid, item.key)) seen.set(item.key, (seen.get(item.key) ?? 0) + 1);
  }
  return seen;
}

/**
 * Parks the finished thought lines not handled yet. `cursorLine` is the line the cursor is on (it is not
 * finished unless `finished`); returns the new counts and how many thoughts were parked.
 */
export function parkFinished(uid: string, text: string, cursorLine: number, finished: boolean, seen: Seen): { seen: Seen; parked: number } {
  const counts: Seen = new Map();
  const fresh = [];
  for (const { line, index } of noteProseLines(text)) {
    const item = thought(line);
    if (!item) continue;
    const n = counts.get(item.key) ?? 0, known = seen.get(item.key) ?? 0;
    if (!finished && index === cursorLine) { if (n < known) counts.set(item.key, n + 1); continue; }
    counts.set(item.key, n + 1);
    if (n >= known) fresh.push(item);
  }
  let parked = 0;
  for (const item of fresh) if (parkThought(uid, item)) parked++;
  return { seen: counts, parked };
}

export interface NoteThought { text: string; state: string }

/** A note's thought lines with their Parking state ("saved to thoughts", "cleared", …). */
export function noteThoughts(note: { uid: string; text: string }): NoteThought[] {
  return noteProseLines(note.text).map(({ line }) => line).filter(line => thought(line))
    .map(line => ({ text: thought(line)!.text, state: thoughtStatus(note.uid, line) }));
}

export const thoughtDone = (state: string): boolean => /cleared|let go|made into a task/.test(state);

/** Annotations the Markdown renderer draws beside thought lines. */
export function thoughtAnnotations(uid: string | null, text: string): { line: number; thought: { text: string; status: string } }[] {
  if (!uid) return [];
  return text.replace(/\r\n?/g, "\n").split("\n").flatMap((line, index) => {
    const item = thought(line);
    return item ? [{ line: index + 1, thought: { text: item.text, status: thoughtStatus(uid, line) } }] : [];
  }).slice(0, 1000);
}
