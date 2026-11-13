import { useSyncExternalStore } from "react";
import { ReplyRunner, streamReply, type Decision, type RunnerEvent } from "../../../client/pip-core.js";
import { resolve } from "../../../client/pip-credentials.js";
import { changeQueue, chatQueue, queueReply, streamReplyRemote, type ChatQueue } from "../../../client/pip-remote.js";
import { connected } from "../../../client/cloud.js";
import * as liveSocket from "../../../client/live.js";
import { suggestTitle } from "../../../client/pip-title.js";
import { trainingChatRoutine, trainingReply } from "../../../client/pip-training-chat.js";
import { chats, type ChatTurn } from "../../data/chats.ts";
import type { Segment } from "../../../shared/pip-reply.js";

// One reply runner for the whole app, wired like the classic chat's:
// - a signed-in chat always runs on Pocket's server (it survives a closed tab); a guest's runs in this tab;
// - a COROS training routine's chat answers through its own path with the account's key;
// - a fresh chat names itself after its first answer;
// - writes Pip asks for wait for the person's decision (approvals);
// - a message sent while a reply runs waits its turn on the server (queueSend), shown to every device (useQueue).
// Views read the live turn and the approval state through useLiveReply().

/** `blocks`: the reply already cut into prose and cards by the server, while it streams from there. */
export interface LiveReply { chatId: string; turnId: string; turn: Partial<ChatTurn>; blocks?: Segment[]; version: number }

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
    const blocks = event.type === "delta" ? event.blocks : live?.turnId === active?.turnId ? live?.blocks : undefined;
    live = active ? { chatId: active.chatId, turnId: active.turnId, turn: event.turn ?? live?.turn ?? active.turn, ...(blocks ? { blocks } : {}), version: ++version } : null;
    // A delta waits for the next frame; the start, approvals and the end of a reply paint at once.
    if (event.type === "delta") schedule();
    else { if (frame) { (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout)(frame); frame = 0; } emit(); }
    // The reply this tab showed ended, after the end is drawn: the chat's next message may have started meanwhile.
    if (event.type === "finished") setTimeout(() => afterReply?.(), 0);
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
  // Every step of any run may change this chat's queue (a home message can run in another segment): read it again,
  // once for a burst of steps.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reread = () => { clearTimeout(timer); timer = setTimeout(() => void refreshQueue(chatId), 100); };
  const again = () => { look(); reread(); };
  // Only a chat with a message waiting can have a next reply to show; the queue read redraws the page either way.
  afterReply = () => { if (queue?.chatId === chatId && queue.queue.some(item => item.state === "waiting")) look(); reread(); };
  // The queue is read once the account's socket is up (now, or at its hello): it is what tells this tab of changes.
  look(); if (liveSocket.connected()) reread();
  const off = liveSocket.on(message => {
    if (message.type === "hello") again();
    if (message.type === "event" && message.event === "run" && message.data.chat === chatId && ["queued", "started", "delta", "continued"].includes(message.data.kind)) look();
    if (message.type === "event" && message.event === "run" && message.data.kind !== "delta") reread();
  });
  const mine = afterReply;
  return () => { off(); clearTimeout(timer); if (afterReply === mine) afterReply = null; };
}
/** What the chat on screen does when the reply this tab showed has ended. */
let afterReply: (() => void) | null = null;

// The queue of the chat on screen: messages sent while Pip replies, kept on the server and the same on every device
// (docs/pip-message-flow.md). A guest's chat, or one that answers in this tab, has none.
const NO_QUEUE: ChatQueue = { queue: [], active: "" };
let queue: (ChatQueue & { chatId: string }) | null = null;
let asked = 0;
const queueListeners = new Set<() => void>();
const setQueue = (chatId: string, next: ChatQueue) => { queue = { chatId, queue: next.queue ?? [], active: next.active ?? "" }; queueListeners.forEach(listener => listener()); };
async function refreshQueue(chatId: string): Promise<void> {
  if (!canQueue(chatId)) return;
  const ask = ++asked;
  // A failed read keeps what is shown; the next step of a run reads it again.
  const next = await chatQueue(chatId).catch(() => null);
  if (next && ask === asked) setQueue(chatId, next);
}

/** Whether a message sent while a reply runs in this chat can wait its turn: a signed-in chat that runs on the server. */
export const canQueue = (chatId: string): boolean => connected() && !trainingChatRoutine(chatId);
/** Sends `text` to wait its turn behind the reply running in `chatId`, with the chat's sources. */
export async function queueSend(chatId: string, text: string): Promise<void> {
  const chat = chats.get(chatId);
  if (!chat) throw new Error("This chat was removed.");
  await queueReply(chat, { text, context: chat.context ?? [] }).catch(error => { throw plain(error); });
  if (chat.context?.length) chats.update(chatId, current => { current.context = []; });
  await refreshQueue(chatId);
}
/** Takes back a message that has not started. */
export const withdraw = (chatId: string, runId: string): Promise<void> => changeQueue("withdraw", { runId }).then(next => setQueue(chatId, next), error => { throw plain(error); });
/** Lets the messages paused by a stop run again, in order. */
export const resumeQueue = (chatId: string): Promise<void> => changeQueue("resume", { chat: chatId }).then(next => setQueue(chatId, next), error => { throw plain(error); });
/** Takes back every message paused by a stop. */
export const clearQueue = (chatId: string): Promise<void> => changeQueue("clear", { chat: chatId }).then(next => setQueue(chatId, next), error => { throw plain(error); });
/** The queue of `chatId` (for a home segment: the one big chat's), as the server last said. */
export const useQueue = (chatId: string | null | undefined): ChatQueue => useSyncExternalStore(
  listener => { queueListeners.add(listener); return () => { queueListeners.delete(listener); }; },
  () => (queue && chatId && queue.chatId === chatId ? queue : NO_QUEUE), () => NO_QUEUE,
);

export const busy = (): boolean => Boolean(runner.active);
export const approvalOf = (turnId: string, rowId: string) => runner.approvalOf(turnId, rowId);
export function decide(turnId: string, rowId: string, decision: Decision): void { runner.decide(turnId, rowId, decision); }

export const useLiveReply = (): LiveReply | null => useSyncExternalStore(
  listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  () => live, () => null,
);
