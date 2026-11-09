import { createStateStore, type StateStore } from "@json-render/core";
import { subscribe } from "../data/bus.ts";
import { readMoment, type Moment } from "./context.ts";

// One live json-render state for the whole app: the moment (context.ts), refreshed whenever a store changes and
// every minute. Today's surface and the cards inside Pip's answers bind to the same store, so a TaskList in a
// reply and on Today tick together.

let store: StateStore | null = null;
let moment: Moment | null = null;
const listeners = new Set<(moment: Moment) => void>();

function refresh() {
  moment = readMoment();
  store?.update(Object.fromEntries(Object.entries(moment).map(([key, value]) => ["/" + key, value])));
  listeners.forEach(listener => listener(moment!));
}

/** The shared store, started on first use. */
export function momentStore(): StateStore {
  if (!store) {
    moment = readMoment();
    store = createStateStore(moment as unknown as Record<string, unknown>);
    subscribe(refresh);
    setInterval(refresh, 60_000);
  }
  return store;
}

export function currentMoment(): Moment {
  momentStore();
  return moment!;
}

/** Called with each new moment; returns an unsubscribe. */
export function onMoment(listener: (moment: Moment) => void): () => void {
  momentStore();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
