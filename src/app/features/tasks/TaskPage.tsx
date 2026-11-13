import { useEffect, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Figure, Keys, Row, Section, SectionLabel, Segmented, Tick } from "../../ui/kit.tsx";
import { clock, clockText } from "../../../client/planner.js";
import { endFocus, focusRemaining, focusSession, startFocus } from "../../data/today.ts";
import { useCollection } from "../../data/bus.ts";
import { lists } from "../../data/lists.ts";
import { parseTask } from "../../data/parse.ts";
import { completeTask, createTask, getTask } from "../../data/tasks.ts";
import { tasks as store } from "../../../client/store.js";
import type { Step, Task } from "../../data/types.ts";
import { PageTitle } from "../../ui/PageTitle.tsx";
import { BARE_INPUT } from "../../ui/SendButton.tsx";
import { confirm } from "../../ui/dialog/dialog.ts";
import { toast, toastError } from "../../ui/toast/toast.ts";

// One task: what it is, when, in which list, whether it is important, and its steps. "new" is an empty sheet the
// classic app's links already point at (#/tasks/new), so those links keep working after the move.

const attempt = (work: () => unknown) => { try { work(); } catch (error) { toastError(error); } };

interface Draft { text: string; due: string; list: string; important: boolean; steps: Step[] }

const draftOf = (task: Task | null): Draft => ({ text: task?.text ?? "", due: task?.due ?? "", list: task?.list ?? "", important: Boolean(task?.important), steps: task?.steps ?? [] });

export function TaskPage() {
  const { taskId } = useParams({ from: "/tasks/$taskId" });
  const navigate = useNavigate();
  const fresh = taskId === "new";
  const task = useCollection(["tasks.json"], () => fresh ? null : getTask(taskId), [taskId, fresh]);
  const listsNow = useCollection(["tasks.json"], lists);
  const [draft, setDraft] = useState<Draft>(() => draftOf(task));
  const [step, setStep] = useState("");
  const [saved, setSaved] = useState(false);

  // A task that arrives from sync while the sheet is open fills the fields once; later edits are the person's.
  useEffect(() => { if (task && !saved) setDraft(draftOf(task)); }, [task, saved]);

  if (!fresh && !task) return <main className="pb-4">
    <Button onClick={() => void navigate({ to: "/tasks" })} className="mt-4">‹ tasks</Button>
    <p className="mt-6 text-sm text-muted-foreground">This task was removed.</p>
  </main>;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }));
  const hint = parseTask(draft.text, { lists: listsNow });

  function save(): void {
    // "tomorrow", "!" and "#list" may be written in the text; a field the person set by hand wins over them.
    const parsed = parseTask(draft.text, { lists: listsNow });
    const text = parsed.text.trim();
    if (!text) { toastError(new Error("Write what you will do.")); return; }
    if (text.length > 500) { toastError(new Error("Keep it under 500 characters.")); return; }
    const steps = draft.steps.map(item => ({ text: item.text.trim(), done: item.done })).filter(item => item.text && item.text.length <= 160).slice(0, 32);
    attempt(() => {
      const fields = { text, due: draft.due || parsed.due || "", list: draft.list || parsed.list || "", important: draft.important || Boolean(parsed.important), steps };
      if (task) store.edit(task.uid, current => Object.assign(current, fields));
      else createTask(text, fields);
      setSaved(true);
      toast("Saved.");
      void navigate({ to: "/tasks" });
    });
  }

  async function remove() {
    if (!task) return;
    if (!await confirm({ title: "Delete this task?", message: "It disappears on every device.", confirmLabel: "delete", danger: true })) return;
    attempt(() => { store.remove(task.uid); void navigate({ to: "/tasks" }); });
  }

  function addStep() {
    const value = step.trim();
    if (!value) return;
    if (draft.steps.length >= 32) { toastError(new Error("Use up to 32 steps.")); return; }
    setDraft(current => ({ ...current, steps: [...current.steps, { text: value, done: false }] }));
    setStep("");
  }

  return <main className="pb-4">
    <Button onClick={() => void navigate({ to: "/tasks" })} className="mt-4">‹ tasks</Button>
    <PageTitle title={fresh ? "new task" : "task"} meta={task ? (task.done ? "done" : "open") : "not saved yet"} />

    <div className="mt-6">
      {/* The task itself reads as the page's title; the other fields follow as label/value rows. */}
      <SectionLabel><label htmlFor="task-text">what will you do?</label></SectionLabel>
      <Textarea id="task-text" value={draft.text} maxLength={500} rows={2} placeholder="one action, one line… “call the bank tomorrow !”"
        onChange={event => set("text", event.target.value)}
        className="min-h-11 resize-none rounded-none border-0 bg-transparent px-0 py-1 text-hi shadow-none placeholder:text-dim focus-visible:ring-0 dark:bg-transparent" />
      {hint.labels.length ? <p className="text-xs text-dim" aria-live="polite">
        {hint.labels.join(" · ")} · applied on save
      </p> : null}

      <div className="mt-2">
        <Row end={<Input id="task-due" type="date" value={draft.due} onChange={event => set("due", event.target.value)} className={cn(BARE_INPUT, "w-40 text-right")} />}>
          <label htmlFor="task-due" className="text-dim">date</label>
        </Row>
        <Row end={<div className="relative w-40 min-w-0">
          <select id="task-list" value={draft.list} onChange={event => set("list", event.target.value)}
            className="min-h-11 w-full appearance-none rounded-none border-0 bg-transparent pr-6 pl-0 text-right text-sm text-foreground outline-none focus-visible:ring-0 sm:min-h-0">
            <option value="">inbox</option>
            {listsNow.map(list => <option key={list.uid} value={list.uid}>{list.name}</option>)}
          </select>
          <ChevronDown aria-hidden="true" className="pointer-events-none absolute top-1/2 right-0 size-3.5 -translate-y-1/2 text-dim" />
        </div>}>
          <label htmlFor="task-list" className="text-dim">list</label>
        </Row>
        <Row end={<Switch checked={draft.important} aria-label="important" onCheckedChange={next => set("important", next)} />}>
          <span className="text-dim">important</span>
        </Row>
      </div>

      <Section label={<span role="heading" aria-level={2}>steps</span>} note={`${draft.steps.filter(item => item.done).length}/${draft.steps.length}`} className="mt-6">
        {draft.steps.length ? <ul className="space-y-1">
          {draft.steps.map((item, index) => <li key={index}>
            <Row lead={<Tick checked={item.done} label={(item.done ? "Reopen step " : "Complete step ") + item.text}
              onChange={() => setDraft(current => ({ ...current, steps: current.steps.map((old, at) => at === index ? { ...old, done: !old.done } : old) }))} />}
              dim={item.done}
              end={<Button type="button" variant="destructive" size="sm" aria-label={"Remove step " + item.text}
                onClick={() => setDraft(current => ({ ...current, steps: current.steps.filter((_, at) => at !== index) }))}>remove</Button>}>
              {item.text}
            </Row>
          </li>)}
        </ul> : null}
        <form className="flex min-h-11 items-center gap-2 sm:min-h-0" onSubmit={event => { event.preventDefault(); addStep(); }}>
          <span aria-hidden="true" className="text-dim">+</span>
          <Input value={step} maxLength={160} placeholder="add a step…" aria-label="New step" onChange={event => setStep(event.target.value)} className={BARE_INPUT} />
          <Button type="submit" disabled={!step.trim()}>add</Button>
        </form>
      </Section>
    </div>

    {task && !task.done ? <TaskFocus uid={task.uid} /> : null}

    <Keys className="mt-6">
      <Button onClick={save} variant="go">save task</Button>
      {task ? <Button onClick={() => attempt(() => { completeTask(task.uid); void navigate({ to: "/tasks" }); })}>{task.done ? "reopen" : "complete"}</Button> : null}
      <Button onClick={() => void navigate({ to: "/tasks" })}>cancel</Button>
      {task ? <Button variant="destructive" onClick={() => void remove()}>delete</Button> : null}
    </Keys>
  </main>;
}

