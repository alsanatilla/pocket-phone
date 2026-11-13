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
