import { useCallback, useEffect, useState } from "react";
import * as cloud from "../../client/cloud.js";

// Pip's memory of the person: the lasting facts it keeps about them, read and changed on /memory. The server keeps
// the list; this module reads it once, again after a change it hears about, and sends each change back.

export interface MemoryEntry { id: string; text: string; chat: string; created: number; updated: number }
export type MemoryState = "loading" | "ready" | "signed-out" | "failed";
export interface MemoryView { entries: MemoryEntry[]; state: MemoryState; error: string; reload: () => void }

interface MemoryAnswer { accountId: string; entries: MemoryEntry[] }

const entriesOf = (answer: MemoryAnswer): MemoryEntry[] => answer.entries;

/** The account's memory, oldest first, as the server keeps it. */
export function loadMemory(): Promise<MemoryEntry[]> {
  return cloud.request<MemoryAnswer>("/api/pip/memory").then(entriesOf);
}

/** Adds one fact; resolves to the list the server answers with. */
export function addMemory(text: string): Promise<MemoryEntry[]> {
  return cloud.post<MemoryAnswer>("/api/pip/memory", { action: "add", text }).then(entriesOf);
}

/** Changes one entry's text; resolves to the list the server answers with. */
export function editMemory(id: string, text: string): Promise<MemoryEntry[]> {
  return cloud.post<MemoryAnswer>("/api/pip/memory", { action: "edit", id, text }).then(entriesOf);
}

/** Removes one entry; resolves to the list the server answers with. */
export function forgetMemory(id: string): Promise<MemoryEntry[]> {
  return cloud.post<MemoryAnswer>("/api/pip/memory", { action: "forget", id }).then(entriesOf);
}

/**
 * The memory screen's state: the server's list, read on mount and again on `pocket-memory-changed`, and never
 * asked for while signed out. A result that arrives after unmount is dropped.
 */
export function useMemory(): MemoryView {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [state, setState] = useState<MemoryState>("loading");
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion(value => value + 1), []);

  useEffect(() => {
    if (!cloud.connected()) {
      setEntries([]);
      setError("");
      setState("signed-out");
      return;
    }
    let cancelled = false;
    // A reload after an action keeps the list on screen; only the first read, or a retry, shows the shimmer.
    setState(current => current === "ready" ? current : "loading");
    loadMemory()
      .then(entries => {
        if (cancelled) return;
        setEntries(entries);
        setError("");
        setState("ready");
      })
      .catch(failure => {
        if (cancelled) return;
        setError(failure instanceof Error ? failure.message : String(failure));
        setState("failed");
      });
    return () => { cancelled = true; };
  }, [version]);

  useEffect(() => {
    const changed = () => reload();
    addEventListener("pocket-memory-changed", changed);
    return () => removeEventListener("pocket-memory-changed", changed);
  }, [reload]);

  return { entries, state, error, reload };
}
