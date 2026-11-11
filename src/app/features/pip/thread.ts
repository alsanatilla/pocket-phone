// The conversation on screen: one separate chat's turns, or home's segments joined oldest first, cut to the last
// `shown` turns so a long conversation opens at its end and the rest waits behind one button.

import type { Chat, ChatTurn } from "../../data/chats.ts";

export interface ThreadItem { turn: ChatTurn; chatId: string }

/** The turns of `chats` in the order given, keeping only the last `shown`, and how many are left out. */
export function threadOf(chats: Chat[], shown: number): { items: ThreadItem[]; earlier: number } {
  const all = chats.flatMap(chat => chat.turns.map(turn => ({ turn, chatId: chat.uid })));
  const count = Math.max(0, Math.min(all.length, Math.floor(shown)));
  return { items: all.slice(all.length - count), earlier: all.length - count };
}
