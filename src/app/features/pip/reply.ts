import { activity, activityTitle, settle, type ActivityRow } from "../../../client/pip-activity.js";
import type { Change, CreateProposal } from "../../../client/pip-actions.js";
import type { ChatTurn } from "../../data/chats.ts";

// What a reply consists of besides its text, read from its activity ledger:
// - the lookups Pip made (the ledger itself, and a one-line summary);
// - a plan, if Pip kept one;
// - things Pip proposes the person saves (a note, task or appointment), changes to existing records, COROS
//   workouts, and writes that wait for the person's approval right now.
// Pure functions of a turn, so they can be tested without a model.

export type PlanStep = { text: string; status: "pending" | "in_progress" | "done" };

export type Offer =
  | { type: "create"; row: ActivityRow; proposal: CreateProposal; saved?: string }
  | { type: "change"; row: ActivityRow; change: Change; before: { title: string; [key: string]: unknown }; saved?: string }
  | { type: "coros"; row: ActivityRow; title: string; tool: string; saved?: string }
  | { type: "approval"; row: ActivityRow; name: string; title: string; input: Record<string, unknown> };

const json = (raw: string | undefined): Record<string, unknown> | null => {
  if (!raw) return null;
  try { const value = JSON.parse(raw); return value && typeof value === "object" ? value as Record<string, unknown> : null; } catch { return null; }
};

/** The ledger as it stands: a reply that stopped mid-way shows its open lookups as interrupted. */
export function ledger(turn: ChatTurn, streaming: boolean): ActivityRow[] {
  const rows = !streaming && turn.status === "streaming" ? settle(turn.activity ?? [], "stopped", "Interrupted") : activity(turn.activity ?? []);
  // A drawn card stands in the answer itself; its tool call is not a lookup to list.
  // What Pip remembered or forgot is said under the answer, in words (memoryOf), not listed as a step.
  // So is a job Pip set up, changed or removed (jobsOf).
  return rows.filter(row => row.name !== "show_card" && !(SAID_TOOLS.includes(row.name) && row.state === "done"));
}

const MEMORY_TOOLS = ["remember", "forget"];
const JOB_CHANGES = ["create_job", "change_job", "remove_job"];
const SAID_TOOLS = [...MEMORY_TOOLS, ...JOB_CHANGES];
export interface MemoryChange { kind: "remembered" | "corrected" | "forgot"; text: string }
/** What this reply changed in Pip's memory of the person, in the order it happened. */
export function memoryOf(turn: ChatTurn): MemoryChange[] {
  const changes: MemoryChange[] = [];
  for (const row of activity(turn.activity ?? [])) {
    if (!MEMORY_TOOLS.includes(row.name) || row.state !== "done") continue;
    const value = json(row.result), text = typeof value?.text === "string" ? value.text : "";
    if (!text) continue;
    if (row.name === "forget") { if (value?.forgotten) changes.push({ kind: "forgot", text }); }
    else if (value?.replaced) changes.push({ kind: "corrected", text });
    else if (value?.added) changes.push({ kind: "remembered", text });
  }
  return changes;
}

export interface JobChange { kind: "scheduled" | "changed" | "paused" | "resumed" | "removed"; text: string }
/** The jobs this reply set up, changed, paused, resumed or removed, as "Mon 08:00 · Bike prices". */
export function jobsOf(turn: ChatTurn): JobChange[] {
  const changes: JobChange[] = [];
  for (const row of activity(turn.activity ?? [])) {
    if (!JOB_CHANGES.includes(row.name) || row.state !== "done") continue;
    const value = json(row.result), kind = value?.done as JobChange["kind"] | undefined;
    if (value?.kind !== "job" || !kind || typeof value.title !== "string") continue;
    // A job set up while Pip on its own is off would not run: the line says so instead of only "scheduled".
    changes.push({ kind, text: (typeof value.schedule === "string" && value.schedule ? value.schedule + " · " : "") + value.title + (value.off === true ? " · pip on its own is off" : "") });
  }
  return changes;
}

export const ledgerTitle = (rows: ActivityRow[]): string => activityTitle(rows);

export function planOf(rows: ActivityRow[]): PlanStep[] {
  const plans = rows.filter(row => row.state === "done").map(row => json(row.result)?.plan).filter(Array.isArray);
  const last = (plans.at(-1) ?? []) as unknown[];
  return last.filter((step): step is PlanStep => Boolean(step) && typeof (step as PlanStep).text === "string" && ["pending", "in_progress", "done"].includes((step as PlanStep).status)).slice(0, 8);
}

export function offersOf(rows: ActivityRow[]): Offer[] {
  const offers: Offer[] = [];
  for (const row of rows) {
    const value = json(row.result);
    if (row.state === "awaiting") {
      const action = value?.action as { title?: string } | undefined;
      offers.push({ type: "approval", row, name: row.name, title: action?.title || row.title, input: json(row.input) ?? {} });
      continue;
    }
    if (row.state !== "done" || !value) continue;
    const saved = row.applied_href;
    const proposal = value.proposal as CreateProposal | undefined;
    if (proposal && ["note", "task", "appointment"].includes(proposal.kind) && typeof proposal.title === "string") {
      offers.push({ type: "create", row, proposal, saved });
    } else if (value.kind === "change" && typeof (value.change as Change)?.change === "string" && typeof (value.before as { title?: unknown })?.title === "string") {
      offers.push({ type: "change", row, change: value.change as Change, before: value.before as { title: string }, saved });
    } else if (value.kind === "coros" && typeof (value.coros as { tool?: unknown })?.tool === "string" && typeof value.title === "string") {
      offers.push({ type: "coros", row, title: value.title, tool: (value.coros as { tool: string }).tool, saved });
    }
  }
  return offers;
}

/** "complete_task" → what the button says. */
export function changeLabel(change: Change): string {
  return ({ complete_task: "mark done", update_task: "update task", append_note: "add to note", move_appointment: "move appointment" } as Record<string, string>)[change.change] ?? "apply change";
}

/** Links Pip cited: from the reply and from its lookups, each once. */
export function sourcesOf(turn: ChatTurn, rows: ActivityRow[]): { href: string; title: string }[] {
  const seen = new Set<string>();
  return [...(turn.sources ?? []), ...rows.flatMap(row => row.sources)].filter(item => !seen.has(item.href) && Boolean(seen.add(item.href))).slice(0, 12);
}
