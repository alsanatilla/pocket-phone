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

describe("cards a model wrote without their fence", () => {
  // What Gemma 4 sent: a lone "pocket" line, the whole card as one nested patch, and tool-call closing tags.
  const tree = JSON.stringify({ op: "add", path: "/root", value: { type: "Stack", props: { direction: "vertical", gap: "md" }, children: [
    { type: "Chart", props: { kind: "line", title: "RDL", data: [{ label: "Woche 1", value: 110 }], unit: "kg" } },
    { type: "Text", props: { variant: "muted" }, children: [{ text: "Wiederholen statt erzwingen." }] }] } });
  const reply = `Fortschrittskurve:\n\npocket\n\n${tree}\n</parameter>\n</function>\n\nViel Erfolg!`;

  it("draws them as cards and never shows the JSON, the marker or the tags", () => {
    const segments = segmentAnswer(reply);
    expect(segments.map(segment => segment.kind)).toEqual(["prose", "card", "prose"]);
    expect(segments[1]).toMatchObject({ kind: "card", source: tree });
    const prose = segments.filter(segment => segment.kind === "prose").map(segment => segment.text).join("\n");
    expect(prose).not.toMatch(/pocket|parameter|function|"op"/);
    expect(prose).toContain("Viel Erfolg!");
  });

  it("holds a lone pocket line while streaming, and gives it back when no card follows", () => {
    expect(segmentAnswer("Hier:\n\npocket")).toEqual([{ kind: "prose", key: "p0", text: "Hier:\n" }]);
    expect(segmentAnswer("Hier:\n\npocket\n" + tree.slice(0, 30))).toMatchObject([{ kind: "prose" }, { kind: "card", closed: false }]);
    const kept = segmentAnswer("The word\npocket\nis a noun.");
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ kind: "prose", text: "The word\npocket\nis a noun." });
  });

  it("finds a card in a JSON code block, and leaves other JSON as code", () => {
    expect(segmentAnswer("```json\n" + tree + "\n```")).toMatchObject([{ kind: "card", source: tree, closed: true }]);
    const code = "```json\n{\"name\": \"Pocket\"}\n```";
    expect(segmentAnswer(code)).toEqual([{ kind: "prose", key: "p0", text: code }]);
  });
});
