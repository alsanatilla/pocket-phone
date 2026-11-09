import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readMoment } from "./context.ts";
import { fallbackSurface } from "./fallback.ts";
import { remoteSurface } from "./remote.ts";
import { streamSurface } from "./generate.ts";
import { useSurface } from "./useSurface.ts";
vi.mock("../../client/workspace-storage.js", async original => ({ ...await original<typeof import("../../client/workspace-storage.js")>(), activeAccount: () => "owner" }));
vi.mock("./remote.ts", () => ({ remoteSurface: vi.fn() }));
vi.mock("./generate.ts", () => ({ streamSurface: vi.fn(), NoModel: class extends Error {} }));
vi.mock("./moment.ts", async () => {
  const { readMoment } = await import("./context.ts");
  const { createStateStore } = await import("@json-render/core");
  const moment = readMoment();
  return { currentMoment: () => moment, momentStore: () => createStateStore(moment as unknown as Record<string, unknown>), onMoment: () => () => {} };
});
beforeEach(() => { vi.mocked(remoteSurface).mockReset(); vi.mocked(streamSurface).mockReset(); });

describe("Today page lifecycle", () => {
  it("restores the account layout even when automatic generation is off", async () => {
    localStorage.setItem("pocket:ai-profile", JSON.stringify({ provider: "anthropic", tier: "balanced", autoArrange: false }));
    const spec = fallbackSurface(readMoment());
    vi.mocked(remoteSurface).mockResolvedValue(spec);
    const { result } = renderHook(useSurface);
    await waitFor(() => expect(result.current.status).toBe("arranged"));
    expect(result.current.spec).toEqual(spec);
    expect(streamSurface).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("pocket:surface")!).owner).toBe("owner");
  });

  it("ignores a late response after leaving the page", async () => {
    let finish!: (spec: ReturnType<typeof fallbackSurface>) => void;
    vi.mocked(remoteSurface).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { unmount } = renderHook(useSurface);
    unmount();
    await act(async () => { finish(fallbackSurface(readMoment())); });
    expect(localStorage.getItem("pocket:surface")).toBeNull();
    expect(vi.mocked(remoteSurface).mock.calls[0]![1].signal.aborted).toBe(true);
  });

  it("keeps the standard-layout choice when Today is reopened", async () => {
    vi.mocked(remoteSurface).mockResolvedValue(fallbackSurface(readMoment()));
    const first = renderHook(useSurface);
    await waitFor(() => expect(first.result.current.status).toBe("arranged"));
    act(() => first.result.current.standard());
    first.unmount();
    vi.mocked(remoteSurface).mockClear();
    const second = renderHook(useSurface);
    expect(second.result.current.status).toBe("standard");
    expect(remoteSurface).not.toHaveBeenCalled();
  });
});