/**
 * A focus session on this task: 15, 25 or 45 minutes on the room timer (the clock), which keeps running when the page
 * closes and rings when it ends. One session at a time: while another task has one, this says so.
 */
function TaskFocus({ uid }: { uid: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const session = useCollection(["clock.json"], () => focusSession(now), [Math.floor(now / 1000)]);
  const [minutes, setMinutes] = useState("25");
  const mine = session && session.task_uid === uid ? session : null;
  const remaining = mine ? focusRemaining(mine, now) : 0;
  return <Section label="focus" className="mt-6">
    {mine ? <>
      <div role="timer" aria-label="Focus time remaining"><Figure label="remaining" value={remaining > 0 ? clockText(remaining) : "done"} /></div>
      <Keys className="mt-3">
        {remaining > 0 ? <Button type="button" onClick={() => attempt(() => mine.enabled ? clock.pause(mine.uid) : clock.resume(mine.uid))}>{mine.enabled ? "pause" : "resume"}</Button> : null}
        <Button type="button" onClick={() => attempt(() => endFocus(mine.uid))}>{remaining > 0 ? "end session" : "finish session"}</Button>
      </Keys>
    </> : session && focusRemaining(session, now) > 0 ? <p className="text-sm text-muted-foreground">A focus session runs on “{session.title}”. End it there to focus on this one.</p> : <>
      <Segmented label="Focus duration" value={minutes} onChange={setMinutes} options={["15", "25", "45"].map(value => ({ value, label: value + " min" }))} />
      <Keys className="mt-3"><Button type="button" onClick={() => attempt(() => startFocus(uid, Number(minutes)))}>start focus</Button></Keys>
    </>}
  </Section>;
}
