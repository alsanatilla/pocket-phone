// The chat list's first row: Pip's one big chat, above the separate chats, counted apart from them.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { chats, type ChatTurn } from "../../data/chats.ts";
import { createNote } from "../../data/notes.ts";
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

  it("says how a chat stands: writing, failed, or a draft not sent", () => {
    const writing = seed("Writing", 1);
    const failed = seed("Failed", 1);
    const draft = seed("Draft", 1);
    chats.update(writing, chat => { chat.turns[0]!.status = "streaming"; });
    chats.update(failed, chat => { chat.turns[0]!.status = "failed"; });
    chats.update(draft, chat => { chat.draft = "half a thought"; });

    render(<ChatList open onOpenChange={() => {}} current={null} homeCurrent={false} onPick={() => {}} onHome={() => {}} onNew={() => {}} />);
    expect(screen.getByText("writing")).toBeTruthy();
    expect(screen.getByText("failed")).toBeTruthy();
    expect(screen.getByText("draft")).toBeTruthy();
  });

  it("brings the chat that is open into view, however far down the list it is", () => {
    seed("Older", 2);
    const current = seed("Reading now", 2);
    const intoView = vi.spyOn(Element.prototype, "scrollIntoView");

    render(<ChatList open onOpenChange={() => {}} current={current} homeCurrent={false} onPick={() => {}} onHome={() => {}} onNew={() => {}} />);
    expect(intoView).toHaveBeenCalled();
    expect((intoView.mock.contexts[0] as HTMLElement).textContent).toContain("Reading now");
  });
});

describe("the chat list's field", () => {
  it("puts the conversations away and shows what matches, chats first", () => {
    seed("Training", 4);
    seed("Groceries", 2);
    createNote("Roof repair\nThe neighbour knows about the leak.");

    render(<ChatList open onOpenChange={() => {}} current={null} homeCurrent={false} onPick={() => {}} onHome={() => {}} onNew={() => {}}
      onResult={() => {}} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a chat or anything" }), { target: { value: "groceries" } });

    expect(screen.getByRole("button", { name: /Groceries/ })).toBeTruthy();
    expect(screen.queryByText("Training")).toBeNull();
    expect(screen.queryByText(/ongoing/)).toBeNull();
  });

  it("finds a note by what it says, and opens the hit", () => {
    const note = createNote("Roof repair\nThe neighbour knows about the leak.");
    const onResult = vi.fn();

    render(<ChatList open onOpenChange={() => {}} current={null} homeCurrent={false} onPick={() => {}} onHome={() => {}} onNew={() => {}}
      onResult={onResult} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a chat or anything" }), { target: { value: "leak" } });
    fireEvent.click(screen.getByRole("button", { name: /Roof repair/ }));

    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ kind: "note", uid: note.uid }));
  });

  it("says when nothing matches, and the clear key brings the list back", () => {
    seed("Training", 4);
    render(<ChatList open onOpenChange={() => {}} current={null} homeCurrent={false} onPick={() => {}} onHome={() => {}} onNew={() => {}} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Find a chat or anything" }), { target: { value: "zzzz" } });
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "clear" }));
    expect(screen.getByText("Training")).toBeTruthy();
  });
});
