import { beforeAll, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const params = { taskId: "" };
vi.mock("@tanstack/react-router", () => ({ useParams: () => params, useNavigate: () => vi.fn() }));
vi.mock("../../ui/toast/toast.ts", () => ({ toast: vi.fn(), toastError: vi.fn(), clearToast: vi.fn() }));
vi.mock("../../ui/dialog/dialog.ts", () => ({ confirm: vi.fn(() => Promise.resolve(true)) }));

import { clock } from "../../../client/planner.js";
import { connect } from "../../data/bus.ts";
import { completeTask, createTask, getTask } from "../../data/tasks.ts";
import { confirm } from "../../ui/dialog/dialog.ts";
import { TaskPage } from "./TaskPage.tsx";

// Focus moved from Today to the task it is about: started, paused and ended here on the real room timer.

beforeAll(() => { connect(); });

describe("a task's focus", () => {
  it("starts a session on this task, pauses it and ends it", async () => {
    const task = createTask("Write the brief");
    params.taskId = task.uid;
    render(<TaskPage />);
    fireEvent.click(screen.getByRole("tab", { name: "15 min" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "start focus" })); });
    const session = clock.all().find(entry => entry.kind === "focus");
    expect(session).toMatchObject({ task_uid: task.uid, enabled: true });
    expect(screen.getByRole("timer", { name: "Focus time remaining" }).textContent).toMatch(/15:00|14:59/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "pause" })); });
    expect(clock.get(session!.uid)?.enabled).toBe(false);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "end session" })); });
    expect(clock.all().filter(entry => entry.kind === "focus")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "start focus" })).toBeTruthy();
  });

  it("says so while another task has the session, and is not offered for a finished task", () => {
    const other = createTask("Read the report"), mine = createTask("Call the bank");
    clock.save({ uid: "today-focus", kind: "focus", title: other.text, task_uid: other.uid, enabled: true, remaining: 25 * 60_000, due: Date.now() + 25 * 60_000 });
    params.taskId = mine.uid;
    const view = render(<TaskPage />);
    expect(screen.getByText(/A focus session runs on “Read the report”/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "start focus" })).toBeNull();
    view.unmount();
    completeTask(mine.uid);
    render(<TaskPage />);
    expect(screen.queryByText("focus")).toBeNull();
  });
});

describe("a task's keys", () => {
  it("offers save and complete; delete is in the task's menu, asks first, and removes the task", async () => {
    const task = createTask("Send the insurance form");
    params.taskId = task.uid;
    render(<TaskPage />);
    expect(screen.getByRole("button", { name: "save task" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "complete" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "delete" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("button", { name: "Options for this task" }), { key: "ArrowDown" });
    await act(async () => { fireEvent.click(await screen.findByRole("menuitem", { name: "delete" })); });
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ danger: true }));
    expect(getTask(task.uid)).toBeNull();
  });

  it("removes a step from that step's menu, with no remove key on every step", async () => {
    const task = createTask("Pack for Lisbon", { steps: [{ text: "Passport", done: false }, { text: "Charger", done: false }] });
    params.taskId = task.uid;
    render(<TaskPage />);
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
    expect(screen.getByText("0/2")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("button", { name: "Options for step Passport" }), { key: "ArrowDown" });
    await act(async () => { fireEvent.click(await screen.findByRole("menuitem", { name: "remove" })); });
    expect(screen.queryByText("Passport")).toBeNull();
    expect(screen.getByText("Charger")).toBeTruthy();
    expect(screen.getByText("0/1")).toBeTruthy();
  });
});
