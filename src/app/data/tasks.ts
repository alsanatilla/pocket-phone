import { tasks as store, taskDay } from "../../client/store.js";
import type { Task } from "./types.ts";

// Tasks: typed access to the shared store and the day's view of it.

export const listTasks = (): Task[] => store.list();
export const getTask = (uid: string): Task | null => store.get(uid);
/** Toggles done; logs a DONE line to the receipt when it completes. */
export const completeTask = (uid: string): Task => store.complete(uid);
export const today = (at: number = Date.now()): string => taskDay(at);

export interface DaySummary { open: Task[]; due: Task[]; done: number }

/** What a day holds: open tasks, those due on or before it, and how many are done. */
export function daySummary(list: Task[], day: string): DaySummary {
  const open = list.filter(task => !task.done);
  return { open, due: open.filter(task => Boolean(task.due) && task.due <= day), done: list.length - open.length };
}
