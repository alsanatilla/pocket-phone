import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("../../ui/toast/toast.ts", () => ({ toast: vi.fn(), toastError: vi.fn(), clearToast: vi.fn() }));
vi.mock("../../ui/Markdown.tsx", () => ({ Markdown: ({ text }: { text: string }) => <div className="prose">{text}</div> }));
vi.mock("../../runtime.ts", () => ({ useSyncState: vi.fn() }));
vi.mock("../../../client/cloud.js", () => ({ connected: vi.fn(() => true), account: vi.fn(() => ({ id: "user-a", email: "a@example.com" })) }));
vi.mock("../../data/jobs.ts", () => ({ loadJobs: vi.fn() }));
vi.mock("../../data/assignments.ts", async original => ({ ...await original<typeof import("../../data/assignments.ts")>(),
  useAssignments: vi.fn(), stop: vi.fn(() => Promise.resolve()), retry: vi.fn(() => Promise.resolve()), refresh: vi.fn(() => Promise.resolve()) }));
vi.mock("../pip/runner.ts", () => ({ send: vi.fn(() => Promise.resolve()), busy: vi.fn(() => false), canQueue: vi.fn(() => true), queueSend: vi.fn(() => Promise.resolve()) }));

import { agenda } from "../../../client/planner.js";
import { connect } from "../../data/bus.ts";
import { refresh, retry, stop, useAssignments, type Assignment, type AssignmentsState, type PendingDecision } from "../../data/assignments.ts";
import { chats, type ChatTurn } from "../../data/chats.ts";
import { homeChat } from "../../data/home.ts";
import { loadJobs, type JobsState } from "../../data/jobs.ts";
import { completeTask, createTask, getTask } from "../../data/tasks.ts";
import { markVisit } from "../../data/today.ts";
import { useSyncState } from "../../runtime.ts";
import { send } from "../pip/runner.ts";
import { TodayPage } from "./TodayPage.tsx";

// Today with its real stores (tasks, agenda, chats) and the server's parts stubbed: the assignments list, the jobs and
// the account. It shows what is there, says honestly what is not, and every key does what it says.

const at = (hour: number, minute = 0, day = 9) => new Date(2026, 10, day, hour, minute).getTime();
const working: Assignment = { id: "a1", title: "Bike prices", state: "working", created: at(7, 40), started: at(7, 44), ended: 0, origin: { chat: "home-x", turn: "t1" }, report: null, error: "", lookups: 3, retryOf: "", retried: "" };
const failed: Assignment = { ...working, id: "a2", title: "Train times", state: "failed", ended: at(6, 58), error: "The provider could not be reached." };
const decision: PendingDecision = { runId: "r1", chat: "home-x", asked: at(8, 12), requests: [{ id: "q1", tool: "create_record", title: "Save task “Call Ms. Brandt about the deposit”" }] };
const state = (fields: Partial<AssignmentsState> = {}): AssignmentsState => ({ account: "user-a", status: "ready", assignments: [], decisions: [], error: "", ...fields });
const jobs = (fields: Partial<JobsState> = {}): JobsState => ({ settings: null, hasKey: true, keySource: "dedicated", usedToday: 0, routines: [], runs: [], ...fields });

function briefIn(): string {
  const home = homeChat();
  const turn = { uid: "t-brief", text: "Morning check-in (job)", owner: "pip-routine", answer: "Dentist at 10:30, so leave by 10:05.", created: at(7, 30), updated: at(7, 31), status: "done" } as ChatTurn;
  chats.update(home.uid, value => { value.turns.push(turn); });
  return home.uid;
}

beforeAll(() => { connect(); });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at(9));
  navigate.mockReset();
  vi.mocked(useSyncState).mockReturnValue({ label: "", state: "idle", signedIn: true, local: false });
  vi.mocked(useAssignments).mockReturnValue(state());
  vi.mocked(loadJobs).mockResolvedValue(jobs());
});
afterEach(() => { vi.useRealTimers(); });

