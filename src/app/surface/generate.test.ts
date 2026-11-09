import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { readMoment } from "./context.ts";
import { NoModel, streamSurface } from "./generate.ts";

// The model is the only thing faked: credentials resolve, the provider hands back a mock that streams JSONL
// patches in uneven chunks, the way a real provider does.

const credential = vi.hoisted(() => ({ value: { key: "test" } as { key: string } | null }));
const model = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../../client/pip-credentials.js", () => ({ resolve: async () => credential.value }));
vi.mock("../../client/pip-provider.js", () => ({ providerModel: async () => model.current, providerError: (error: unknown) => error }));

const PATCHES = [
  { op: "add", path: "/root", value: "main" },
  { op: "add", path: "/elements/main", value: { type: "Stack", props: { direction: "vertical", gap: "lg" }, children: ["hero", "tasks"] } },
  { op: "add", path: "/elements/hero", value: { type: "Hero", props: { eyebrow: null, value: { $state: "/tasks/due" }, unit: "due", caption: null, tone: "accent" }, children: [] } },
  { op: "add", path: "/elements/tasks", value: { type: "TaskList", props: { title: null, source: "due", limit: 5 }, children: [] } },
].map(patch => JSON.stringify(patch) + "\n").join("");

function streaming(text: string) {
  const chunks = text.match(/[\s\S]{1,37}/g) ?? [];
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t" },
          ...chunks.map(delta => ({ type: "text-delta" as const, id: "t", delta })),
          { type: "text-end", id: "t" },
          { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } },
        ],
      }),
    }),
  });
}

describe("streamSurface", () => {
  it("builds the spec while the model writes and returns it validated", async () => {
    model.current = streaming(PATCHES);
    const partials: number[] = [];
    const spec = await streamSurface(readMoment(), { signal: new AbortController().signal, onSpec: partial => partials.push(Object.keys(partial.elements ?? {}).length) });
    expect(spec.root).toBe("main");
    expect(Object.keys(spec.elements)).toEqual(["main", "hero", "tasks", "today-action"]);
    // The action card is Pocket's, not the model's: it is added to the root after the Hero.
    expect((spec.elements[spec.root] as { children: string[] }).children).toEqual(["hero", "today-action", "tasks"]);
    expect(["FocusSession", "EventPrep", "DayReview"]).toContain((spec.elements["today-action"] as { type: string }).type);
    expect(partials.length).toBeGreaterThan(1);
    expect(partials.at(-1)).toBe(3);
  });

  it("refuses a screen built from components Pocket does not have", async () => {
    model.current = streaming(PATCHES.replace('"TaskList"', '"Marquee"'));
    await expect(streamSurface(readMoment(), { signal: new AbortController().signal, onSpec: () => {} })).rejects.toThrow(/did not fit/);
  });

  it("says so when no model is connected", async () => {
    credential.value = null;
    await expect(streamSurface(readMoment(), { signal: new AbortController().signal, onSpec: () => {} })).rejects.toBeInstanceOf(NoModel);
    credential.value = { key: "test" };
  });
});
