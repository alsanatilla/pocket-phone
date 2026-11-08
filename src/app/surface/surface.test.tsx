import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createStateStore, validateSpec } from "@json-render/core";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { createTask } from "../data/tasks.ts";
import { catalog } from "./catalog.ts";
import { momentKey, phaseOf, readMoment, type Moment } from "./context.ts";
import { fallbackSurface } from "./fallback.ts";
import { systemPrompt, userPrompt } from "./generate.ts";
import { registry } from "./registry.tsx";

vi.mock("recharts", async original => ({ ...(await original<typeof import("recharts")>()), ResponsiveContainer: ({ children }: { children: unknown }) => children }));

const at = (hour: number) => new Date(2026, 10, 8, hour, 15).getTime();

describe("the moment", () => {
  it("names the phase of the day", () => {
    expect([2, 7, 12, 15, 20, 23].map(phaseOf)).toEqual(["night", "morning", "midday", "afternoon", "evening", "night"]);
  });

  it("counts what is due and keeps its key when only the data changes", () => {
    createTask("Call the clinic", { due: "2026-11-08" });
    createTask("Old bill", { due: "2026-11-01" });
    const moment = readMoment(at(9));
    expect(moment.tasks).toMatchObject({ open: 2, due: 2, overdue: 1 });
    expect(moment.tasks.list.map(task => task.text)).toContain("Old bill");

    createTask("Another one today", { due: "2026-11-08" });
    expect(momentKey(readMoment(at(9)), "2026-11-08")).toBe(momentKey(moment, "2026-11-08"));
    expect(momentKey(readMoment(at(20)), "2026-11-08")).not.toBe(momentKey(moment, "2026-11-08"));
  });
});

describe("the standard surface", () => {
  it.each([7, 12, 16, 21])("is a valid spec of catalog components at %i:15", hour => {
    createTask("Something due", { due: "2026-11-08" });
    const spec = fallbackSurface(readMoment(at(hour)));
    expect(validateSpec(spec).valid).toBe(true);
    for (const element of Object.values(spec.elements)) expect(catalog.componentNames).toContain(element.type);
  });

  it("renders live values from state and the real task list", () => {
    createTask("Water the plants", { due: new Date().toISOString().slice(0, 10) });
    const moment = readMoment();
    const store = createStateStore(moment as unknown as Record<string, unknown>);
    render(<JSONUIProvider registry={registry} store={store} handlers={{}}><Renderer spec={fallbackSurface(moment)} registry={registry} /></JSONUIProvider>);
    expect(screen.getByText("Water the plants")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Complete Water the plants" })).toBeTruthy();
  });
});

describe("the prompt", () => {
  it("describes Pocket's components and actions and carries the moment as state", () => {
    const system = systemPrompt();
    for (const name of ["Hero", "Metric", "Gauge", "Chart", "Timeline", "TaskList", "Capture", "Grid", "Tabs"]) expect(system).toContain(name);
    expect(system).toContain("askPip");
    expect(system).not.toContain("className");

    const moment: Moment = readMoment(at(8));
    expect(userPrompt(moment)).toContain("morning");
    expect(userPrompt(moment)).toContain('"phase"');
  });
});
