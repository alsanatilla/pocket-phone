import { agenda, clock, type ClockEntry } from "../../client/planner.js";
import { tasks } from "../../client/store.js";
import { getTask, listTasks, chosenTask, today, createTask } from "./tasks.ts";
import { createNote, listNotes, updateNote } from "./notes.ts";

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
