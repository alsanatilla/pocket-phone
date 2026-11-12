// The chat list's first row: Pip's one big chat, above the separate chats, counted apart from them.

import { fireEvent, render, screen, within } from "@testing-library/react";
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

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("pip");
    expect(rows[0]!.textContent).toContain("one ongoing conversation · 3 messages");
    expect(within(rows[0]!).getByRole("button")).toBeTruthy();
    expect(rows[0]!.getAttribute("aria-current")).toBe("page");
    // The heading counts separate chats only, and both segments keep the one pip row.
    expect(screen.getByText(/1 conversation/)).toBeTruthy();
    expect(screen.getAllByText("pip")).toHaveLength(1);
    expect(rows[1]!.textContent).toContain("Training");

    fireEvent.click(within(rows[0]!).getByRole("button"));
    expect(onHome).toHaveBeenCalled();
  });

  it("says one message when the whole conversation has one", () => {
    seed("pip", 1, true);
    render(<ChatList open onOpenChange={() => {}} current={null} homeCurrent onPick={() => {}} onHome={() => {}} onNew={() => {}} />);
    expect(screen.getByText(/one ongoing conversation · 1 message$/)).toBeTruthy();
  });
});
