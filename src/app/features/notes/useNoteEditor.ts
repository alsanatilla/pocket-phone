import { useCallback, useEffect, useRef, useState } from "react";
import { activeAccount } from "../../../client/workspace-storage.js";
import { createNote, getNote, pinNote, removeNote, updateNote } from "../../data/notes.ts";
import { initialSeen, parkFinished, type Seen } from "../../data/thoughts.ts";

// The note editor's behaviour, apart from how it looks:
// - text saves 600 ms after typing stops, 150 ms after Enter or an arrow key, on blur, and when the editor closes;
// - every keystroke is kept as a draft under the classic editor's key, so a reload loses nothing and both
//   clients see the same draft;
// - a new note (fresh) has its uid already; the first non-empty save creates it under that uid;
// - finished ">> thought" lines park (see data/thoughts.ts).

const draftKey = (uid: string) => "pocket:note-draft:" + uid;
const readDraft = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const writeDraft = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage full or blocked */ } };
const dropDraft = (key: string) => { try { localStorage.removeItem(key); } catch { /* storage blocked */ } };

export type SaveStatus = "new" | "draft" | "saving" | "saved";

export interface NoteEditor {
  /** False when the note was deleted (here or on another device). */
  exists: boolean;
  /** Whether the note has been saved at least once (pin and preview need it). */
  stored: boolean;
  text: string;
  status: SaveStatus;
  parked: number;
  pinned: boolean;
  error: string;
  edit: (value: string, cursorLine: number) => void;
  /** Enter or an arrow key: save a little sooner. */
  nudge: (cursorLine: number) => void;
  flush: () => void;
  togglePin: () => void;
  remove: () => void;
}

export function useNoteEditor(uid: string, fresh = false): NoteEditor {
  const [initial] = useState(() => getNote(uid));
  const [draft] = useState(() => readDraft(draftKey(uid)));
  const [text, setText] = useState(() => draft ?? initial?.text ?? "");
  const [status, setStatus] = useState<SaveStatus>(draft != null ? "draft" : initial ? "saved" : "new");
  const [parked, setParked] = useState(0);
  const [pinned, setPinned] = useState(Boolean(initial?.pinned));
  const [error, setError] = useState("");

  const stored = useRef(Boolean(initial));
  const [isStored, setStored] = useState(Boolean(initial));
  const owner = useRef(activeAccount());
  const latest = useRef(text);
  const saved = useRef(initial?.text ?? "");
  const cursor = useRef(-1);
  const seen = useRef<Seen | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  seen.current ??= initialSeen(uid, text);

  const save = useCallback((finished: boolean) => {
    clearTimeout(timer.current);
    if (activeAccount() !== owner.current) return; // signed into another account since this opened
    if (stored.current && !getNote(uid)) return; // deleted elsewhere
    const value = latest.current;
    try {
      if (!stored.current) {
        if (!value.trim()) return;
        createNote(value, uid);
        stored.current = true; setStored(true);
      } else if (saved.current !== value) updateNote(uid, value);
      saved.current = value;
      dropDraft(draftKey(uid));
      const result = parkFinished(uid, value, cursor.current, finished, seen.current!);
      seen.current = result.seen;
      if (result.parked) setParked(count => count + result.parked);
      setStatus("saved");
      setError("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  }, [uid]);

  const schedule = (delay: number) => { clearTimeout(timer.current); timer.current = setTimeout(() => save(false), delay); };

  // Leaving (another note, another page, closing the tab) saves what is there.
  useEffect(() => {
    const flush = () => save(true);
    addEventListener("pagehide", flush);
    return () => { removeEventListener("pagehide", flush); flush(); };
  }, [save]);

  return {
    exists: Boolean(initial) || fresh,
    stored: isStored,
    text, status, parked, pinned, error,
    edit(value, cursorLine) {
      setText(value); latest.current = value; cursor.current = cursorLine; setStatus("saving");
      writeDraft(draftKey(uid), value);
      schedule(600);
    },
    nudge(cursorLine) { cursor.current = cursorLine; schedule(150); },
    flush: () => save(true),
    togglePin() {
      save(true);
      if (!stored.current) return;
      try { pinNote(uid, !pinned); setPinned(!pinned); } catch (failure) { setError(String((failure as Error).message)); }
    },
    remove() {
      clearTimeout(timer.current);
      if (stored.current) removeNote(uid);
      dropDraft(draftKey(uid));
      stored.current = false; latest.current = "";
    },
  };
}
