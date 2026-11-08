import { useMemo, useSyncExternalStore } from "react";
import { onChange } from "../../client/store.js";

// The classic stores read localStorage on every call and announce their writes (see the listeners below).
// Views subscribe to a version counter per collection and derive their data from it, so a write anywhere
// (this shell, sync, another tab) re-renders exactly the views that read that collection.

const versions = new Map();
const listeners = new Set();
const bump = name => {
  versions.set(name, (versions.get(name) || 0) + 1);
  listeners.forEach(fn => fn());
};

// Workspace collections (tasks.json, notes.json, …) announce writes here.
onChange(name => bump(name));
// Object stores (chats, zines) announce writes with a window event that names no collection.
addEventListener("pocket-persistence-change", () => bump("chats"));
// Another tab wrote localStorage. Signed-in keys carry "pocket:account:<id>:" in front of the usual key.
addEventListener("storage", event => {
  const key = (event.key || "").replace(/^pocket:account:[^:]+:/, "");
  if (key.startsWith("pocket:pip-chat:")) bump("chats");
  else if (key.startsWith("pocket:")) bump(key.slice(7));
});

const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };

/** Returns `read()`, recomputed only when one of the collections in `names` changes. */
export function useStore(names, read) {
  const version = useSyncExternalStore(subscribe, () => names.map(name => versions.get(name) || 0).join(":"));
  // `read` is a fresh closure each render; the data it reads only changes when `version` does.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(read, [version]);
}
