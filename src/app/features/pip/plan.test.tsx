import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
vi.mock("../../ui/toast/toast.ts", () => ({ toast: vi.fn(), toastError: vi.fn(), clearToast: vi.fn() }));
vi.mock("../../ui/Markdown.tsx", () => ({ Markdown: ({ text }: { text: string }) => <div className="prose">{text}</div> }));
// The runner as the review sees it: which writes wait, and the decisions taken so far (the real one keeps them the same way).
const runner = vi.hoisted(() => ({ waiting: new Set<string>(), decisions: new Map<string, { approved: boolean; input?: unknown }>() }));
vi.mock("./runner.ts", () => ({
  busy: () => false, send: vi.fn().mockResolvedValue(undefined), retry: vi.fn(), resume: vi.fn(),
  approvalOf: (_turn: string, row: string) => runner.waiting.has(row) ? { decision: runner.decisions.get(row) } : null,
  decide: vi.fn((_turn: string, row: string, decision: { approved: boolean; input?: unknown }) => { runner.decisions.set(row, decision); }),
}));
import { chats, type ChatTurn } from "../../data/chats.ts";
import { connect } from "../../data/bus.ts";
import { aboutCard, planRequest } from "../../../shared/pocket-card-edit.js";
import { Card } from "./stream/Card.tsx";
import { Turn } from "./Turn.tsx";
import { decide } from "./runner.ts";

connect();
const line = (path: string, value: unknown) => JSON.stringify({ op: "add", path, value });
const ITEMS = [{ time: "08:00", title: "Long run", detail: "18 km easy" }, { time: "10:30", title: "Brunch with Mia" }, { time: "", title: "Buy groceries" }];
const plan = [line("/id", "kplan01"), line("/root", "t"), line("/elements/t", { type: "Timeline", props: { title: "Saturday 15 Nov", items: ITEMS }, children: [] })].join("\n");
const metric = [line("/id", "kmetric1"), line("/root", "m"), line("/elements/m", { type: "Metric", props: { label: "Recovery", value: "72" }, children: [] })].join("\n");
async function menu() {
  fireEvent.keyDown(screen.getByRole("button", { name: "Card options" }), { key: "ArrowDown" });
  return screen.findAllByRole("menuitem");
}

describe("a plan card", () => {
  it("offers to add a plan to the calendar and tasks, and sends Pip every item with the card's id", async () => {
    const ask = vi.fn(), drawn = new Date(2026, 10, 14, 9).getTime();
    render(<Card source={plan} closed streaming={false} onAsk={ask} at={{ chatId: "chat-plan", place: "chat", drawn }} />);
    const items = await menu();
    const add = items.find(item => item.textContent === "add to calendar and tasks")!;
    await act(async () => { fireEvent.click(add); });
    const sent = String(ask.mock.calls[0]![0]);
    expect(sent).toBe(planRequest(plan, "kplan01", drawn));
    for (const item of ["- 08:00 · Long run · 18 km easy", "- 10:30 · Brunch with Mia", "- no time · Buy groceries", "drawn Sat 2026-11-14", "“Saturday 15 Nov”"]) expect(sent).toContain(item);
    // The person's line shows the request alone; the block is for Pip, and the trailer names the card.
    expect(aboutCard(sent)).toMatchObject({ text: "Add this plan to my calendar and tasks.", id: "kplan01" });
  });

  it("is not offered on a card that is not a plan", async () => {
    render(<Card source={metric} closed streaming={false} onAsk={vi.fn()} at={{ chatId: "chat-metric", place: "chat" }} />);
    const items = await menu();
    expect(items.map(item => item.textContent)).not.toContain("add to calendar and tasks");
  });
});

const awaiting = (id: string, input: Record<string, unknown>) => ({ id, kind: "tool", name: "create_record", title: "save " + input.kind, input: JSON.stringify(input), state: "awaiting",
  summary: "waiting for your approval", result: JSON.stringify({ kind: "approval", action: { tool: "create_record", kind: input.kind, title: input.title } }), started: 1, ended: 0, sources: [] });
const ROWS = [
  awaiting("row-a", { kind: "appointment", title: "Long run", text: "", when: "2026-11-15T08:00:00Z", minutes: 60 }),
  awaiting("row-b", { kind: "appointment", title: "Brunch with Mia", text: "", when: "2026-11-15T10:30:00Z", minutes: 60 }),
  awaiting("row-c", { kind: "task", title: "Buy groceries", text: "", due: "2026-11-15" }),
];
function seed() {
  const chat = chats.create();
  const turn = { uid: "turn-plan", text: planRequest(plan, "kplan01")!, answer: "", created: Date.now(), status: "streaming", activity: ROWS, sources: [] } as unknown as ChatTurn;
  chats.update(chat.uid, value => { value.turns.push(turn); });
  return { chatId: chat.uid, turn: chats.get(chat.uid)!.turns[0]! };
}
const view = () => { const { chatId, turn } = seed(); return render(<Turn turn={turn} chatId={chatId} latest live={{ status: "streaming" }} locked={false} />); };
async function rowMenu(title: string, choice: string) {
  fireEvent.keyDown(screen.getByRole("button", { name: "Options for: " + title }), { key: "ArrowDown" });
  const item = (await screen.findAllByRole("menuitem")).find(element => element.textContent === choice)!;
  await act(async () => { fireEvent.click(item); });
}

describe("several writes waiting at once", () => {
  beforeEach(() => { runner.waiting = new Set(ROWS.map(row => row.id)); runner.decisions.clear(); vi.mocked(decide).mockClear(); });

  it("are one list under one heading, with one save all, not a section and two keys each", () => {
    view();
    expect(screen.getAllByText(/needs your approval/)).toHaveLength(1);
    expect(screen.getByText("Add this plan to my calendar and tasks.")).toBeTruthy();
    expect(screen.queryByText(/\[plan/)).toBeNull();
    expect(screen.queryByRole("button", { name: "review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "decline" })).toBeNull();
    // The waiting writes are not listed a second time as steps above the review.
    expect(screen.queryByText(/waiting for your approval/)).toBeNull();
    expect(screen.getByText("08:00")).toBeTruthy();
    expect(screen.getByText("task")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "save all" }));
    expect(vi.mocked(decide).mock.calls.map(call => [call[1], call[2]])).toEqual(ROWS.map(row => [row.id, { approved: true }]));
  });

  it("keeps a per-item decline, and saves the rest together", async () => {
    const { rerender } = view();
    await rowMenu("Brunch with Mia", "decline");
    expect(runner.decisions.get("row-b")).toEqual({ approved: false });
    const { chatId, turn } = seed();
    rerender(<Turn turn={turn} chatId={chatId} latest live={{ status: "streaming", updated: 2 } as Partial<ChatTurn>} locked={false} />);
    expect(screen.getByText("declined")).toBeTruthy();
    vi.mocked(decide).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "save the rest" }));
    expect(vi.mocked(decide).mock.calls.map(call => call[1])).toEqual(["row-a", "row-c"]);
    expect(runner.decisions.get("row-b")).toEqual({ approved: false });
  });

  it("opens one item for review and approves it with the person's edits", async () => {
    view();
    await rowMenu("Long run", "review…");
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByDisplayValue("Long run"), { target: { value: "Long run, 20 km" } });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "approve" })); });
    expect(runner.decisions.get("row-a")).toMatchObject({ approved: true, input: { kind: "appointment", title: "Long run, 20 km" } });
  });
});
