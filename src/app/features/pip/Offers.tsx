import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { applyChange, applyProposal, type CreateProposal } from "../../../client/pip-actions.js";
import { chats } from "../../data/chats.ts";
import { BARE_INPUT } from "../../ui/SendButton.tsx";
import { toast, toastError } from "../../ui/toast/toast.ts";
import { approvalOf, decide } from "./runner.ts";
import { changeLabel, type Offer } from "./reply.ts";
import { classicHref, hrefFor } from "../../lib/classic.ts";

// What Pip offers to put into Pocket. Nothing is saved without the person: a proposal opens for review first,
// a change says what it will do, a write Pip asked for waits for approve or decline. Saving is idempotent, so a
// second tap (or another device) never makes a duplicate.

const LABEL = "text-[10.5px] uppercase tracking-[0.06em] text-dim";
const WORD = "flex min-h-11 shrink-0 items-center text-xs text-dim transition-colors hover:text-foreground disabled:opacity-50 sm:min-h-0";
const LINE = "flex min-h-11 items-center gap-2 border-t py-2 sm:min-h-0";
const MULTILINE = "flex gap-2 border-t py-2";
const BARE_AREA = "min-h-16 w-full resize-none rounded-none border-0 bg-transparent p-0 text-sm shadow-none placeholder:text-dim focus-visible:ring-0 dark:bg-transparent";

const IN_APP = new Set(["/notes", "/today", "/pip"]);
function SavedLink({ href, label }: { href: string; label: string }) {
  const area = "/" + href.split("/")[1];
  return IN_APP.has(area)
    ? <Link to={href} className={WORD}>✓ {label}</Link>
    : <a href={hrefFor(href)} className={WORD}>✓ {label}</a>;
}

/** An offer is a small label, its details as label/value rows, then its actions as words. */
function Frame({ kind, rows, children }: { kind: string; rows: [string, string][]; children?: React.ReactNode }) {
  return (
    <section className="space-y-1 border-t pt-2">
      <p className={LABEL}>{kind}</p>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[minmax(72px,35%)_minmax(0,1fr)] gap-3 border-t py-2 text-sm first:border-t-0">
            <dt className="text-xs text-dim">{label}</dt>
            <dd className="min-w-0 whitespace-pre-wrap break-words text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      {children ? <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-1">{children}</div> : null}
    </section>
  );
}

/** The proposal's fields as the rows Frame draws. */
function rowsOf(proposal: CreateProposal): [string, string][] {
  const steps = (proposal.steps ?? []).filter(Boolean);
  return [
    ["title", proposal.title],
    ...(proposal.due ? [["due", proposal.due] as [string, string]] : []),
    ...(steps.length ? [["steps", steps.join(" · ")] as [string, string]] : []),
    ...(proposal.text ? [["text", proposal.text] as [string, string]] : []),
  ];
}

/** Edit a note, task or appointment before it is saved (or before an approved write runs). */
function ProposalForm({ proposal, onSubmit, submitLabel }: { proposal: CreateProposal; onSubmit: (value: CreateProposal) => void | Promise<void>; submitLabel: string }) {
  const [title, setTitle] = useState(proposal.title);
  const [text, setText] = useState(proposal.text ?? "");
  const [due, setDue] = useState(proposal.due ?? "");
  const [steps, setSteps] = useState((proposal.steps ?? []).join("\n"));
  const [when, setWhen] = useState(() => {
    const at = new Date(proposal.when ?? "");
    return Number.isFinite(+at) ? new Date(+at - at.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
  });
  const [minutes, setMinutes] = useState(String(proposal.minutes ?? 60));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value: CreateProposal = { kind: proposal.kind, title: title.trim(), text };
    if (proposal.kind === "task") Object.assign(value, { due, steps: steps.split("\n").map(line => line.trim()).filter(Boolean) });
    if (proposal.kind === "appointment") Object.assign(value, { when: when ? new Date(when).toISOString() : "", minutes: Number(minutes) });
    void onSubmit(value);
  };
  return (
    <form onSubmit={submit} className="grid gap-1">
      <label className={LINE}>
        <span aria-hidden="true" className="text-dim">›</span>
        <span className="shrink-0 text-xs text-dim">title</span>
        <Input value={title} maxLength={200} onChange={event => setTitle(event.target.value)} className={BARE_INPUT} />
      </label>
      {proposal.kind === "appointment" ? (
        <>
          <label className={LINE}>
            <span aria-hidden="true" className="text-dim">›</span>
            <span className="shrink-0 text-xs text-dim">when</span>
            <Input type="datetime-local" value={when} onChange={event => setWhen(event.target.value)} className={BARE_INPUT} />
          </label>
          <label className={LINE}>
            <span aria-hidden="true" className="text-dim">›</span>
            <span className="shrink-0 text-xs text-dim">minutes</span>
            <Input type="number" min={15} max={480} value={minutes} onChange={event => setMinutes(event.target.value)} className={BARE_INPUT} />
          </label>
        </>
      ) : null}
      {proposal.kind === "task" ? (
        <>
          <label className={LINE}>
            <span aria-hidden="true" className="text-dim">›</span>
            <span className="shrink-0 text-xs text-dim">due</span>
            <Input type="date" value={due} onChange={event => setDue(event.target.value)} className={BARE_INPUT} />
          </label>
          <label className={MULTILINE}>
            <span aria-hidden="true" className="pt-0.5 text-dim">›</span>
            <span className="grid min-w-0 flex-1 gap-1">
              <span className="text-xs text-dim">steps, one per line</span>
              <Textarea rows={3} value={steps} onChange={event => setSteps(event.target.value)} className={BARE_AREA} />
            </span>
          </label>
        </>
      ) : null}
      <label className={MULTILINE}>
        <span aria-hidden="true" className="pt-0.5 text-dim">›</span>
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="text-xs text-dim">{proposal.kind === "task" ? "context" : "text"}</span>
          <Textarea rows={4} maxLength={6000} value={text} onChange={event => setText(event.target.value)} className={BARE_AREA} />
        </span>
      </label>
      <DialogFooter className="flex-row items-center justify-end border-t pt-1">
        <button type="submit" disabled={!title.trim()} className="flex min-h-11 items-center bg-primary px-3 text-sm text-primary-foreground transition-colors disabled:bg-secondary disabled:text-dim sm:h-8 sm:min-h-0">{submitLabel}</button>
      </DialogFooter>
    </form>
  );
}

