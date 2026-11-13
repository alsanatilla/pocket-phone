import { agenda, clock, type ClockEntry } from "../../client/planner.js";
import { tasks } from "../../client/store.js";
import { getTask, listTasks, chosenTask, today, createTask } from "./tasks.ts";
import { createNote, listNotes, updateNote } from "./notes.ts";
import type { AgendaEvent } from "../../client/planner.js";
import type { Assignment } from "../../client/pip-remote.js";
import type { Chat, ChatTurn } from "./chats.ts";
import type { JobRun } from "./jobs.ts";
import type { Task } from "./types.ts";

export function nextTask() {
  const chosen = chosenTask();
  return chosen && !chosen.done ? chosen : listTasks().find(task => !task.done) ?? null;
}
export function selectTask(uid: string) {
  if (!getTask(uid) || getTask(uid)!.done) throw new Error("Choose an open task.");
  tasks.next(uid);
}
export function focusSession(now = Date.now()): ClockEntry | null {
  const all = clock.all().filter(entry => entry.kind === "focus");
  return all.find(entry => entry.enabled && entry.due > now)
    ?? all.find(entry => !entry.enabled && !entry.due && entry.remaining > 0)
    ?? all.find(entry => entry.uid === "today-focus" && entry.due > 0 && entry.due <= now && today(entry.due) === today(now)) ?? null;
}
export function focusRemaining(entry: ClockEntry, now = Date.now()) {
  return entry.due ? Math.max(0, entry.due - now) : Math.max(0, entry.remaining);
}
export function startFocus(uid: string, minutes = 25) {
  const current = focusSession();
  if (current && focusRemaining(current) > 0) return current;
  const task = getTask(uid);
  if (!task || task.done) throw new Error("Choose an open task.");
  if (![15, 25, 45].includes(minutes)) throw new Error("Choose 15, 25 or 45 minutes.");
  selectTask(uid);
  return clock.save({ uid: "today-focus", kind: "focus", title: task.text, task_uid: uid, enabled: true, remaining: minutes * 60000, due: Date.now() + minutes * 60000 });
}
export function endFocus(uid: string) { clock.remove(uid); }
export function toggleStep(uid: string, index: number, text: string, done: boolean) {
  return tasks.edit(uid, task => {
    if (task.steps[index]?.text !== text) throw new Error("This step changed. Try again.");
    task.steps[index]!.done = done;
  });
}
export function addStep(uid: string, text: string) {
  const value = text.trim();
  if (!value || value.length > 500) throw new Error("Write a step, up to 500 characters.");
  return tasks.edit(uid, task => {
    if (task.steps.length >= 20) throw new Error("This task already has 20 steps.");
    task.steps.push({ text: value, done: false });
  });
}
export function nextEvent(now = Date.now()) {
  return agenda.all().find(event => event.when + event.minutes * 60000 > now) ?? null;
}
export function linkPrep(eventId: string, taskId: string) {
  const event = agenda.get(eventId);
  if (!event) throw new Error("This event was removed.");
  if (taskId && (!getTask(taskId) || getTask(taskId)!.done)) throw new Error("Choose an open task.");
  return agenda.save({ ...event, task_uid: taskId });
}
export function createPrep(eventId: string) {
  const event = agenda.get(eventId);
  if (!event) throw new Error("This event was removed.");
  const existing = event.task_uid ? getTask(event.task_uid) : null;
  if (existing) return existing;
  const task = createTask(("Prepare: " + event.title).slice(0, 500), { due: today(event.when) });
  linkPrep(eventId, task.uid);
  return task;
}
export function tomorrow(now = Date.now()) {
  const date = new Date(now); date.setDate(date.getDate() + 1);
  return today(date.getTime());
}
export function deferTask(uid: string, due: string) {
  return tasks.edit(uid, task => {
    if (task.done) throw new Error("This task is already done.");
    task.due = due;
  });
}
export function dailyNote(day = today()) {
  return listNotes().find(note => note.uid.startsWith("day-" + day + "-")) ?? null;
}
export function dailyNoteText(day = today()) {
  return dailyNote(day)?.text.replace(new RegExp("^# " + day + "\\n\\n?"), "") ?? "";
}
export function saveDailyNote(text: string, day: string, expectedVersion: number) {
  const value = text.trim(), note = dailyNote(day);
  if ((note?.updated ?? 0) !== expectedVersion) throw new Error("This note changed elsewhere. Reload before saving.");
  if (!value) throw new Error("Write a note first.");
  const body = "# " + day + "\n\n" + value.slice(0, 2000);
  return note ? updateNote(note.uid, body) : createNote(body, "day-" + day + "-" + crypto.randomUUID());
}

