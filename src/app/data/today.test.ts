import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clock } from "../../client/planner.js";
import { completeTask, createTask, getTask, today } from "./tasks.ts";
import { addStep, dailyNoteText, dayAppointments, dayOf, dayPart, dayTasks, dayTitle, deferTask, excerpt, focusRemaining, focusSession, FIRST_VISIT, fromPip, lastVisit, latestBrief, markVisit, reportTitle, saveDailyNote, startFocus, tomorrow, toggleStep } from "./today.ts";
import type { Assignment } from "../../client/pip-remote.js";
import type { Chat, ChatTurn } from "./chats.ts";
import type { JobRun } from "./jobs.ts";
import type { Task } from "./types.ts";

// The room timer and the task store are the real ones; only the clock is controlled, so a session can be started,
// left, paused and picked up again exactly as the Today screen does it.

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 9, 9, 0, 0)); });
afterEach(() => { vi.useRealTimers(); });

describe("a focus session", () => {
  it("starts on the chosen task and counts down in real time", () => {
    const task = createTask("Write the brief");
    const session = startFocus(task.uid, 25);
    expect(session.task_uid).toBe(task.uid);
    expect(session.enabled).toBe(true);
    expect(focusRemaining(session, Date.now())).toBe(25 * MINUTE);

    vi.setSystemTime(Date.now() + 10 * MINUTE);
    expect(focusRemaining(session, Date.now())).toBe(15 * MINUTE);
  });

  it("is found again after the screen reopened, running or paused", () => {
    const task = createTask("Read the report");
    const session = startFocus(task.uid, 15);

    vi.setSystemTime(Date.now() + 5 * MINUTE);
    expect(focusSession(Date.now())?.uid).toBe(session.uid);
    expect(focusRemaining(focusSession(Date.now())!, Date.now())).toBe(10 * MINUTE);

    clock.pause(session.uid);
    const paused = focusSession(Date.now());
    expect(paused?.enabled).toBe(false);
    expect(focusRemaining(paused!, Date.now())).toBe(10 * MINUTE);

    clock.resume(session.uid);
    expect(focusSession(Date.now())?.enabled).toBe(true);
    expect(focusRemaining(focusSession(Date.now())!, Date.now())).toBe(10 * MINUTE);
  });

  it("stays on the screen as done once its time is up today, and never starts twice at once", () => {
    const first = createTask("First");
    const second = createTask("Second");
    const session = startFocus(first.uid, 15);
    expect(startFocus(second.uid, 25).uid).toBe(session.uid); // a running session is not replaced

    vi.setSystemTime(Date.now() + 16 * MINUTE);
    expect(focusRemaining(session, Date.now())).toBe(0);
    expect(focusSession(Date.now())?.uid).toBe(session.uid);
    expect(startFocus(second.uid, 25).task_uid).toBe(second.uid); // an expired one may be replaced
  });

  it("refuses a done task and a duration it does not offer", () => {
    const task = createTask("Old");
    completeTask(task.uid);
    expect(() => startFocus(task.uid, 25)).toThrow(/open task/i);
    const open = createTask("Open");
    expect(() => startFocus(open.uid, 20)).toThrow(/15, 25 or 45/);
  });
});

describe("a checklist in the action card", () => {
  it("adds a trimmed step, ticks it, and refuses a step that changed underneath", () => {
    const task = createTask("Pack for Lisbon");
    addStep(task.uid, "  passport  ");
    expect(getTask(task.uid)!.steps).toEqual([{ text: "passport", done: false }]);

    toggleStep(task.uid, 0, "passport", true);
    expect(getTask(task.uid)!.steps[0]!.done).toBe(true);

    expect(() => toggleStep(task.uid, 0, "tickets", true)).toThrow(/changed/);
    expect(() => addStep(task.uid, "   ")).toThrow(/step/i);
  });

  it("stops at twenty steps", () => {
    const task = createTask("Long list");
    for (let index = 0; index < 20; index += 1) addStep(task.uid, "step " + index);
    expect(() => addStep(task.uid, "one more")).toThrow(/20 steps/);
    expect(getTask(task.uid)!.steps).toHaveLength(20);
  });
});

