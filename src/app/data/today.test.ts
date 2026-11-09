import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clock } from "../../client/planner.js";
import { completeTask, createTask, getTask, today } from "./tasks.ts";
import { addStep, dailyNoteText, deferTask, focusRemaining, focusSession, saveDailyNote, startFocus, tomorrow, toggleStep } from "./today.ts";

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
