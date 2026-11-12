// The chat list's first row: Pip's one big chat, above the separate chats, counted apart from them.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { chats, type ChatTurn } from "../../data/chats.ts";
import { ChatList } from "./ChatList.tsx";

const turn = (uid: string): ChatTurn => ({ uid, text: "question", answer: "answer", created: 1, status: "done" });

function seed(title: string, turns: number, home = false): string {
  const created = chats.create();
  chats.update(created.uid, chat => {
    chat.title = title;
    if (home) { chat.home = true; chat.titled = true; }
    for (let index = 0; index < turns; index++) chat.turns.push(turn(title + "-" + index));
  });
  return created.uid;
}

describe("the chat list's home row", () => {
  it("comes first with every segment's messages, and keeps the segments out of the other rows", () => {
    seed("pip", 2, true);
    seed("pip", 1, true);
    seed("Training", 4);
    const onHome = vi.fn();

    render(<ChatList open onOpenChange={() => {}} current={null} homeCurrent onPick={() => {}} onHome={onHome} onNew={() => {}} />);

    // The big chat is one row of its own, above the list; the list holds only the separate chats.
    const home = screen.getByRole("button", { name: /^pip/ });
    expect(home.textContent).toContain("ongoing · 3 messages");
    expect(home.getAttribute("aria-current")).toBe("page");
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("Training");
    expect(screen.getByText(/1 conversation/)).toBeTruthy();
    expect(screen.getAllByText("pip")).toHaveLength(1);
    expect(home.compareDocumentPosition(rows[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(home);
    expect(onHome).toHaveBeenCalled();
  });

  it("says one message when the whole conversation has one", () => {
    seed("pip", 1, true);
    render(<ChatList open onOpenChange={() => {}} current={null} homeCurrent onPick={() => {}} onHome={() => {}} onNew={() => {}} />);
    expect(screen.getByText(/ongoing · 1 message$/)).toBeTruthy();
  });
});

describe("the chat list's rows", () => {
  it("leaves out chats nobody wrote in, except the one that is open", () => {
    seed("Empty one", 0);
    seed("Open and empty", 0);
    seed("Training", 4);
    const open = JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key => localStorage.getItem(key)!.includes("Open and empty"))!)!).uid;
    render(<ChatList open onOpenChange={() => {}} current={open} homeCurrent={false} onPick={() => {}} onHome={() => {}} onNew={() => {}} />);
    const names = screen.getAllByRole("listitem").map(item => item.textContent);
    expect(names.some(text => text!.includes("Training"))).toBe(true);
    expect(names.some(text => text!.includes("Open and empty"))).toBe(true);
    expect(names.some(text => text!.includes("Empty one"))).toBe(false);
  });
});