// ── The Today page: what it shows, decided here so it can be tested without drawing it ──

const HOUR = 3_600_000, DAY_MS = 24 * HOUR;
/** The two shapes of Today: the morning's (today's plan) and the evening's (what got done, what is left, tomorrow). */
export type DayPart = "morning" | "evening";
/** Evening from 17:00 until 04:00, so a late look still closes the day it belongs to. */
export function dayPart(now = Date.now()): DayPart {
  const hour = new Date(now).getHours();
  return hour >= 17 || hour < 4 ? "evening" : "morning";
}
/** "Fri 14 Nov". */
export const dayTitle = (now = Date.now()): string => new Date(now).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
/** "08:07". */
export const clockAt = (at: number): string => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

// "Since your last visit" is kept per account (and per device): the moment the person last left Today. A first visit
// on a device, or a marker that cannot be read, shows the last FIRST_VISIT hours.
export const FIRST_VISIT = 12 * HOUR;
const SEEN = "pocket:today-seen:";
export function lastVisit(account: string, now = Date.now()): number {
  try {
    const value = Number(localStorage.getItem(SEEN + account));
    if (Number.isFinite(value) && value > 0 && value <= now) return value;
  } catch { /* storage blocked: treated as a first visit */ }
  return now - FIRST_VISIT;
}
export function markVisit(account: string, at = Date.now()): void {
  try { localStorage.setItem(SEEN + account, String(at)); } catch { /* storage blocked: the next visit shows the last hours */ }
}

/** One of the day's tasks, with the one note that tells it apart: how late it is, or when it is due. */
export interface DayTask { task: Task; note: string; late: boolean }
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z")) / DAY_MS);
/**
 * The tasks Today lists: open ones due today or earlier (the evening adds tomorrow's), then the ones finished today,
 * which stay ticked in place instead of vanishing (the morning keeps only those that were due; the evening all of
 * them, as what got done).
 */
export function dayTasks(list: readonly Task[], part: DayPart, now = Date.now()): DayTask[] {
  const day = today(now), next = tomorrow(now);
  const open = list.filter(task => !task.done && task.due && (task.due <= day || (part === "evening" && task.due === next)))
    .sort((a, b) => a.due.localeCompare(b.due) || Number(b.important) - Number(a.important) || a.created - b.created)
    .map(task => {
      const late = task.due < day ? daysBetween(task.due, day) : 0;
      return { task, late: late > 0, note: late ? late + (late === 1 ? " day late" : " days late") : task.due === day ? "today" : "tomorrow" };
    });
  const finished = list.filter(task => task.done && today(task.updated) === day && (part === "evening" || (task.due && task.due <= day)))
    .sort((a, b) => a.updated - b.updated).map(task => ({ task, note: "", late: false }));
  return [...open, ...finished];
}

/** The appointments Today lists: the morning's that have not ended yet, or in the evening tomorrow's. */
export function dayAppointments(all: readonly AgendaEvent[], part: DayPart, now = Date.now()): AgendaEvent[] {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  if (part === "evening" && new Date(now).getHours() >= 4) start.setDate(start.getDate() + 1);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return all.filter(event => event.when < end.getTime() && event.when + event.minutes * 60_000 > Math.max(start.getTime(), part === "morning" ? now : 0))
    .sort((a, b) => a.when - b.when);
}

