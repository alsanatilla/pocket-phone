// Types for the parts of pip-core.js the React client uses. Chat shapes live in src/app/data/chats.ts.
import type { Chat, ChatTurn } from "../app/data/chats.ts";

/** Which provider, endpoint and model a chat (or Pocket's default) uses. */
export interface PipConfig { provider: "anthropic" | "compatible"; model: string; baseUrl: string; maxTokens: number; thinking: boolean; webSearch: boolean }
export const DEFAULT_CONFIG: Readonly<PipConfig>;
/** Pocket's saved default; throws when the saved settings cannot be read. */
export function settings(storage?: Storage): PipConfig;
/** Validates and normalises a config; throws with a readable message when it is not usable. */
export function config(value?: Partial<PipConfig>): PipConfig;
export function saveSettings(value: PipConfig, storage?: Storage): void;

export class ChatStore {
  constructor(storage?: Storage);
  list(): Chat[];
  get(uid: string | null): Chat | null;
  create(): Chat;
  update(uid: string, edit: (chat: Chat) => void): Chat;
}

export interface ActiveReply { chatId: string; turnId: string; turn: Partial<ChatTurn> }
export interface RunnerEvent { type: "started" | "delta" | "finished" | "approval"; chatId: string; turn?: Partial<ChatTurn> }

export class ReplyRunner {
  constructor(store: ChatStore, options?: { title?: (() => Promise<void>) | null; onChange?: (event: RunnerEvent) => void });
  active: ActiveReply | null;
  send(uid: string, options: { text: string; context?: unknown[] }): Promise<unknown>;
  stop(): void;
}
