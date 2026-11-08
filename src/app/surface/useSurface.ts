import { useCallback, useEffect, useRef, useState } from "react";
import { createStateStore, type Spec, type StateStore } from "@json-render/core";
import { activeAccount } from "../../client/workspace-storage.js";
import { settings } from "../../client/pip-core.js";
import { resolve } from "../../client/pip-credentials.js";
import { subscribe } from "../data/bus.ts";
import { readMoment, momentKey, type Moment } from "./context.ts";
import { fallbackSurface } from "./fallback.ts";
import { NoModel, streamSurface } from "./generate.ts";

// The home surface's life cycle:
// 1. the standard surface (fallback.ts) draws at once from local data;
// 2. if a model is connected and nothing was arranged for this moment yet, Pocket asks it to arrange one,
//    and the screen builds up as it streams;
// 3. the arranged spec is kept per moment (phase of day + shape of what is due), so reopening costs nothing;
// 4. the state the spec binds to stays live: ticking a task, a sync or the minute changing updates it in place.

export type SurfaceStatus = "standard" | "arranging" | "arranged" | "failed";

interface Cached { key: string; owner: string; spec: Spec; at: number }
const CACHE = "pocket:surface";
const readCache = (key: string): Spec | null => {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE) || "null") as Cached | null;
    return cached && cached.key === key && cached.owner === activeAccount() ? cached.spec : null;
  } catch { return null; }
};
const writeCache = (key: string, spec: Spec) => {
  try { localStorage.setItem(CACHE, JSON.stringify({ key, owner: activeAccount(), spec, at: Date.now() } satisfies Cached)); } catch { /* full or blocked */ }
};

/** The moment as json-render state, kept current from the stores and the clock. */
function useMomentStore(): { store: StateStore; moment: Moment } {
  const [store] = useState(() => createStateStore(readMoment() as unknown as Record<string, unknown>));
  const [moment, setMoment] = useState(() => readMoment());
  useEffect(() => {
    const refresh = () => {
      const next = readMoment();
      store.update(Object.fromEntries(Object.entries(next).map(([key, value]) => ["/" + key, value])));
      setMoment(next);
    };
    const unsubscribe = subscribe(refresh);
    const minute = setInterval(refresh, 60_000);
    return () => { unsubscribe(); clearInterval(minute); };
  }, [store]);
  return { store, moment };
}

async function modelConnected(): Promise<boolean> {
  try { return Boolean(await resolve(settings())); } catch { return false; }
}

export function useSurface() {
  const { store, moment } = useMomentStore();
  const key = momentKey(moment);
  const [spec, setSpec] = useState<Spec>(() => readCache(key) ?? fallbackSurface(moment));
  const [status, setStatus] = useState<SurfaceStatus>(() => (readCache(key) ? "arranged" : "standard"));
  const [error, setError] = useState("");
  const running = useRef<AbortController | null>(null);
  const momentRef = useRef(moment);
  momentRef.current = moment;

  const arrange = useCallback(async () => {
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    setStatus("arranging"); setError("");
    try {
      const final = await streamSurface(momentRef.current, { signal: controller.signal, onSpec: partial => { if (!controller.signal.aborted) setSpec(partial); } });
      if (controller.signal.aborted) return;
      writeCache(momentKey(momentRef.current), final);
      setSpec(final); setStatus("arranged");
    } catch (failure) {
      if (controller.signal.aborted) return;
      setSpec(fallbackSurface(momentRef.current));
      setStatus(failure instanceof NoModel ? "standard" : "failed");
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (running.current === controller) running.current = null;
    }
  }, []);

  const standard = useCallback(() => {
    running.current?.abort();
    setSpec(fallbackSurface(momentRef.current)); setStatus("standard"); setError("");
  }, []);

  // A new moment: show what was arranged for it before, or the standard surface, and arrange if possible.
  useEffect(() => {
    const cached = readCache(key);
    if (cached) { setSpec(cached); setStatus("arranged"); return; }
    setSpec(fallbackSurface(momentRef.current)); setStatus("standard");
    let live = true;
    void modelConnected().then(ok => { if (live && ok) void arrange(); });
    return () => { live = false; };
  }, [key, arrange]);

  useEffect(() => () => running.current?.abort(), []);

  return { spec, store, moment, status, error, arrange, standard };
}
