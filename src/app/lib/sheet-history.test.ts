import { beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { dropSheetEntry, hasSheetEntry, useSheetBack } from "./sheet-history.ts";

// The chats sheet lives in the browser's history: back closes it, and picking a chat leaves no copy behind.

beforeEach(() => { history.replaceState(null, ""); });

describe("a sheet that goes back", () => {
  it("adds an entry when it opens and closes when the browser goes back to the one before", () => {
    const close = vi.fn();
    const { rerender } = renderHook(({ open }: { open: boolean }) => useSheetBack(open, close), { initialProps: { open: false } });
    expect(hasSheetEntry()).toBe(false);

    rerender({ open: true });
    expect(hasSheetEntry()).toBe(true);
    expect(close).not.toHaveBeenCalled();

    act(() => { dispatchEvent(new PopStateEvent("popstate")); });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("adds one entry per opening, even when the effect runs twice for StrictMode", () => {
    const close = vi.fn();
    const before = history.length;
    const { rerender } = renderHook(({ open }: { open: boolean }) => useSheetBack(open, close), { initialProps: { open: false }, wrapper: StrictMode });
    rerender({ open: true });
    expect(history.length).toBe(before + 1);
    rerender({ open: false });
    rerender({ open: true });
    expect(history.length).toBe(before + 2);
  });

  it("forgets its entry when something was picked, so back returns to the page it was opened from", () => {
    const close = vi.fn();
    const { rerender } = renderHook(({ open }: { open: boolean }) => useSheetBack(open, close), { initialProps: { open: false } });
    rerender({ open: true });
    dropSheetEntry();
    rerender({ open: false });
    expect(hasSheetEntry()).toBe(false);
  });
});
