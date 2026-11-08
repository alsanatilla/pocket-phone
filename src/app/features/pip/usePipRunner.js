import { useEffect, useRef, useState } from "react";
import { ChatStore, ReplyRunner } from "../../../client/pip-core.js";

// One ChatStore and one ReplyRunner for the whole app: a reply keeps streaming while you look at Today,
// and coming back shows it where it is. React state holds only a snapshot of the live turn.

export const chats = new ChatStore();

let runner = null;
const watchers = new Set();
let live = null; // { chatId, turnId, turn } while a reply streams
let lastPaint = 0;

function getRunner() {
  runner ??= new ReplyRunner(chats, {
    title: async () => {},
    onChange: event => {
      const active = runner.active;
      live = active ? { chatId: active.chatId, turnId: active.turnId, turn: event.turn || live?.turn || active.turn } : null;
      // Deltas arrive many times a second; a repaint every ~90 ms keeps the caret moving without thrashing.
      const now = Date.now();
      if (event.type === "delta" && now - lastPaint < 90) return;
      lastPaint = now;
      watchers.forEach(fn => fn(live));
    },
  });
  return runner;
}

/** `{ live, send, stop }` for the chat view. `send` rejects with the runner's own message (no key, busy, …). */
export function usePipRunner() {
  const [snapshot, setSnapshot] = useState(live);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const watch = value => { if (mounted.current) setSnapshot(value); };
    watchers.add(watch);
    setSnapshot(live);
    return () => { mounted.current = false; watchers.delete(watch); };
  }, []);

  return {
    live: snapshot,
    send: (chatId, text) => getRunner().send(chatId, { text, context: chats.get(chatId)?.context ?? [] }),
    // Aborts the request itself; the runner marks the turn stopped and saves what arrived.
    stop: () => { runner?.stop(); live = null; watchers.forEach(fn => fn(null)); },
  };
}
