import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
vi.mock("../../../ui/dialog/dialog.ts", () => ({ prompt: vi.fn(), confirm: vi.fn() }));
vi.mock("../../../ui/toast/toast.ts", () => ({ toast: vi.fn(), toastError: vi.fn() }));
vi.mock("../../../lib/classic.ts", () => ({ openPath: vi.fn() }));
vi.mock("../runner.ts", () => ({ busy: () => false, send: vi.fn().mockResolvedValue(undefined) }));
import { prompt, confirm } from "../../../ui/dialog/dialog.ts";
import { toast, toastError } from "../../../ui/toast/toast.ts";
import { chats } from "../../../data/chats.ts";
import { connect } from "../../../data/bus.ts";
import { pinnedCards } from "../../../data/cards.ts";
import { Card } from "./Card.tsx";
import { PinnedCards } from "../../today/PinnedCards.tsx";
import { send } from "../runner.ts";
import { openPath } from "../../../lib/classic.ts";

connect();
const line = (path: string, value: unknown) => JSON.stringify({ op: "add", path, value });
const source = (value = "72") => [
  line("/id", "card1234"), line("/root", "main"),
  line("/elements/main", { type: "Metric", props: { label: "Recovery", value }, children: [] }),
].join("\n");
function seed() {
  const chat = chats.create();
  chats.update(chat.uid, c => { c.title = "Training"; c.turns.push({
    uid: "turn1", text: "Recovery?", answer: "Before.\n\n```pocket\n" + source() + "\n```\n\nAfter.",
    created: 1, status: "done",
  }); });
  return chat.uid;
}
async function select(name: string) {
  fireEvent.keyDown(screen.getByRole("button", { name: "Card options" }), { key: "ArrowDown" });
  const item = await screen.findByRole("menuitem", { name });
  await act(async () => { fireEvent.click(item); });
}

describe("card controls", () => {
  it("only exposes controls for a settled, identified card", () => {
    const chatId = seed();
    const props = { source: source(), closed: true, onAsk: vi.fn(), at: { chatId, place: "chat" as const } };
    const view = render(<Card {...props} streaming />);
    expect(screen.queryByRole("button", { name: "Card options" })).toBeNull();
    view.rerender(<Card {...props} streaming={false} />);
    expect(screen.getByRole("button", { name: "Card options" })).toBeTruthy();
  });

  it("pins through the menu; Today follows the stored card and disappears on unpin", async () => {
    const chatId = seed();
    const view = render(<Card source={source()} closed streaming={false} onAsk={vi.fn()} at={{ chatId, place: "chat" }} />);
    await select("pin to today");
    expect(pinnedCards()).toHaveLength(1);
    view.unmount();
    render(<PinnedCards />);
    expect(screen.getByText("72")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Training" })).toBeTruthy();
    act(() => { chats.update(chatId, chat => { chat.turns[0]!.answer = chat.turns[0]!.answer.replace('"72"', '"58"'); }); });
    expect(screen.getByText("58")).toBeTruthy();
    await select("refresh");
    expect(send).toHaveBeenCalledWith(chatId, "Refresh this card with the current figures.\n[about card card1234]");
    expect(openPath).toHaveBeenCalledWith("/pip?chat=" + encodeURIComponent(chatId));
    await select("unpin");
    expect(screen.queryByLabelText("Pinned cards")).toBeNull();
    expect(chats.get(chatId)!.turns[0]!.answer).toContain("58");
  });

  it("addresses changes to the selected card and requires confirmation to remove it", async () => {
    const chatId = seed(), ask = vi.fn();
    render(<Card source={source()} closed streaming={false} onAsk={ask} at={{ chatId, place: "chat" }} />);
    vi.mocked(prompt).mockResolvedValueOnce("HRV was 58");
    await select("change…");
    expect(ask).toHaveBeenCalledWith("HRV was 58\n[about card card1234]");
    vi.mocked(confirm).mockResolvedValueOnce(false);
    await select("remove");
    expect(chats.get(chatId)!.turns[0]!.answer).toContain("pocket");
    vi.mocked(confirm).mockResolvedValueOnce(true);
    await select("remove");
    expect(chats.get(chatId)!.turns[0]!.answer).toBe("Before.\n\nAfter.");
  });

  it("reports a card disappearing while the removal dialog is open", async () => {
    const chatId = seed();
    render(<Card source={source()} closed streaming={false} onAsk={vi.fn()} at={{ chatId, place: "chat" }} />);
    vi.mocked(confirm).mockImplementationOnce(async () => { chats.remove(chatId); return true; });
    await select("remove");
    expect(toastError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("could not be removed") }));
  });

  it("knows when a pinned card names a source, so Pip can keep it current", async () => {
    localStorage.removeItem("pocket:active-account");
    const chat = chats.create();
    const chart = [
      line("/id", "kchart12"), line("/root", "main"),
      line("/elements/main", { type: "Chart", props: { kind: "line", title: "Distance", data: [{ label: "W1", value: 22 }], source: { title: "Club log", url: "https://example.org/log" } }, children: [] }),
    ].join("\n");
    chats.update(chat.uid, c => { c.title = "Running"; c.turns.push({ uid: "turn1", text: "Distance?", answer: "```pocket\n" + chart + "\n```", created: 1, status: "done" }); });
    render(<Card source={chart} closed streaming={false} onAsk={vi.fn()} at={{ chatId: chat.uid, place: "chat" }} />);
    await select("pin to today");
    expect(pinnedCards()).toHaveLength(1);
    expect(toast).toHaveBeenCalledWith("Pinned. Sign in to let Pip keep it current.");
  });

  it("sets a threshold on a card that names a source, and offers to stop it", async () => {
    localStorage.removeItem("pocket:active-account");
    const chat = chats.create();
    const chart = [
      line("/id", "kchart12"), line("/root", "main"),
      line("/elements/main", { type: "Chart", props: { kind: "line", title: "Distance", data: [{ label: "W1", value: 22 }], source: { title: "Club log", url: "https://example.org/log" } }, children: [] }),
    ].join("\n");
    chats.update(chat.uid, c => { c.title = "Running"; c.turns.push({ uid: "turn1", text: "Distance?", answer: "```pocket\n" + chart + "\n```", created: 1, status: "done" }); });
    const view = render(<Card source={chart} closed streaming={false} onAsk={vi.fn()} at={{ chatId: chat.uid, place: "chat" }} />);
    expect(screen.getByRole("button", { name: "Card options" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("button", { name: "Card options" }), { key: "ArrowDown" });
    await screen.findByRole("menuitem", { name: "tell me when it drops below…" });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    vi.mocked(prompt).mockResolvedValueOnce("900");
    await select("tell me when it drops below…");
    const answer = chats.get(chat.uid)!.turns[0]!.answer;
    expect(answer).toContain('"/alert"');
    expect(answer).toContain('"below":900');
    expect(pinnedCards()).toHaveLength(1);
    view.unmount();
    render(<Card source={answer.split("```pocket\n")[1]!.split("\n```")[0]!} closed streaming={false} onAsk={vi.fn()} at={{ chatId: chat.uid, place: "chat" }} />);
    expect(screen.getByText("below 900")).toBeTruthy();
    await select("stop telling me");
    expect(chats.get(chat.uid)!.turns[0]!.answer).not.toContain('"/alert"');
  });
});
