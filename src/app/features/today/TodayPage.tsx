import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import * as cloud from "../../../client/cloud.js";
import { agenda } from "../../../client/planner.js";
import { refresh, retry, stop, useAssignments, type Assignment, type AssignmentsState } from "../../data/assignments.ts";
import { useCollection } from "../../data/bus.ts";
import { pinnedCards } from "../../data/cards.ts";
import { listChats, readChat } from "../../data/chats.ts";
import { homeForSend } from "../../data/home.ts";
import { BRIEF_KINDS, clockAt, dailyNote, dayAppointments, dayPart, dayTasks, dayTitle, fromPip, JOB_OWNER, lastVisit, latestBrief, markVisit, type PipItem } from "../../data/today.ts";
import { loadJobs, type JobsState } from "../../data/jobs.ts";
import { completeTask, listTasks, today } from "../../data/tasks.ts";
import { noteTitle } from "../../data/notes.ts";
import { hrefFor } from "../../lib/classic.ts";
import { useSyncState } from "../../runtime.ts";
import { Keys, Row, RowMenu, Section, SectionLabel, Tick } from "../../ui/kit.tsx";
import { PageTitle } from "../../ui/PageTitle.tsx";
import { SendButton } from "../../ui/SendButton.tsx";
import { toastError } from "../../ui/toast/toast.ts";
import { Answer } from "../pip/stream/Answer.tsx";
import { busy, canQueue, queueSend, send } from "../pip/runner.ts";
import { PinnedCards } from "./PinnedCards.tsx";

// Today: what the day holds and what Pip did meanwhile, read at a glance, with one field to talk to Pip.
// docs/mockups/today-assignments.html is the approved design. In reading order: Pip's latest brief (a job's report,
// never written on opening the page), replies waiting for the person's decision, what Pip did since the last visit
// and what it works on now, the appointments, the tasks (ticked here), the pinned cards, and the field, which sends
// to the big chat and opens it. The evening shows tomorrow's appointments and what got done instead.

const attempt = (work: () => unknown) => { try { work(); } catch (error) { toastError(error); } };
const pipHref = (chat: string) => hrefFor("/pip" + (chat ? "?chat=" + encodeURIComponent(chat) : ""));

/** The minute, so the day's part, the date and "late" stay right while the page stays open. */
function useMinute(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(id); }, []);
  return now;
}

export function TodayPage() {
  const sync = useSyncState();
  const account = sync.signedIn ? cloud.account()?.id ?? "" : "";
  // Another account is another page: nothing of the one before (its jobs, its last visit) carries over.
  return <TodayView key={account} account={account} signedIn={sync.signedIn} local={sync.local} />;
}

function TodayView({ account, signedIn, local }: { account: string; signedIn: boolean; local: boolean }) {
  const now = useMinute(), part = dayPart(now);
  const work = useAssignments();
  // The last visit is read once: what arrives while the page is open stays until the person leaves it.
  const [since] = useState(() => lastVisit(account));
  useVisit(account, work.status === "ready" || !signedIn);
  const jobs = useBriefJobs(account, signedIn);

  const chats = useCollection(["chats"], listChats);
  const brief = jobs ? latestBrief(jobs.runs, chats, now) : null;
  const items = fromPip(chats, work.assignments, since, brief?.turn.uid);
  const tasks = useCollection(["tasks.json"], () => dayTasks(listTasks(), part, now), [part, today(now)]);
  const events = useCollection(["agenda.json"], () => dayAppointments(agenda.all(), part, now), [part, Math.floor(now / 60_000)]);
  const note = useCollection(["notes.json"], () => (part === "evening" ? dailyNote(today(now)) : null), [part, today(now)]);
  const hasPinned = useCollection(["chats"], () => pinnedCards().length > 0);
  const nothing = !brief && !work.decisions.length && !items.length && !events.length && !tasks.length && !note && !hasPinned;

  return (
    <main className="flex min-h-[calc(100dvh-45px)] flex-col">
      <PageTitle title="today" meta={dayTitle(now) + (part === "evening" ? " · evening" : "")} />
      <div className="mt-3 flex-1">
        {brief ? <BriefText brief={brief} /> : jobs && signedIn && !jobs.routines.some(job => BRIEF_KINDS.includes(job.kind)) && !nothing
          ? <p className="mb-6 text-sm text-muted-foreground">Pip can write a short brief here each morning. Set one up in <a href={hrefFor("/jobs")} className="text-primary underline underline-offset-2">jobs</a>.</p>
          : null}
        {nothing && (!signedIn || work.status === "ready") ? <p className="mb-6 text-sm text-muted-foreground">Nothing due and nothing planned {part === "evening" ? "tomorrow" : "today"}. Ask pip anything below.</p> : null}

        <Decisions work={work} />
        <FromPip items={items} work={work} since={since} signedIn={signedIn} local={local} />

        {events.length ? (
          <Section label={part === "evening" ? "tomorrow" : "appointments"}>
            {events.map(event => (
              <Row key={event.uid} href={hrefFor("/calendar/" + event.uid)} arrow={false}
                lead={<span className="w-[5ch] text-xs">{clockAt(event.when)}</span>}>{event.title}</Row>
            ))}
          </Section>
        ) : null}

        {tasks.length ? (
          <Section label="tasks">
            {tasks.map(({ task, note: when, late }) => (
              <Row key={task.uid} dim={task.done}
                lead={<Tick checked={task.done} label={(task.done ? "Not done: " : "Done: ") + task.text} onChange={() => attempt(() => completeTask(task.uid))} />}
                end={when ? <span className={cn(late && "text-destructive")}>{when}</span> : undefined}>
                {task.text}
              </Row>
            ))}
          </Section>
        ) : null}

        {note ? (
          <Section label="the day">
            <Row href={hrefFor("/notes/" + note.uid)} arrow={false}>{noteTitle(note)}</Row>
          </Section>
        ) : null}

        <PinnedCards />
      </div>
      <AskPip />
    </main>
  );
}

