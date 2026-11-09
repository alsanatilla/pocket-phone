import { useSyncExternalStore } from "react";
import { ReplyRunner, streamReply, type Decision, type RunnerEvent } from "../../../client/pip-core.js";
import { resolve } from "../../../client/pip-credentials.js";
import { streamReplyRemote } from "../../../client/pip-remote.js";
import { connected } from "../../../client/cloud.js";
import * as liveSocket from "../../../client/live.js";
import { suggestTitle } from "../../../client/pip-title.js";
import { trainingChatRoutine, trainingReply } from "../../../client/pip-training-chat.js";
import { chats, type ChatTurn } from "../../data/chats.ts";

// One reply runner for the whole app, wired like the classic chat's:
// - a signed-in chat always runs on Pocket's server (it survives a closed tab); a guest's runs in this tab;
// - a COROS training routine's chat answers through its own path with the account's key;
// - a fresh chat names itself after its first answer;
// - writes Pip asks for wait for the person's decision (approvals).
// Views read the live turn and the approval state through useLiveReply().

export interface LiveReply { chatId: string; turnId: string; turn: Partial<ChatTurn>; version: number }

let live: LiveReply | null = null;
let version = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

// Deltas arrive many times a second, in bursts. They are coalesced to one paint per animation frame: the screen
// shows every frame's newest text, never more work than the display can show, and nothing waits on a timer.
let frame = 0;
const schedule = () => {
  if (frame) return;
  frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(flush) : (setTimeout(flush, 16) as unknown as number);
};
function flush() { frame = 0; emit(); }

const runner = new ReplyRunner(chats, {
  key: (value, chat) => trainingChatRoutine(chat.uid) ? "account-key" : resolve(value),
  remote: {
    // One rule, no lookup first: a signed-in chat runs on Pocket's server. A missing key is the server's clear answer.
    available: chat => Promise.resolve(!trainingChatRoutine(chat.uid) && connected()),
    stream: streamReplyRemote,
    attach: (chat, _turn, options) => streamReplyRemote(chat, null, options),
  },
  stream: (chat, turn, options) => trainingChatRoutine(chat.uid) ? trainingReply(chat, turn, options) : streamReply(chat, turn, options),
  title: suggestTitle,
  onChange: (event: RunnerEvent) => {
    const active = runner.active;
    live = active ? { chatId: active.chatId, turnId: active.turnId, turn: event.turn ?? live?.turn ?? active.turn, version: ++version } : null;
    // A delta waits for the next frame; the start, approvals and the end of a reply paint at once.
    if (event.type === "delta") schedule();
    else { if (frame) { (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout)(frame); frame = 0; } emit(); }
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

/**
 * While a chat is open: show a reply that runs in it without this tab having sent it (another tab or device asked,
 * or this tab was reloaded mid-reply). Looks once now, then whenever the account's socket says a reply started or
 * grew in this chat. Returns the function that stops watching.
 */
export function watchChat(chatId: string): () => void {
  if (!connected()) return () => {};
  const look = () => { if (!runner.active) void runner.attach(chatId).catch(() => {}); };
  look();
  return liveSocket.on(message => {
    if (message.type === "hello") look();
    if (message.type === "event" && message.event === "run" && message.data.chat === chatId && ["queued", "started", "progress", "continued"].includes(message.data.kind)) look();
  });
}

export const busy = (): boolean => Boolean(runner.active);
export const approvalOf = (turnId: string, rowId: string) => runner.approvalOf(turnId, rowId);
export function decide(turnId: string, rowId: string, decision: Decision): void { runner.decide(turnId, rowId, decision); }

export const useLiveReply = (): LiveReply | null => useSyncExternalStore(
  listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  () => live, () => null,
);
