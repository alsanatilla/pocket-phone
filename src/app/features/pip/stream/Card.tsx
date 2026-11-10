import { memo, useMemo, useRef } from "react";
import { Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { CardMenu } from "./CardMenu.tsx";

// A card inside a reply, built while it streams. Only complete JSON lines count (the line being written is held
// back), each element appears as soon as its line is complete, and elements that did not change keep their
// identity, so nothing already on screen re-mounts or re-animates while the rest arrives. The JSON is never shown.

type Elements = Record<string, unknown>;

/**
 * A button the model wrote without an action would do nothing. In a reply, a button is a choice for the next
 * message, so it asks Pip what it says.
 */
function withDefaultPress(element: unknown): unknown {
  const value = element as { type?: unknown; on?: unknown; props?: { label?: unknown } } | null;
  if (!value || value.type !== "Button" || value.on || typeof value.props?.label !== "string" || !value.props.label.trim()) return element;
  return { ...value, on: { press: { action: "askPip", params: { prompt: value.props.label.trim() } } } };
}

/** The spec compiled from complete lines, with unchanged elements keeping the same object between updates. */
export function useStreamingSpec(source: string, closed: boolean): Spec | null {
  const previous = useRef<{ elements: Elements; json: Map<string, string> }>({ elements: {}, json: new Map() });
  return useMemo(() => {
    const complete = closed ? source : source.slice(0, source.lastIndexOf("\n") + 1);
    const spec = complete.trim() ? normalizeSpec(pocketSpec(complete)) : null;
    if (!spec || typeof spec.root !== "string" || !spec.elements || typeof spec.elements !== "object") return null;
    const elements: Elements = {}, json = new Map<string, string>();
    for (const [id, written] of Object.entries(spec.elements)) {
      const element = withDefaultPress(written);
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

/** Where a card stands, so the person can pin, change or remove it: its chat, and whether this is the chat or Today. */
export interface CardPlace { chatId: string; place: "chat" | "today"; chatTitle?: string; locked?: boolean }

export const Card = memo(function Card({ source, closed, streaming, onAsk, at }: { source: string; closed: boolean; streaming: boolean; onAsk: (prompt: string) => void; at?: CardPlace }) {
  // Once the reply is finished, its last line is complete even without a newline after it.
  const spec = useStreamingSpec(source, closed || !streaming);
  const handlers = useHandlers(onAsk);
  // Containers alone draw nothing: until the first visible element has arrived, the placeholder holds the place.
  if (!spec || !visible(spec)) return streaming && !closed ? <Placeholder /> : null;
  if (isLegacySpec(spec)) return <div className="not-prose my-3"><LegacyCard spec={spec} /></div>;
  const marks = spec as { id?: string; updated?: unknown; pinned?: unknown };
  // A card Pip changed after it drew it (update_card) says when: the figures are newer than the words around them.
  const updated = Number(marks.updated) || 0, pinned = Number(marks.pinned) > 0;
  const hasMenu = Boolean(at && marks.id && !streaming);
  return (
    <div className="not-prose relative my-3" data-card={marks.id || undefined}>
      {/* Reserve a row: generated headings, figures and buttons can occupy any corner of the card. */}
      {hasMenu || updated ? <div className="mb-1 flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {at?.place === "today" ? <Button variant="ghost" className="h-11 min-w-0 max-w-full justify-start px-0 text-xs text-foreground sm:h-9"
            onClick={() => openPath("/pip?chat=" + encodeURIComponent(at.chatId))}>
            <Pin aria-hidden="true" className="size-3.5 text-primary" /><span className="truncate">{at.chatTitle || "a chat"}</span>
          </Button> : pinned ? <span className="inline-flex items-center gap-1.5"><Pin aria-hidden="true" className="size-3" />pinned to today</span> : null}
          {updated ? <span className="whitespace-nowrap">updated <time dateTime={new Date(updated).toISOString()}>{stamp(updated)}</time></span> : null}
        </div>
        {at && marks.id && hasMenu ? <CardMenu chatId={at.chatId} id={marks.id} pinned={pinned} place={at.place} locked={at.locked} onAsk={onAsk} /> : null}
      </div> : null}
      <JSONUIProvider registry={registry} store={momentStore()} handlers={handlers}>
        <Renderer spec={spec} registry={registry} loading={streaming && !closed} />
      </JSONUIProvider>
    </div>
  );
});

/** "14:32" today, "Mon 14:32" this week, "3 Nov" before that. */
function stamp(at: number): string {
  const date = new Date(at), age = Date.now() - at, time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  if (date.toDateString() === new Date().toDateString()) return time;
  return age < 6 * 864e5 ? date.toLocaleDateString([], { weekday: "short" }) + " " + time : date.toLocaleDateString([], { day: "numeric", month: "short" });
}
