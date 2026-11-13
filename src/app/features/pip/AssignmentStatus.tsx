import { useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { latestOf, retry, stop, useAssignments, type Assignment } from "../../data/assignments.ts";
import { clockAt } from "../../data/today.ts";
import { hrefFor } from "../../lib/classic.ts";
import { toastError } from "../../ui/toast/toast.ts";

// An assignment's one line under the reply that started it, like a card's line: its state at the left and one key
// at the right (stop while it works, try again once it failed or was stopped). A retry is followed, so the line says
// what the newest attempt does. The report itself is a turn of its own further down the big chat; the line links to it.

/**
 * The assignments a reply started (`started`, from its tool calls), live. One the list does not hold (signed out, not
 * read yet, or older than the list) is still named, without a state or a key.
 */
export function AssignmentStatus({ started }: { started: { id: string; title: string }[] }) {
  const work = useAssignments();
  return <div className="space-y-1">{started.map(({ id, title }) => {
    const item = work.assignments.find(entry => entry.id === id);
    return item ? <Line key={id} item={latestOf(item, work.assignments)} /> : <p key={id} className="text-xs text-dim">assignment{title ? " · " + title : ""}</p>;
  })}</div>;
}

/** Scrolls to the report when it is on screen; otherwise the link opens the chat it is in. */
function toReport(event: MouseEvent<HTMLAnchorElement>, turn: string) {
  const node = document.querySelector(`[data-turn="${CSS.escape(turn)}"]`);
  if (!node) return;
  event.preventDefault();
  node.scrollIntoView({ block: "start", behavior: "smooth" });
}

function Line({ item }: { item: Assignment }) {
  const [busy, setBusy] = useState(false);
  const act = (work: () => Promise<void>) => { setBusy(true); work().catch(toastError).finally(() => setBusy(false)); };
  const working = item.state === "working" || item.state === "waiting";
  const key = working ? <Button type="button" disabled={busy} onClick={() => act(() => stop(item.id))} aria-label={"Stop the assignment " + item.title}>stop</Button>
    : item.state === "failed" || item.state === "stopped" ? <Button type="button" disabled={busy} onClick={() => act(() => retry(item.id))} aria-label={"Try the assignment " + item.title + " again"}>try again</Button>
    : null;
  const text = item.state === "failed"
    ? <p className="min-w-0 flex-1 text-xs text-destructive">{(item.title ? item.title + " failed: " : "") + (item.error || "the assignment did not finish.")}</p>
    : <p className="min-w-0 flex-1 text-xs text-dim">
      {item.state === "done" ? <>assignment · reported {clockAt(item.ended)}{item.report ? <>, <a href={hrefFor("/pip?chat=" + encodeURIComponent(item.report.chat))} onClick={event => toReport(event, item.report!.turn)} className="text-primary underline underline-offset-2">below</a></> : null}</>
        : item.state === "stopped" ? "assignment · stopped"
        : item.state === "waiting" ? "assignment · waiting for another to finish"
        : "assignment · working" + (item.lookups ? " · " + item.lookups + (item.lookups === 1 ? " lookup" : " lookups") : "")}
    </p>;
  return <div className="flex items-center gap-3">{text}{key}</div>;
}
