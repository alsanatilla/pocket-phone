import { notes as store, noteTitle as titleOf, thought, NOTE_LIMIT as LIMIT } from "../../client/store.js";
import { noteProseLines } from "../../shared/note-lines.js";
import type { Note } from "./types.ts";

// Notes: typed access to the shared store, plus the derived text the list shows.

export const NOTE_LIMIT: number = LIMIT;

export const listNotes = (): Note[] => store.list();
export const getNote = (uid: string): Note | null => store.get(uid);
export const createNote = (text: string, uid?: string): Note => store.create(text, uid);
export const updateNote = (uid: string, text: string): Note => store.update(uid, text);
export const pinNote = (uid: string, pinned: boolean): Note => store.pin(uid, pinned);
export const removeNote = (uid: string): Note => store.remove(uid);

/** The first non-empty line, without heading or thought markers: what the phone shows as the title. */
export const noteTitle = (note: Pick<Note, "text">): string => titleOf(note);

/** The second and later prose lines as one line of plain text: no Markdown markers, no thought lines. */
export function noteExcerpt(note: Pick<Note, "text">, limit = 60): string {
  return noteProseLines(note.text).map(item => item.line).filter(line => line.trim()).slice(1)
    .filter(line => !thought(line))
    .map(line => line.replace(/^\s*(#+|>|[-*+]\s+(\[[ xX]\]\s*)?|\d+[.)])\s*/, ""))
    .join(" ").slice(0, limit);
}

export function searchNotes(list: Note[], query: string): Note[] {
  const q = query.trim().toLowerCase();
  return q ? list.filter(note => note.text.toLowerCase().includes(q)) : list;
}
