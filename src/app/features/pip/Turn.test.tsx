import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
vi.mock("../../ui/toast/toast.ts", () => ({ toast: vi.fn(), toastError: vi.fn(), clearToast: vi.fn() }));
vi.mock("../../ui/Markdown.tsx", () => ({ Markdown: ({ text }: { text: string }) => <div className="prose">{text}</div> }));
vi.mock("../../data/assignments.ts", async original => ({ ...await original<typeof import("../../data/assignments.ts")>(), useAssignments: vi.fn(), stop: vi.fn(() => Promise.resolve()), retry: vi.fn(() => Promise.resolve()) }));
import { chats, type ChatTurn } from "../../data/chats.ts";
import { listTasks } from "../../data/tasks.ts";
import { toastError } from "../../ui/toast/toast.ts";
import { QueuedTurn, Turn } from "./Turn.tsx";
import { retry, stop, useAssignments, type Assignment, type AssignmentsState } from "../../data/assignments.ts";

function seed(activity: unknown[], extra: Partial<ChatTurn> = {}) {
  const chat = chats.create();
  const turn = { uid: "turn-1", text: "Plan my week", answer: "Here is a start.", created: Date.now(), status: "done", activity, sources: [], ...extra } as ChatTurn;
  chats.update(chat.uid, value => { value.turns.push(turn); });
  return { chatId: chat.uid, turn: chats.get(chat.uid)!.turns[0]! };
}

