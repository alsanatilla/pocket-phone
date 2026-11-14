import { Fragment, memo, useCallback, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Circle, LoaderCircle, Minus, TriangleAlert } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Keys, Row } from "../../ui/kit.tsx";
import { phaseLabel } from "../../../client/pip-activity.js";
import { readChat, type ChatTurn } from "../../data/chats.ts";
import { explain } from "./account.ts";
import { toastError } from "../../ui/toast/toast.ts";
import { OfferCard } from "./Offers.tsx";
import { AssignmentStatus } from "./AssignmentStatus.tsx";
import { ASSIGNMENT_OWNER, reportTitle } from "../../data/today.ts";
import { Answer, Thinking } from "./stream/Answer.tsx";
import { Prose } from "./stream/Prose.tsx";
import { assignmentsOf, jobsOf, ledger, memoryOf, offersOf, planOf, sourcesOf } from "./reply.ts";
import { resume, retry, send } from "./runner.ts";
import { hrefFor } from "../../lib/classic.ts";
import type { Segment } from "../../../shared/pip-reply.js";
import { aboutCard } from "../../../shared/pocket-card-edit.js";
import { answerPieces, takenSteers, type Steer } from "../../../shared/pip-steer.js";

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

/** A fold is one key on a line; what it holds is plain text under it, with no rule beside it. */
function Fold({ title, open, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  return (
    <Collapsible defaultOpen={open} className="group/fold">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" className="text-dim">{title}</Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Why a reply ended, in this app's words: a refusal the server wrote into the turn (a message that waited its turn,
 * another device's reply) reads the same as one this tab was told. "settings" in the sentence is where it is fixed.
 */
function Problem({ error, chatId, className }: { error: string; chatId: string; className: string }) {
  const text = explain(error, readChat(chatId)?.config);
  const at = text.lastIndexOf(" in settings");
  if (at < 0) return <p className={className}>{text}</p>;
  return (
    <p className={className}>
      {text.slice(0, at)} in <Link to="/settings" className="text-primary underline underline-offset-2">settings</Link>{text.slice(at + " in settings".length)}
    </p>
  );
}

type LedgerRow = ReturnType<typeof ledger>[number];
const secondsOf = (row: LedgerRow) => row.ended > row.started ? Math.max(1, Math.round((row.ended - row.started) / 1000)) : 0;
const durationOf = (row: LedgerRow) => secondsOf(row) ? secondsOf(row) + " s" : "";

/** The lookups as rows: a mark, what Pip looked at, and how long it took at the right. */
function Steps({ rows }: { rows: LedgerRow[] }) {
  return (
    <ul className="space-y-0.5">
      {rows.map(row => (
        <li key={row.id}>
          <Row lead={<StateIcon state={row.state} />} end={durationOf(row) || undefined}>
            {row.title}
            {row.summary ? <span className="text-dim"> · {row.summary}</span> : null}
          </Row>
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

/**
 * A message sent while Pip replies, waiting its turn on the server: the person's next question as a prompt line whose
 * marker is dim (it has not been asked yet), and one line under it like a card's: the dim word `queued` (or `paused`
 * after a stop) and one quiet key to take it back before it starts. The key reaches 44px to the touch by itself, so
 * the line stays as close to the message as the time under a question.
 */
export function QueuedTurn({ text, state, onTakeBack }: { text: string; state: "waiting" | "held"; onTakeBack: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const takeBack = () => { setBusy(true); onTakeBack().catch(error => { setBusy(false); toastError(error); }); };
  return (
    <article>
      <div className="flex gap-2 font-medium text-hi">
        <span aria-hidden="true" className="text-dim">›</span>
        <p className="min-w-0 whitespace-pre-wrap break-words">{text}</p>
      </div>
      <div className="ml-[2ch] mt-0.5 flex items-center gap-3">
        <p className="min-w-0 flex-1 text-xs text-dim">{state === "held" ? "paused" : "queued"}</p>
        <Button type="button" size="xs" disabled={busy} onClick={takeBack} aria-label={"Take back: " + text.slice(0, 60)}>take back</Button>
      </div>
    </article>
  );
}

/**
 * A message the person sent into this reply while Pip worked on it: their words as a prompt line, where the reply took
 * them in, and the dim line a question has under it. Until Pip has it (`sent`, or `held` while a change waits for a
 * decision) its marker is dim, as a queued message's, and one quiet key takes it back; once Pip has it the marker is
 * the question's and the line says so, and the answer goes on below it.
 */
export function SteerLine({ text, at, state, onTakeBack }: { text: string; at: number; state: "sent" | "held" | "taken"; onTakeBack?: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const takeBack = () => { setBusy(true); onTakeBack?.().catch(error => { setBusy(false); toastError(error); }); };
  return (
    <div data-steer={state}>
      <div className="flex gap-2 font-medium text-hi">
        <span aria-hidden="true" className={state === "taken" ? "text-primary" : "text-dim"}>›</span>
        <p className="min-w-0 whitespace-pre-wrap break-words">{text}</p>
      </div>
      <div className="ml-[2ch] mt-0.5 flex items-center gap-3">
        <p className="min-w-0 flex-1 text-[11px] text-dim">{clock(at)} · {state === "taken" ? "taken in" : state === "held" ? "after your decision" : "for pip’s next step"}</p>
        {state !== "taken" && onTakeBack ? <Button type="button" size="xs" disabled={busy} onClick={takeBack} aria-label={"Take back: " + text.slice(0, 60)}>take back</Button> : null}
      </div>
    </div>
  );
}

/** A message sent into the running reply that it has not taken yet (from the chat's queue). */
export interface PendingSteer { runId: string; turnUid: string; text: string; created: number }

interface TurnProps { turn: ChatTurn; live: Partial<ChatTurn> | null; blocks?: Segment[]; chatId: string; latest: boolean; locked: boolean;
  /** Messages sent into this reply that it has not taken yet; `held` while the reply waits for a decision. */
  pending?: PendingSteer[]; held?: boolean; onTakeBack?: (runId: string) => Promise<void> }

/**
 * Re-renders only when this exchange changed: its saved version (turns carry `updated`), its live copy while it
 * streams, or whether it is the latest or locked. Every other exchange stays put while one reply streams.
 */
export const Turn = memo(TurnView, (before, after) =>
  before.live === after.live && before.blocks === after.blocks && before.chatId === after.chatId && before.latest === after.latest && before.locked === after.locked
  && sameTurn(before.turn, after.turn) && before.held === after.held && JSON.stringify(before.pending ?? []) === JSON.stringify(after.pending ?? []));

/** The store re-parses chats on every read, so objects are always new; the store stamps a turn's content change. */
function sameTurn(a: ChatTurn & { updated?: number }, b: ChatTurn & { updated?: number }): boolean {
  if (a.uid !== b.uid) return false;
  if (a.updated !== undefined && b.updated !== undefined) return a.updated === b.updated;
  return a.status === b.status && a.answer === b.answer && JSON.stringify(a.activity) === JSON.stringify(b.activity);
}

/**
 * The answer cut where the person's messages arrived: each part is text (a stored reply) or the streamed blocks the
 * server cut (`block` says how many stand before a message). A reply nobody steered is one part, drawn as before.
 */
function answerParts(answer: string, blocks: Segment[] | undefined, steers: Steer[]): { text: string; blocks?: Segment[]; filled: boolean }[] {
  if (!steers.length) return [{ text: answer, blocks, filled: Boolean(answer) }];
  if (blocks && steers.every(item => typeof item.block === "number")) {
    let from = 0;
    const parts = steers.map(item => { const to = Math.max(from, Math.min(blocks.length, item.block!)), part = blocks.slice(from, to); from = to; return { text: "", blocks: part, filled: part.length > 0 }; });
    const rest = blocks.slice(from);
    return [...parts, { text: "", blocks: rest, filled: rest.length > 0 }];
  }
  return answerPieces(answer, steers).map(text => ({ text, filled: Boolean(text.trim()) }));
}

function TurnView({ turn, live, blocks, chatId, latest, locked, pending = [], held = false, onTakeBack }: TurnProps) {
  const shown: ChatTurn = live ? { ...turn, ...live } as ChatTurn : turn;
  const streaming = Boolean(live);
  const rows = ledger(shown, streaming);
  const plan = planOf(rows), offers = offersOf(rows), sources = sourcesOf(shown, rows);
  const remembered = memoryOf(shown), jobs = jobsOf(shown);
  const cards = useCardButtons(chatId, locked);
  const ask = useCallback((prompt: string) => { if (!locked) send(chatId, prompt).catch(toastError); }, [chatId, locked]);
  const place = useMemo(() => ({ chatId, place: "chat" as const, locked }), [chatId, locked]);
  // A message about one card says so in a line of its own, not with the card's id. An assignment's report is Pip's
  // own turn: its title stands where the question would, with a quiet marker, and the line under it says what it is.
  const report = shown.owner === ASSIGNMENT_OWNER;
  const asked = report ? { text: reportTitle(shown), id: "" } : aboutCard(shown.text);
  const handedOff = assignmentsOf(shown);
  const unfinished = !streaming && latest && ["stopped", "failed", "streaming"].includes(shown.status);
  const took = rows.reduce((sum, row) => sum + secondsOf(row), 0);
  const steps = rows.length > 1 ? rows.length + " steps" : "1 step";
  const steers = takenSteers(shown.steers);
  const parts = answerParts(shown.answer || "", blocks, steers);
  const waiting = pending.filter(item => !steers.some(steer => steer.uid === item.turnUid));

  return (
    <article data-turn={shown.uid} className={cn("space-y-3", Date.now() - shown.created < 4000 && "arrive")}>
      {/* What the person wrote is a prompt line; the reply under it is plain text. No bubble, no rule beside it. */}
      <div>
        <div className="flex gap-2 font-medium text-hi">
          <span aria-hidden="true" className={report ? "text-dim" : "text-primary"}>›</span>
          <p className="min-w-0 whitespace-pre-wrap break-words">{asked.text}</p>
        </div>
        <p className="ml-[2ch] mt-0.5 text-[11px] text-dim">{clock(shown.created)}{asked.id ? " · about a card" : report ? " · assignment" : ""}</p>
      </div>

      <div data-reply className="space-y-3">
        {rows.length ? (
          !streaming && rows.length > 3
            ? <Fold title={took ? steps + " · " + took + " s" : steps}><Steps rows={rows} /></Fold>
            : <Steps rows={rows} />
        ) : null}

        {plan.length ? (
          <ul>
            {plan.map((step, index) => (
              <li key={index}>
                <Row lead={<StateIcon state={step.status === "done" ? "done" : step.status === "in_progress" ? "running" : "queued"} />} dim={step.status === "done"}>
                  {step.text}
                </Row>
              </li>
            ))}
          </ul>
        ) : null}

        {shown.reasoning ? <Fold title="reasoning"><Prose text={shown.reasoning} streaming={streaming && !shown.answer} className="text-xs text-muted-foreground" /></Fold> : null}

        {/* Classic cards' buttons answer through data attributes; the click is caught here. A message the person sent
            into the reply stands where Pip took it in, and the answer goes on after it. */}
        {!steers.length
          ? (shown.answer ? <div {...cards}><Answer text={shown.answer} blocks={blocks} streaming={streaming} onAsk={ask} at={place} /></div> : null)
          : (
            <div {...cards} className="space-y-3">
              {parts.map((part, index) => (
                <Fragment key={index}>
                  {part.filled ? <Answer text={part.text} blocks={part.blocks} streaming={streaming && index === parts.length - 1} onAsk={ask} at={place} /> : null}
                  {index < steers.length ? <SteerLine text={steers[index]!.text} at={steers[index]!.taken || steers[index]!.at} state="taken" /> : null}
                </Fragment>
              ))}
            </div>
          )}

        {streaming && !offers.length && (steers.length ? !parts.at(-1)?.filled : !shown.answer) ? <Thinking label={phaseLabel(shown.phase || "thinking")} /> : null}

        {/* What Pip took into its memory of the person with this reply: said, so nothing is remembered unseen. */}
        {!streaming && remembered.length ? (
          <ul className="space-y-0.5 text-xs text-dim">
            {remembered.map((change, index) => <li key={index}>{change.kind}: {change.text}</li>)}
            <li><Link to="/memory" className="text-primary underline underline-offset-2">memory</Link></li>
          </ul>
        ) : null}

        {/* A job Pip set up or changed in this reply: said in a line, with the page where it can be undone. */}
        {!streaming && jobs.length ? (
          <ul className="space-y-0.5 text-xs text-dim">
            {jobs.map((change, index) => <li key={index}>{change.kind}: {change.text}</li>)}
            <li><Link to="/jobs" className="text-primary underline underline-offset-2">jobs</Link></li>
          </ul>
        ) : null}

        {/* Work this reply handed to an assignment: its state, live, with stop or try again. */}
        {handedOff.length ? <AssignmentStatus started={handedOff} /> : null}

        {sources.length && !streaming ? (
          <p className="text-[11px] text-dim">
            {sources.map((source, index) => (
              <span key={source.href}>{index ? " · " : ""}
                <a href={source.href.startsWith("/") ? hrefFor(source.href) : source.href} target={source.href.startsWith("/") ? undefined : "_blank"} rel="noopener noreferrer"
                  className="text-primary underline underline-offset-2">{source.title}</a>
              </span>
            ))}
          </p>
        ) : null}

        {offers.length ? <div className="space-y-2">{offers.map(offer => <OfferCard key={offer.row.id} offer={offer} chatId={chatId} turnId={shown.uid} locked={locked && !streaming} />)}</div> : null}

        {/* Sent into the reply and not taken yet: after what Pip has written so far, and after a change it waits on. */}
        {waiting.map(item => (
          <SteerLine key={item.runId} text={item.text} at={item.created} state={held ? "held" : "sent"} onTakeBack={onTakeBack ? () => onTakeBack(item.runId) : undefined} />
        ))}

        {unfinished ? (
          <div className="space-y-1">
            <Problem error={shown.error || "This reply did not finish."} chatId={chatId} className="text-sm text-destructive" />
            <Keys>
              <Button type="button" disabled={locked} onClick={() => resume(chatId, shown.uid).catch(toastError)}>continue</Button>
              <Button type="button" disabled={locked} onClick={() => retry(chatId, shown.uid).catch(toastError)}>start over</Button>
            </Keys>
          </div>
        ) : !streaming && shown.error ? <Problem error={shown.error} chatId={chatId} className="text-xs text-destructive" /> : null}
      </div>
    </article>
  );
}
