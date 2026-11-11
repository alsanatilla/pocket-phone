// The conversation the page joins: a separate chat on its own, or home's segments oldest first, cut to the turns a
// person asked to see. A pure rule, so the page only draws the result.

import { describe, expect, it } from "vitest";
import type { Chat, ChatTurn } from "../../data/chats.ts";
import { threadOf } from "./thread.ts";

const config: Chat["config"] = { provider: "compatible", model: "test-model", baseUrl: "https://example.com/v1", maxTokens: 1024, thinking: false, webSearch: false };

const turn = (uid: string): ChatTurn => ({ uid, text: uid, answer: "answer " + uid, created: 1, status: "done" });
const chat = (uid: string, turns: string[]): Chat => ({ uid, title: uid, updated: 1, draft: "", config, context: [], turns: turns.map(turn) });

describe("threadOf", () => {
  it("joins segments in the order they are given, each turn keeping its own chat", () => {
    const older = chat("older", ["a1", "a2"]);
    const newer = chat("newer", ["b1"]);

    expect(threadOf([older, newer], 30)).toEqual({
      items: [
        { turn: older.turns[0], chatId: "older" },
        { turn: older.turns[1], chatId: "older" },
        { turn: newer.turns[0], chatId: "newer" },
      ],
      earlier: 0,
    });
  });

  it("keeps only the last shown turns and counts the rest as earlier", () => {
    const joined = threadOf([chat("one", ["1", "2", "3"]), chat("two", ["4", "5"])], 2);
    expect(joined.items.map(item => item.turn.uid)).toEqual(["4", "5"]);
    expect(joined.earlier).toBe(3);
  });

  it("returns one separate chat's turns", () => {
    const separate = chat("separate", ["only"]);
    expect(threadOf([separate], 30).items).toEqual([{ turn: separate.turns[0], chatId: "separate" }]);
  });

  it("returns nothing for a chat without turns", () => {
    expect(threadOf([chat("empty", [])], 30)).toEqual({ items: [], earlier: 0 });
  });
});