export function OfferCard({ offer, chatId, turnId, locked }: { offer: Offer; chatId: string; turnId: string; locked: boolean }) {
  const [reviewing, setReviewing] = useState(false);
  const record = (href: string, result: unknown) => chats.recordApplied(chatId, turnId, offer.row.id, href, result);

  if (offer.type === "create") {
    if (offer.saved) return <Frame kind={offer.proposal.kind} rows={rowsOf(offer.proposal)}><SavedLink href={offer.saved} label="saved" /></Frame>;
    const save = async (proposal: CreateProposal) => {
      try {
        const href = await applyProposal(chatId, turnId, offer.row.id, proposal);
        record(href, { kind: "proposal", proposal, requires_confirmation: false });
        setReviewing(false); toast("Saved.");
      } catch (error) { toastError(error); }
    };
    return (
      <Frame kind={offer.proposal.kind} rows={rowsOf(offer.proposal)}>
        <button type="button" disabled={locked} className={WORD} onClick={() => setReviewing(true)}>review</button>
        <Dialog open={reviewing} onOpenChange={setReviewing}>
          <DialogContent>
            <DialogHeader><DialogTitle>new {offer.proposal.kind}</DialogTitle><DialogDescription>Pip suggested this. Change anything, then save.</DialogDescription></DialogHeader>
            <ProposalForm proposal={offer.proposal} onSubmit={save} submitLabel={"save " + offer.proposal.kind} />
          </DialogContent>
        </Dialog>
      </Frame>
    );
  }

  if (offer.type === "change") {
    if (offer.saved) return <Frame kind={changeLabel(offer.change)} rows={[["title", offer.before.title]]}><SavedLink href={offer.saved} label="done" /></Frame>;
    const apply = () => {
      try { const href = applyChange(offer.change); record(href, { kind: "change", change: offer.change, before: offer.before, requires_confirmation: false }); toast("Done."); }
      catch (error) { toastError(error); }
    };
    return (
      <Frame kind={changeLabel(offer.change)} rows={[["title", offer.before.title]]}>
        <button type="button" disabled={locked} className={WORD} onClick={apply}>{changeLabel(offer.change)}</button>
      </Frame>
    );
  }

  if (offer.type === "coros") {
    return (
      <Frame kind="COROS workout" rows={[["title", offer.title]]}>
        {offer.saved ? <SavedLink href={offer.saved} label="saved to COROS" /> : <a href={classicHref("/pip/" + chatId)} className={WORD}>review in classic</a>}
      </Frame>
    );
  }

  // A write waiting for approval right now.
  const waiting = approvalOf(turnId, offer.row.id);
  const decided = waiting?.decision;
  const editable = offer.name === "create_record" && typeof offer.input.title === "string";
  return (
    <Frame kind={decided ? (decided.approved ? "approved" : "declined") : "needs your approval"} rows={[["title", offer.title]]}>
      {waiting && !decided ? (
        <>
          <button type="button" className={WORD} onClick={() => decide(turnId, offer.row.id, { approved: false })}>decline</button>
          {editable
            ? <button type="button" className={WORD} onClick={() => setReviewing(true)}>review</button>
            : <button type="button" className={WORD} onClick={() => decide(turnId, offer.row.id, { approved: true })}>approve</button>}
          {editable ? (
            <Dialog open={reviewing} onOpenChange={setReviewing}>
              <DialogContent>
                <DialogHeader><DialogTitle>{offer.title}</DialogTitle><DialogDescription>Pip wants to save this. Change anything, then approve.</DialogDescription></DialogHeader>
                <ProposalForm proposal={offer.input as unknown as CreateProposal} submitLabel="approve"
                  onSubmit={value => { decide(turnId, offer.row.id, { approved: true, input: value }); setReviewing(false); }} />
              </DialogContent>
            </Dialog>
          ) : null}
        </>
      ) : null}
    </Frame>
  );
}
