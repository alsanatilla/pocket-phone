import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "../components/ui/button.tsx";
import { clock, clockText } from "../../client/planner.js";
import { activeAccount } from "../../client/workspace-storage.js";
import { useCollection } from "../data/bus.ts";
import { getTask, listTasks, completeTask, today } from "../data/tasks.ts";
import { getNote, noteTitle } from "../data/notes.ts";
import { addStep, createPrep, dailyNote, dailyNoteText, deferTask, endFocus, focusRemaining, focusSession, linkPrep, nextEvent, nextTask, saveDailyNote, selectTask, startFocus, toggleStep, tomorrow } from "../data/today.ts";
import type { Task } from "../data/types.ts";
import { hrefFor } from "../lib/classic.ts";
import { Figure, Keys, Row, Section, SectionLabel, Segmented, Tick } from "../ui/kit.tsx";
import { toast, toastError } from "../ui/toast/toast.ts";

// Today's actions, drawn as Terminal blocks: a Section with its label, Rows for what can be read or ticked, keys
// for what can be pressed, and a prompt line for a field. Live data stays live: the lists read the stores
// themselves.

const attempt = (work: () => unknown) => { try { work(); } catch (error) { toastError(error); } };
const FIELD_LINE = "flex min-h-11 items-center gap-2 py-2 sm:min-h-0";
const FIELD_INPUT = "min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-sm text-foreground placeholder:text-dim";
const BARE_SELECT = "min-h-11 min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-foreground sm:min-h-0";

function Block({ title, children }: { title: string; children: ReactNode }) {
  return <Section className="arrive mb-0" label={title}>{children}</Section>;
}
function useNow(period = 1000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), period); return () => clearInterval(id); }, [period]);
  return now;
}
function TaskSteps({ task }: { task: Task }) {
  const [text, setText] = useState("");
  return <div>
    {task.steps.map((step, index) => (
      <Row key={index + step.text} lead={<Tick checked={step.done} label={step.text} onChange={next => attempt(() => toggleStep(task.uid, index, step.text, next))} />}>
        <span className={cn(step.done && "text-dim line-through")}>{step.text}</span>
      </Row>
    ))}
    {!task.done ? <form className={FIELD_LINE} onSubmit={event => { event.preventDefault(); attempt(() => { addStep(task.uid, text); setText(""); }); }}>
      <span aria-hidden="true" className="text-dim">+</span>
      <input aria-label="New step" placeholder="add a step…" maxLength={500} value={text} onChange={event => setText(event.target.value)} className={FIELD_INPUT} />
      <Button type="submit" size="xs" disabled={!text.trim()}>add</Button>
    </form> : null}
  </div>;
}
function TaskNote({ task }: { task: Task }) {
  const note = useCollection(["notes.json"], () => task.source?.note_uid ? getNote(task.source.note_uid) : null, [task.source?.note_uid]);
  return note ? <a className="block truncate text-xs text-primary underline underline-offset-2" href={hrefFor("/notes/" + note.uid)}>note: {noteTitle(note)}</a> : null;
}

