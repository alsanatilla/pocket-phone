import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { agenda, clock, clockText } from "../../client/planner.js";
import { activeAccount } from "../../client/workspace-storage.js";
import { useCollection } from "../data/bus.ts";
import { getTask, listTasks, completeTask, today } from "../data/tasks.ts";
import { getNote, noteTitle } from "../data/notes.ts";
import { addStep, createPrep, dailyNote, dailyNoteText, deferTask, endFocus, focusRemaining, focusSession, linkPrep, nextEvent, nextTask, saveDailyNote, selectTask, startFocus, toggleStep, tomorrow } from "../data/today.ts";
import type { Task } from "../data/types.ts";
import { hrefFor } from "../lib/classic.ts";
import { toast, toastError } from "../ui/toast/toast.ts";

const attempt = (work: () => unknown) => { try { work(); } catch (error) { toastError(error); } };
function Block({ title, children }: { title: string; children: ReactNode }) {
  return <section className="space-y-3 rounded-lg border bg-card p-4"><h2 className="text-[11px] uppercase tracking-wider text-primary">{title}</h2>{children}</section>;
}
function useNow(period = 1000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), period); return () => clearInterval(id); }, [period]);
  return now;
}
const selectClass = "w-full min-w-0 rounded-md border bg-background p-2 text-sm text-foreground";
function TaskSteps({ task }: { task: Task }) {
  const [text, setText] = useState("");
  return <div className="space-y-2">
    {task.steps.map((step, index) => <label key={index + step.text} className="flex items-start gap-2 py-1 text-sm">
      <input type="checkbox" className="mt-1 accent-primary" checked={step.done} onChange={event => attempt(() => toggleStep(task.uid, index, step.text, event.target.checked))} />
      <span className={step.done ? "text-muted-foreground line-through" : ""}>{step.text}</span>
    </label>)}
    {!task.done ? <form className="flex gap-2" onSubmit={event => { event.preventDefault(); attempt(() => { addStep(task.uid, text); setText(""); }); }}>
      <Input aria-label="New step" placeholder="add a step…" maxLength={500} value={text} onChange={event => setText(event.target.value)} className="h-9" />
      <Button type="submit" size="sm" variant="ghost" className="h-9" disabled={!text.trim()}>add</Button>
    </form> : null}
  </div>;
}
function TaskNote({ task }: { task: Task }) {
  const note = useCollection(["notes.json"], () => task.source?.note_uid ? getNote(task.source.note_uid) : null, [task.source?.note_uid]);
  return note ? <a className="block truncate text-xs text-primary" href={hrefFor("/notes/" + note.uid)}>↗ {noteTitle(note)}</a> : null;
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
    {session ? <h3 className="text-base">{task?.text ?? session.title}</h3> : open.length ? <select aria-label="Focus task" className={selectClass} value={task?.uid ?? ""} onChange={event => attempt(() => selectTask(event.target.value))}>
      {open.map(item => <option key={item.uid} value={item.uid}>{item.text}</option>)}
    </select> : <a href={hrefFor("/tasks/new")} className="text-sm text-primary">+ add a task</a>}
    {session || task ? <>
      <div className="py-2 text-center font-pixel text-7xl leading-none text-primary" role="timer" aria-label="Focus time remaining">{done ? "done" : clockText(remaining)}</div>
      {!session ? <div className="flex justify-center gap-2" aria-label="Focus duration">{[15, 25, 45].map(value => <Button key={value} size="sm" variant={minutes === value ? "secondary" : "ghost"} aria-pressed={minutes === value} onClick={() => setMinutes(value)}>{value} min</Button>)}</div> : null}
      <div className="flex gap-2">
        {!session ? <Button className="flex-1" onClick={() => attempt(() => task && startFocus(task.uid, minutes))}>start focus</Button>
          : <>
            {!done ? <Button className="flex-1" onClick={() => attempt(() => session.enabled ? clock.pause(session.uid) : clock.resume(session.uid))}>{session.enabled ? "pause" : "resume"}</Button> : null}
            <Button variant="outline" className="flex-1" onClick={() => attempt(() => endFocus(session.uid))}>{done ? "finish session" : "end session"}</Button>
          </>}
      </div>
      {task ? <>
        <TaskSteps key={task.uid} task={task} /><TaskNote task={task} />
        {!task.done ? <Button variant="outline" size="sm" className="h-9" aria-label={"Complete " + task.text} onClick={() => attempt(() => { if (!getTask(task.uid)?.done) completeTask(task.uid); if (session) endFocus(session.uid); toast("Done."); })}>complete task</Button> : <p className="text-xs text-muted-foreground">Task completed</p>}
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
    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>{sameDay ? time : when.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }) + " · " + time} · {event.minutes} min</span>
      <span>{until <= 0 ? "now" : sameDay && until <= 60 ? "in " + until + " min" : ""}</span>
    </div>
    <h3 className="text-xl">{event.title}</h3>
    <a href={hrefFor("/calendar/" + event.uid)} className="inline-block text-xs text-primary">open event ↗</a>
    {task ? <div className="space-y-3 border-t pt-3">
      <div className="flex items-center justify-between gap-2"><h4 className="text-sm">{task.text}</h4><Button size="sm" variant="ghost" onClick={() => attempt(() => linkPrep(event.uid, ""))}>unlink</Button></div>
      <TaskSteps key={task.uid} task={task} /><TaskNote task={task} />
      {task.done ? <p className="text-xs text-movement">Ready</p> : <Button variant="outline" size="sm" onClick={() => attempt(() => { if (!getTask(task.uid)?.done) completeTask(task.uid); })}>prep done</Button>}
    </div> : <div className="flex flex-wrap gap-2 border-t pt-3">
      <Button variant="outline" size="sm" onClick={() => attempt(() => createPrep(event.uid))}>+ prep checklist</Button>
      {open.length ? <select aria-label="Link preparation task" className={selectClass} value="" onChange={change => attempt(() => linkPrep(event.uid, change.target.value))}>
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
  return <form className="space-y-2 border-t pt-3" onSubmit={event => {
    event.preventDefault(); attempt(() => { const saved = saveDailyNote(text, day, version); setVersion(saved.updated); setDirty(false); toast("Saved."); });
  }}>
    <label htmlFor="today-note" className="text-xs text-muted-foreground">one line about today</label>
    <Input id="today-note" maxLength={2000} value={text} onChange={event => { setText(event.target.value); setDirty(true); }} placeholder="worth remembering…" />
    <Button type="submit" size="sm" variant="outline" disabled={!text.trim() || !dirty}>save note</Button>
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
    <div className="flex items-baseline gap-2"><span className="font-pixel text-4xl text-movement">{finished.length}</span><span className="text-xs text-muted-foreground">done today</span></div>
    {finished.length ? <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">completed</summary><ul className="mt-2 space-y-1">{finished.map(task => <li key={task.uid}>{task.text}</li>)}</ul></details> : null}
    {loose.length ? <ul className="divide-y">{loose.map(task => <li key={task.uid} className="py-3">
      <p className="text-sm">{task.text}</p><div className="mt-2 flex flex-wrap gap-1">
        <Button size="sm" variant="outline" aria-label={"Move " + task.text + " to tomorrow"} onClick={() => move(task, tomorrow())}>tomorrow ↗</Button>
        <Button size="sm" variant="ghost" aria-label={"Defer " + task.text} onClick={() => move(task, "")}>later</Button>
        <Button size="sm" variant="ghost" aria-label={"Complete " + task.text} onClick={() => attempt(() => { if (!getTask(task.uid)?.done) completeTask(task.uid); })}>done</Button>
      </div>
    </li>)}</ul> : <p className="text-sm text-muted-foreground">Nothing left due today.</p>}
    {undo ? <Button size="sm" variant="ghost" onClick={() => attempt(() => {
      if (getTask(undo.uid)?.due !== undo.next) throw new Error("This task changed since you moved it.");
      deferTask(undo.uid, undo.due); setUndo(null);
    })}>undo move</Button> : null}
    {first ? <div className="border-t pt-3"><p className="text-xs text-muted-foreground">tomorrow</p><p className="mt-1 text-sm">{first.text}</p></div> : null}
    <DayNote key={activeAccount() + day} day={day} />
  </Block>;
}
