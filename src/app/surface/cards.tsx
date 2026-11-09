import type { Spec } from "@json-render/core";

// Telling cards apart: a reply written before Pip used the surface catalog has classic-only types or props and is
// drawn by the classic renderer (src/client/pip-cards.jsx). The chat draws cards in features/pip/stream/Card.tsx.

/** Types and props only the classic card catalog had. */
const LEGACY_TYPES = new Set(["Section", "Fields", "Field", "Divider", "Actions", "LinkButton"]);

type Element = { type?: string; props?: Record<string, unknown>; on?: unknown };

export function isLegacySpec(spec: Spec): boolean {
  return Object.values((spec.elements ?? {}) as Record<string, Element>).some(element =>
    LEGACY_TYPES.has(String(element.type))
    || (element.type === "Chart" && element.props != null && "chart" in element.props)
    || (element.type === "Table" && element.props != null && "headers" in element.props)
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
