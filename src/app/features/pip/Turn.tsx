import { useRef, type KeyboardEvent, type MouseEvent } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { elapsed, mark, phaseLabel } from "../../../client/pip-activity.js";
import { hydrateCards, releaseCards } from "../../../client/pip-cards.jsx";
import { hydrateSurfaceCards, releaseSurfaceCards } from "../../surface/cards.tsx";
import type { ChatTurn } from "../../data/chats.ts";
import { Markdown } from "../../ui/Markdown.tsx";
import { toastError } from "../../ui/toast/toast.ts";
import { OfferCard } from "./Offers.tsx";
import { ledger, ledgerTitle, offersOf, planOf, sourcesOf } from "./reply.ts";
import { resume, retry, send } from "./runner.ts";

// One exchange: the question, then Pip's reply with its parts in reading order: what it looked up (folded to one
// line once the reply is done), its plan, its reasoning, the answer with its cards, sources, and what it offers.

const clock = (at: number) => new Date(Number(at) || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

function Fold({ title, open, children, tone = "text-muted-foreground" }: { title: string; open?: boolean; children: React.ReactNode; tone?: string }) {
  return (
    <Collapsible defaultOpen={open} className="group/fold">
      <CollapsibleTrigger className={cn("flex items-center gap-1.5 text-xs hover:text-foreground", tone)}>
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]/fold:rotate-90" />{title}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 border-l pl-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** A card's button is a message: the value it carries becomes the next thing sent to Pip. */
function useCardButtons(chatId: string, locked: boolean) {
  const act = (target: EventTarget) => {
    const button = (target as HTMLElement).closest?.("[data-pocket-action]") as HTMLElement | null;
    if (!button) return false;
    const value = String(button.dataset.pocketValue || button.dataset.pocketAction || "").trim();
    if (value && !locked) send(chatId, value).catch(toastError);
    return true;
  };
  return {
    onClick: (event: MouseEvent) => { if (act(event.target)) event.preventDefault(); },
    onKeyDown: (event: KeyboardEvent) => { if ((event.key === "Enter" || event.key === " ") && act(event.target)) event.preventDefault(); },
  };
}

export function Turn({ turn, live, chatId, latest, locked }: { turn: ChatTurn; live: Partial<ChatTurn> | null; chatId: string; latest: boolean; locked: boolean }) {
  const shown: ChatTurn = live ? { ...turn, ...live } as ChatTurn : turn;
  const streaming = Boolean(live);
  const rows = ledger(shown, streaming);
  const plan = planOf(rows), offers = offersOf(rows), sources = sourcesOf(shown, rows);
  const cards = useCardButtons(chatId, locked);
  const unfinished = !streaming && latest && ["stopped", "failed", "streaming"].includes(shown.status);
  const wasOpen = useRef(rows.length <= 4);

  return (
    <article className="space-y-3">
      <div className="ml-auto w-fit max-w-[85%] rounded-lg rounded-br-sm bg-secondary px-3.5 py-2">
        <p className="whitespace-pre-wrap text-sm">{shown.text}</p>
        <p className="mt-1 text-right text-[10px] text-dim">{clock(shown.created)}</p>
      </div>

      <div className="space-y-2.5 border-l-2 border-primary/60 pl-3.5">
        {rows.length ? (
          <Fold title={ledgerTitle(rows)} open={streaming || wasOpen.current}>
            <ul className="space-y-1">
              {rows.map(row => (
                <li key={row.id} className="text-xs">
                  <span className="text-muted-foreground">{mark(row.state)} </span>{row.title}
                  {row.summary ? <span className="text-muted-foreground"> · {row.summary}</span> : null}
                  {elapsed(row) ? <span className="text-dim"> · {elapsed(row)}</span> : null}
                </li>
              ))}
            </ul>
          </Fold>
        ) : null}

        {plan.length ? (
          <ol className="space-y-0.5 text-xs">
            {plan.map((step, index) => (
              <li key={index} className={step.status === "done" ? "text-muted-foreground line-through" : step.status === "in_progress" ? "text-primary" : ""}>
                {step.status === "done" ? "□" : step.status === "in_progress" ? "◌" : "◇"} {step.text}
              </li>
            ))}
          </ol>
        ) : null}

        {shown.reasoning ? <Fold title="reasoning"><Markdown text={shown.reasoning} options={{ streaming }} className="prose text-xs text-muted-foreground" /></Fold> : null}

        {shown.answer ? (
          <div {...cards}>
            <Markdown text={shown.answer} className="prose text-[15px]" options={{
              streaming,
              onBeforeRender: node => { releaseSurfaceCards(node); releaseCards(node); },
              // New-catalog cards first; what is left is a card from before, drawn the classic way.
              onRender: node => { hydrateSurfaceCards(node, { onAsk: prompt => { if (!locked) send(chatId, prompt).catch(toastError); } }); hydrateCards(node); },
            }} />
          </div>
        ) : null}

        {streaming ? <p className="animate-pulse text-xs text-primary" role="status">{phaseLabel(shown.phase || "thinking")}</p> : null}

        {sources.length && !streaming ? (
          <div className="flex flex-wrap gap-1.5">
            {sources.map(source => (
              <a key={source.href} href={source.href.startsWith("/") ? "/#" + source.href : source.href} target={source.href.startsWith("/") ? undefined : "_blank"} rel="noopener noreferrer"
                className="max-w-full truncate rounded-sm border px-2 py-0.5 text-[11px] text-muted-foreground no-underline hover:border-primary hover:text-foreground">{source.title}</a>
            ))}
          </div>
        ) : null}

        {offers.length ? <div className="space-y-2">{offers.map(offer => <OfferCard key={offer.row.id} offer={offer} chatId={chatId} turnId={shown.uid} locked={locked && !streaming} />)}</div> : null}

        {unfinished ? (
          <div className="space-y-2 rounded-md border border-dashed p-3">
            <p className="text-sm text-muted-foreground">{shown.error || "This reply did not finish."}</p>
            <div className="flex gap-2">
              <Button size="sm" disabled={locked} onClick={() => resume(chatId, shown.uid).catch(toastError)}>continue</Button>
              <Button size="sm" variant="outline" disabled={locked} onClick={() => retry(chatId, shown.uid).catch(toastError)}>start over</Button>
            </div>
          </div>
        ) : !streaming && shown.error ? <p className="text-xs text-muted-foreground">{shown.error}</p> : null}
      </div>
    </article>
  );
}
