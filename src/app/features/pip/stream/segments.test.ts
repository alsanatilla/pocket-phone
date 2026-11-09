import { describe, expect, it } from "vitest";
import { inlineTokens, pendingShape, segmentAnswer, splitProse } from "./segments.ts";

describe("segmentAnswer", () => {
  it("cuts prose and cards apart, in order, with stable keys", () => {
    const text = "Intro line.\n\n```pocket\n{\"op\":\"add\",\"path\":\"/root\",\"value\":\"main\"}\n```\n\nBetween.\n\n```pocket\n{\"op\":\"add\"";
    const segments = segmentAnswer(text);
    expect(segments.map(segment => segment.kind)).toEqual(["prose", "card", "prose", "card"]);
    expect(segments.map(segment => segment.key)).toEqual(["p0", "c1", "p2", "c3"]);
    expect(segments[1]).toMatchObject({ closed: true, source: "{\"op\":\"add\",\"path\":\"/root\",\"value\":\"main\"}" });
    expect(segments[3]).toMatchObject({ closed: false });
    // Growing the text keeps the earlier keys.
    expect(segmentAnswer(text + ",\"path\":\"/root\"}\n```\n\nEnd.").slice(0, 4).map(segment => segment.key)).toEqual(["p0", "c1", "p2", "c3"]);
  });

  it("never shows a card's JSON as prose, even mid-fence", () => {
    const segments = segmentAnswer("Look:\n\n```pocket\n{\"op\":\"add\",\"path\":\"/root\",\"va");
    expect(segments.filter(segment => segment.kind === "prose").map(segment => (segment as { text: string }).text).join()).not.toContain("{");
  });

  it("leaves a pocket fence inside a code block as code", () => {
    const segments = segmentAnswer("Example:\n\n````md\n```pocket\n{}\n```\n````\n\nDone.");
    expect(segments.every(segment => segment.kind === "prose")).toBe(true);
  });
});

describe("splitProse", () => {
  it("settles blocks at blank lines and keeps the one being written apart", () => {
    expect(splitProse("One.\n\nTwo is still", true)).toEqual({ blocks: ["One."], pending: "Two is still" });
    expect(splitProse("One.\n\nTwo.", false)).toEqual({ blocks: ["One.", "Two."], pending: "" });
  });

  it("keeps a fenced code block whole, blank lines included", () => {
    expect(splitProse("```js\na\n\nb\n```\n\nAfter", true).blocks).toEqual(["```js\na\n\nb\n```"]);
  });
});

describe("text still being written", () => {
  it("formats complete pairs and hides an unfinished marker", () => {
    expect(inlineTokens("a **bold** and `code` and [site](https://x.org)")).toEqual([
      { type: "text", text: "a " }, { type: "strong", text: "bold" }, { type: "text", text: " and " }, { type: "code", text: "code" },
      { type: "text", text: " and " }, { type: "link", text: "site" },
    ]);
    expect(inlineTokens("start **impor")).toEqual([{ type: "text", text: "start impor" }]);
    expect(inlineTokens("see [the sou")).toEqual([{ type: "text", text: "see the sou" }]);
    expect(inlineTokens("snake_case_name stays")).toEqual([{ type: "text", text: "snake_case_name stays" }]);
  });

  it("takes the shape of what it will become", () => {
    expect(pendingShape("## Plan")).toEqual({ kind: "heading", level: 2, text: "Plan" });
    expect(pendingShape("- one\n- two")).toEqual({ kind: "list", ordered: false, items: ["one", "two"] });
    expect(pendingShape("1. first\n2. sec")).toMatchObject({ kind: "list", ordered: true });
    expect(pendingShape("```js\nconst a = 1")).toEqual({ kind: "code", text: "const a = 1" });
  });
});
