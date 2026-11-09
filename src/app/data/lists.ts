import { changed, load, save, tasks as store } from "../../client/store.js";
import { createTask, listTasks, today } from "./tasks.ts";
import type { Step, Task, TaskList } from "./types.ts";

// Lists are Todoist's projects, as lean as Pocket can make them: a name, and tasks that point at it with a uid.
// A list can be kept as a template; a template is the same record with `template: true`, hidden from the normal
// lists, whose tasks carry a day offset instead of a date ("in 0 days", "in 2 days"), so using it in November and
// in March gives the same shape. Both live in tasks.json, next to the tasks, so one sync carries them everywhere.

const DOC = "tasks.json";
const NAME_LIMIT = 60;

interface Doc { lists?: TaskList[]; tasks: Task[] }

const read = (): Doc => load(DOC) as Doc;
function write(doc: Doc): void { save(DOC, doc); changed(DOC); }

const cleanName = (name: string): string => {
  const value = String(name ?? "").trim().replace(/\s+/g, " ");
  if (!value || value.length > NAME_LIMIT) throw new Error("Give the list a name, up to 60 characters.");
  return value;
};

const byName = (a: TaskList, b: TaskList) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.created - b.created;

/** The lists a person picks from (templates are kept apart). */
export function lists(): TaskList[] { return (read().lists ?? []).filter(list => !list.deleted && !list.template).sort(byName); }
export function templates(): TaskList[] { return (read().lists ?? []).filter(list => !list.deleted && list.template).sort(byName); }
export function getList(uid: string): TaskList | null { return (read().lists ?? []).find(list => list.uid === uid && !list.deleted) ?? null; }

function editList(uid: string, change: (list: TaskList) => void, doc = read()): TaskList {
  doc.lists ??= [];
  const list = doc.lists.find(item => item.uid === uid && !item.deleted);
  if (!list) throw new Error("This list was removed.");
  change(list);
  list.updated = Math.max(Date.now(), list.updated + 1);
  write(doc);
  return list;
}

export function createList(name: string, options: { template?: boolean } = {}): TaskList {
  const doc = read();
  doc.lists ??= [];
  const now = Date.now();
  const list: TaskList = { uid: crypto.randomUUID(), name: cleanName(name), template: Boolean(options.template), created: now, updated: now, deleted: false };
  doc.lists.push(list);
  write(doc);
  return list;
}

export const renameList = (uid: string, name: string): TaskList => editList(uid, list => { list.name = cleanName(name); });

/** Removing a list keeps its tasks; they return to the Inbox instead of disappearing. */
export function removeList(uid: string): void {
  const doc = read();
  for (const task of doc.tasks) if (task.list === uid && !task.deleted) { task.list = ""; task.updated = Math.max(Date.now(), task.updated + 1); }
  doc.lists ??= [];
  const list = doc.lists.find(item => item.uid === uid && !item.deleted);
  if (!list) throw new Error("This list was removed.");
  list.deleted = true;
  list.updated = Math.max(Date.now(), list.updated + 1);
  write(doc);
}

/** Days between two local days ("YYYY-MM-DD"), both read at noon so a DST change cannot shift one. */
export function dayOffset(from: string, to: string): number {
  const at = (day: string) => { const [y, m, d] = day.split("-").map(Number); return new Date(y!, (m ?? 1) - 1, d ?? 1, 12).getTime(); };
  return Math.round((at(to) - at(from)) / 86_400_000);
}
/** The local day `days` after `day`. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const value = new Date(y!, (m ?? 1) - 1, (d ?? 1) + days, 12);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

/** Tasks that belong to a list (a template's items included). */
export function tasksIn(uid: string): Task[] {
  return listTasks().filter(task => task.list === uid);
}

/** Copies a list's open tasks into a template; each keeps its distance from today, or no date. */
export function saveAsTemplate(listUid: string, name?: string): TaskList {
  const source = getList(listUid);
  if (!source || source.template) throw new Error("Only a list can become a template.");
  const template = createList(name?.trim() || source.name, { template: true });
  const day = today();
  for (const task of tasksIn(listUid)) {
    if (task.done) continue;
    createTask(task.text, {
      list: template.uid,
      offset: task.due ? Math.max(0, dayOffset(day, task.due)) : null,
      steps: (task.steps ?? []).map(step => ({ text: step.text, done: false })),
      important: task.important,
    });
  }
  return template;
}

/** A template's items, in the order they were written. */
export function templateItems(templateUid: string): Task[] {
  return listTasks().filter(task => task.list === templateUid).sort((a, b) => a.created - b.created);
}

/** Adds or changes an item in a template: text, and how many days after "today" it is due (null: no date). */
export function addTemplateItem(templateUid: string, text: string, offset: number | null = null, steps: Step[] = []): Task {
  const template = getList(templateUid);
  if (!template?.template) throw new Error("That is not a template.");
  return createTask(text, { list: templateUid, offset, steps, important: false });
}

export function setTemplateItem(taskUid: string, change: { text?: string; offset?: number | null }): Task {
  return store.edit(taskUid, task => {
    if (change.text !== undefined) task.text = String(change.text).trim().slice(0, 500);
    if (change.offset !== undefined) task.offset = change.offset;
  });
}

/** Starts a list from a template: a new list, and its items dated from today. */
export function useTemplate(templateUid: string, name?: string): TaskList {
  const template = getList(templateUid);
  if (!template?.template) throw new Error("That is not a template.");
  const list = createList(name?.trim() || template.name);
  const day = today();
  for (const item of templateItems(templateUid)) {
    const offset = typeof item.offset === "number" ? item.offset : null;
    createTask(item.text, {
      list: list.uid,
      due: offset === null ? "" : addDays(day, offset),
      important: item.important,
      steps: (item.steps ?? []).map(step => ({ text: step.text, done: false })),
    });
  }
  return list;
}
