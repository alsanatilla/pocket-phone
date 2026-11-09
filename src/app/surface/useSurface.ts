import { defaultConfig } from "../data/models.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Spec, StateStore } from "@json-render/core";
import { activeAccount } from "../../client/workspace-storage.js";
import { readProfile } from "../data/ai.ts";
import { resolve } from "../../client/pip-credentials.js";
import { momentKey, type Moment } from "./context.ts";
import { currentMoment, momentStore, onMoment } from "./moment.ts";
import { fallbackSurface } from "./fallback.ts";
import { remoteSurface } from "./remote.ts";
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
const writeCache = (key: string, spec: Spec, owner: string) => {
  if (owner !== activeAccount()) return;
  try { localStorage.setItem(CACHE, JSON.stringify({ key, owner, spec, at: Date.now() } satisfies Cached)); } catch { /* full or blocked */ }
};

/** The shared live moment (moment.ts) and its store; re-renders when the moment changes. */
function useMomentStore(): { store: StateStore; moment: Moment } {
  const [moment, setMoment] = useState(currentMoment);
  useEffect(() => onMoment(setMoment), []);
  return { store: momentStore(), moment };
}

/** Arrange by itself only when the person allows it and a model is connected. */
async function mayArrange(): Promise<boolean> {
  try {
    const profile = readProfile();
    return profile.autoArrange && Boolean(await resolve(defaultConfig()));
  } catch { return false; }
}

const enough = (spec: Spec): boolean => {
  const root = (spec.elements as Record<string, { children?: string[] }> | undefined)?.[spec.root];
  return Boolean(root) && (root!.children ?? []).filter(id => Boolean((spec.elements as Record<string, unknown>)[id])).length >= 2;
};

export function useSurface() {
  const { store, moment } = useMomentStore();
  const key = momentKey(moment);
  const [spec, setSpec] = useState<Spec>(() => readCache(key) ?? fallbackSurface(moment));
  const [status, setStatus] = useState<SurfaceStatus>(() => (readCache(key) ? "arranged" : "standard"));
  const [error, setError] = useState("");
  const running = useRef<AbortController | null>(null);
  const momentRef = useRef(moment);
  momentRef.current = moment;

  const owner = activeAccount();
  const standardKey = "pocket:surface-standard:" + owner;
  const arrange = useCallback(async (force = true) => {
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    const snapshot = momentRef.current, startedKey = momentKey(snapshot), startedOwner = activeAccount();
    if (force) localStorage.removeItem(standardKey);
    setStatus("arranging"); setError("");
    try {
      const final = await streamSurface(snapshot, { signal: controller.signal, onSpec: partial => {
        if (!controller.signal.aborted && activeAccount() === startedOwner && enough(partial)) setSpec(partial);
      } }, force);
      if (controller.signal.aborted || activeAccount() !== startedOwner) return;
      writeCache(startedKey, final, startedOwner);
      setSpec(final); setStatus("arranged");
    } catch (failure) {
      if (controller.signal.aborted || activeAccount() !== startedOwner) return;
      setSpec(readCache(startedKey) ?? fallbackSurface(snapshot));
      setStatus(failure instanceof NoModel ? "standard" : "failed");
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (running.current === controller) running.current = null;
    }
  }, [standardKey]);

  const standard = useCallback(() => {
    running.current?.abort();
    localStorage.setItem(standardKey, momentKey(momentRef.current));
    setSpec(fallbackSurface(momentRef.current)); setStatus("standard"); setError("");
  }, [standardKey]);

  useEffect(() => {
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    const cached = readCache(key);
    const preferStandard = localStorage.getItem(standardKey) === key;
    setSpec(!preferStandard && cached ? cached : fallbackSurface(momentRef.current));
    setStatus(!preferStandard && cached ? "arranged" : "standard"); setError("");
    if (preferStandard) return () => controller.abort();
    void (async () => {
      try {
        // Restore server work even with auto-arrange off or a key disconnected since it finished.
        if (owner) {
          const saved = await remoteSurface(key, { signal: controller.signal, onRunning: () => { if (!controller.signal.aborted) setStatus("arranging"); }, onSpec: partial => {
            if (!controller.signal.aborted && enough(partial)) setSpec(partial);
          } });
          if (controller.signal.aborted) return;
          if (saved) { writeCache(key, saved, owner); setSpec(saved); setStatus("arranged"); return; }
        }
        if (!cached && !controller.signal.aborted && await mayArrange() && !controller.signal.aborted) void arrange(false);
      } catch (failure) {
        if (controller.signal.aborted) return;
        setStatus("failed"); setError(failure instanceof Error ? failure.message : String(failure));
      }
    })();
    return () => { controller.abort(); running.current?.abort(); };
  }, [key, owner, standardKey, arrange]);

  useEffect(() => () => running.current?.abort(), []);

  return { spec, store, moment, status, error, arrange, standard };
}
