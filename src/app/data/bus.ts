import { useMemo, useSyncExternalStore, type DependencyList } from "react";
import { onChange } from "../../client/store.js";

// One change bus for every local collection. The stores under src/client announce writes three different ways
// (store.onChange, a window event for object stores, the storage event from other tabs) and sync announces
// merges with its own events. `connect()` turns all of them into "collection X changed"; views subscribe with
// useCollection and never listen to those sources themselves.

export type Collection =
  | "notes.json" | "tasks.json" | "parking.json" | "receipt.json" | "dice.json" | "journal.json" | "gym.json"
  | "agenda.json" | "clock.json" | "chats" | "*";

const versions = new Map<string, number>();
const listeners = new Set<() => void>();

export function bump(name: string): void {
  versions.set(name, (versions.get(name) ?? 0) + 1);
  listeners.forEach(listener => listener());
}
/** Something that can touch many collections at once happened (a sync merge, extras, COROS). */
export const bumpAll = (): void => bump("*");

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** Calls `listener` only when one of `names` (or "*") changed; returns an unsubscribe. */
export function watch(names: readonly Collection[], listener: () => void): () => void {
  let last = snapshot(names);
  return subscribe(() => {
    const next = snapshot(names);
    if (next !== last) { last = next; listener(); }
  });
}

export const snapshot = (names: readonly Collection[]): string => ["*", ...names].map(name => versions.get(name) ?? 0).join(":");

/** Collection a localStorage key belongs to: "pocket:tasks.json" → tasks.json, chats by prefix, accounts stripped. */
export function collectionOfKey(key: string): string | null {
  const plain = key.replace(/^pocket:account:[^:]+:/, "");
  if (plain.startsWith("pocket:pip-chat:")) return "chats";
  if (plain.startsWith("pocket:") && plain.endsWith(".json")) return plain.slice(7);
  return null;
}

let connected = false;
/** Wires the store and sync events to the bus. Called once by main; tests call it or bump by hand. */
export function connect(): void {
  if (connected) return;
  connected = true;
  onChange((name: string) => bump(name));
  addEventListener("pocket-persistence-change", () => bump("chats"));
  for (const name of ["pocket-objects-synced", "pocket-coros-synced", "pocket-extras-applied"]) addEventListener(name, bumpAll);
  addEventListener("storage", event => {
    const name = collectionOfKey(event.key ?? "");
    if (name) bump(name);
  });
}

/**
 * `read()`'s result, recomputed only when one of `names` changes or one of `deps` does. The stores read
 * localStorage on every call, so this is also what keeps renders from parsing JSON over and over.
 */
export function useCollection<T>(names: readonly Collection[], read: () => T, deps: DependencyList = []): T {
  const version = useSyncExternalStore(subscribe, () => snapshot(names), () => snapshot(names));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(read, [version, ...deps]);
}
