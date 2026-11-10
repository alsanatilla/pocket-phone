import { memo, useCallback, useMemo, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { Check, ChevronRight, Circle, LoaderCircle, Minus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { elapsed, phaseLabel } from "../../../client/pip-activity.js";
import type { ChatTurn } from "../../data/chats.ts";
import { toastError } from "../../ui/toast/toast.ts";
import { OfferCard } from "./Offers.tsx";
import { Answer, Thinking } from "./stream/Answer.tsx";
import { Prose } from "./stream/Prose.tsx";
import { ledger, ledgerTitle, offersOf, planOf, sourcesOf } from "./reply.ts";
import { resume, retry, send } from "./runner.ts";
import { hrefFor } from "../../lib/classic.ts";
import type { Segment } from "../../../shared/pip-reply.js";
import { aboutCard } from "../../../shared/pocket-card-edit.js";

// One exchange: the question, then Pip's reply with its parts in reading order: what it looked up (folded to one
// line once the reply is done), its plan, its reasoning, the answer with its cards, sources, and what it offers.

const clock = (at: number) => new Date(Number(at) || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

/** A step's state as an icon: the ledger's text glyphs (□ △ ◌) read as missing characters. */
const STATE_ICON = { done: Check, running: LoaderCircle, awaiting: Circle, queued: Circle, failed: TriangleAlert, stopped: Minus } as const;
function StateIcon({ state }: { state: string }) {
  const Icon = STATE_ICON[state as keyof typeof STATE_ICON] ?? Circle;
  return <Icon aria-label={state} className={cn("inline size-3 shrink-0 align-[-2px]", state === "failed" ? "text-destructive" : state === "done" ? "text-movement" : "text-muted-foreground", state === "running" && "animate-spin")} />;
}

function Fold({ title, open, children, tone = "text-muted-foreground" }: { title: string; open?: boolean; children: React.ReactNode; tone?: string }) {
  return (
    <Collapsible defaultOpen={open} className="group/fold">
      {/* 44px to tap on a phone, the same small line to look at. */}
      <CollapsibleTrigger className={cn("-my-3 flex min-h-11 items-center gap-1.5 text-xs hover:text-foreground sm:my-0 sm:min-h-0", tone)}>
        <ChevronRight className="size-3.5 transition-transform duration-150 ease-out group-data-[state=open]/fold:rotate-90" />{title.replace(/^[□△−◇◌◈]\s*/, "")}
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

interface TurnProps { turn: ChatTurn; live: Partial<ChatTurn> | null; blocks?: Segment[]; chatId: string; latest: boolean; locked: boolean }

/**
 * Re-renders only when this exchange changed: its saved version (turns carry `updated`), its live copy while it
 * streams, or whether it is the latest or locked. Every other exchange stays put while one reply streams.
 */
export const Turn = memo(TurnView, (before, after) =>
  before.live === after.live && before.blocks === after.blocks && before.chatId === after.chatId && before.latest === after.latest && before.locked === after.locked
  && sameTurn(before.turn, after.turn));

/** The store re-parses chats on every read, so objects are always new; the store stamps a turn's content change. */
function sameTurn(a: ChatTurn & { updated?: number }, b: ChatTurn & { updated?: number }): boolean {
  if (a.uid !== b.uid) return false;
  if (a.updated !== undefined && b.updated !== undefined) return a.updated === b.updated;
  return a.status === b.status && a.answer === b.answer && JSON.stringify(a.activity) === JSON.stringify(b.activity);
}

function TurnView({ turn, live, blocks, chatId, latest, locked }: TurnProps) {
  const shown: ChatTurn = live ? { ...turn, ...live } as ChatTurn : turn;
  const streaming = Boolean(live);
  const rows = ledger(shown, streaming);
  const plan = planOf(rows), offers = offersOf(rows), sources = sourcesOf(shown, rows);
  const cards = useCardButtons(chatId, locked);
  const ask = useCallback((prompt: string) => { if (!locked) send(chatId, prompt).catch(toastError); }, [chatId, locked]);
  const place = useMemo(() => ({ chatId, place: "chat" as const, locked }), [chatId, locked]);
  // A message about one card says so in a line of its own, not with the card's id.
  const asked = aboutCard(shown.text);
  const unfinished = !streaming && latest && ["stopped", "failed", "streaming"].includes(shown.status);
  const wasOpen = useRef(rows.length <= 4);

  return (
    <article className={cn("space-y-3", Date.now() - shown.created < 4000 && "arrive")}>
      <div className="ml-auto w-fit max-w-[85%] rounded-lg rounded-br-sm bg-secondary px-3.5 py-2">
        <p className="whitespace-pre-wrap text-sm">{asked.text}</p>
        {asked.id ? <p className="mt-1 text-[11px] text-dim">about a card</p> : null}
        <p className="mt-1 text-right text-[10px] text-dim">{clock(shown.created)}</p>
      </div>

      <div className="space-y-2.5 border-l-2 border-primary/60 pl-3.5">
        {rows.length ? (
          <Fold title={ledgerTitle(rows)} open={streaming || wasOpen.current}>
            <ul className="space-y-1">
              {rows.map(row => (
                <li key={row.id} className="text-xs">
                  <StateIcon state={row.state} /> {row.title}
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

        {shown.reasoning ? <Fold title="reasoning"><Prose text={shown.reasoning} streaming={streaming && !shown.answer} className="text-xs text-muted-foreground" /></Fold> : null}

        {/* Classic cards' buttons answer through data attributes; the click is caught here. */}
        {shown.answer ? <div {...cards}><Answer text={shown.answer} blocks={blocks} streaming={streaming} onAsk={ask} at={place} /></div> : null}

        {streaming && !shown.answer ? <Thinking label={phaseLabel(shown.phase || "thinking")} /> : null}

        {sources.length && !streaming ? (
          <div className="flex flex-wrap gap-1.5">
            {sources.map(source => (
              <a key={source.href} href={source.href.startsWith("/") ? hrefFor(source.href) : source.href} target={source.href.startsWith("/") ? undefined : "_blank"} rel="noopener noreferrer"
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
