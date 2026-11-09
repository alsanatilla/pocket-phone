import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { z } from "zod";
import { CARD_ACTIONS, CARD_COMPONENTS, CARDS_PROMPT } from "../../shared/pocket-cards.js";
import { createTask } from "../data/tasks.ts";
import { catalog } from "./catalog.ts";
import { decodeSpec, isLegacySpec } from "./cards.tsx";
import { Card } from "../features/pip/stream/Card.tsx";
import { mergeSeries } from "./components.tsx";

vi.mock("recharts", async original => ({ ...(await original<typeof import("recharts")>()), ResponsiveContainer: ({ children }: { children: unknown }) => children }));

const encode = (value: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
const lines = (spec: { root: string; elements: Record<string, unknown> }) =>
  [JSON.stringify({ op: "add", path: "/root", value: spec.root }), ...Object.entries(spec.elements).map(([id, value]) => JSON.stringify({ op: "add", path: "/elements/" + id, value }))].join("\n") + "\n";

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
    expect(CARDS_PROMPT).toContain("Chart(kind, title, data, series, unit, tone, note, source)");
    expect(CARDS_PROMPT).toContain("Table(title, columns, rows, note, source)");
    expect(CARDS_PROMPT).toMatch(/exactly where the picture belongs/);
    expect(CARDS_PROMPT).toMatch(/Never invent/);
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
    render(<Card source={lines(modern)} closed streaming={false} onAsk={onAsk} />);
    await waitFor(() => expect(screen.getByText("über dem Schnitt")).toBeTruthy());
    expect(screen.getByText("Fahrrad reparieren")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "plan tomorrow" }));
    await waitFor(() => expect(onAsk).toHaveBeenCalledWith("Plan tomorrow with me"));
  });

  it("recognises a card from before the new catalog", () => {
    const legacy = { root: "card", elements: { card: { type: "Card", props: { title: "Week", subtitle: "3 due" }, children: ["f"] }, f: { type: "Field", props: { label: "next", value: "tax" }, children: [] } } };
    expect(isLegacySpec(legacy as never)).toBe(true);
    expect(isLegacySpec(modern as never)).toBe(false);
  });

  it("tells the new table from the classic one", () => {
    expect(isLegacySpec({ root: "t", elements: { t: { type: "Table", props: { headers: ["a"], rows: [] }, children: [] } } } as never)).toBe(true);
    expect(isLegacySpec({ root: "t", elements: { t: { type: "Table", props: { title: null, columns: ["a"], rows: [] }, children: [] } } } as never)).toBe(false);
  });

  it("keeps non-ASCII text intact", () => {
    expect(decodeSpec(encode({ root: "a", elements: { a: { type: "Text", props: { text: "Grüße, Zürich" }, children: [] } } }))?.elements.a).toMatchObject({ props: { text: "Grüße, Zürich" } });
  });
});

describe("charts of researched figures", () => {
  it("lines series up by label, keeping the order labels first appear and gaps as gaps", () => {
    const rows = mergeSeries([
      { name: "DE", data: [{ label: "Jan", value: 120 }, { label: "Feb", value: 340 }, { label: "Mar", value: 210 }] },
      { name: "AT", data: [{ label: "Jan", value: 90 }, { label: "Mar", value: 150 }, { label: "Apr", value: 80 }] },
    ]);
    expect(rows).toEqual([
      { label: "Jan", s0: 120, s1: 90 }, { label: "Feb", s0: 340 }, { label: "Mar", s0: 210, s1: 150 }, { label: "Apr", s1: 80 },
    ]);
  });
});