describe("Today", () => {
  it("in the morning: the latest brief as written, then decisions, what Pip did, appointments and tasks; no clock, arranging or timer", async () => {
    const chat = briefIn();
    vi.mocked(loadJobs).mockResolvedValue(jobs({ routines: [{ id: "m", kind: "checkin", title: "Morning check-in" } as JobsState["routines"][number]],
      runs: [{ routine: "m", title: "Morning check-in", kind: "checkin", at: at(7, 30), status: "done", error: "", chat, turn: "t-brief" }] }));
    vi.mocked(useAssignments).mockReturnValue(state({ assignments: [working], decisions: [decision] }));
    agenda.save({ title: "Dentist, Dr. Weber", when: at(10, 30), minutes: 45 });
    const late = createTask("Submit the tax return", { due: "2026-11-07" });
    render(<TodayPage />);

    expect(await screen.findByText("Dentist at 10:30, so leave by 10:05.")).toBeTruthy();
    expect(screen.getByText("Mon 9 Nov")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Save task “Call Ms. Brandt/ }).getAttribute("href")).toBe("#/pip?chat=home-x");
    expect(screen.getByText("3 lookups so far · started 07:44")).toBeTruthy();
    expect(screen.getByText("Dentist, Dr. Weber")).toBeTruthy();
    expect(screen.getByText("2 days late")).toBeTruthy();
    for (const gone of [/arrange/i, /standard layout/i, /start focus/i, /remaining/i, /park/i]) expect(screen.queryByText(gone)).toBeNull();
    // The brief is shown above and not again under "from pip"; the brief job's report is not listed twice.
    expect(screen.getAllByText(/Morning check-in/i)).toHaveLength(1);

    fireEvent.click(screen.getByRole("checkbox", { name: "Done: Submit the tax return" }));
    expect(getTask(late.uid)?.done).toBe(true);
    expect(screen.getByRole("checkbox", { name: "Not done: Submit the tax return" })).toBeTruthy();
  });

  it("stops a working assignment and tries a failed one again from its row's menu", async () => {
    vi.mocked(useAssignments).mockReturnValue(state({ assignments: [working, failed] }));
    render(<TodayPage />);
    expect(screen.getByText("Failed: The provider could not be reached.")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("button", { name: "Bike prices: more" }), { key: "ArrowDown" });
    await act(async () => { fireEvent.click(await screen.findByRole("menuitem", { name: "stop" })); });
    expect(stop).toHaveBeenCalledWith("a1");
    fireEvent.keyDown(screen.getByRole("button", { name: "Train times: more" }), { key: "ArrowDown" });
    await act(async () => { fireEvent.click(await screen.findByRole("menuitem", { name: "try again" })); });
    expect(retry).toHaveBeenCalledWith("a2");
  });

  it("keeps what arrived since the last visit while open, and remembers the visit per account when left", () => {
    markVisit("user-a", at(8));
    const done: Assignment = { ...working, id: "a3", title: "Flat insurance", state: "done", ended: at(8, 30), report: null };
    const old: Assignment = { ...working, id: "a4", title: "Old research", state: "done", ended: at(7) };
    vi.mocked(useAssignments).mockReturnValue(state({ assignments: [done, old] }));
    const view = render(<TodayPage />);
    expect(screen.getByText("since 08:00")).toBeTruthy();
    expect(screen.getByText("Flat insurance")).toBeTruthy();
    expect(screen.queryByText("Old research")).toBeNull();
    vi.setSystemTime(at(9, 30));
    view.rerender(<TodayPage />);
    expect(screen.getByText("Flat insurance")).toBeTruthy();
    view.unmount();
    expect(localStorage.getItem("pocket:today-seen:user-a")).toBe(String(at(9, 30)));
    expect(localStorage.getItem("pocket:today-seen:user-b")).toBeNull();
  });

  it("does not count a visit whose list could not be read as seen", () => {
    markVisit("user-a", at(8));
    vi.mocked(useAssignments).mockReturnValue(state({ status: "failed", error: "Pocket could not be reached." }));
    const view = render(<TodayPage />);
    expect(screen.getByText("Pocket could not reach Pip: Pocket could not be reached.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "try again" }));
    expect(refresh).toHaveBeenCalled();
    view.unmount();
    expect(localStorage.getItem("pocket:today-seen:user-a")).toBe(String(at(8)));
  });

  it("signed out: says how to see what Pip did, and the day's own things still show", () => {
    vi.mocked(useSyncState).mockReturnValue({ label: "", state: "idle", signedIn: false, local: false });
    createTask("Call the landlord", { due: "2026-11-09" });
    render(<TodayPage />);
    expect(screen.getByText("Sign in to see what Pip did while you were away.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "sign in" }).getAttribute("href")).toBe("#/settings");
    expect(screen.getByText("Call the landlord")).toBeTruthy();
  });

  it("empty: one sentence and the field", () => {
    render(<TodayPage />);
    expect(screen.getByText("Nothing due and nothing planned today. Ask pip anything below.")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Message Pip" })).toBeTruthy();
  });

  it("in the evening: tomorrow's appointments and what got done", () => {
    vi.setSystemTime(at(19));
    agenda.save({ title: "Flat viewing, Lindenstraße 12", when: at(9, 0, 10), minutes: 60 });
    completeTask(createTask("Renew bike insurance").uid);
    const view = render(<TodayPage />);
    expect(screen.getByRole("checkbox", { name: "Not done: Renew bike insurance" })).toBeTruthy();
    expect(screen.getByText("Mon 9 Nov · evening")).toBeTruthy();
    expect(within(view.container).getByText("tomorrow")).toBeTruthy();
    expect(screen.getByText("Flat viewing, Lindenstraße 12")).toBeTruthy();
  });

  it("sends what is written to the big chat and opens it", async () => {
    render(<TodayPage />);
    const field = screen.getByRole("textbox", { name: "Message Pip" });
    fireEvent.change(field, { target: { value: "Is the dentist at 10:30?" } });
    await act(async () => { fireEvent.keyDown(field, { key: "Enter" }); });
    expect(send).toHaveBeenCalledWith(homeChat().uid, "Is the dentist at 10:30?");
    expect(navigate).toHaveBeenCalledWith({ to: "/pip" });
    expect((field as HTMLTextAreaElement).value).toBe("");
  });
});
