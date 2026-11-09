import { activeAccount } from "../../client/workspace-storage.js";
import type { PipConfig } from "../../client/pip-core.js";

// Pip's background jobs, as the server keeps them (/api/pip/background). A job is a routine: a preset kind, a
// schedule (a time on chosen days, every N minutes within active hours, or once), a delivery (push or quiet) and
// its own notes between runs (scratch), which only Pip writes.

export type JobKind = "checkin" | "brief" | "watch" | "prompt" | "training";
export type RunStatus = "done" | "failed" | "limit" | "off" | "skipped" | "unchanged" | "";

export interface Job {
  id: string; kind: JobKind; title: string; prompt: string; enabled: boolean;
  time: string; days: number[]; every?: number; at?: number; activeHours?: { start: string; end: string };
  delivery?: "notify" | "quiet";
  nextRun: number; lastRun: number; lastStatus: RunStatus; lastError: string; lastChat: string; scratch: string;
}
export interface JobRun { routine: string; title: string; kind: string; at: number; status: RunStatus; error: string; chat: string }
export interface BackgroundSettings extends PipConfig { grants: string[]; dailyTokens: number; timezone: string; enabled: boolean; useAccountKey?: boolean }
export interface JobsState {
  settings: BackgroundSettings | null; hasKey: boolean; keySource: "dedicated" | "account" | null;
  usedToday: number; routines: Job[]; runs: JobRun[];
}

/** What a new job may be sent with; the server validates and fills in the rest. */
export type JobDraft = Partial<Pick<Job, "id" | "kind" | "title" | "prompt" | "enabled" | "time" | "days" | "every" | "at" | "activeHours" | "delivery">> & { kind: JobKind };

async function call<T>(body?: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/pip/background", body ? {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId: activeAccount(), ...body }),
  } : { credentials: "same-origin", cache: "no-store" });
  const value = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (response.status === 401) throw new Error("Sign in to Pocket to let Pip work on its own.");
  if (!response.ok || !value) throw new Error(value?.error || "Pocket could not reach Pip's jobs.");
  return value;
}

export const loadJobs = () => call<JobsState>();
export const saveJob = (routine: JobDraft) => call<JobsState>({ action: "routine", routine });
export const deleteJob = (id: string) => call<JobsState>({ action: "delete-routine", id });
export const runJob = (id: string) => call<JobsState & { run: { status: RunStatus; chat?: string; error?: string } }>({ action: "run", id });
export const clearNotes = (id: string) => call<JobsState>({ action: "clear-scratch", id });
export const saveBackgroundSettings = (settings: BackgroundSettings) => call<JobsState>({ action: "settings", settings });

// ── Words for a schedule ──

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function daysLabel(days: number[]): string {
  const set = [...new Set(days)].sort();
  if (set.length === 7) return "every day";
  if (set.join() === "1,2,3,4,5") return "weekdays";
  if (set.join() === "0,6") return "weekends";
  return set.map(day => DAY_NAMES[day]).join(" ");
}
const interval = (minutes: number) => minutes % 60 === 0 ? (minutes === 60 ? "every hour" : `every ${minutes / 60} h`) : `every ${minutes} min`;

/** "07:30 · weekdays", "every 2 h · 08:00–22:00", "once · Thu 12 Nov 18:00". */
export function scheduleLabel(job: Pick<Job, "time" | "days" | "every" | "at" | "activeHours">): string {
  if (job.at) return "once · " + new Date(job.at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  if (job.every) {
    const window = job.activeHours ? ` · ${job.activeHours.start}–${job.activeHours.end === "00:00" ? "24:00" : job.activeHours.end}` : "";
    const days = job.days.length === 7 ? "" : " · " + daysLabel(job.days);
    return interval(job.every) + window + days;
  }
  return `${job.time} · ${daysLabel(job.days)}`;
}

/** "in 3 h", "tomorrow 07:30", "paused", "not scheduled". */
export function nextLabel(job: Pick<Job, "enabled" | "nextRun">, now = Date.now()): string {
  if (!job.enabled) return "paused";
  if (!job.nextRun) return "not scheduled";
  const minutes = Math.round((job.nextRun - now) / 60000);
  if (minutes < 1) return "due now";
  if (minutes < 60) return `in ${minutes} min`;
  if (minutes < 12 * 60) return `in ${Math.round(minutes / 60)} h`;
  const date = new Date(job.nextRun), tomorrow = new Date(now + 86_400_000);
  const clock = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return date.toDateString() === tomorrow.toDateString() ? "tomorrow " + clock : date.toLocaleDateString([], { weekday: "short", day: "numeric" }) + " " + clock;
}

export const STATUS_LABEL: Record<string, string> = {
  done: "answered", failed: "failed", limit: "token limit reached", off: "did not run", skipped: "skipped", unchanged: "nothing new", "": "not run yet",
};

/** Presets for a new job: what each kind is for, and a sensible start. */
export const PRESETS: { kind: JobKind; name: string; blurb: string; draft: JobDraft }[] = [
  { kind: "checkin", name: "Morning check-in", blurb: "What needs attention today, before the day starts.", draft: { kind: "checkin", time: "07:30", days: [1, 2, 3, 4, 5] } },
  { kind: "brief", name: "Nightly brief", blurb: "What changed today, what is rotting, one connection worth knowing.", draft: { kind: "brief", time: "21:00", days: [0, 1, 2, 3, 4, 5, 6] } },
  { kind: "watch", name: "Watch", blurb: "Look for something on a rhythm; stay silent until it shows up.", draft: { kind: "watch", title: "", prompt: "", every: 120, activeHours: { start: "08:00", end: "22:00" }, delivery: "notify" } },
  { kind: "prompt", name: "Reminder", blurb: "Once, at a moment: Pip writes to you then, with what it can look up.", draft: { kind: "prompt", title: "", prompt: "", at: 0 } },
  { kind: "prompt", name: "Recurring task", blurb: "Any question, answered on a schedule.", draft: { kind: "prompt", title: "", prompt: "", time: "09:00", days: [1] } },
];