describe("closing the day", () => {
  it("moves a task to tomorrow", () => {
    const task = createTask("Send the invoice", { due: today() });
    deferTask(task.uid, tomorrow());
    expect(getTask(task.uid)!.due).toBe(tomorrow());
    expect(getTask(task.uid)!.due).not.toBe(today());
  });

  it("refuses to move a task that is already done", () => {
    const task = createTask("Already finished", { due: today() });
    completeTask(task.uid);
    expect(() => deferTask(task.uid, tomorrow())).toThrow(/done/i);
  });

  it("keeps one line for the day, and refuses a save from a stale version", () => {
    const day = today();
    const saved = saveDailyNote("shipped the settings split", day, 0);
    expect(dailyNoteText(day)).toBe("shipped the settings split");

    expect(() => saveDailyNote("second draft", day, 0)).toThrow(/changed elsewhere/);
    const second = saveDailyNote("second draft", day, saved.updated);
    expect(dailyNoteText(day)).toBe("second draft");
    expect(() => saveDailyNote("   ", day, second.updated)).toThrow(/write a note/i);
  });
});

// ── The Today page's choices, on plain values ──

const at = (hour: number, minute = 0, day = 9) => new Date(2026, 10, day, hour, minute).getTime();
const task = (uid: string, text: string, fields: Partial<Task> = {}): Task => ({ uid, text, done: false, due: "", important: false, steps: [], created: at(6), updated: at(6), deleted: false, ...fields });
const turn = (uid: string, fields: Partial<ChatTurn> = {}): ChatTurn => ({ uid, text: "Question", answer: "Answer.", created: at(7), updated: at(7), status: "done", ...fields });
const chat = (uid: string, turns: ChatTurn[], fields: Partial<Chat> = {}): Chat => ({ uid, title: "pip", home: true, updated: at(23), draft: "", config: {} as Chat["config"], context: [], turns, ...fields });
const assignment = (id: string, fields: Partial<Assignment> = {}): Assignment => ({ id, title: "Bike prices", state: "working", created: at(7), started: at(7), ended: 0,
  origin: { chat: "home-1", turn: "t-origin" }, report: null, error: "", lookups: 0, retryOf: "", retried: "", ...fields });

describe("the part of the day", () => {
  it("is the morning until five in the afternoon, and the evening until four at night", () => {
    expect(dayPart(at(9))).toBe("morning");
    expect(dayPart(at(16, 59))).toBe("morning");
    expect(dayPart(at(17))).toBe("evening");
    expect(dayPart(at(2))).toBe("evening");
    expect(dayPart(at(4))).toBe("morning");
  });
});

describe("the day's tasks", () => {
  const list = [
    task("late", "Submit the tax return", { due: "2026-11-07" }),
    task("today", "Call the landlord", { due: "2026-11-09" }),
    task("tomorrow", "Pack the climbing bag", { due: "2026-11-10" }),
    task("someday", "Read the manual"),
    task("done", "Renew bike insurance", { due: "2026-11-09", done: true, updated: at(8) }),
    task("done-undated", "Water the plants", { done: true, updated: at(8, 30) }),
    task("done-yesterday", "Old thing", { due: "2026-11-08", done: true, updated: at(8, 0, 8) }),
  ];
  it("in the morning: open ones due today or earlier, the late one first and saying how late, then what was finished of them", () => {
    const shown = dayTasks(list, "morning", at(9));
    expect(shown.map(item => [item.task.uid, item.note, item.late])).toEqual([["late", "2 days late", true], ["today", "", false], ["done", "", false]]);
  });
  it("in the evening: tomorrow's too, and everything finished today", () => {
    expect(dayTasks(list, "evening", at(19)).map(item => item.task.uid)).toEqual(["late", "today", "tomorrow", "done", "done-undated"]);
  });
});

