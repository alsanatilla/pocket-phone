import { afterEach, describe, expect, it, vi } from "vitest";
import { remoteSurface } from "./remote.ts";
const account = vi.hoisted(() => ({ id: "owner" }));
vi.mock("../../client/workspace-storage.js", () => ({ activeAccount: () => account.id }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); account.id = "owner"; });
const spec = { root: "main", elements: {} };
const response = (surface: unknown, accountId = "owner") => new Response(JSON.stringify({ accountId, surface }));
describe("restoring Today", () => {
  it("follows running work until its saved result is ready without submitting another run", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce(response({ status: "running", spec: null })).mockResolvedValueOnce(response({ status: "done", spec }));
    vi.stubGlobal("fetch", fetcher);
    const onRunning = vi.fn(), onSpec = vi.fn();
    const run = remoteSurface("morning", { signal: new AbortController().signal, onRunning, onSpec });
    await vi.advanceTimersByTimeAsync(1100);
    expect(await run).toEqual(spec);
    expect(onRunning).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(call => call[1].method === "GET")).toBe(true);
  });
  it("leaving cancels observation, without a server stop request", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue(response({ status: "running" }));
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    const run = remoteSurface("morning", { signal: controller.signal, onSpec: () => {} });
    const rejected = expect(run).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejected;
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("never renders a different account's result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ status: "done", spec }, "someone-else")));
    const onSpec = vi.fn();
    await expect(remoteSurface("morning", { signal: new AbortController().signal, onSpec })).rejects.toThrow("Account changed");
    expect(onSpec).not.toHaveBeenCalled();
  });
});
