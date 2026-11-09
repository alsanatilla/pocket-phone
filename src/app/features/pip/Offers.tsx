import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { applyChange, applyProposal, type CreateProposal } from "../../../client/pip-actions.js";
import { chats } from "../../data/chats.ts";
import { toast, toastError } from "../../ui/toast/toast.ts";
import { approvalOf, decide } from "./runner.ts";
import { changeLabel, type Offer } from "./reply.ts";

// What Pip offers to put into Pocket. Nothing is saved without the person: a proposal opens for review first,
// a change says what it will do, a write Pip asked for waits for approve or decline. Saving is idempotent, so a
// second tap (or another device) never makes a duplicate.

const IN_APP = new Set(["/notes", "/today", "/pip"]);
function SavedLink({ href, label }: { href: string; label: string }) {
  const area = "/" + href.split("/")[1];
  return IN_APP.has(area)
    ? <Button asChild size="sm" variant="ghost" className="text-movement"><Link to={href}>✓ {label}</Link></Button>
    : <Button asChild size="sm" variant="ghost" className="text-movement"><a href={"/#" + href}>✓ {label}</a></Button>;
}

function Frame({ kind, title, children }: { kind: string; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-card px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-[0.08em] text-primary">{kind}</p>
        <p className="text-sm">{title}</p>
      </div>
      <div className="flex gap-1">{children}</div>
    </section>
  );
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
    <form onSubmit={submit} className="grid gap-3">
      <Label className="grid gap-1.5"><span className="text-xs text-muted-foreground">title</span><Input value={title} maxLength={200} onChange={event => setTitle(event.target.value)} /></Label>
      {proposal.kind === "appointment" ? (
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <Label className="grid gap-1.5"><span className="text-xs text-muted-foreground">when</span><Input type="datetime-local" value={when} onChange={event => setWhen(event.target.value)} /></Label>
          <Label className="grid gap-1.5"><span className="text-xs text-muted-foreground">minutes</span><Input type="number" min={15} max={480} value={minutes} onChange={event => setMinutes(event.target.value)} /></Label>
        </div>
      ) : null}
      {proposal.kind === "task" ? (
        <>
          <Label className="grid gap-1.5"><span className="text-xs text-muted-foreground">due</span><Input type="date" value={due} onChange={event => setDue(event.target.value)} /></Label>
          <Label className="grid gap-1.5"><span className="text-xs text-muted-foreground">steps, one per line</span><Textarea rows={3} value={steps} onChange={event => setSteps(event.target.value)} /></Label>
        </>
      ) : null}
      <Label className="grid gap-1.5"><span className="text-xs text-muted-foreground">{proposal.kind === "task" ? "context" : "text"}</span><Textarea rows={4} maxLength={6000} value={text} onChange={event => setText(event.target.value)} /></Label>
      <DialogFooter><Button type="submit" disabled={!title.trim()}>{submitLabel}</Button></DialogFooter>
    </form>
  );
}

export function OfferCard({ offer, chatId, turnId, locked }: { offer: Offer; chatId: string; turnId: string; locked: boolean }) {
  const [reviewing, setReviewing] = useState(false);
  const record = (href: string, result: unknown) => chats.recordApplied(chatId, turnId, offer.row.id, href, result);

  if (offer.type === "create") {
    if (offer.saved) return <Frame kind={offer.proposal.kind} title={offer.proposal.title}><SavedLink href={offer.saved} label="saved" /></Frame>;
    const save = async (proposal: CreateProposal) => {
      try {
        const href = await applyProposal(chatId, turnId, offer.row.id, proposal);
        record(href, { kind: "proposal", proposal, requires_confirmation: false });
        setReviewing(false); toast("Saved.");
      } catch (error) { toastError(error); }
    };
    return (
      <Frame kind={offer.proposal.kind} title={offer.proposal.title}>
        <Button size="sm" disabled={locked} onClick={() => setReviewing(true)}>review</Button>
        <Dialog open={reviewing} onOpenChange={setReviewing}>
          <DialogContent>
            <DialogHeader><DialogTitle className="font-pixel text-2xl font-normal">new {offer.proposal.kind}</DialogTitle><DialogDescription>Pip suggested this. Change anything, then save.</DialogDescription></DialogHeader>
            <ProposalForm proposal={offer.proposal} onSubmit={save} submitLabel={"save " + offer.proposal.kind} />
          </DialogContent>
        </Dialog>
      </Frame>
    );
  }

  if (offer.type === "change") {
    if (offer.saved) return <Frame kind={changeLabel(offer.change)} title={offer.before.title}><SavedLink href={offer.saved} label="done" /></Frame>;
    const apply = () => {
      try { const href = applyChange(offer.change); record(href, { kind: "change", change: offer.change, before: offer.before, requires_confirmation: false }); toast("Done."); }
      catch (error) { toastError(error); }
    };
    return (
      <Frame kind={changeLabel(offer.change)} title={offer.before.title}>
        <Button size="sm" disabled={locked} onClick={apply}>{changeLabel(offer.change)}</Button>
      </Frame>
    );
  }

  if (offer.type === "coros") {
    return (
      <Frame kind="COROS workout" title={offer.title}>
        {offer.saved ? <SavedLink href={offer.saved} label="saved to COROS" /> : <Button asChild size="sm" variant="outline"><a href={"/#/pip/" + chatId}>review in classic</a></Button>}
      </Frame>
    );
  }

  // A write waiting for approval right now.
  const waiting = approvalOf(turnId, offer.row.id);
  const decided = waiting?.decision;
  const editable = offer.name === "create_record" && typeof offer.input.title === "string";
  return (
    <Frame kind={decided ? (decided.approved ? "approved" : "declined") : "needs your approval"} title={offer.title}>
      {waiting && !decided ? (
        <>
          <Button size="sm" variant="ghost" onClick={() => decide(turnId, offer.row.id, { approved: false })}>decline</Button>
          {editable
            ? <Button size="sm" onClick={() => setReviewing(true)}>review</Button>
            : <Button size="sm" onClick={() => decide(turnId, offer.row.id, { approved: true })}>approve</Button>}
          {editable ? (
            <Dialog open={reviewing} onOpenChange={setReviewing}>
              <DialogContent>
                <DialogHeader><DialogTitle className="font-pixel text-2xl font-normal">{offer.title}</DialogTitle><DialogDescription>Pip wants to save this. Change anything, then approve.</DialogDescription></DialogHeader>
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