/**
 * Remembers when the person left Today (the tab hidden, or another page opened), per account. Only once what Pip
 * did could be read: a visit that could not show it does not count as having seen it.
 */
function useVisit(account: string, shown: boolean): void {
  const ready = useRef(shown);
  ready.current = shown;
  useEffect(() => {
    const leave = () => { if (ready.current) markVisit(account); };
    const hidden = () => { if (document.visibilityState === "hidden") leave(); };
    document.addEventListener("visibilitychange", hidden);
    return () => { document.removeEventListener("visibilitychange", hidden); leave(); };
  }, [account]);
}

/**
 * The jobs and their recent runs, for the brief: read when the page opens and again when a job's new report arrives
 * in the synced chats. Nothing is asked of a model here.
 */
function useBriefJobs(account: string, signedIn: boolean): JobsState | null {
  const latest = useCollection(["chats"], () => {
    let newest = "", at = 0;
    for (const chat of listChats()) for (const turn of chat.turns) if (turn.owner === JOB_OWNER && turn.created > at) { at = turn.created; newest = turn.uid; }
    return newest;
  });
  const [jobs, setJobs] = useState<JobsState | null>(null);
  useEffect(() => {
    if (!signedIn) { setJobs(null); return; }
    let current = true;
    loadJobs().then(value => { if (current) setJobs(value); }, () => { /* No brief then; what Pip did says whether Pocket is reachable. */ });
    return () => { current = false; };
  }, [account, signedIn, latest]);
  return jobs;
}

function BriefText({ brief }: { brief: NonNullable<ReturnType<typeof latestBrief>> }) {
  const navigate = useNavigate();
  const ask = (prompt: string) => { void navigate({ to: "/pip" }); send(homeForSend().uid, prompt).catch(toastError); };
  return (
    <div className="mb-6">
      <Answer text={brief.turn.answer} streaming={false} onAsk={ask} at={{ chatId: brief.chat, place: "today" }} />
      <p className="mt-1 text-xs text-dim">{brief.title.toLowerCase()} · {clockAt(brief.at)} · <a href={pipHref(brief.chat)} className="text-primary underline underline-offset-2">in pip</a></p>
    </div>
  );
}

/** Replies waiting for the person: each row opens the chat, where the change is approved or declined as always. */
function Decisions({ work }: { work: AssignmentsState }) {
  if (!work.decisions.length) return null;
  return (
    <Section label="waiting for you">
      {work.decisions.flatMap(decision => {
        const chat = readChat(decision.chat);
        const where = !chat || chat.home ? "pip" : chat.title || "chat";
        return decision.requests.map(request => (
          <Row key={decision.runId + ":" + request.id} href={pipHref(decision.chat)} arrow={false}
            sub={where + (decision.asked ? " · asked " + clockAt(decision.asked) : "")}>{request.title}</Row>
        ));
      })}
    </Section>
  );
}

const SHOWN = 10;

