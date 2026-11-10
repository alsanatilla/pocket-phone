// What the UI calls to work with the cards in chats: pin one so it also shows on Today, remove one, and list the
// pinned cards. The pin lives in the card itself, so every reader of the stored answer sees it.

import { chats, listChats } from "./chats.ts";
import type { Chat } from "./chats.ts";
import { cardsIn, dropCard, pinCard } from "../../shared/pocket-card-edit.js";

export interface PinnedCard {
  chat: string; chatTitle: string; turn: string; id: string; pinned: number; source: string;
}

/** Every pinned card in every chat that is not deleted, newest pin first. */
export function pinnedCards(): PinnedCard[] {
  const cards: PinnedCard[] = [];
  for (const chat of listChats()) {
    for (const turn of chat.turns) {
      // Most turns have no card; the mark is cheap to look for before parsing anything.
      if (!turn.answer.includes("/pinned")) continue;
      for (const card of cardsIn(turn.answer)) {
        if (!card.pinned) continue;
        cards.push({ chat: chat.uid, chatTitle: chat.title, turn: turn.uid, id: card.id, pinned: card.pinned, source: card.source });
      }
    }
  }
  return cards.sort((a, b) => b.pinned - a.pinned);
}

/** The first turn in a chat that holds the card and is not being written. */
function turnWith(chat: Chat, id: string) {
  return chat.turns.find(turn => turn.status !== "streaming" && cardsIn(turn.answer).some(card => card.id === id));
}

/** Changes one card's answer in one chats.update call; false when the chat, the card or a finished turn is missing. */
function changeCard(chatUid: string, id: string, change: (answer: string) => string | null): boolean {
  const before = chats.get(chatUid);
  if (!before || !turnWith(before, id)) return false;
  let changed = false;
  chats.update(chatUid, chat => {
    const turn = turnWith(chat, id);
    if (!turn) return;
    const answer = change(turn.answer);
    if (answer === null) return;
    turn.answer = answer;
    // The turn's own time must move too, or another device keeps its older copy in mergeObject.
    turn.updated = Math.max(Date.now(), (turn.updated ?? 0) + 1);
    changed = true;
  });
  return changed;
}

/** Pins or unpins the card `id` in the chat's turn that holds it; false when there is none to change. */
export function setCardPinned(chat: string, id: string, pinned: boolean): boolean {
  const at = pinned ? Date.now() : 0;
  return changeCard(chat, id, answer => pinCard(answer, id, at));
}

/** Removes the card `id` from the chat's turn that holds it, keeping the turn; false when there is none. */
export function removeCard(chat: string, id: string): boolean {
  return changeCard(chat, id, answer => dropCard(answer, id));
}
