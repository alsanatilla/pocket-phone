// Types for the parts of pip-core.js the React client uses. Chat shapes live in src/app/data/chats.ts.
import type { Chat, ChatTurn } from "../app/data/chats.ts";

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
