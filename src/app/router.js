import { useSyncExternalStore } from "react";

// Hash routing, the same URL shape the classic app uses (#/name?key=value), so links work in both shells.
// The hash string is the snapshot: it is a primitive, so useSyncExternalStore re-renders only when it changes.

const subscribe = notify => {
  addEventListener("hashchange", notify);
  return () => removeEventListener("hashchange", notify);
};
const readHash = () => location.hash;

export function parseHash(hash) {
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?");
  const [name = "", ...rest] = path.split("/").filter(Boolean);
  return { name: name.toLowerCase(), rest, params: new URLSearchParams(query) };
}

/** The current route: `{ name, rest, params }`. Unknown or empty names fall back to `fallback`. */
export function useRoute(known, fallback) {
  const hash = useSyncExternalStore(subscribe, readHash, () => "");
  const route = parseHash(hash);
  return known.has(route.name) ? route : { ...route, name: fallback };
}

export const href = (name, params) => "#/" + name + (params ? "?" + new URLSearchParams(params) : "");
export const navigate = (name, params) => { location.hash = href(name, params); };
