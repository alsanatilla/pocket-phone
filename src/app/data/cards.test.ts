// Pinned cards as a person sees them on Today, and the two changes the card menu makes. The real chat store runs
// against jsdom's localStorage, as the other data tests do.

import { describe, expect, it } from "vitest";
import { chats, createChat, renameChat } from "./chats.ts";
import { pinnedCards, removeCard, setCardPinned } from "./cards.ts";

/** A stored card as cardFence writes one, with only the marks this fixture needs. */
function fence(id: string, text: string, marks: { updated?: number; pinned?: number } = {}): string {
  return "```pocket\n" + [
    JSON.stringify({ op: "add", path: "/id", value: id }),
    ...(marks.updated ? [JSON.stringify({ op: "add", path: "/updated", value: marks.updated })] : []),
    ...(marks.pinned ? [JSON.stringify({ op: "add", path: "/pinned", value: marks.pinned })] : []),
    JSON.stringify({ op: "add", path: "/root", value: "main" }),
    JSON.stringify({ op: "add", path: "/elements/main", value: { type: "Text", props: { text }, children: [] } }),
  ].join("\n") + "\n```";
}

const source = (text: string): string => text.slice("```pocket\n".length, -"\n```".length);

function addTurn(chat: string, answer: string, status = "done"): string {
  const uid = crypto.randomUUID();
  chats.update(chat, value => { value.turns.push({ uid, text: "question", answer, status, created: Date.now() }); });
  return uid;
}

describe("pinnedCards", () => {
  it("lists pinned cards across chats, newest pin first, without unpinned or deleted chats", () => {
    const bike = createChat();
    renameChat(bike.uid, "Bike");
    const bikeTurn = addTurn(bike.uid, "Lowest so far:\n\n" + fence("kold111", "950", { pinned: 1000 }) + "\n\nI keep looking.");

    const training = createChat();
    renameChat(training.uid, "Training");
    const trainingTurn = addTurn(training.uid, "This week:\n\n" + fence("knew222", "31", { pinned: 2000 })
      + "\n\n" + fence("kplain3", "a card nobody pinned") + "\n\nKeep going.");

    const gone = createChat();
    renameChat(gone.uid, "Gone");
    addTurn(gone.uid, "Old:\n\n" + fence("kgone44", "x", { pinned: 3000 }));
    chats.remove(gone.uid);

    expect(pinnedCards()).toEqual([
      { chat: training.uid, chatTitle: "Training", turn: trainingTurn, id: "knew222", pinned: 2000, source: source(fence("knew222", "31", { pinned: 2000 })) },
      { chat: bike.uid, chatTitle: "Bike", turn: bikeTurn, id: "kold111", pinned: 1000, source: source(fence("kold111", "950", { pinned: 1000 })) },
    ]);
  });
});

describe("setCardPinned and removeCard", () => {
  it("pins and unpins, bumps the turn's updated, and refuses missing chats, cards and streaming turns", () => {
    const chat = createChat();
    const id = "kpin123";
    const turnId = addTurn(chat.uid, "Before.\n\n" + fence(id, "a figure") + "\n\nAfter.");
    const before = chats.get(chat.uid)!.turns.find(turn => turn.uid === turnId)!.updated ?? 0;

    expect(setCardPinned(chat.uid, id, true)).toBe(true);
    let saved = chats.get(chat.uid)!.turns.find(turn => turn.uid === turnId)!;
    expect(saved.answer).toContain('"path":"/pinned"');
    expect(saved.answer).toContain("Before.");
    expect(saved.updated).toBeGreaterThan(before);

    const pinnedAt = saved.updated ?? 0;
    expect(setCardPinned(chat.uid, id, false)).toBe(true);
    saved = chats.get(chat.uid)!.turns.find(turn => turn.uid === turnId)!;
    expect(saved.answer).not.toContain("/pinned");
    expect(saved.answer).toContain("Before.");
    expect(saved.updated).toBeGreaterThan(pinnedAt);

    expect(setCardPinned(chat.uid, "kmissing", true)).toBe(false);
    expect(setCardPinned("no-such-chat", id, true)).toBe(false);

    const streaming = addTurn(chat.uid, fence("kstream1", "still arriving"), "streaming");
    expect(setCardPinned(chat.uid, "kstream1", true)).toBe(false);
    expect(removeCard(chat.uid, "kstream1")).toBe(false);
    expect(chats.get(chat.uid)!.turns.find(turn => turn.uid === streaming)!.answer).toContain("still arriving");
  });

  it("removes the card and keeps the turn", () => {
    const chat = createChat();
    const id = "krem123";
    const turnId = addTurn(chat.uid, "One.\n\n" + fence(id, "gone") + "\n\nTwo.");

    expect(removeCard(chat.uid, id)).toBe(true);
    const turns = chats.get(chat.uid)!.turns;
    expect(turns).toHaveLength(1);
    expect(turns.find(turn => turn.uid === turnId)!.answer).toBe("One.\n\nTwo.");
    expect(turns.find(turn => turn.uid === turnId)!.status).toBe("done");
    expect(removeCard(chat.uid, id)).toBe(false);
    expect(removeCard("no-such-chat", id)).toBe(false);
  });
});
