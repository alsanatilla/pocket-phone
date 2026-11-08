import { useSyncExternalStore } from "react";
import { ReplyRunner, type RunnerEvent } from "../../../client/pip-core.js";
import { chats, type ChatTurn } from "../../data/chats.ts";

// One reply runner for the whole app: a reply keeps streaming while you look at Today, and coming back shows it
// where it is. Views read the live turn through useLiveReply(); the runner is created on the first send.

export interface LiveReply { chatId: string; turnId: string; turn: Partial<ChatTurn> }

let runner: ReplyRunner | null = null;
let live: LiveReply | null = null;
let lastPaint = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

function getRunner(): ReplyRunner {
  runner ??= new ReplyRunner(chats, {
    title: async () => {},
    onChange: (event: RunnerEvent) => {
      const active = runner?.active;
      live = active ? { chatId: active.chatId, turnId: active.turnId, turn: event.turn ?? live?.turn ?? active.turn } : null;
      // Deltas arrive many times a second; a repaint every ~90 ms keeps the caret moving without thrashing.
      const now = Date.now();
      if (event.type === "delta" && now - lastPaint < 90) return;
      lastPaint = now;
      emit();
    },
  });
  return runner;
}

/** Sends `text` in `chatId`. Rejects with the runner's own message (no key, a reply already running, …). */
export async function send(chatId: string, text: string): Promise<void> {
  await getRunner().send(chatId, { text, context: chats.get(chatId)?.context ?? [] });
}

/** Aborts the request itself; the runner marks the turn stopped and saves what arrived. */
export function stop(): void {
  runner?.stop();
  live = null;
  emit();
}

export const useLiveReply = (): LiveReply | null => useSyncExternalStore(
  listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  () => live, () => null,
);
