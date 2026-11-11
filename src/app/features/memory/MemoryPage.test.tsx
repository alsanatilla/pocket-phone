import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { chats } from "../../data/chats.ts";
import type { MemoryEntry } from "../../data/memory.ts";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, search, children, className }: { to: string; search?: { chat?: string }; children?: ReactNode; className?: string }) => (
    <a href={"#" + to + (search?.chat ? "?chat=" + search.chat : "")} className={className}>{children}</a>
  ),
}));
vi.mock("../../../client/cloud.js", () => ({ connected: vi.fn(() => true), request: vi.fn(), post: vi.fn() }));
vi.mock("../../ui/toast/toast.ts", () => ({ toast: vi.fn(), toastError: vi.fn(), clearToast: vi.fn() }));

import * as cloud from "../../../client/cloud.js";
import { toast } from "../../ui/toast/toast.ts";
import { DialogHost } from "../../ui/dialog/DialogHost.tsx";
import { MemoryPage } from "./MemoryPage.tsx";

// The memory page reads the server's list, then shows each entry with the chat it came from and the actions that
// change it. Cloud and the router's link are stubbed; the real page, dialogs and stores are used.

const at = (day: number) => new Date(2026, 10, day, 12).getTime();
const entry = (id: string, text: string, day: number, chat = ""): MemoryEntry => ({ id, text, chat, created: at(day), updated: at(day) });
const answer = (entries: MemoryEntry[]) => ({ accountId: "user-1", entries });

beforeEach(() => {
  vi.mocked(cloud.connected).mockReturnValue(true);
  vi.mocked(cloud.request).mockReset();
  vi.mocked(cloud.request).mockResolvedValue(answer([]));
  vi.mocked(cloud.post).mockReset();
});

describe("the memory page", () => {
  it("lists what pip remembers newest first, with the chat it came from", async () => {
    const chat = chats.create();
    chats.update(chat.uid, value => { value.title = "Schlaf und Training"; });
    const older = entry("m1", "Likes short answers without preamble.", 1);
    const newer = entry("m2", "Trains for a half marathon in April.", 2, chat.uid);
    vi.mocked(cloud.request).mockResolvedValue(answer([older, newer]));

    render(<MemoryPage />);
    expect(await screen.findByText(newer.text)).toBeTruthy();
    const rows = screen.getAllByRole("listitem").map(row => row.textContent ?? "");
    expect(rows[0]).toContain(newer.text);
    expect(rows[1]).toContain(older.text);
    expect(screen.getByRole("link", { name: "Schlaf und Training" }).getAttribute("href")).toBe("#/pip?chat=" + chat.uid);
  });

  it("edits with the current text and shows the server's list", async () => {
    const before = entry("m1", "Likes short answers.", 1);
    const after = { ...before, text: "Likes very short answers, no preamble." };
    vi.mocked(cloud.request).mockResolvedValueOnce(answer([before])).mockResolvedValue(answer([after]));
    vi.mocked(cloud.post).mockResolvedValue(answer([after]));

    render(<><MemoryPage /><DialogHost /></>);
    await screen.findByText(before.text);
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    const field = screen.getByRole("textbox", { name: "Edit memory" }) as HTMLTextAreaElement;
    expect(field.value).toBe(before.text);
    fireEvent.change(field, { target: { value: after.text } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(cloud.post).toHaveBeenCalledWith("/api/pip/memory", { action: "edit", id: "m1", text: after.text }));
    expect(await screen.findByText(after.text)).toBeTruthy();
    expect(screen.queryByText(before.text)).toBeNull();
  });

  it("forgets a row and says so", async () => {
    const gone = entry("m1", "An old fact.", 2);
    const kept = entry("m2", "A fact that stays.", 1);
    vi.mocked(cloud.request).mockResolvedValueOnce(answer([kept, gone])).mockResolvedValue(answer([kept]));
    vi.mocked(cloud.post).mockResolvedValue(answer([kept]));

    render(<MemoryPage />);
    await screen.findByText(gone.text);
    fireEvent.click(screen.getAllByRole("button", { name: "forget" })[0]!);

    await waitFor(() => expect(cloud.post).toHaveBeenCalledWith("/api/pip/memory", { action: "forget", id: "m1" }));
    await waitFor(() => expect(screen.queryByText(gone.text)).toBeNull());
    expect(vi.mocked(toast)).toHaveBeenCalledWith("Forgotten.");
  });

  it("adds what was typed and clears the field", async () => {
    const added = entry("m1", "Prefers to train early, before work.", 1);
    vi.mocked(cloud.request).mockResolvedValueOnce(answer([])).mockResolvedValue(answer([added]));
    vi.mocked(cloud.post).mockResolvedValue(answer([added]));

    render(<MemoryPage />);
    const field = await screen.findByPlaceholderText("add something pip should remember") as HTMLInputElement;
    expect(screen.getByRole("button", { name: "remember" })).toHaveProperty("disabled", true);
    fireEvent.change(field, { target: { value: added.text } });
    fireEvent.click(screen.getByRole("button", { name: "remember" }));

    await waitFor(() => expect(cloud.post).toHaveBeenCalledWith("/api/pip/memory", { action: "add", text: added.text }));
    expect(await screen.findByText(added.text)).toBeTruthy();
    expect(field.value).toBe("");
  });

  it("says what it is doing when there is nothing, no account, an error or a full list", async () => {
    const empty = render(<MemoryPage />);
    expect(await screen.findByText("Nothing yet. Pip remembers lasting things you tell it, and you can add some here.")).toBeTruthy();
    expect(screen.getByPlaceholderText("add something pip should remember")).toBeTruthy();
    empty.unmount();

    vi.mocked(cloud.connected).mockReturnValue(false);
    vi.mocked(cloud.request).mockClear();
    const signedOut = render(<MemoryPage />);
    expect(await screen.findByText((_, element) => element?.tagName === "P" && element.textContent === "Sign in to give pip a memory.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/classic#/account");
    expect(cloud.request).not.toHaveBeenCalled();
    signedOut.unmount();

    vi.mocked(cloud.connected).mockReturnValue(true);
    vi.mocked(cloud.request).mockRejectedValueOnce(new Error("Pocket storage did not answer.")).mockResolvedValue(answer([entry("m1", "A fact after retrying.", 1)]));
    const failed = render(<MemoryPage />);
    expect(await screen.findByText("Pocket storage did not answer.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "try again" }));
    expect(await screen.findByText("A fact after retrying.")).toBeTruthy();
    failed.unmount();

    vi.mocked(cloud.request).mockResolvedValue(answer(Array.from({ length: 100 }, (_, index) => entry("m" + index, "Fact " + index, index + 1))));
    render(<MemoryPage />);
    expect(await screen.findByText("Memory is full (100). Forget something to add more.")).toBeTruthy();
    expect(screen.queryByPlaceholderText("add something pip should remember")).toBeNull();
  });

  it("reads the list again when the account says it changed", async () => {
    const first = entry("m1", "Likes short answers.", 1);
    const second = entry("m2", "Trains for a half marathon.", 2);
    vi.mocked(cloud.request).mockResolvedValueOnce(answer([first])).mockResolvedValue(answer([first, second]));

    render(<MemoryPage />);
    await screen.findByText(first.text);
    expect(cloud.request).toHaveBeenCalledTimes(1);
    act(() => { dispatchEvent(new Event("pocket-memory-changed")); });

    expect(await screen.findByText(second.text)).toBeTruthy();
    expect(cloud.request).toHaveBeenCalledTimes(2);
  });
});