export function FocusSession({ title }: { title?: string | null }) {
  const now = useNow();
  const { session, task, open } = useCollection(["tasks.json", "clock.json"], () => {
    const session = focusSession(now);
    return { session, task: session?.task_uid ? getTask(session.task_uid) : nextTask(), open: listTasks().filter(task => !task.done) };
  }, [Math.floor(now / 1000)]);
  const [minutes, setMinutes] = useState(25);
  const remaining = session ? focusRemaining(session, now) : minutes * 60000;
  const done = Boolean(session && remaining <= 0);
  return <Block title={title ?? "focus"}>
    {session ? <p className="text-sm text-hi">{task?.text ?? session.title}</p> : open.length ? (
      <label className={FIELD_LINE}>
        <span aria-hidden="true" className="text-dim">›</span>
        <select aria-label="Focus task" className={BARE_SELECT} value={task?.uid ?? ""} onChange={event => attempt(() => selectTask(event.target.value))}>
          {open.map(item => <option key={item.uid} value={item.uid}>{item.text}</option>)}
        </select>
      </label>
    ) : <p className="text-sm text-muted-foreground">No open task to focus on.</p>}
    {session || task ? <>
      <div role="timer" aria-label="Focus time remaining"><Figure label="remaining" value={done ? "done" : clockText(remaining)} /></div>
      {!session ? <div className="mt-3"><Segmented label="Focus duration" value={String(minutes)} onChange={value => setMinutes(Number(value))}
        options={[15, 25, 45].map(value => ({ value: String(value), label: value + " min" }))} /></div> : null}
      <Keys className="mt-3">
        {!session ? <Button type="button" onClick={() => attempt(() => task && startFocus(task.uid, minutes))}>start focus</Button>
          : <>
            {!done ? <Button type="button" onClick={() => attempt(() => session.enabled ? clock.pause(session.uid) : clock.resume(session.uid))}>{session.enabled ? "pause" : "resume"}</Button> : null}
            <Button type="button" onClick={() => attempt(() => endFocus(session.uid))}>{done ? "finish session" : "end session"}</Button>
          </>}
      </Keys>
      {task ? <>
        <TaskSteps key={task.uid} task={task} /><TaskNote task={task} />
        {!task.done ? <Keys className="mt-3"><Button type="button" aria-label={"Complete " + task.text} onClick={() => attempt(() => { if (!getTask(task.uid)?.done) completeTask(task.uid); if (session) endFocus(session.uid); toast("Done."); })}>complete task</Button></Keys>
          : <p className="text-xs text-dim">task completed</p>}
      </> : null}
    </> : null}
  </Block>;
}

export function EventPrep({ title }: { title?: string | null }) {
  const now = useNow(15000);
  const { event, task, open } = useCollection(["agenda.json", "tasks.json"], () => {
    const event = nextEvent(now);
    return { event, task: event?.task_uid ? getTask(event.task_uid) : null, open: listTasks().filter(task => !task.done) };
  }, [Math.floor(now / 15000)]);
  if (!event) return null;
  const until = Math.ceil((event.when - now) / 60000);
  const when = new Date(event.when);
  const sameDay = today(event.when) === today(now);
  const time = when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return <Block title={title ?? "up next"}>
    <div className="flex items-baseline justify-between gap-2 text-xs text-dim">
      <span>{sameDay ? time : when.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }) + " · " + time} · {event.minutes} min</span>
      <span className="shrink-0">{until <= 0 ? "now" : sameDay && until <= 60 ? "in " + until + " min" : ""}</span>
    </div>
    <p className="text-sm text-hi">{event.title}</p>
    <Keys className="mt-2"><Button asChild size="sm"><a href={hrefFor("/calendar/" + event.uid)}>open event</a></Button></Keys>
    {task ? <div className="mt-3">
      <Row end={<Button type="button" size="xs" onClick={() => attempt(() => linkPrep(event.uid, ""))}>unlink</Button>}>{task.text}</Row>
      <TaskSteps key={task.uid} task={task} /><TaskNote task={task} />
      {task.done ? <p className="text-xs text-dim">ready</p> : <Keys className="mt-3"><Button type="button" onClick={() => attempt(() => { if (!getTask(task.uid)?.done) completeTask(task.uid); })}>prep done</Button></Keys>}
    </div> : <div>
      <Keys className="mt-3"><Button type="button" onClick={() => attempt(() => createPrep(event.uid))}>prep checklist</Button></Keys>
      {open.length ? <label className={FIELD_LINE}>
        <span aria-hidden="true" className="text-dim">›</span>
        <select aria-label="Link preparation task" className={cn(BARE_SELECT, "text-xs text-dim")} value="" onChange={change => attempt(() => linkPrep(event.uid, change.target.value))}>
          <option value="">link a task…</option>{open.map(item => <option key={item.uid} value={item.uid}>{item.text}</option>)}
        </select>
      </label> : null}
    </div>}
  </Block>;
}

