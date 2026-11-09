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
  remove(uid: string): void;
  recordApplied(uid: string, turnId: string, eventId: string, href: string, result?: unknown): Chat;
}

export interface ActiveReply { chatId: string; turnId: string; turn: Partial<ChatTurn> }
export interface RunnerEvent { type: "started" | "delta" | "finished" | "approval"; chatId: string; turn?: Partial<ChatTurn> }

export interface RunnerOptions {
  key?: (value: PipConfig, chat: Chat) => unknown;
  stream?: (chat: Chat, turn: ChatTurn, options: Record<string, unknown>) => Promise<unknown>;
  remote?: { available: (chat: Chat) => Promise<boolean>; stream: (chat: Chat, turn: ChatTurn, options: Record<string, unknown>) => Promise<unknown>;
    /** The same follower without sending: shows a reply already running in the chat. */
    attach?: (chat: Chat, turn: null, options: Record<string, unknown>) => Promise<unknown> } | null;
  title?: ((value: PipConfig, credential: unknown, request: string, answer: string) => Promise<string>) | null;
  onChange?: (event: RunnerEvent) => void;
}
export interface Decision { approved: boolean; input?: unknown }

export class ReplyRunner {
  constructor(store: ChatStore, options?: RunnerOptions);
  active: ActiveReply | null;
  /** A new message (text), or retry/resume (continue) of the latest unfinished turn. */
  send(uid: string, options: { text?: string; context?: unknown[]; retry?: string | null; resume?: string | null }): Promise<unknown>;
  stop(): void;
  /** Shows a reply already running on the server in this chat (sent from another tab or device). Whether there was one. */
  attach(uid: string): Promise<boolean>;
  /** Whether a write still waits for the user, and the decision already taken. */
  approvalOf(turnId: string, eventId: string): { decision?: Decision } | null;
  decide(turnId: string, eventId: string, decision: Decision): void;
}
export function streamReply(chat: Chat, turn: ChatTurn, options?: Record<string, unknown>): Promise<unknown>;
