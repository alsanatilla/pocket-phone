import { thought, thoughtParked, parkThought, thoughtStatus } from "../../../client/store.js";
import { noteProseLines } from "../../../shared/note-lines.js";

// ">> call Sam @tomorrow" in a note parks "call Sam". Same rules as the classic editor and NoteThoughts.java:
// a line parks once the cursor has left it (a half-typed ">> cal" never parks), and an old line that is
// revisited unchanged never parks again. `seen` counts the handled lines per thought key.

/** The thought lines of `text` that already exist in Parking. */
export function initialSeen(uid, text) {
  const seen = new Map();
  for (const { line } of noteProseLines(text)) {
    const item = thought(line);
    if (item && thoughtParked(uid, item.key)) seen.set(item.key, (seen.get(item.key) || 0) + 1);
  }
  return seen;
}

/** Parks the finished, not yet handled thought lines. Returns the new `seen` and how many were parked. */
export function parkFinished(uid, text, cursorLine, finished, seen) {
  const counts = new Map(), fresh = [];
  for (const { line, index } of noteProseLines(text)) {
    const item = thought(line);
    if (!item) continue;
    const n = counts.get(item.key) || 0, known = seen.get(item.key) || 0;
    if (!finished && index === cursorLine) { if (n < known) counts.set(item.key, n + 1); continue; }
    counts.set(item.key, n + 1);
    if (n >= known) fresh.push(item);
  }
  let parked = 0;
  for (const item of fresh) if (parkThought(uid, item)) parked++;
  return { seen: counts, parked };
}

/** Thought lines of a note with their Parking state, for the list chips. */
export function noteThoughts(note) {
  return noteProseLines(note.text).map(({ line }) => line).filter(line => thought(line))
    .map(line => ({ text: thought(line).text, state: thoughtStatus(note.uid, line) }));
}

/** Annotations the renderer draws beside thought lines in the preview. */
export function thoughtAnnotations(uid, text) {
  if (!uid) return [];
  return String(text ?? "").replace(/\r\n?/g, "\n").split("\n").flatMap((line, index) => {
    const item = thought(line);
    return item ? [{ line: index + 1, thought: { text: item.text, status: thoughtStatus(uid, line) } }] : [];
  }).slice(0, 1000);
}
