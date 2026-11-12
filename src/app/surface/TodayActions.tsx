import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { clock, clockText } from "../../client/planner.js";
import { activeAccount } from "../../client/workspace-storage.js";
import { useCollection } from "../data/bus.ts";
import { getTask, listTasks, completeTask, today } from "../data/tasks.ts";
import { getNote, noteTitle } from "../data/notes.ts";
import { addStep, createPrep, dailyNote, dailyNoteText, deferTask, endFocus, focusRemaining, focusSession, linkPrep, nextEvent, nextTask, saveDailyNote, selectTask, startFocus, toggleStep, tomorrow } from "../data/today.ts";
import type { Task } from "../data/types.ts";
import { hrefFor } from "../lib/classic.ts";
import { toast, toastError } from "../ui/toast/toast.ts";

// Today's actions, drawn as Terminal rows and words: a block is a small label and hairlines, never a box; a field is
// a prompt line; an action is a lower-case word. Live data stays live: the lists read the stores themselves.

const attempt = (work: () => unknown) => { try { work(); } catch (error) { toastError(error); } };
const LABEL = "text-[10.5px] uppercase tracking-[0.06em] text-dim";
const ACTION = "min-h-11 text-xs text-dim hover:text-foreground disabled:text-dim sm:min-h-0";
const FIELD_LINE = "flex min-h-11 items-center gap-2 border-t py-2 sm:min-h-0";
const FIELD_INPUT = "min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-sm text-foreground placeholder:text-dim";
const BARE_SELECT = "min-h-11 min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-foreground sm:min-h-0";

