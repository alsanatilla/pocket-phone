import { memo, useCallback, useMemo, type KeyboardEvent, type MouseEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Circle, LoaderCircle, Minus, TriangleAlert } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { phaseLabel } from "../../../client/pip-activity.js";
import type { ChatTurn } from "../../data/chats.ts";
import { toastError } from "../../ui/toast/toast.ts";
import { OfferCard } from "./Offers.tsx";
import { Answer, Thinking } from "./stream/Answer.tsx";
import { Prose } from "./stream/Prose.tsx";
import { ledger, memoryOf, offersOf, planOf, sourcesOf } from "./reply.ts";
import { resume, retry, send } from "./runner.ts";
import { hrefFor } from "../../lib/classic.ts";
import type { Segment } from "../../../shared/pip-reply.js";
import { aboutCard } from "../../../shared/pocket-card-edit.js";

// One exchange: the question, then Pip's reply with its parts in reading order: what it looked up (listed open while
// the reply runs, folded to one line once it is done and there are more than three), its plan, its reasoning, the
// answer with its cards, sources, and what it offers.

const clock = (at: number) => new Date(Number(at) || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

/** A step's state as an icon: the ledger's text glyphs (□ △ ◌) read as missing characters. */
const STATE_ICON = { done: Check, running: LoaderCircle, awaiting: Circle, queued: Circle, failed: TriangleAlert, stopped: Minus } as const;
function StateIcon({ state }: { state: string }) {
  const Icon = STATE_ICON[state as keyof typeof STATE_ICON] ?? Circle;
  return <Icon aria-label={state} className={cn("inline size-3 shrink-0 align-[-2px]", state === "failed" ? "text-destructive" : state === "done" ? "text-dim" : "text-muted-foreground", state === "running" && "animate-spin")} />;
}

/** A fold is one word on a line; what it holds is plain text under it, with no rule beside it. */
function Fold({ title, open, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  return (
    <Collapsible defaultOpen={open} className="group/fold">
      {/* 44px to tap on a phone, the same small line to look at. */}
      <CollapsibleTrigger className="-my-1 flex min-h-11 items-center text-xs text-dim transition-colors hover:text-foreground sm:my-0 sm:min-h-0">
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1">{children}</CollapsibleContent>
    </Collapsible>
  );
}

type LedgerRow = ReturnType<typeof ledger>[number];
const secondsOf = (row: LedgerRow) => row.ended > row.started ? Math.max(1, Math.round((row.ended - row.started) / 1000)) : 0;
const durationOf = (row: LedgerRow) => secondsOf(row) ? secondsOf(row) + " s" : "";

/** The lookups as rows: a mark, what Pip looked at, and how long it took at the right. */
function Steps({ rows }: { rows: LedgerRow[] }) {
  return (
    <ul className="space-y-1">
      {rows.map(row => (
        <li key={row.id} className="flex items-baseline gap-2.5 text-xs">
          <StateIcon state={row.state} />
          <span className="min-w-0 flex-1">
            <span className="text-hi">{row.title}</span>
            {row.summary ? <span className="text-dim"> · {row.summary}</span> : null}
          </span>
          {durationOf(row) ? <span className="shrink-0 text-dim">{durationOf(row)}</span> : null}
        </li>
      ))}
    </ul>
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
  const remembered = memoryOf(shown);
  const cards = useCardButtons(chatId, locked);
  const ask = useCallback((prompt: string) => { if (!locked) send(chatId, prompt).catch(toastError); }, [chatId, locked]);
  const place = useMemo(() => ({ chatId, place: "chat" as const, locked }), [chatId, locked]);
  // A message about one card says so in a line of its own, not with the card's id.
  const asked = aboutCard(shown.text);
  const unfinished = !streaming && latest && ["stopped", "failed", "streaming"].includes(shown.status);
  const took = rows.reduce((sum, row) => sum + secondsOf(row), 0);
  const steps = rows.length > 1 ? rows.length + " steps" : "1 step";

  return (
    <article className={cn("space-y-3", Date.now() - shown.created < 4000 && "arrive")}>
      {/* What the person wrote is a prompt line; the reply under it is plain text. No bubble, no rule beside it. */}
      <div>
        <div className="flex gap-2 font-medium text-hi">
          <span aria-hidden="true" className="text-primary">›</span>
          <p className="min-w-0 whitespace-pre-wrap break-words">{asked.text}</p>
        </div>
        <p className="ml-[2ch] mt-0.5 text-[11px] text-dim">{clock(shown.created)}{asked.id ? " · about a card" : ""}</p>
      </div>

      <div data-reply className="space-y-3">
        {rows.length ? (
          !streaming && rows.length > 3
            ? <Fold title={took ? steps + " · " + took + " s" : steps}><Steps rows={rows} /></Fold>
            : <Steps rows={rows} />
        ) : null}

        {plan.length ? (
          <ol className="space-y-0.5 text-xs">
            {plan.map((step, index) => (
              <li key={index} className={step.status === "done" ? "text-muted-foreground line-through" : step.status === "in_progress" ? "text-hi" : ""}>
                {step.status === "done" ? "□" : step.status === "in_progress" ? "◌" : "◇"} {step.text}
              </li>
            ))}
          </ol>
        ) : null}

        {shown.reasoning ? <Fold title="reasoning"><Prose text={shown.reasoning} streaming={streaming && !shown.answer} className="text-xs text-muted-foreground" /></Fold> : null}

        {/* Classic cards' buttons answer through data attributes; the click is caught here. */}
        {shown.answer ? <div {...cards}><Answer text={shown.answer} blocks={blocks} streaming={streaming} onAsk={ask} at={place} /></div> : null}

        {streaming && !shown.answer && !offers.length ? <Thinking label={phaseLabel(shown.phase || "thinking")} /> : null}

        {/* What Pip took into its memory of the person with this reply: said, so nothing is remembered unseen. */}
        {!streaming && remembered.length ? (
          <ul className="space-y-0.5 text-xs text-dim">
            {remembered.map((change, index) => <li key={index}>{change.kind}: {change.text}</li>)}
            <li><Link to="/memory" className="text-primary underline-offset-2 hover:underline">memory</Link></li>
          </ul>
        ) : null}

        {sources.length && !streaming ? (
          <p className="text-[11px] text-dim">
            {sources.map((source, index) => (
              <span key={source.href}>{index ? " · " : ""}
                <a href={source.href.startsWith("/") ? hrefFor(source.href) : source.href} target={source.href.startsWith("/") ? undefined : "_blank"} rel="noopener noreferrer"
                  className="text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground">{source.title}</a>
              </span>
            ))}
          </p>
        ) : null}

        {offers.length ? <div className="space-y-2">{offers.map(offer => <OfferCard key={offer.row.id} offer={offer} chatId={chatId} turnId={shown.uid} locked={locked && !streaming} />)}</div> : null}

        {unfinished ? (
          <div className="space-y-1">
            <p className="text-sm text-destructive">{shown.error || "This reply did not finish."}</p>
            <div className="flex items-center gap-2 text-xs text-dim">
              <button type="button" disabled={locked} onClick={() => resume(chatId, shown.uid).catch(toastError)}
                className="flex min-h-11 items-center text-xs text-dim transition-colors hover:text-foreground disabled:opacity-50 sm:min-h-0">continue</button>
              <span aria-hidden="true">·</span>
              <button type="button" disabled={locked} onClick={() => retry(chatId, shown.uid).catch(toastError)}
                className="flex min-h-11 items-center text-xs text-dim transition-colors hover:text-foreground disabled:opacity-50 sm:min-h-0">start over</button>
            </div>
          </div>
        ) : !streaming && shown.error ? <p className="text-xs text-destructive">{shown.error}</p> : null}
      </div>
    </article>
  );
}
