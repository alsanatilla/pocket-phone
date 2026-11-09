// Types for the parts of pip-remote.js the React client uses: replies that run on Pocket's server.
import type { Chat, ChatTurn } from "../app/data/chats.ts";
import type { PipConfig } from "./pip-core.js";
export function serverRuns(options: { chat?: string; config?: PipConfig | null; force?: boolean }): Promise<{ available: boolean }>;
export function streamReplyRemote(chat: Chat, turn: ChatTurn, options: Record<string, unknown>): Promise<unknown>;
