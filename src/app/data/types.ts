// The shapes of Pocket's local documents, as src/client/store.js writes them and the phone syncs them.

export interface Note {
  uid: string;
  text: string;
  pinned: boolean;
  created: number;
  updated: number;
  deleted: boolean;
}

export interface Step { text: string; done: boolean }

export interface TaskSource { kind?: string; name?: string; text?: string; note_uid?: string; token?: string }

export interface Task {
  uid: string;
  text: string;
  done: boolean;
  /** Local day "YYYY-MM-DD", or "" for no date. */
  due: string;
  important: boolean;
  steps: Step[];
  created: number;
  updated: number;
  deleted: boolean;
  source?: TaskSource;
}

export type ThoughtState = "parked" | "cleared" | "killed" | "task";

/** An item in Parking: a thought waiting for a decision. */
export interface Thought {
  id: number;
  text: string;
  created: number;
  /** When to revisit (ms), 0 for "when I choose". */
  due: number;
  closed: number;
  notches: number;
  state: ThoughtState;
  updated: number;
  /** The note a ">>" line parked it from. */
  note?: string;
}
