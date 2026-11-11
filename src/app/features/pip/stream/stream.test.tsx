import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

// A reply's text is drawn in the browser (Streamdown), so nothing here asks the server for HTML.
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

  it("leaves a settled paragraph in place while the next one is written", () => {
    const view = render(<Answer text={"First paragraph.\n\nSecond is coming"} streaming onAsk={() => {}} />);
    const first = screen.getByText("First paragraph.");
    view.rerender(<Answer text={"First paragraph.\n\nSecond is coming along nicely"} streaming onAsk={() => {}} />);
    expect(screen.getByText("First paragraph.")).toBe(first);
    // The caret marks the reply still being written, so its text ends with the half-written sentence.
    expect(view.container.querySelector(".caret")?.textContent?.trim().endsWith("Second is coming along nicely")).toBe(true);
  });

  it("formats the paragraph being written without showing its markers", () => {
    const view = render(<Answer text={"Start **bold** and then **half"} streaming onAsk={() => {}} />);
    expect(view.container.querySelector("strong")?.textContent).toBe("bold");
    expect(view.container.textContent).not.toContain("*");
  });

  it("draws a table, a code block and a list from the text alone, and asks nothing of the server", () => {
    const asked = vi.spyOn(globalThis, "fetch");
    const text = "Die Woche:\n\n| Tag | km |\n|---|---|\n| Mo | 8 |\n| Sa | 18 |\n\n- locker\n- lang\n\n```js\nconst pace = distance / time;\n```";
    const view = render(<Answer text={text} streaming onAsk={() => {}} />);
    expect(view.container.querySelector("table thead th")?.textContent).toBe("Tag");
    expect(view.container.querySelectorAll("table tbody tr")).toHaveLength(2);
    expect(view.container.querySelectorAll("ul li")).toHaveLength(2);
    expect(view.container.querySelector("pre code")?.textContent).toContain("const pace = distance / time;");
    expect(asked).not.toHaveBeenCalled();
  });

  it("shows no syntax characters while the text is half written", () => {
    const view = render(<Answer text="" streaming onAsk={() => {}} />);
    for (const text of ["Der Wert ist **wichtig", "Ein Satz.\n\n```js\nconst pace = distance / time;", "| Tag | Lauf |\n|---|---|"]) {
      view.rerender(<Answer text={text} streaming onAsk={() => {}} />);
      const shown = view.container.textContent ?? "";
      expect(shown, text).not.toMatch(/\*\*|```|\|/);
      expect(shown.length, text).toBeGreaterThan(3);
    }
  });

  it("draws raw HTML in the text as text, never as elements", () => {
    const view = render(<Answer text={'Ein <b>fetter</b> Satz und <script>alert(1)</script>'} streaming={false} onAsk={() => {}} />);
    expect(view.container.querySelector("b, script, img")).toBeNull();
    expect(view.container.textContent).toContain("<b>fetter</b>");
  });

  it("keeps only web and mail links, as the server renderer did", () => {
    const view = render(<Answer text={"[weg](javascript:alert) und [hin](https://example.com/x) und [mail](mailto:a@b.c)"} streaming={false} onAsk={() => {}} />);
    const links = view.container.querySelectorAll("a");
    expect([...links].map(link => link.getAttribute("href"))).toEqual(["https://example.com/x", "mailto:a@b.c"]);
    expect(links[0]?.getAttribute("target")).toBe("_blank");
    expect(links[0]?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(links[1]?.getAttribute("target")).toBeNull();
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

describe("malformed model cards", () => {
  it("renders sibling metrics even when the declared root element is absent", () => {
    const source = card.split("\n").filter((_, index) => index !== 1).join("\n");
    render(<Card source={source} closed streaming={false} onAsk={() => {}} />);
    expect(screen.getByText("rested")).toBeTruthy();
    expect(screen.getByText("light")).toBeTruthy();
  });

  it("renders a chart with a missing closing brace and missing root element", () => {
    const source = P("/root", "main") + "\n" + P("/elements/chart", {
      type: "Chart", props: { kind: "bar", title: "Weekly totals", data: [{ label: "Week 1", value: 403 }, { label: "Week 2", value: 596 }], note: "Reported totals", children: [] },
    }).slice(0, -1);
    const view = render(<Card source={source} closed={false} streaming onAsk={() => {}} />);
    expect(screen.queryByText("Weekly totals")).toBeNull();
    view.rerender(<Card source={source} closed streaming={false} onAsk={() => {}} />);
    expect(screen.getByText("Weekly totals")).toBeTruthy();
    expect(screen.getByText("Reported totals")).toBeTruthy();
  });
});

describe("a card a model wrote without its fence, as one nested tree", () => {
  const tree = JSON.stringify({ op: "add", path: "/root", value: { type: "Stack", props: { direction: "vertical", gap: "md" }, children: [
    { type: "Text", props: { variant: "body" }, children: [{ type: "Text", props: {}, children: [{ text: "Die Kurve steigt gleichmäßig." }] }] },
    { type: "Button", props: { label: "Plan als Aufgabe anlegen", variant: "primary" } }] } });
  const gemma = "Fortschrittskurve:\n\npocket\n\n" + tree + "\n</parameter>\n</function>\n\nViel Erfolg!";

  it("streams without JSON on screen, draws the card, and its button asks Pip", () => {
    const asked: string[] = [];
    const view = render(<Answer text="" streaming onAsk={prompt => asked.push(prompt)} />);
    for (let end = 1; end <= gemma.length; end += 11) {
      view.rerender(<Answer text={gemma.slice(0, end)} streaming onAsk={prompt => asked.push(prompt)} />);
      expect(view.container.textContent ?? "", "at " + end).not.toMatch(/"op"|\{"|<\/?(parameter|function)|^pocket|\npocket/);
    }
    view.rerender(<Answer text={gemma} streaming={false} onAsk={prompt => asked.push(prompt)} />);
    expect(screen.getByText("Die Kurve steigt gleichmäßig.")).toBeTruthy();
    act(() => { screen.getByRole("button", { name: "Plan als Aufgabe anlegen" }).click(); });
    expect(asked).toEqual(["Plan als Aufgabe anlegen"]);
  });
});