describe("a reply in Pip", () => {
  it("lets the person review a proposed task, save it once, and shows it as saved", async () => {
    const proposal = { proposal: { kind: "task", title: "Book the dentist", text: "Before Friday", due: "2026-11-12", steps: ["find the number"] } };
    const { chatId, turn } = seed([{ id: "row-1", name: "propose", title: "Proposal", state: "done", started: 1, ended: 2, result: JSON.stringify(proposal) }]);
    const view = render(<Turn turn={turn} chatId={chatId} latest live={null} locked={false} />);

    expect(screen.getByText("Book the dentist")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "review" }));
    fireEvent.change(screen.getByDisplayValue("Book the dentist"), { target: { value: "Book the dentist, 9am" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "save task" })); });

    await waitFor(() => expect(listTasks().filter(task => task.text === "Book the dentist, 9am")).toHaveLength(1));
    const saved = listTasks().filter(task => task.text === "Book the dentist, 9am");
    expect(saved[0]).toMatchObject({ due: "2026-11-12", steps: [{ text: "find the number", done: false }] });
    expect(toastError).not.toHaveBeenCalled();

    view.rerender(<Turn turn={chats.get(chatId)!.turns[0]!} chatId={chatId} latest live={null} locked={false} />);
    expect(screen.getByRole("link", { name: /saved/ })).toBeTruthy();
  });

  it("offers to continue or start over when a reply did not finish", () => {
    const { chatId, turn } = seed([], { status: "stopped", error: "Stopped. Continue or retry when you’re ready.", answer: "" });
    render(<Turn turn={turn} chatId={chatId} latest live={null} locked={false} />);
    expect(screen.getByText(/Continue or retry/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "continue" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "start over" })).toBeTruthy();
  });

  it("shows a message waiting its turn as the next question, marked queued, with one key to take it back", async () => {
    const takeBack = vi.fn(() => Promise.resolve());
    const view = render(<QueuedTurn text="And the red one?" state="waiting" onTakeBack={takeBack} />);
    expect(screen.getByText("And the red one?")).toBeTruthy();
    expect(screen.getByText("queued")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Take back: And the red one?" })); });
    expect(takeBack).toHaveBeenCalledTimes(1);
    view.rerender(<QueuedTurn text="And the red one?" state="held" onTakeBack={takeBack} />);
    expect(screen.getByText("paused")).toBeTruthy();
  });

  it("shows an assignment's report as Pip's own turn: its title without the mark, a quiet marker, and what it is", () => {
    const { chatId, turn } = seed([], { text: "Bike prices (assignment)", owner: "pip-assignment", answer: "The Canyon is cheapest." });
    const view = render(<Turn turn={turn} chatId={chatId} latest={false} live={null} locked={false} />);
    expect(screen.getByText("Bike prices")).toBeTruthy();
    expect(screen.queryByText(/\(assignment\)/)).toBeNull();
    expect(screen.getByText(/· assignment/)).toBeTruthy();
    view.unmount();
    // The person's own words keep whatever they wrote.
    const own = seed([], { uid: "turn-2", text: "Explain this (assignment)", owner: "phone" });
    render(<Turn turn={own.turn} chatId={own.chatId} latest={false} live={null} locked={false} />);
    expect(screen.getByText("Explain this (assignment)")).toBeTruthy();
    expect(screen.queryByText(/· assignment/)).toBeNull();
  });

  it("follows the assignment a reply started: working with stop, failed with try again, and its retry once tried", async () => {
    const started = { id: "row-a", name: "start_assignment", title: "start an assignment · Bike prices", state: "done", started: 1, ended: 2, result: JSON.stringify({ kind: "assignment", done: "started", id: "a1", title: "Bike prices" }) };
    const { chatId, turn } = seed([started], { answer: "I am looking into it." });
    const base: Assignment = { id: "a1", title: "Bike prices", state: "working", created: 1, started: 1, ended: 0, origin: { chat: chatId, turn: turn.uid }, report: null, error: "", lookups: 3, retryOf: "", retried: "" };
    const state = (assignments: Assignment[]): AssignmentsState => ({ account: "user-a", status: "ready", assignments, decisions: [], error: "" });
    // Before the list is read (or signed out) the reply still says what it handed off, without a key.
    vi.mocked(useAssignments).mockReturnValue({ account: "", status: "signed-out", assignments: [], decisions: [], error: "" });
    const view = render(<Turn turn={turn} chatId={chatId} latest live={null} locked={false} />);
    expect(screen.getByText("assignment · Bike prices")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /assignment/ })).toBeNull();
    // The status line says it; the tool call is not listed as a step as well.
    expect(screen.queryByText(/start an assignment/)).toBeNull();

    vi.mocked(useAssignments).mockReturnValue(state([base]));
    view.rerender(<Turn turn={{ ...turn, updated: 98 }} chatId={chatId} latest live={null} locked={false} />);
    expect(screen.getByText("assignment · working · 3 lookups")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Stop the assignment Bike prices" })); });
    expect(stop).toHaveBeenCalledWith("a1");

    vi.mocked(useAssignments).mockReturnValue(state([{ ...base, state: "failed", ended: 3, error: "the provider could not be reached." }]));
    view.rerender(<Turn turn={{ ...turn, updated: 99 }} chatId={chatId} latest live={null} locked={false} />);
    expect(screen.getByText("Bike prices failed: the provider could not be reached.")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try the assignment Bike prices again" })); });
    expect(retry).toHaveBeenCalledWith("a1");

    const reportAt = new Date(2026, 10, 9, 8, 6).getTime();
    vi.mocked(useAssignments).mockReturnValue(state([
      { ...base, id: "a2", retryOf: "a1", state: "done", ended: reportAt, report: { chat: chatId, turn: "report-1" } },
      { ...base, state: "failed", retried: "a2" },
    ]));
    view.rerender(<Turn turn={{ ...turn, updated: 100 }} chatId={chatId} latest live={null} locked={false} />);
    expect(screen.getByText(/assignment · reported 08:06/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "below" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Try the assignment/ })).toBeNull();
  });

  it("shows a message sent into the reply where Pip took it in, marked quietly, with the answer going on after it", () => {
    const answer = "Saturday is free.\n\nSunday is free too.";
    const { chatId, turn } = seed([], { answer, steers: [{ uid: "s1", text: "And Sunday?", at: 1, taken: 2, pos: 17 }] } as Partial<ChatTurn>);
    const view = render(<Turn turn={turn} chatId={chatId} latest live={null} locked={false} />);
    const reply = view.container.querySelector("[data-reply]")!.textContent!;
    expect(reply.indexOf("Saturday is free.")).toBeLessThan(reply.indexOf("And Sunday?"));
    expect(reply.indexOf("And Sunday?")).toBeLessThan(reply.indexOf("Sunday is free too."));
    expect(screen.getByText(/taken in/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Take back/ })).toBeNull();
  });

  it("cuts streamed blocks at a taken message, and shows one not taken yet after the reply so far with a key to take it back", async () => {
    const { chatId, turn } = seed([], { status: "streaming", answer: "" });
    const blocks = [{ kind: "prose" as const, key: "p0", text: "Saturday is free." }, { kind: "prose" as const, key: "p1", text: "Sunday too." }];
    const live = { status: "streaming", answer: "Saturday is free.\n\nSunday too.", phase: "writing", steers: [{ uid: "s1", text: "And Sunday?", at: 1, taken: 2, pos: 17, block: 1 }] } as Partial<ChatTurn>;
    const takeBack = vi.fn(() => Promise.resolve());
    const view = render(<Turn turn={turn} chatId={chatId} latest live={live} blocks={blocks} locked
      pending={[{ runId: "r2", turnUid: "s2", text: "Only the morning, please.", created: 3 }]} onTakeBack={takeBack} />);
    const reply = view.container.querySelector("[data-reply]")!.textContent!;
    expect(reply.indexOf("Saturday is free.")).toBeLessThan(reply.indexOf("And Sunday?"));
    expect(reply.indexOf("Sunday too.")).toBeLessThan(reply.indexOf("Only the morning"));
    expect(screen.getByText(/for pip’s next step/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Take back: Only the morning, please." })); });
    expect(takeBack).toHaveBeenCalledWith("r2");
    view.rerender(<Turn turn={turn} chatId={chatId} latest live={live} blocks={blocks} locked held
      pending={[{ runId: "r2", turnUid: "s2", text: "Only the morning, please.", created: 3 }]} onTakeBack={takeBack} />);
    expect(screen.getByText(/after your decision/)).toBeTruthy();
    // Once the reply has taken it, it is drawn once, in its place.
    view.rerender(<Turn turn={turn} chatId={chatId} latest live={{ ...live, steers: [...live.steers!, { uid: "s2", text: "Only the morning, please.", at: 3, taken: 4, pos: 29, block: 2 }] } as Partial<ChatTurn>} blocks={blocks} locked
      pending={[{ runId: "r2", turnUid: "s2", text: "Only the morning, please.", created: 3 }]} onTakeBack={takeBack} />);
    expect(screen.getAllByText("Only the morning, please.")).toHaveLength(1);
  });
});
