import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { withCard } from "../../../../shared/pocket-card-edit.js";
import { removeCard, setCardPinned } from "../../../data/cards.ts";
import { confirm, prompt } from "../../../ui/dialog/dialog.ts";
import { toast, toastError } from "../../../ui/toast/toast.ts";
import { openPath } from "../../../lib/classic.ts";

// What the person can do with a drawn card: pin it to Today, have Pip change or refresh it, or take it out of the
// reply. A request to Pip names the card (withCard), so "make it 58" needs no explanation of which one.

export function CardMenu({ chatId, id, pinned, place, locked, onAsk }: {
  chatId: string; id: string; pinned: boolean; place: "chat" | "today"; locked?: boolean; onAsk: (prompt: string) => void;
}) {
  const guard = (run: () => unknown) => () => { Promise.resolve().then(run).catch(toastError); };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Card options"
          className="size-11 text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground sm:size-9"><MoreHorizontal /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 max-w-[calc(100vw-2rem)] [&_[role=menuitem]]:min-h-11 [&_[role=menuitem]]:px-3 sm:[&_[role=menuitem]]:min-h-9">
        <DropdownMenuItem onSelect={guard(() => {
          if (!setCardPinned(chatId, id, !pinned)) throw new Error("This card is no longer in the chat.");
          toast(pinned ? "Unpinned." : "Pinned to today.");
        })}>{pinned ? "unpin" : "pin to today"}</DropdownMenuItem>
        {place === "today" ? <DropdownMenuItem onSelect={guard(() => openPath("/pip?chat=" + encodeURIComponent(chatId)))}>open chat</DropdownMenuItem> : null}
        <DropdownMenuItem disabled={locked} onSelect={guard(async () => {
          const text = await prompt({ title: "Change this card", placeholder: "what should change?", maxLength: 2000 });
          if (text?.trim()) onAsk(withCard(text.trim(), id));
        })}>change…</DropdownMenuItem>
        <DropdownMenuItem disabled={locked} onSelect={guard(() => onAsk(withCard("Refresh this card with the current figures.", id)))}>refresh</DropdownMenuItem>
        {place === "chat" ? <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={guard(async () => {
            if (await confirm({ title: "Remove this card?", message: "The text around it stays.", confirmLabel: "remove", danger: true })) {
              if (!removeCard(chatId, id)) throw new Error("This card could not be removed. It may have changed; try again.");
            }
          })}>remove</DropdownMenuItem>
        </> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
