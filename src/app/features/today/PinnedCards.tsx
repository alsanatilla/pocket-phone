import { useCollection } from "../../data/bus.ts";
import { pinnedCards } from "../../data/cards.ts";
import { Card } from "../pip/stream/Card.tsx";
import { busy, send } from "../pip/runner.ts";
import { openPath } from "../../lib/classic.ts";
import { toastError } from "../../ui/toast/toast.ts";

// The cards pinned in Pip's chats, on top of Today. Each is the card in its chat, not a copy: when Pip changes it
// there, it changes here. Asking about one from here sends the message in its chat and opens it.

export function PinnedCards() {
  const cards = useCollection(["chats"], pinnedCards);
  if (!cards.length) return null;
  return (
    <section aria-label="Pinned cards" className="mb-6 space-y-4">
      {cards.map(card => {
        const ask = (prompt: string) => {
          if (busy()) { toastError(new Error("Pip is still writing a reply. Try again when it is done.")); return; }
          openPath("/pip?chat=" + encodeURIComponent(card.chat));
          send(card.chat, prompt).catch(toastError);
        };
        return (
          <Card key={card.chat + ":" + card.id} source={card.source} closed streaming={false} onAsk={ask}
            at={{ chatId: card.chat, place: "today", chatTitle: card.chatTitle }} />
        );
      })}
    </section>
  );
}
