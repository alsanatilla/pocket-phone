import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

// The Markdown renderer runs on Pocket's server; here it answers at once with a paragraph per block.
vi.mock("../../../../shared/markdown.js", async original => ({
  ...(await original<typeof import("../../../../shared/markdown.js")>()),
  renderMarkdown: async (source: string) => source.split(/\n{2,}/).map(block => "<p>" + block.replace(/[<&*]/g, "") + "</p>").join(""),
}));
vi.mock("recharts", async original => ({ ...(await original<typeof import("recharts")>()), ResponsiveContainer: ({ children }: { children: unknown }) => children }));

import { Answer } from "./Answer.tsx";
import { Card } from "./Card.tsx";

const P = (path: string, value: unknown) => JSON.stringify({ op: "add", path, value });
const card = [
  P("/root", "main"),
  P("/elements/main", { type: "Grid", props: { columns: 2, gap: "md" }, children: ["a", "b"] }),
  P("/elements/a", { type: "Metric", props: { label: "recovery", value: 72, unit: "%", hint: "rested", tone: "movement" }, children: [] }),
  P("/elements/b", { type: "Metric", props: { label: "strain", value: 41, unit: null, hint: "light", tone: "warning" }, children: [] }),
].join("\n");
const reply = "You are **well rested** today.\n\n```pocket\n" + card + "\n```\n\nIntervals fit well. Keep the *last* one easy.";

describe("a streaming reply", () => {
  it("never puts a card's JSON on screen, at any point while it arrives", () => {
    const view = render(<Answer text="" streaming onAsk={() => {}} />);
    for (let end = 1; end <= reply.length; end += 7) {
      view.rerender(<Answer text={reply.slice(0, end)} streaming onAsk={() => {}} />);
      const text = view.container.textContent ?? "";
      expect(text, "at " + end).not.toMatch(/"op"|"path"|"elements|```|\{"/);
    }
  });

  it("builds a card element by element without re-mounting what is already there", () => {
    const parts = card.split("\n");
    const view = render(<Card source={parts.slice(0, 3).join("\n") + "\n"} closed={false} streaming onAsk={() => {}} />);
    const first = screen.getByText("rested").closest("div, button")!;
    expect(screen.queryByText("light")).toBeNull();
    view.rerender(<Card source={parts.join("\n") + "\n"} closed={false} streaming onAsk={() => {}} />);
    expect(screen.getByText("light")).toBeTruthy();
    expect(screen.getByText("rested").closest("div, button")).toBe(first);
  });

  it("holds back the line still being written", () => {
    const parts = card.split("\n");
    const half = parts.slice(0, 3).join("\n") + "\n" + parts[3]!.slice(0, 40);
    render(<Card source={half} closed={false} streaming onAsk={() => {}} />);
    expect(screen.getByText("rested")).toBeTruthy();
    expect(screen.queryByText("light")).toBeNull();
  });

  it("leaves a settled paragraph in place while the next one is written", async () => {
    const view = render(<Answer text={"First paragraph.\n\nSecond is coming"} streaming onAsk={() => {}} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const first = screen.getByText("First paragraph.");
    view.rerender(<Answer text={"First paragraph.\n\nSecond is coming along nicely"} streaming onAsk={() => {}} />);
    expect(screen.getByText("First paragraph.")).toBe(first);
    expect(view.container.querySelector(".caret")?.textContent).toContain("coming along nicely");
  });

  it("formats the paragraph being written without showing its markers", () => {
    const view = render(<Answer text={"Start **bold** and then **half"} streaming onAsk={() => {}} />);
    expect(view.container.querySelector("strong")?.textContent).toBe("bold");
    expect(view.container.textContent).not.toContain("*");
  });
});

describe("a card's first lines", () => {
  it("keep a placeholder in place until something visible has arrived", () => {
    const parts = card.split("\n");
    const view = render(<Card source={parts.slice(0, 2).join("\n") + "\n"} closed={false} streaming onAsk={() => {}} />);
    expect(view.container.querySelector(".shimmer")).toBeTruthy();
    view.rerender(<Card source={parts.slice(0, 3).join("\n") + "\n"} closed={false} streaming onAsk={() => {}} />);
    expect(view.container.querySelector(".shimmer")).toBeNull();
    expect(screen.getByText("rested")).toBeTruthy();
  });
});
