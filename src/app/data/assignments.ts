import { useSyncExternalStore } from "react";
import * as cloud from "../../client/cloud.js";
import * as liveSocket from "../../client/live.js";
import { assignmentList, retryAssignment, stopAssignment, type Assignment, type AssignmentList, type PendingDecision } from "../../client/pip-remote.js";

// What Pip works on in the background (assignments) and the replies waiting for the person's decision, as the
// server keeps them (docs/pip-message-flow.md, "An assignment"). One copy per tab, shared by Today and the chat.
//
// - It is read while something on screen uses it, and not at all otherwise: the first view to subscribe starts it,
//   the last one to leave stops it, with every listener and timer it made.
// - The account's live socket says when to read again (any step of a run, a reconnect). Without the socket, and only
//   while the tab is visible and something still works or waits, it reads again every POLL ms.
// - It belongs to one account: a view never sees another account's list, and signing out empties it.

export type { Assignment, PendingDecision };
export type AssignmentsStatus = "signed-out" | "loading" | "ready" | "failed";
export interface AssignmentsState { account: string; status: AssignmentsStatus; assignments: Assignment[]; decisions: PendingDecision[]; error: string }

const POLL = 15_000;
const SIGNED_OUT: AssignmentsState = { account: "", status: "signed-out", assignments: [], decisions: [], error: "" };

let state: AssignmentsState = SIGNED_OUT;
let asked = 0;
let poll: ReturnType<typeof setTimeout> | undefined;
let soon: ReturnType<typeof setTimeout> | undefined;
let stopListening: (() => void) | null = null;
const listeners = new Set<() => void>();

const signedIn = (): string => (cloud.connected() ? cloud.account()?.id ?? "" : "");
const set = (next: AssignmentsState) => { state = next; listeners.forEach(listener => listener()); };
const loading = (account: string): AssignmentsState => ({ account, status: "loading", assignments: [], decisions: [], error: "" });
/** Whether anything in the list can still change without the person: then a tab without the socket reads again. */
const moving = () => state.assignments.some(item => item.state === "working" || item.state === "waiting");

function schedule(): void {
  clearTimeout(poll);
  poll = undefined;
  if (!listeners.size || liveSocket.connected() || !state.account) return;
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  if (state.status === "ready" && !moving()) return;
  poll = setTimeout(() => void refresh(), POLL);
}

/** Applies an answer from the server, when it is still this account's. */
function apply(account: string, value: AssignmentList): void {
  if (signedIn() !== account || (value.accountId && value.accountId !== account)) return;
  set({ account, status: "ready", assignments: value.assignments ?? [], decisions: value.decisions ?? [], error: "" });
}

/** Reads the list again. An account other than the one shown starts from nothing, so its list never mixes in. */
export async function refresh(): Promise<void> {
  const account = signedIn();
  if (!account) { asked++; if (state !== SIGNED_OUT) set(SIGNED_OUT); return; }
  if (state.account !== account) set(loading(account));
  const ask = ++asked;
  try {
    const value = await assignmentList();
    if (ask === asked) apply(account, value);
  } catch (error) {
    // A failed read keeps what was shown (it may be a moment's dropped connection) and says so.
    if (ask === asked && signedIn() === account) set({ ...state, account, status: state.status === "ready" ? "ready" : "failed", error: error instanceof Error ? error.message : String(error) });
  }
  if (ask === asked) schedule();
}

function start(): void {
  const again = () => { clearTimeout(soon); soon = setTimeout(() => void refresh(), 150); };
  const off = liveSocket.on(message => {
    if (message.type === "hello" || message.type === "closed") again();
    // Every step of a run but its text may change an assignment or a decision; a burst is read once.
    if (message.type === "event" && message.event === "run" && message.data.kind !== "delta") again();
  });
  const visible = () => { if (document.visibilityState === "visible") again(); else schedule(); };
  document.addEventListener("visibilitychange", visible);
  addEventListener("online", again);
  stopListening = () => { off(); document.removeEventListener("visibilitychange", visible); removeEventListener("online", again); clearTimeout(soon); clearTimeout(poll); poll = soon = undefined; };
  void refresh();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { stopListening?.(); stopListening = null; }
  };
}

/** The list for the account signed in now; another account's (or a signed-out tab's) is never returned. */
const snapshot = (): AssignmentsState => (state.account && state.account === signedIn() ? state : SIGNED_OUT);

/** The assignments and decisions, live while the calling view is on screen. */
export const useAssignments = (): AssignmentsState => useSyncExternalStore(subscribe, snapshot, () => SIGNED_OUT);

/** Stops an assignment; the list is the server's answer. */
export async function stop(id: string): Promise<void> {
  const account = signedIn();
  apply(account, await stopAssignment(id));
}
/** Tries a failed or stopped assignment again; the list is the server's answer. */
export async function retry(id: string): Promise<void> {
  const account = signedIn();
  apply(account, await retryAssignment(id));
}

/** The assignment to show for one: itself, or the newest retry it led to when that is in the list. */
export function latestOf(item: Assignment, list: readonly Assignment[]): Assignment {
  let current = item;
  for (let hops = 0; current.retried && hops < 20; hops++) {
    const next = list.find(entry => entry.id === current.retried);
    if (!next) break;
    current = next;
  }
  return current;
}

/** For tests: forgets the list and every listener's work. */
export function resetAssignments(): void {
  stopListening?.(); stopListening = null; listeners.clear(); asked++; state = SIGNED_OUT;
}
