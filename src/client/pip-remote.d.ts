// Types for the parts of pip-remote.js the React client uses: replies that run on Pocket's server.
import type { Chat, ChatTurn } from "../app/data/chats.ts";
import type { PipConfig } from "./pip-core.js";
export function serverRuns(options: { chat?: string; config?: PipConfig | null; force?: boolean }): Promise<{ available: boolean }>;
/** Sends `turn` and follows its run; with `attach: true` (and no turn) follows the run already going in the chat. */
export function streamReplyRemote(chat: Chat, turn: ChatTurn | null, options: Record<string, unknown>): Promise<unknown>;
/** A message waiting its turn on the server while a reply runs in its chat; `held` after the person stopped that reply. */
export interface QueuedMessage { runId: string; requestId: string; chat: string; turnUid: string; text: string; created: number; state: "waiting" | "held" }
/** A chat's queue and what its running reply is doing (`awaiting` while it waits for a decision; "" when none runs). */
export interface ChatQueue { queue: QueuedMessage[]; active: string }
/** Sends a message to wait its turn while a reply runs in the chat. */
export function queueReply(chat: Chat, message: { text: string; context?: unknown[] }, storage?: Storage): Promise<unknown>;
export function chatQueue(chatUid: string): Promise<ChatQueue>;
export function changeQueue(action: "withdraw" | "resume" | "clear", target: { chat?: string; runId?: string }): Promise<ChatQueue>;
/** Work Pip does in the background and reports into the big chat (docs/pip-message-flow.md, "An assignment"). */
export interface Assignment {
  id: string; title: string; state: "waiting" | "working" | "done" | "failed" | "stopped";
  created: number; started: number; ended: number;
  /** The reply that started it, and where its report stands once it is done. */
  origin: { chat: string; turn: string } | null; report: { chat: string; turn: string } | null;
  error: string; lookups: number;
  /** The assignment this one retries, and the retry started for this one (from any device), or "". */
  retryOf: string; retried: string;
}
/** A reply waiting for the person's decision on a change it wants to make. */
export interface PendingDecision { runId: string; chat: string; asked: number; requests: { id: string; tool: string; title: string }[] }
export interface AssignmentList { accountId: string; assignments: Assignment[]; decisions: PendingDecision[] }
export function assignmentList(): Promise<AssignmentList>;
export function stopAssignment(id: string, storage?: Storage): Promise<AssignmentList>;
export function retryAssignment(id: string): Promise<AssignmentList>;
