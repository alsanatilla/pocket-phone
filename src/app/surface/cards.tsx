import type { Spec } from "@json-render/core";

// Telling cards apart: a reply written before Pip used the surface catalog has classic-only types or props and is
// drawn by the classic renderer (src/client/pip-cards.jsx). The chat draws cards in features/pip/stream/Card.tsx.
// The test itself lives in src/shared/pocket-spec.js, where the reply runner also uses it to keep replayed
// answers from teaching the retired shape.
export { isLegacySpec } from "../../shared/pocket-spec.js";

export function decodeSpec(value: string): Spec | null {
  try {
    const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0));
    const spec = JSON.parse(new TextDecoder().decode(bytes)) as Spec;
    return spec && typeof spec === "object" && spec.root && spec.elements ? spec : null;
  } catch { return null; }
}
