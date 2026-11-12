import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cardName, sourceUrl, withCard } from "../../../../shared/pocket-card-edit.js";
import { removeCard, setCardAlert, setCardPinned } from "../../../data/cards.ts";
import { keepCardCurrent, stopCardWatch } from "../../../data/card-watch.ts";
import { confirm, prompt } from "../../../ui/dialog/dialog.ts";
import { toast, toastError } from "../../../ui/toast/toast.ts";
import { openPath } from "../../../lib/classic.ts";

// What the person can do with a drawn card: pin it to Today, have Pip change or refresh it, or take it out of the
// reply. A request to Pip names the card (withCard), so "make it 58" needs no explanation of which one. A card that
// names a source is kept current by a watch of its own while it is pinned.

export function CardMenu({ chatId, id, pinned, place, locked, source, alert, onAsk }: {
  chatId: string; id: string; pinned: boolean; place: "chat" | "today"; locked?: boolean; source: string;
  alert?: { below?: number; above?: number }; onAsk: (prompt: string) => void;
}) {
  const guard = (run: () => unknown) => () => { Promise.resolve().then(run).catch(toastError); };
  const url = sourceUrl(source), name = cardName(source);
  const kept = (said: string) => (state: Awaited<ReturnType<typeof keepCardCurrent>>) =>
    toast(state === "scheduled" ? said
      : state === "signed-out" ? "Pinned. Sign in to let Pip keep it current."
      : state === "no-key" ? "Pinned. Add a key for Pip on its own to keep it current."
      : "Pinned to today.");
  const pin = async () => {
    const next = !pinned;
    if (!setCardPinned(chatId, id, next)) throw new Error("This card is no longer in the chat.");
    if (!next) { await stopCardWatch(chatId, id); toast("Unpinned."); return; }
    if (!url) { toast("Pinned to today."); return; }
    kept("Pinned. Pip keeps this card current every 6 hours.")(await keepCardCurrent({ chat: chatId, id, url, name, alert }));
  };
  // A threshold on the card's figure: the same watch, told to speak up when the number crosses it.
  const watch = async (direction: "below" | "above" | null) => {
    if (direction === null) {
      if (!setCardAlert(chatId, id, null)) throw new Error("This card is no longer in the chat.");
      if (url) kept("Alert removed.")(await keepCardCurrent({ chat: chatId, id, url, name }));
      else toast("Alert removed.");
      return;
    }
    const text = await prompt({ title: direction === "below" ? "Tell me when it drops below" : "Tell me when it rises above", placeholder: "a number, such as 850", maxLength: 24 });
    if (text === null) return;
    const value = Number(String(text).replace(/[\s,]/g, "").replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(value)) { toast("Write a number, such as 850."); return; }
    if (!setCardAlert(chatId, id, { [direction]: value })) throw new Error("This card is no longer in the chat.");
    if (!pinned) setCardPinned(chatId, id, true);
    const said = "Pinned. Pip tells you when it goes " + (direction === "below" ? "below " : "above ") + value + ".";
    if (url) kept(said)(await keepCardCurrent({ chat: chatId, id, url, name, alert: { [direction]: value } }));
    else toast(said);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Card options"
          className="min-h-11 shrink-0 text-xs text-dim hover:text-foreground data-[state=open]:text-foreground sm:min-h-0">more</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 max-w-[calc(100vw-2rem)] [&_[role=menuitem]]:min-h-11 [&_[role=menuitem]]:px-3 sm:[&_[role=menuitem]]:min-h-9">
        <DropdownMenuItem onSelect={guard(pin)}>{pinned ? "unpin" : "pin to today"}</DropdownMenuItem>
        {place === "today" ? <DropdownMenuItem onSelect={guard(() => openPath("/pip?chat=" + encodeURIComponent(chatId)))}>open chat</DropdownMenuItem> : null}
        <DropdownMenuItem disabled={locked} onSelect={guard(async () => {
          const text = await prompt({ title: "Change this card", placeholder: "what should change?", maxLength: 2000 });
          if (text?.trim()) onAsk(withCard(text.trim(), id));
        })}>change…</DropdownMenuItem>
        <DropdownMenuItem disabled={locked} onSelect={guard(() => onAsk(withCard("Refresh this card with the current figures.", id)))}>refresh</DropdownMenuItem>
        {url ? alert
          ? <DropdownMenuItem onSelect={guard(() => watch(null))}>stop telling me</DropdownMenuItem>
          : <>
              <DropdownMenuItem onSelect={guard(() => watch("below"))}>tell me when it drops below…</DropdownMenuItem>
              <DropdownMenuItem onSelect={guard(() => watch("above"))}>tell me when it rises above…</DropdownMenuItem>
            </>
          : null}
        {place === "chat" ? <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={guard(async () => {
            if (await confirm({ title: "Remove this card?", message: "The text around it stays.", confirmLabel: "remove", danger: true })) {
              if (!removeCard(chatId, id)) throw new Error("This card could not be removed. It may have changed; try again.");
              await stopCardWatch(chatId, id);
            }
          })}>remove</DropdownMenuItem>
        </> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