describe("the day a late look belongs to", () => {
  // Monday the 9th at 18:00 and Tuesday the 10th at 01:00 are the same evening: the same date, tasks and appointments.
  const list = [
    task("late", "Submit the tax return", { due: "2026-11-08" }),
    task("today", "Call the landlord", { due: "2026-11-09" }),
    task("tomorrow", "Pack the climbing bag", { due: "2026-11-10" }),
    task("after", "Book the train", { due: "2026-11-11" }),
    task("done-evening", "Renew bike insurance", { done: true, updated: at(22) }),
    task("done-night", "Water the plants", { done: true, updated: at(0, 30, 10) }),
    task("done-sunday", "Old thing", { done: true, updated: at(20, 0, 8) }),
  ];
  const events = [
    { uid: "monday", title: "Climbing", when: at(19), minutes: 90 },
    { uid: "tuesday", title: "Flat viewing", when: at(9, 0, 10), minutes: 60 },
    { uid: "wednesday", title: "Dentist", when: at(9, 0, 11), minutes: 30 },
  ];
  for (const [label, now] of [["18:00", at(18)], ["01:00 the night after", at(1, 0, 10)]] as const) {
    it("at " + label + ": Monday's evening, with Tuesday as tomorrow", () => {
      expect(dayPart(now)).toBe("evening");
      expect(dayOf(now)).toBe("2026-11-09");
      expect(dayTitle(now)).toBe("Mon 9 Nov");
      expect(dayTasks(list, "evening", now).map(item => [item.task.uid, item.note])).toEqual([
        ["late", "1 day late"], ["today", ""], ["tomorrow", "tomorrow"], ["done-evening", ""], ["done-night", ""]]);
      expect(dayAppointments(events, "evening", now).map(event => event.uid)).toEqual(["tuesday"]);
    });
  }
  it("from 04:00 it is the next day's morning", () => {
    const now = at(4, 0, 10);
    expect([dayPart(now), dayOf(now), dayTitle(now)]).toEqual(["morning", "2026-11-10", "Tue 10 Nov"]);
    expect(dayTasks(list, "morning", now).map(item => [item.task.uid, item.note])).toEqual([["late", "2 days late"], ["today", "1 day late"], ["tomorrow", ""]]);
    expect(dayAppointments(events, "morning", now).map(event => event.uid)).toEqual(["tuesday"]);
  });
});

describe("the day's appointments", () => {
  const events = [
    { uid: "past", title: "Breakfast", when: at(7), minutes: 30 },
    { uid: "dentist", title: "Dentist", when: at(10, 30), minutes: 45 },
    { uid: "climb", title: "Climbing", when: at(18, 30), minutes: 90 },
    { uid: "view", title: "Flat viewing", when: at(9, 0, 10), minutes: 60 },
  ];
  it("in the morning: today's that have not ended, in order", () => {
    expect(dayAppointments(events, "morning", at(9)).map(event => event.uid)).toEqual(["dentist", "climb"]);
  });
  it("in the evening: tomorrow's, also after midnight", () => {
    expect(dayAppointments(events, "evening", at(20)).map(event => event.uid)).toEqual(["view"]);
    expect(dayAppointments(events, "evening", at(1, 0, 10)).map(event => event.uid)).toEqual(["view"]);
  });
});

describe("the last visit", () => {
  it("is kept per account; a first visit shows the last twelve hours", () => {
    const now = at(9);
    expect(lastVisit("account-a", now)).toBe(now - FIRST_VISIT);
    markVisit("account-a", at(7));
    expect(lastVisit("account-a", now)).toBe(at(7));
    expect(lastVisit("account-b", now)).toBe(now - FIRST_VISIT);
    expect(lastVisit("", now)).toBe(now - FIRST_VISIT);
  });
  it("ignores a marker from the future or one that is not a time", () => {
    localStorage.setItem("pocket:today-seen:account-c", String(at(12)));
    expect(lastVisit("account-c", at(9))).toBe(at(9) - FIRST_VISIT);
    localStorage.setItem("pocket:today-seen:account-c", "soon");
    expect(lastVisit("account-c", at(9))).toBe(at(9) - FIRST_VISIT);
  });
});

