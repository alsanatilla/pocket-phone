import { memo, useMemo, useRef } from "react";
import { JSONUIProvider, Renderer } from "@json-render/react";
import type { Spec } from "@json-render/core";
import { LegacyCard } from "../../../../client/pip-cards.jsx";
import { pocketSpec, normalizeSpec } from "../../../../shared/pocket-spec.js";
import { completeTask } from "../../../data/tasks.ts";
import { parkThoughtText } from "../../../data/thoughts.ts";
import { toast, toastError } from "../../../ui/toast/toast.ts";
import { isLegacySpec } from "../../../surface/cards.tsx";
import { momentStore } from "../../../surface/moment.ts";
import { registry } from "../../../surface/registry.tsx";
import { openPath } from "../../../lib/classic.ts";

// A card inside a reply, built while it streams. Only complete JSON lines count (the line being written is held
// back), each element appears as soon as its line is complete, and elements that did not change keep their
// identity, so nothing already on screen re-mounts or re-animates while the rest arrives. The JSON is never shown.

type Elements = Record<string, unknown>;

/** The spec compiled from complete lines, with unchanged elements keeping the same object between updates. */
export function useStreamingSpec(source: string, closed: boolean): Spec | null {
  const previous = useRef<{ elements: Elements; json: Map<string, string> }>({ elements: {}, json: new Map() });
  return useMemo(() => {
    const complete = closed ? source : source.slice(0, source.lastIndexOf("\n") + 1);
    const spec = complete.trim() ? normalizeSpec(pocketSpec(complete)) : null;
    if (!spec || typeof spec.root !== "string" || !spec.elements || typeof spec.elements !== "object") return null;
    const elements: Elements = {}, json = new Map<string, string>();
    for (const [id, element] of Object.entries(spec.elements)) {
      const text = JSON.stringify(element);
      json.set(id, text);
      elements[id] = previous.current.json.get(id) === text ? previous.current.elements[id] : element;
    }
    previous.current = { elements, json };
    return { ...spec, root: spec.root, elements } as Spec;
  }, [source, closed]);
}

function useHandlers(onAsk: (prompt: string) => void) {
  const ask = useRef(onAsk);
  ask.current = onAsk;
  return useMemo(() => {
    const guard = (run: (params: Record<string, unknown>) => void) => (params: Record<string, unknown>) => {
      try { run(params ?? {}); } catch (error) { toastError(error); }
    };
    return {
      askPip: guard(({ prompt }) => { const text = String(prompt ?? "").trim(); if (text) ask.current(text.slice(0, 2000)); }),
      open: guard(({ to }) => openPath(String(to || "/today"))),
      completeTask: guard(({ uid }) => { completeTask(String(uid)); toast("Done."); }),
      parkThought: guard(({ text }) => { parkThoughtText(String(text)); toast("Kept."); }),
    };
  }, []);
}

const CONTAINERS = new Set(["Stack", "Grid", "Card"]);
/** Whether the spec has its root and at least one element that draws something. */
function visible(spec: Spec): boolean {
  const elements = spec.elements as Record<string, { type?: string }>;
  return Boolean(elements[spec.root]) && Object.values(elements).some(element => element && !CONTAINERS.has(String(element.type)));
}

/** Where a card will be, while its first lines arrive. */
function Placeholder() {
  return <div className="shimmer arrive my-3 h-28 rounded-lg" aria-hidden="true" />;
}

export const Card = memo(function Card({ source, closed, streaming, onAsk }: { source: string; closed: boolean; streaming: boolean; onAsk: (prompt: string) => void }) {
  const spec = useStreamingSpec(source, closed);
  const handlers = useHandlers(onAsk);
  // Containers alone draw nothing: until the first visible element has arrived, the placeholder holds the place.
  if (!spec || !visible(spec)) return streaming && !closed ? <Placeholder /> : null;
  if (isLegacySpec(spec)) return <div className="not-prose my-3"><LegacyCard spec={spec} /></div>;
  return (
    <div className="not-prose my-3">
      <JSONUIProvider registry={registry} store={momentStore()} handlers={handlers}>
        <Renderer spec={spec} registry={registry} loading={streaming && !closed} />
      </JSONUIProvider>
    </div>
  );
});
