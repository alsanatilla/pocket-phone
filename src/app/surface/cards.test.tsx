import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { z } from "zod";
import { CARD_ACTIONS, CARD_COMPONENTS, CARDS_PROMPT } from "../../shared/pocket-cards.js";
import { createTask } from "../data/tasks.ts";
import { catalog } from "./catalog.ts";
import { decodeSpec, hydrateSurfaceCards, isLegacySpec, releaseSurfaceCards } from "./cards.tsx";

vi.mock("recharts", async original => ({ ...(await original<typeof import("recharts")>()), ResponsiveContainer: ({ children }: { children: unknown }) => children }));

const encode = (value: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
const placeholder = (spec: unknown) => {
  const host = document.createElement("div");
  host.innerHTML = `<p>prose</p><div class="pocket-spec" data-spec="${encode(spec)}"></div>`;
  document.body.append(host);
  return host;
};

describe("the card prompt", () => {
  const components = catalog.data.components as Record<string, { props: z.ZodObject<z.ZodRawShape> }>;

  it("names only components and props the catalog has", () => {
    for (const [name, [props]] of Object.entries(CARD_COMPONENTS)) {
      expect(catalog.componentNames, name).toContain(name);
      for (const prop of props as string[]) expect(Object.keys(components[name]!.props.shape), `${name}.${prop}`).toContain(prop);
    }
  });

  it("names only actions the catalog has, with their params", () => {
    const actions = catalog.data.actions as Record<string, { params: z.ZodObject<z.ZodRawShape> }>;
    for (const [name, [param]] of Object.entries(CARD_ACTIONS)) {
      expect(catalog.actionNames, name).toContain(name);
      expect(Object.keys(actions[name]!.params.shape)).toContain(param);
    }
  });

  it("is what Pip is told", () => {
    expect(CARDS_PROMPT).toContain("Hero(eyebrow, value, unit, caption, tone)");
    expect(CARDS_PROMPT).toContain("Chart(kind, title, data, unit, tone)");
    expect(CARDS_PROMPT).not.toMatch(/\bFields?\b|LinkButton|subtitle/);
  });
});

describe("cards in a reply", () => {
  const modern = {
    root: "main",
    elements: {
      main: { type: "Stack", props: { direction: "vertical", gap: "md" }, children: ["tiles", "tasks", "choice"] },
      tiles: { type: "Grid", props: { columns: 2, gap: "md" }, children: ["a", "b"] },
      a: { type: "Metric", props: { label: "schlaf", value: "7,5", unit: "h", hint: "über dem Schnitt", tone: "calendar" }, children: [] },
      b: { type: "Metric", props: { label: "strain", value: 41, unit: null, hint: null, tone: "warning" }, children: [] },
      tasks: { type: "TaskList", props: { title: null, source: "open", limit: 3 }, children: [] },
      choice: { type: "Button", props: { label: "plan tomorrow", variant: "primary" }, on: { press: { action: "askPip", params: { prompt: "Plan tomorrow with me" } } }, children: [] },
    },
  };

  it("draws a new-catalog card with live tasks, and its button asks Pip in the same chat", async () => {
    createTask("Fahrrad reparieren");
    const onAsk = vi.fn();
    const host = placeholder(modern);
    act(() => hydrateSurfaceCards(host, { onAsk }));
    await waitFor(() => expect(screen.getByText("über dem Schnitt")).toBeTruthy());
    expect(screen.getByText("Fahrrad reparieren")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "plan tomorrow" }));
    await waitFor(() => expect(onAsk).toHaveBeenCalledWith("Plan tomorrow with me"));
    act(() => releaseSurfaceCards(host));
    host.remove();
  });

  it("leaves a card from before the new catalog to the classic renderer", () => {
    const legacy = { root: "card", elements: { card: { type: "Card", props: { title: "Week", subtitle: "3 due" }, children: ["f"] }, f: { type: "Field", props: { label: "next", value: "tax" }, children: [] } } };
    expect(isLegacySpec(legacy as never)).toBe(true);
    expect(isLegacySpec(modern as never)).toBe(false);
    const host = placeholder(legacy);
    hydrateSurfaceCards(host, { onAsk: () => {} });
    expect((host.querySelector(".pocket-spec") as HTMLElement).dataset.renderer).toBeUndefined();
    host.remove();
  });

  it("keeps non-ASCII text intact", () => {
    expect(decodeSpec(encode({ root: "a", elements: { a: { type: "Text", props: { text: "Grüße, Zürich" }, children: [] } } }))?.elements.a).toMatchObject({ props: { text: "Grüße, Zürich" } });
  });
});