/** The first sentence-sized line of a reply, without Markdown marks or cards, for a row's second line. */
export function excerpt(answer: string): string {
  const text = String(answer || "").replace(/```[\s\S]*?(```|$)/g, " ").split("\n")
    .map(line => line.replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, "").replace(/[*_`~]|\[([^\]]*)\]\([^)]*\)/g, (match, label) => label ?? "").replace(/\|/g, " ").trim())
    .find(line => line && !/^[-:\s]+$/.test(line)) ?? "";
  return text.length > 160 ? text.slice(0, 159).trimEnd() + "…" : text;
}

const findTurn = (chats: readonly Chat[], chat: string, turn: string): { chat: Chat; turn: ChatTurn } | null => {
  const found = chats.find(item => item.uid === chat);
  const hit = found?.turns.find(item => item.uid === turn);
  return found && hit ? { chat: found, turn: hit } : null;
};

/** A job's report says "<name> (job)" in the big chat; the name is what Today shows. Only for a job's own turn. */
export function reportTitle(turn: Pick<ChatTurn, "text" | "owner">, chat?: Pick<Chat, "home" | "title">): string {
  if (turn.owner === JOB_OWNER) return chat && !chat.home ? chat.title || turn.text : turn.text.replace(/ \(job\)$/, "");
  if (turn.owner === ASSIGNMENT_OWNER) return turn.text.replace(/ \(assignment\)$/, "");
  return turn.text;
}
export const JOB_OWNER = "pip-routine", ASSIGNMENT_OWNER = "pip-assignment";

/** The latest morning check-in or nightly brief, as written: the job's run, and its report in the synced chats. */
export interface Brief { title: string; at: number; chat: string; turn: ChatTurn }
export const BRIEF_KINDS = ["checkin", "brief"];
/** The newest finished brief of the last 16 hours whose report this device has; null when there is none. */
export function latestBrief(runs: readonly JobRun[], chats: readonly Chat[], now = Date.now()): Brief | null {
  for (const run of runs) {
    if (!BRIEF_KINDS.includes(run.kind) || run.status !== "done" || run.at < now - 16 * HOUR || !run.chat || !run.turn) continue;
    const found = findTurn(chats, run.chat, run.turn);
    if (found && found.turn.status === "done" && found.turn.answer.trim()) return { title: run.title, at: found.turn.updated || run.at, chat: found.chat.uid, turn: found.turn };
  }
  return null;
}

/** A line under "from pip": an assignment (working, or ended since the last visit) or a job's report. */
export interface PipItem { key: string; title: string; note: string; at: number; chat: string; assignment: Assignment | null }
/**
 * What Pip did and does since `since`: assignments still working or waiting (always), those that ended since, and
 * the jobs' reports written since, newest first after the working ones. An assignment that was retried is shown by
 * its retry; the brief (`skip`) is shown above and not repeated.
 */
export function fromPip(chats: readonly Chat[], assignments: readonly Assignment[], since: number, skip = ""): PipItem[] {
  const ids = new Set(assignments.map(item => item.id));
  const moving = (item: Assignment) => item.state === "working" || item.state === "waiting";
  const work: PipItem[] = assignments.filter(item => !(item.retried && ids.has(item.retried)) && (moving(item) || item.ended >= since)).map(item => {
    const report = item.report ? findTurn(chats, item.report.chat, item.report.turn) : null;
    const note = item.state === "done" ? (report ? excerpt(report.turn.answer) : "reported in pip")
      : item.state === "failed" ? item.error || "This assignment failed."
      : item.state === "stopped" ? "stopped"
      : item.state === "waiting" ? "waits for one of the others to finish"
      : (item.lookups ? item.lookups + (item.lookups === 1 ? " lookup" : " lookups") + " so far · " : "") + "started " + clockAt(item.started || item.created);
    return { key: "a:" + item.id, title: item.title || "assignment", note, at: item.ended || item.started || item.created, chat: item.report?.chat || item.origin?.chat || "", assignment: item };
  });
  const jobs: PipItem[] = [];
  for (const chat of chats) {
    if ((chat.updated || 0) < since) continue;
    for (const turn of chat.turns) {
      const at = turn.updated || turn.created;
      if (turn.owner !== JOB_OWNER || turn.status !== "done" || at < since || turn.uid === skip || !turn.answer.trim() || turn.answer.trim() === "SKIP") continue;
      jobs.push({ key: "j:" + chat.uid + ":" + turn.uid, title: reportTitle(turn, chat), note: excerpt(turn.answer), at, chat: chat.uid, assignment: null });
    }
  }
  const active = work.filter(item => item.assignment && moving(item.assignment)).sort((a, b) => b.at - a.at);
  const ended = [...work.filter(item => !item.assignment || !moving(item.assignment)), ...jobs].sort((a, b) => b.at - a.at);
  return [...active, ...ended];
}
