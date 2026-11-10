import { activeAccount } from "../../client/workspace-storage.js";
import { deleteJob, loadJobs, saveJob, type JobDraft } from "./jobs.ts";

// A pinned card that names a source keeps itself current: a watch of its own reads that source every few hours,
// changes the card with update_card and says nothing when only the figures moved. The routine answers in the card's
// own chat, so the card stays the same card, not a copy.

/** How often a kept card reads its source; within Pip's active hours, so nobody is woken by a number. */
export const CARD_WATCH_EVERY = 360;

export interface CardWatch { chat: string; id: string; url: string; name?: string; alert?: { below?: number; above?: number } | null }

/** What keeps a pinned card current, as the routine is saved: a watch in the card's chat, every six hours. */
export function cardWatchDraft(card: CardWatch): JobDraft {
  const name = (card.name || "").trim();
  const below = card.alert?.below, above = card.alert?.above;
  const told = Number.isFinite(below) ? " when " + (name || "it") + " drops below " + below
    : Number.isFinite(above) ? " when " + (name || "it") + " rises above " + above : "";
  return {
    kind: "watch",
    title: (name ? "Keep " + name + " current" : "Keep a card current").slice(0, 80),
    prompt: "Keep the card [about card " + card.id + "] in this chat current from its source, " + card.url + ". "
      + "Read the source, then compare what it says with the card's figures. If only the figures moved, change that "
      + "card with update_card and then answer exactly SKIP. If the source cannot be read, or the card is no longer "
      + "in this chat or no longer pinned to today, answer exactly SKIP. Write a message only when the change is one "
      + "the person should know about."
      + (told ? " Tell the person in a message" + told + ", even when it is the only change; do not answer SKIP then." : ""),
    chat: card.chat,
    card: card.chat + "/" + card.id,
    every: CARD_WATCH_EVERY,
    days: [0, 1, 2, 3, 4, 5, 6],
    activeHours: { start: "07:00", end: "22:00" },
    delivery: "notify",
    enabled: true,
  };
}

/** Why a card is not kept current, when it is not: nobody to run the routine, or no key and schedule for it. */
export type KeptCurrent = "scheduled" | "signed-out" | "no-key" | "failed";

/** Starts the routine that keeps a card current, or resumes one already there; pinning stands whatever this says. */
export async function keepCardCurrent(card: CardWatch): Promise<KeptCurrent> {
  if (!activeAccount()) return "signed-out";
  try {
    const state = await loadJobs();
    if (!state.settings?.enabled || !state.hasKey) return "no-key";
    const key = card.chat + "/" + card.id;
    const existing = state.routines.find(job => job.card === key);
    if (existing) {
      // A new threshold or name replaces the routine's prompt; its runs and notes stay.
      await saveJob({ ...cardWatchDraft(card), id: existing.id, enabled: true });
      return "scheduled";
    }
    await saveJob(cardWatchDraft(card));
    return "scheduled";
  } catch {
    return "failed";
  }
}

/** Stops keeping a card current when it is unpinned or removed; another device may already have removed it. */
export async function stopCardWatch(chat: string, id: string): Promise<void> {
  if (!activeAccount()) return;
  const key = chat + "/" + id;
  try {
    const state = await loadJobs();
    await Promise.all(state.routines.filter(job => job.card === key).map(job => deleteJob(job.id)));
  } catch {
    // The card is unpinned either way; a routine that stays answers SKIP once the card is not pinned.
  }
}