function DayNote({ day }: { day: string }) {
  const note = useCollection(["notes.json"], () => dailyNote(day), [day]);
  const [text, setText] = useState(() => dailyNoteText(day));
  const [version, setVersion] = useState(note?.updated ?? 0);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) { setText(dailyNoteText(day)); setVersion(note?.updated ?? 0); } }, [note?.updated, day, dirty]);
  return <form className="mt-3" onSubmit={event => {
    event.preventDefault(); attempt(() => { const saved = saveDailyNote(text, day, version); setVersion(saved.updated); setDirty(false); toast("Saved."); });
  }}>
    <div id="today-note-label"><SectionLabel>one line about today</SectionLabel></div>
    <label className={FIELD_LINE}>
      <span aria-hidden="true" className="text-dim">›</span>
      <input id="today-note" aria-labelledby="today-note-label" maxLength={2000} value={text} onChange={event => { setText(event.target.value); setDirty(true); }} placeholder="worth remembering…" className={FIELD_INPUT} />
      <Button type="submit" size="xs" disabled={!text.trim() || !dirty}>save</Button>
    </label>
  </form>;
}
export function DayReview({ title }: { title?: string | null }) {
  const now = useNow(30000), day = today(now);
  const { finished, loose, first } = useCollection(["tasks.json"], () => {
    const all = listTasks();
    return { finished: all.filter(task => task.done && today(task.updated) === day), loose: all.filter(task => !task.done && task.due && task.due <= day), first: all.find(task => !task.done && task.due === tomorrow(now)) };
  }, [day]);
  const [undo, setUndo] = useState<{ uid: string; due: string; next: string } | null>(null);
  const [showDone, setShowDone] = useState(false);
  function move(task: Task, due: string) {
    attempt(() => { deferTask(task.uid, due); setUndo({ uid: task.uid, due: task.due, next: due }); });
  }
  return <Block title={title ?? "close the day"}>
    <Figure label="done today" value={finished.length} />
    {finished.length ? <div className="mt-3">
      <Button type="button" size="xs" aria-expanded={showDone} onClick={() => setShowDone(value => !value)}>completed</Button>
      {showDone ? finished.map(task => <Row key={task.uid}><span className="text-dim">{task.text}</span></Row>) : null}
    </div> : null}
    {loose.length ? <div className="mt-3">{loose.map(task => <div key={task.uid} className="mb-3 last:mb-0">
      <Row>{task.text}</Row>
      <Keys className="mt-1">
        <Button type="button" size="xs" aria-label={"Move " + task.text + " to tomorrow"} onClick={() => move(task, tomorrow())}>tomorrow</Button>
        <Button type="button" size="xs" aria-label={"Defer " + task.text} onClick={() => move(task, "")}>later</Button>
        <Button type="button" size="xs" aria-label={"Complete " + task.text} onClick={() => attempt(() => { if (!getTask(task.uid)?.done) completeTask(task.uid); })}>done</Button>
      </Keys>
    </div>)}</div> : <p className="mt-3 text-sm text-muted-foreground">Nothing left due today.</p>}
    {undo ? <Keys className="mt-2"><Button type="button" size="xs" onClick={() => attempt(() => {
      if (getTask(undo.uid)?.due !== undo.next) throw new Error("This task changed since you moved it.");
      deferTask(undo.uid, undo.due); setUndo(null);
    })}>undo move</Button></Keys> : null}
    {first ? <div className="mt-3"><SectionLabel>tomorrow</SectionLabel><p className="text-sm text-hi">{first.text}</p></div> : null}
    <DayNote key={activeAccount() + day} day={day} />
  </Block>;
}
