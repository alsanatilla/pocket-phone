// Pip's one ongoing conversation as the app creates and extends it: one segment until it is full, then the next
// with the same marks and the model the person chose. The real chat store runs against jsdom's localStorage.

import { describe, expect, it } from "vitest";
import { chats, createChat, listChats } from "./chats.ts";
import { homeChat, homeChats, homeForSend, isHome } from "./home.ts";
import type { PipConfig } from "../../client/pip-core.js";

const config: PipConfig = { provider: "compatible", model: "other-model", baseUrl: "https://other.example/v1", maxTokens: 1024, thinking: false, webSearch: false };

describe("homeChat", () => {
  it("creates one segment titled pip, marked home and titled, and returns it on the next call", () => {
    const first = homeChat();
    expect(first.title).toBe("pip");
    expect(first.home).toBe(true);
    expect(first.titled).toBe(true);
    expect(isHome(first)).toBe(true);
    expect(isHome(createChat())).toBe(false);
    expect(homeChat().uid).toBe(first.uid);
    expect(homeChats().map(chat => chat.uid)).toEqual([first.uid]);
    expect(listChats()).toHaveLength(2);
  });
});

describe("homeForSend", () => {
  it("keeps the same segment until it is full, then starts one with the same marks and config", () => {
    const turn = (index: number) => ({ uid: "turn-" + index, text: "question " + index, answer: "answer " + index, created: index + 1, status: "done" });
    // Seeded with an older `created`, so the new segment is unambiguously the later one.
    const first = { uid: "home-first", title: "pip", titled: true, home: true, created: 1, updated: 1, draft: "", context: [], config, turns: [turn(0), turn(1)] };
    localStorage.setItem("pocket:pip-chat:" + first.uid, JSON.stringify(first));

    expect(homeForSend().uid).toBe(first.uid);
    chats.update(first.uid, chat => {
      for (let index = 2; index < 60; index++) chat.turns.push(turn(index));
    });
    const next = homeForSend();
    expect(next.uid).not.toBe(first.uid);
    expect(next.home).toBe(true);
    expect(next.title).toBe("pip");
    expect(next.titled).toBe(true);
    expect(next.config).toEqual(config);
    expect(homeChats().map(chat => chat.uid)).toEqual([first.uid, next.uid]);
    expect(homeForSend().uid).toBe(next.uid);
  });
});
