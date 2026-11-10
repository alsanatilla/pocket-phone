import { describe, expect, it } from "vitest";
import { CARD_WATCH_EVERY, cardWatchDraft } from "./card-watch.ts";

// What keeps a pinned card current: a watch in the card's own chat, inside Pip's active hours. The routine is what
// the server runs; this checks the one draft the menu saves.

describe("card watch", () => {
  it("keeps a card current in its own chat every six hours", () => {
    const draft = cardWatchDraft({ chat: "chat123", id: "kprice9", url: "https://example.org/prices", name: "Canyon Endurace" });
    expect(draft.kind).toBe("watch");
    expect(draft.chat).toBe("chat123");
    expect(draft.card).toBe("chat123/kprice9");
    expect(draft.every).toBe(CARD_WATCH_EVERY);
    expect(draft.every).toBe(360);
    expect(draft.title).toBe("Keep Canyon Endurace current");
    expect(draft.activeHours).toEqual({ start: "07:00", end: "22:00" });
    expect(draft.prompt).toContain("[about card kprice9]");
    expect(draft.prompt).toContain("https://example.org/prices");
    expect(draft.prompt).toContain("answer exactly SKIP");
    expect(draft.delivery).toBe("notify");
  });

  it("keeps a plain title and a short key for a card without a name", () => {
    const draft = cardWatchDraft({ chat: "c1", id: "k1a2b3c", url: "https://example.org" });
    expect(draft.title).toBe("Keep a card current");
    expect(draft.card).toBe("c1/k1a2b3c");
  });

  it("tells the person when the figure crosses a threshold", () => {
    const below = cardWatchDraft({ chat: "c1", id: "k1a2b3c", url: "https://example.org", name: "Canyon Endurace", alert: { below: 900 } });
    expect(below.prompt).toContain("when Canyon Endurace drops below 900");
    expect(below.prompt).toContain("do not answer SKIP");
    const above = cardWatchDraft({ chat: "c1", id: "k1a2b3c", url: "https://example.org", name: "HRV", alert: { above: 80 } });
    expect(above.prompt).toContain("when HRV rises above 80");
    expect(cardWatchDraft({ chat: "c1", id: "k1a2b3c", url: "https://example.org" }).prompt).not.toContain("Tell the person in a message");
  });

  it("cuts a long name to the routine's 80 characters", () => {
    const draft = cardWatchDraft({ chat: "c1", id: "k1a2b3c", url: "https://example.org", name: "x".repeat(120) });
    expect(String(draft.title).length).toBeLessThanOrEqual(80);
  });
});
