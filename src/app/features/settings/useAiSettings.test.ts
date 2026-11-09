import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { settings } from "../../../client/pip-core.js";
import { chats } from "../../data/chats.ts";
import { useAiSettings } from "./useAiSettings.ts";
import * as openrouter from "./openrouter.ts";

vi.mock("./openrouter.ts", () => ({ pending: vi.fn(() => false), finish: vi.fn(), connect: vi.fn() }));

describe("connection settings", () => {
  it("browsing providers and saving a key never selects a chat model", async () => {
    const chat = chats.create(), before = settings();
    const { result } = renderHook(() => useAiSettings("openrouter"));
    await waitFor(() => expect(result.current.connection.state).toBe("missing"));
    await act(async () => { await result.current.connectKey("test-key-12345678"); });
    expect(result.current.connection.state).toBe("connected");
    act(() => result.current.setProvider("anthropic"));
    expect(settings()).toEqual(before);
    expect(chats.get(chat.uid)).toEqual(chat);
  });

  it("an OpenRouter sign-in only connects the account", async () => {
    const chat = chats.create(), before = settings();
    vi.mocked(openrouter.pending).mockReturnValue(true);
    vi.mocked(openrouter.finish).mockResolvedValue("test-key-12345678");
    const { result } = renderHook(() => useAiSettings("openrouter"));
    await waitFor(() => expect(result.current.connection.state).toBe("connected"));
    expect(settings()).toEqual(before);
    expect(chats.get(chat.uid)).toEqual(chat);
  });
});
