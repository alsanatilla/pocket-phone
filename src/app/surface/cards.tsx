import { createRoot, type Root } from "react-dom/client";
import { JSONUIProvider, Renderer } from "@json-render/react";
import type { Spec } from "@json-render/core";
import { completeTask } from "../data/tasks.ts";
import { parkThoughtText } from "../data/thoughts.ts";
import { toast, toastError } from "../ui/toast/toast.ts";
import { momentStore } from "./moment.ts";
import { registry } from "./registry.tsx";

// Cards inside Pip's answers, drawn with the same catalog and registry as Today's surface and bound to the same
// live moment. The Markdown renderer leaves each ```pocket block as a placeholder (.pocket-spec[data-spec]); this
// mounts a React root into each one. Replies written before Pip used this catalog are recognised and left to the
// classic card renderer (src/client/pip-cards.jsx), so old chats still read as they did.

/** Types and props only the classic card catalog had. */
const LEGACY_TYPES = new Set(["Section", "Fields", "Field", "Table", "Divider", "Actions", "LinkButton"]);

type Element = { type?: string; props?: Record<string, unknown>; on?: unknown };

export function isLegacySpec(spec: Spec): boolean {
  return Object.values((spec.elements ?? {}) as Record<string, Element>).some(element =>
    LEGACY_TYPES.has(String(element.type))
    || (element.type === "Chart" && element.props != null && "chart" in element.props)
    || (element.type === "Card" && element.props != null && "subtitle" in element.props)
    || (element.type === "Button" && !element.on && element.props != null && ("value" in element.props || "id" in element.props)));
}

export function decodeSpec(value: string): Spec | null {
  try {
    const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0));
    const spec = JSON.parse(new TextDecoder().decode(bytes)) as Spec;
    return spec && typeof spec === "object" && spec.root && spec.elements ? spec : null;
  } catch { return null; }
}

export interface CardContext {
  /** A card's askPip action: the prompt becomes the next message in this chat. */
  onAsk: (prompt: string) => void;
}

const IN_APP = new Set(["/today", "/notes", "/pip", "/settings"]);

function handlers({ onAsk }: CardContext) {
  const guard = (run: (params: Record<string, unknown>) => void) => (params: Record<string, unknown>) => {
    try { run(params ?? {}); } catch (error) { toastError(error); }
  };
  return {
    askPip: guard(({ prompt }) => { const text = String(prompt ?? "").trim(); if (text) onAsk(text.slice(0, 2000)); }),
    open: guard(({ to }) => { const path = String(to || "/today"); if (IN_APP.has(path)) location.hash = "#" + path; else location.assign("/#" + path); }),
    completeTask: guard(({ uid }) => { completeTask(String(uid)); toast("Done."); }),
    parkThought: guard(({ text }) => { parkThoughtText(String(text)); toast("Kept."); }),
  };
}

const roots = new WeakMap<Element | HTMLElement, Root>();

/** Mounts every new-catalog card placeholder inside `node`. Idempotent per placeholder. */
export function hydrateSurfaceCards(node: HTMLElement, context: CardContext): void {
  for (const slot of node.querySelectorAll<HTMLElement>(".pocket-spec[data-spec]")) {
    if (roots.has(slot) || slot.dataset.renderer) continue;
    const spec = decodeSpec(slot.dataset.spec ?? "");
    if (!spec || isLegacySpec(spec)) continue;
    slot.dataset.renderer = "surface";
    const root = createRoot(slot);
    roots.set(slot, root);
    root.render(
      <div className="not-prose my-3">
        <JSONUIProvider registry={registry} store={momentStore()} handlers={handlers(context)}>
          <Renderer spec={spec} registry={registry} />
        </JSONUIProvider>
      </div>,
    );
  }
}

/** Unmounts the cards inside a node that is about to be replaced. */
export function releaseSurfaceCards(node: HTMLElement): void {
  for (const slot of node.querySelectorAll<HTMLElement>(".pocket-spec[data-spec]")) {
    const root = roots.get(slot);
    if (root) { roots.delete(slot); try { root.unmount(); } catch { /* already gone */ } }
  }
}
