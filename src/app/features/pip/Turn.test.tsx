import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
vi.mock("../../ui/toast/toast.ts", () => ({ toast: vi.fn(), toastError: vi.fn(), clearToast: vi.fn() }));
vi.mock("../../ui/Markdown.tsx", () => ({ Markdown: ({ text }: { text: string }) => <div className="prose">{text}</div> }));
import { chats, type ChatTurn } from "../../data/chats.ts";
import { listTasks } from "../../data/tasks.ts";
import { toastError } from "../../ui/toast/toast.ts";
import { QueuedTurn, Turn } from "./Turn.tsx";

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
});
