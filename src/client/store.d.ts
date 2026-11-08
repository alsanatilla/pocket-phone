// Types for the parts of store.js the React client (src/app) uses. The JavaScript stays the source of truth;
// keep these in step when its exports change. The document shapes live in src/app/data/types.ts.
import type { Note, Task, Thought } from "../app/data/types.ts";

export const NOTE_LIMIT: number;
export function onChange(listener: (collection: string) => void): () => void;
export function taskDay(at?: number): string;
export function noteTitle(note: { text: string }): string;

export interface ParsedThought { text: string; key: string; delay: string }
export function thought(line: string): ParsedThought | null;
export function thoughtParked(noteUid: string | null, key: string): boolean;
export function parkThought(noteUid: string, item: ParsedThought): Thought | null;
export function thoughtStatus(noteUid: string | null, line: string, now?: number): string;

export const notes: {
  list(): Note[];
  get(uid: string): Note | null;
  create(text: string, uid?: string): Note;
  update(uid: string, text: string): Note;
  pin(uid: string, pinned: boolean): Note;
  remove(uid: string): Note;
};
export const tasks: {
  list(): Task[];
  get(uid: string): Task | null;
  complete(uid: string): Task;
  create(text: string, source?: unknown, fields?: Partial<Task>): Task;
  /** The uid chosen as "do next". */
  chosen(): string | null;
};
export interface Workout { id: string; started: number; ended?: number }
export const gym: { all(): Workout[]; active(): Workout | null };
export function weekStart(at: number): number;
export const parking: {
  open(now?: number): Thought[];
  park(text: string, due?: number): Thought;
};
