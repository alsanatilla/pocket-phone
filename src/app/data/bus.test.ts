import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { bump, bumpAll, collectionOfKey, useCollection } from "./bus.ts";

describe("collectionOfKey", () => {
  it("maps workspace documents, chats and account-scoped keys", () => {
    expect(collectionOfKey("pocket:tasks.json")).toBe("tasks.json");
    expect(collectionOfKey("pocket:account:abc123:pocket:notes.json")).toBe("notes.json");
    expect(collectionOfKey("pocket:pip-chat:9f2")).toBe("chats");
    expect(collectionOfKey("pocket:dice-mode")).toBeNull();
    expect(collectionOfKey("other")).toBeNull();
  });
});

describe("useCollection", () => {
  it("recomputes only when a collection it reads changes", () => {
    let reads = 0;
    const { result } = renderHook(() => useCollection(["tasks.json"], () => ++reads));
    expect(result.current).toBe(1);

    act(() => bump("notes.json"));
    expect(result.current).toBe(1);

    act(() => bump("tasks.json"));
    expect(result.current).toBe(2);

    act(() => bumpAll());
    expect(result.current).toBe(3);
  });

  it("recomputes when a dependency changes", () => {
    const { result, rerender } = renderHook(({ filter }) => useCollection(["tasks.json"], () => filter.toUpperCase(), [filter]), { initialProps: { filter: "all" } });
    expect(result.current).toBe("ALL");
    rerender({ filter: "done" });
    expect(result.current).toBe("DONE");
  });
});
