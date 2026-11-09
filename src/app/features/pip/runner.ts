import { useSyncExternalStore } from "react";
import { ReplyRunner, streamReply, type Decision, type RunnerEvent } from "../../../client/pip-core.js";
import { resolve } from "../../../client/pip-credentials.js";
import { serverRuns, streamReplyRemote } from "../../../client/pip-remote.js";
import { suggestTitle } from "../../../client/pip-title.js";
import { trainingChatRoutine, trainingReply } from "../../../client/pip-training-chat.js";
import { chats, type ChatTurn } from "../../data/chats.ts";

// One reply runner for the whole app, wired like the classic chat's:
// - a reply runs on Pocket's server when the account offers it (it then survives a closed tab), else here;
// - a COROS training routine's chat answers through its own path with the account's key;
// - a fresh chat names itself after its first answer;
// - writes Pip asks for wait for the person's decision (approvals).
// Views read the live turn and the approval state through useLiveReply().

export interface LiveReply { chatId: string; turnId: string; turn: Partial<ChatTurn>; version: number }

let live: LiveReply | null = null;
let version = 0;
let lastPaint = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

const runner = new ReplyRunner(chats, {
  key: (value, chat) => trainingChatRoutine(chat.uid) ? "account-key" : resolve(value),
  remote: {
    available: chat => trainingChatRoutine(chat.uid) ? Promise.resolve(false) : serverRuns({ chat: chat.uid, config: chat.config }).then(state => state.available),
    stream: streamReplyRemote,
  },
  stream: (chat, turn, options) => trainingChatRoutine(chat.uid) ? trainingReply(chat, turn, options) : streamReply(chat, turn, options),
  title: suggestTitle,
  onChange: (event: RunnerEvent) => {
    const active = runner.active;
    live = active ? { chatId: active.chatId, turnId: active.turnId, turn: event.turn ?? live?.turn ?? active.turn, version: ++version } : null;
    // Deltas arrive many times a second; a repaint every ~90 ms keeps the caret moving without thrashing.
    // Approvals and the end of a reply always repaint.
    const now = Date.now();
    if (event.type === "delta" && now - lastPaint < 90) return;
    lastPaint = now;
    emit();
  },
});

/** The engine's messages still name the classic screens; say where things are in this client. */
const plain = (error: unknown): Error => {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(message.replace(/Add an API key for this chat in API settings\./, "Connect a model in settings first.").replace(/\bAPI settings\b/g, "settings"));
};
const run = (work: Promise<unknown>): Promise<void> => work.then(() => undefined, error => { throw plain(error); });

/** Sends `text` in `chatId` with the chat's sources. Rejects with a readable message (no model, busy, …). */
export const send = (chatId: string, text: string): Promise<void> => run(runner.send(chatId, { text, context: chats.get(chatId)?.context ?? [] }));
/** Restarts the latest unfinished reply from scratch. */
export const retry = (chatId: string, turnId: string): Promise<void> => run(runner.send(chatId, { retry: turnId }));
/** Continues the latest unfinished reply, keeping the lookups it completed. */
export const resume = (chatId: string, turnId: string): Promise<void> => run(runner.send(chatId, { resume: turnId }));

/** Aborts the request itself; the runner marks the turn stopped and saves what arrived. */
export function stop(): void { runner.stop(); live = null; emit(); }

export const busy = (): boolean => Boolean(runner.active);
export const approvalOf = (turnId: string, rowId: string) => runner.approvalOf(turnId, rowId);
export function decide(turnId: string, rowId: string, decision: Decision): void { runner.decide(turnId, rowId, decision); }

export const useLiveReply = (): LiveReply | null => useSyncExternalStore(
  listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  () => live, () => null,
);