function Block({ title, children }: { title: string; children: ReactNode }) {
  return <section className="arrive space-y-2"><h2 className={LABEL}>{title}</h2>{children}</section>;
}
function useNow(period = 1000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), period); return () => clearInterval(id); }, [period]);
  return now;
}
function TaskSteps({ task }: { task: Task }) {
  const [text, setText] = useState("");
  return <div>
    {task.steps.map((step, index) => <label key={index + step.text} className="flex min-h-11 items-start gap-2.5 border-t py-2 text-sm sm:min-h-0">
      <input type="checkbox" checked={step.done} onChange={event => attempt(() => toggleStep(task.uid, index, step.text, event.target.checked))} className="peer sr-only" />
      <span aria-hidden="true" className="shrink-0 text-dim peer-focus-visible:text-hi">[{step.done ? "x" : " "}]</span>
      <span className={cn("min-w-0", step.done ? "text-dim line-through" : "text-hi")}>{step.text}</span>
    </label>)}
    {!task.done ? <form className={FIELD_LINE} onSubmit={event => { event.preventDefault(); attempt(() => { addStep(task.uid, text); setText(""); }); }}>
      <span aria-hidden="true" className="text-dim">+</span>
      <input aria-label="New step" placeholder="add a step…" maxLength={500} value={text} onChange={event => setText(event.target.value)} className={FIELD_INPUT} />
      <button type="submit" disabled={!text.trim()} className={ACTION}>add</button>
    </form> : null}
  </div>;
}
function TaskNote({ task }: { task: Task }) {
  const note = useCollection(["notes.json"], () => task.source?.note_uid ? getNote(task.source.note_uid) : null, [task.source?.note_uid]);
  return note ? <a className="block truncate text-xs text-primary underline-offset-2 hover:underline" href={hrefFor("/notes/" + note.uid)}>note: {noteTitle(note)}</a> : null;
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
      <p className="text-[19px] font-medium leading-none text-hi" role="timer" aria-label="Focus time remaining">{done ? "done" : clockText(remaining)}</p>
      {!session ? <div className="flex gap-4" aria-label="Focus duration">{[15, 25, 45].map(value => <button key={value} type="button" aria-pressed={minutes === value} onClick={() => setMinutes(value)}
        className={cn(ACTION, minutes === value && "text-hi")}>{value} min</button>)}</div> : null}
      <div className="flex gap-4">
        {!session ? <button type="button" className={ACTION} onClick={() => attempt(() => task && startFocus(task.uid, minutes))}>start focus</button>
          : <>
            {!done ? <button type="button" className={ACTION} onClick={() => attempt(() => session.enabled ? clock.pause(session.uid) : clock.resume(session.uid))}>{session.enabled ? "pause" : "resume"}</button> : null}
            <button type="button" className={ACTION} onClick={() => attempt(() => endFocus(session.uid))}>{done ? "finish session" : "end session"}</button>
          </>}
      </div>
      {task ? <>
        <TaskSteps key={task.uid} task={task} /><TaskNote task={task} />
        {!task.done ? <button type="button" className={ACTION} aria-label={"Complete " + task.text} onClick={() => attempt(() => { if (!getTask(task.uid)?.done) completeTask(task.uid); if (session) endFocus(session.uid); toast("Done."); })}>complete task</button>
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
    <a href={hrefFor("/calendar/" + event.uid)} className="inline-flex min-h-11 items-center text-xs text-primary underline-offset-2 hover:underline sm:min-h-0">open event</a>
    {task ? <div className="space-y-2 border-t pt-2">
      <div className="flex items-center justify-between gap-3"><p className="text-sm text-hi">{task.text}</p><button type="button" className={ACTION} onClick={() => attempt(() => linkPrep(event.uid, ""))}>unlink</button></div>
      <TaskSteps key={task.uid} task={task} /><TaskNote task={task} />
      {task.done ? <p className="text-xs text-dim">ready</p> : <button type="button" className={ACTION} onClick={() => attempt(() => { if (!getTask(task.uid)?.done) completeTask(task.uid); })}>prep done</button>}
    </div> : <div className="flex flex-wrap items-center gap-4 border-t pt-2">
      <button type="button" className={ACTION} onClick={() => attempt(() => createPrep(event.uid))}>prep checklist</button>
      {open.length ? <select aria-label="Link preparation task" className={cn(BARE_SELECT, "text-xs text-dim")} value="" onChange={change => attempt(() => linkPrep(event.uid, change.target.value))}>
        <option value="">link a task…</option>{open.map(item => <option key={item.uid} value={item.uid}>{item.text}</option>)}
      </select> : null}
    </div>}
  </Block>;
}

function DayNote({ day }: { day: string }) {
  const note = useCollection(["notes.json"], () => dailyNote(day), [day]);
  const [text, setText] = useState(() => dailyNoteText(day));
  const [version, setVersion] = useState(note?.updated ?? 0);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) { setText(dailyNoteText(day)); setVersion(note?.updated ?? 0); } }, [note?.updated, day, dirty]);
  return <form className="space-y-1 border-t pt-2" onSubmit={event => {
    event.preventDefault(); attempt(() => { const saved = saveDailyNote(text, day, version); setVersion(saved.updated); setDirty(false); toast("Saved."); });
  }}>
    <p id="today-note-label" className={LABEL}>one line about today</p>
    <label className={FIELD_LINE}>
      <span aria-hidden="true" className="text-dim">›</span>
      <input id="today-note" aria-labelledby="today-note-label" maxLength={2000} value={text} onChange={event => { setText(event.target.value); setDirty(true); }} placeholder="worth remembering…" className={FIELD_INPUT} />
      <button type="submit" disabled={!text.trim() || !dirty} className={ACTION}>save</button>
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
  function move(task: Task, due: string) {
    attempt(() => { deferTask(task.uid, due); setUndo({ uid: task.uid, due: task.due, next: due }); });
  }
  return <Block title={title ?? "close the day"}>
    <div>
      <p className={LABEL}>done today</p>
      <p className="mt-1 text-[19px] font-medium leading-none text-hi">{finished.length}</p>
    </div>
    {finished.length ? <details>
      <summary className="flex min-h-11 cursor-pointer items-center text-xs text-dim hover:text-foreground sm:min-h-0">completed</summary>
      <ul className="mt-1">{finished.map(task => <li key={task.uid} className="border-t py-2 text-sm text-muted-foreground">{task.text}</li>)}</ul>
    </details> : null}
    {loose.length ? <ul>{loose.map(task => <li key={task.uid} className="border-t py-2 last:border-b">
      <p className="text-sm text-hi">{task.text}</p>
      <div className="mt-1 flex flex-wrap gap-4">
        <button type="button" className={ACTION} aria-label={"Move " + task.text + " to tomorrow"} onClick={() => move(task, tomorrow())}>tomorrow</button>
        <button type="button" className={ACTION} aria-label={"Defer " + task.text} onClick={() => move(task, "")}>later</button>
        <button type="button" className={ACTION} aria-label={"Complete " + task.text} onClick={() => attempt(() => { if (!getTask(task.uid)?.done) completeTask(task.uid); })}>done</button>
      </div>
    </li>)}</ul> : <p className="text-sm text-muted-foreground">Nothing left due today.</p>}
    {undo ? <button type="button" className={ACTION} onClick={() => attempt(() => {
      if (getTask(undo.uid)?.due !== undo.next) throw new Error("This task changed since you moved it.");
      deferTask(undo.uid, undo.due); setUndo(null);
    })}>undo move</button> : null}
    {first ? <div className="border-t pt-2"><p className={LABEL}>tomorrow</p><p className="mt-1 text-sm text-hi">{first.text}</p></div> : null}
    <DayNote key={activeAccount() + day} day={day} />
  </Block>;
}