describe("the brief", () => {
  const runs: JobRun[] = [
    { routine: "w", title: "Train strike watch", kind: "watch", at: at(8), status: "done", error: "", chat: "home-1", turn: "t-watch" },
    { routine: "m", title: "Morning check-in", kind: "checkin", at: at(7, 30), status: "done", error: "", chat: "home-1", turn: "t-brief" },
    { routine: "n", title: "Nightly brief", kind: "brief", at: at(21, 0, 8), status: "done", error: "", chat: "home-1", turn: "t-night" },
  ];
  it("is the newest check-in or nightly brief whose report this device has", () => {
    const chats = [chat("home-1", [turn("t-night", { owner: "pip-routine", answer: "Last night." }), turn("t-brief", { owner: "pip-routine", answer: "Dentist at 10:30.", updated: at(7, 31) })])];
    expect(latestBrief(runs, chats, at(9))).toMatchObject({ title: "Morning check-in", chat: "home-1", at: at(7, 31) });
  });
  it("falls back to an older one while the newest has not arrived, and is none once they are old", () => {
    const chats = [chat("home-1", [turn("t-night", { owner: "pip-routine", answer: "Last night." })])];
    expect(latestBrief(runs, chats, at(9))?.title).toBe("Nightly brief");
    expect(latestBrief(runs, chats, at(9, 0, 10))).toBeNull();
    expect(latestBrief([], chats, at(9))).toBeNull();
  });
});

describe("what Pip did since the last visit", () => {
  const since = at(6);
  it("lists working assignments first, then what ended or reported since, newest first; nothing older", () => {
    const list = [
      assignment("a-working", { title: "Bike prices", lookups: 3, started: at(7, 44) }),
      assignment("a-done", { title: "Flat insurance", state: "done", ended: at(8, 10), report: { chat: "home-1", turn: "t-report" } }),
      assignment("a-old", { title: "Old research", state: "done", ended: at(5) }),
      assignment("a-failed", { title: "Train times", state: "failed", ended: at(6, 58), error: "The provider could not be reached." }),
    ];
    const chats = [chat("home-1", [
      turn("t-job", { owner: "pip-routine", text: "Train strike watch (job)", answer: "**GDL** strike called for Monday.\n\nMore below.", created: at(6, 5), updated: at(6, 10) }),
      turn("t-report", { owner: "pip-assignment", text: "Flat insurance (assignment)", answer: "## Result\n\nThe current tariff is fine.", created: at(8, 10), updated: at(8, 10) }),
      turn("t-mine", { owner: "phone", text: "My question (job)", answer: "Mine.", created: at(8), updated: at(8) }),
      turn("t-skip", { owner: "pip-routine", text: "Watch (job)", answer: "SKIP", created: at(8), updated: at(8) }),
    ])];
    const items = fromPip(chats, list, since);
    expect(items.map(item => [item.title, item.note])).toEqual([
      ["Bike prices", "3 lookups so far · started 07:44"],
      ["Flat insurance", "Result"],
      ["Train times", "The provider could not be reached."],
      ["Train strike watch", "GDL strike called for Monday."],
    ]);
  });
  it("shows a retried assignment by its retry, and leaves out the brief shown above", () => {
    const list = [assignment("first", { state: "failed", ended: at(7), retried: "second" }), assignment("second", { retryOf: "first", state: "working" })];
    const chats = [chat("home-1", [turn("t-brief", { owner: "pip-routine", text: "Morning check-in (job)", created: at(7), updated: at(7) })])];
    expect(fromPip(chats, list, since, "t-brief").map(item => item.key)).toEqual(["a:second"]);
  });
});

describe("a report's words", () => {
  it("drops the job or assignment mark only on that owner's turn, never on the person's own words", () => {
    expect(reportTitle({ owner: "pip-routine", text: "Nightly brief (job)" }, { home: true, title: "pip" })).toBe("Nightly brief");
    expect(reportTitle({ owner: "pip-assignment", text: "Bike prices (assignment)" })).toBe("Bike prices");
    expect(reportTitle({ owner: "phone", text: "Explain this (assignment)" })).toBe("Explain this (assignment)");
    expect(reportTitle({ owner: "pip-routine", text: "Check-in prompt" }, { home: false, title: "Morning" })).toBe("Morning");
  });
  it("takes the first line of text, without Markdown or cards, cut at 160 characters", () => {
    expect(excerpt("```pocket\n{}\n```\n\n- **Canyon** is [cheapest](https://x.example)")).toBe("Canyon is cheapest");
    expect(excerpt("x".repeat(200))).toHaveLength(160);
  });
});
