// Types for pip-activity.js: the ledger of what Pip looked up or proposed while answering.
export interface ActivityRow {
  id: string; kind: "web" | "tool"; name: string; title: string; input: string;
  state: "queued" | "running" | "awaiting" | "done" | "failed" | "stopped";
  summary: string; started: number; ended: number; sources: { href: string; title: string }[];
  result?: string; applied_href?: string; applied?: number;
}
export function activity(items?: unknown[]): ActivityRow[];
export function settle(items: unknown[], state: ActivityRow["state"], summary?: string): ActivityRow[];
export function elapsed(row: ActivityRow): string;
export function mark(state: ActivityRow["state"]): string;
/** One line for the whole ledger, e.g. "□ Tasks + Calendar". */
export function activityTitle(rows: ActivityRow[]): string;
export function phaseLabel(phase: string): string;