/** What Pip did since the last visit and what it works on now; the honest sentence when that cannot be read. */
function FromPip({ items, work, since, signedIn, local }: { items: PipItem[]; work: AssignmentsState; since: number; signedIn: boolean; local: boolean }) {
  const [all, setAll] = useState(false);
  const label = <SectionLabel note={"since " + (today(since) === today() ? "" : new Date(since).toLocaleDateString("en-GB", { weekday: "short" }) + " ") + clockAt(since)}>from pip</SectionLabel>;
  if (!signedIn) {
    if (local) return null;
    return (
      <section className="mb-6">
        <SectionLabel>from pip</SectionLabel>
        <p className="text-sm text-muted-foreground">Sign in to see what Pip did while you were away.</p>
        <Keys className="mt-2"><Button asChild><a href={hrefFor("/settings")}>sign in</a></Button></Keys>
      </section>
    );
  }
  if (work.status === "loading") {
    return <section className="mb-6" aria-busy="true">{label}<div className="shimmer mt-2 h-4 w-3/5 rounded-sm" /><div className="shimmer mt-2 h-4 w-2/5 rounded-sm" /></section>;
  }
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  const problem = work.error ? (
    <div className="mt-1">
      <p className="text-sm text-destructive">{offline ? "You are offline. What Pip did shows when Pocket is back online." : "Pocket could not reach Pip: " + work.error.replace(/\.?$/, ".")}</p>
      <Keys className="mt-2"><Button type="button" onClick={() => void refresh()}>try again</Button></Keys>
    </div>
  ) : null;
  if (!items.length && !problem) return null;
  const shown = all ? items : items.slice(0, SHOWN);
  return (
    <section className="mb-6">
      {label}
      {shown.map(item => item.assignment ? <AssignmentRow key={item.key} item={item} assignment={item.assignment} />
        : <Row key={item.key} href={pipHref(item.chat)} arrow={false} sub={item.note || undefined} end={clockAt(item.at)}>{item.title}</Row>)}
      {items.length > shown.length ? <Row onOpen={() => setAll(true)}>{items.length - shown.length} more</Row> : null}
      {problem}
    </section>
  );
}

/** One assignment: the row opens its report once there is one; stop and try again are in its menu. */
function AssignmentRow({ item, assignment: current }: { item: PipItem; assignment: Assignment }) {
  const working = current.state === "working" || current.state === "waiting";
  const failed = current.state === "failed" || current.state === "stopped";
  const menu = working || failed ? (
    <RowMenu label={item.title + ": more"}>
      {working ? <DropdownMenuItem onSelect={() => { stop(current.id).catch(toastError); }}>stop</DropdownMenuItem> : null}
      {failed ? <DropdownMenuItem onSelect={() => { retry(current.id).catch(toastError); }}>try again</DropdownMenuItem> : null}
      {current.origin?.chat ? <DropdownMenuItem asChild><a href={pipHref(current.origin.chat)}>open the chat</a></DropdownMenuItem> : null}
    </RowMenu>
  ) : null;
  const end = <>{working ? current.state : clockAt(item.at)}{menu}</>;
  if (current.state === "done") return <Row href={pipHref(item.chat)} arrow={false} sub={item.note} end={end}>{item.title}</Row>;
  return <Row sub={current.state === "failed" ? "Failed: " + item.note : item.note} subTone={current.state === "failed" ? "error" : undefined} end={end}>{item.title}</Row>;
}

/** The page's one field: what is written here goes to the big chat with Pip, which then opens. */
function AskPip() {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const node = area.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = Math.min(node.scrollHeight, 160) + "px";
  }, [text]);
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const value = text.trim();
    if (!value) return;
    attempt(() => {
      const target = homeForSend();
      // A reply still running in the big chat: the message waits its turn there, as it would sent from the chat.
      if (busy() && !canQueue(target.uid)) throw new Error("Pip is still writing a reply. Try again when it is done.");
      const sending = busy() ? queueSend(target.uid, value) : send(target.uid, value);
      setText("");
      void navigate({ to: "/pip" });
      sending.catch(toastError);
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
  };
  return (
    <div className="sticky bottom-0 bg-background pt-2 pb-3">
      <form onSubmit={submit} className="border-t pt-1">
        <div className="flex items-start gap-2">
          <span aria-hidden="true" className="pt-2.5 font-medium text-primary">›</span>
          <Textarea ref={area} rows={1} value={text} onChange={event => setText(event.target.value)} onKeyDown={onKeyDown} maxLength={16000}
            placeholder="message pip" aria-label="Message Pip"
            className="max-h-40 min-h-11 flex-1 resize-none rounded-none border-0 bg-transparent px-0 py-2.5 shadow-none placeholder:text-dim focus-visible:ring-0 dark:bg-transparent" />
          <SendButton label="Send to Pip (Enter)" disabled={!text.trim()} className="mt-1.5" />
        </div>
      </form>
    </div>
  );
}
