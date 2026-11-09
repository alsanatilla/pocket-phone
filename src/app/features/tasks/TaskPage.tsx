import { useEffect, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useCollection } from "../../data/bus.ts";
import { lists } from "../../data/lists.ts";
import { parseTask } from "../../data/parse.ts";
import { completeTask, createTask, getTask, today } from "../../data/tasks.ts";
import { tasks as store } from "../../../client/store.js";
import type { Step, Task } from "../../data/types.ts";
import { PageTitle } from "../../ui/PageTitle.tsx";
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

  if (!fresh && !task) return <main className="space-y-3">
    <Button variant="ghost" onClick={() => void navigate({ to: "/tasks" })}>‹ tasks</Button>
    <p className="text-sm text-muted-foreground">This task was removed.</p>
  </main>;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }));
  const hint = parseTask(draft.text, { lists: listsNow });

  function save(): boolean {
    // "tomorrow", "!" and "#list" may be written in the text; a field the person set by hand wins over them.
    const parsed = parseTask(draft.text, { lists: listsNow });
    const text = parsed.text.trim();
    if (!text) { toastError(new Error("Write what you will do.")); return false; }
    if (text.length > 500) { toastError(new Error("Keep it under 500 characters.")); return false; }
    const steps = draft.steps.map(item => ({ text: item.text.trim(), done: item.done })).filter(item => item.text && item.text.length <= 160).slice(0, 32);
    attempt(() => {
      const fields = { text, due: draft.due || parsed.due || "", list: draft.list || parsed.list || "", important: draft.important || Boolean(parsed.important), steps };
      if (task) store.edit(task.uid, current => Object.assign(current, fields));
      else createTask(text, fields);
      setSaved(true);
      toast("Saved.");
      void navigate({ to: "/tasks" });
    });
    return true;
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

  return <main className="space-y-4">
    <PageTitle title={fresh ? "new task" : "task"} meta={task ? (task.done ? "done" : "open") : "not saved yet"} />

    <div className="space-y-3">
      <Label htmlFor="task-text" className="text-[11px] uppercase tracking-wider text-muted-foreground">what will you do?</Label>
      <Textarea id="task-text" value={draft.text} maxLength={500} rows={2} placeholder="one action, one line… “call the bank tomorrow !”"
        onChange={event => set("text", event.target.value)} />
      {hint.labels.length ? <p className="-mt-1 flex flex-wrap gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground" aria-live="polite">
        {hint.labels.map((label, index) => <span key={index} className="rounded-sm border px-1.5 py-0.5">{label}</span>)}
        <span className="text-dim">taken from the text on save</span>
      </p> : null}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="task-due" className="text-[11px] uppercase tracking-wider text-muted-foreground">date</Label>
          <Input id="task-due" type="date" value={draft.due} onChange={event => set("due", event.target.value)} className="h-10" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="task-list" className="text-[11px] uppercase tracking-wider text-muted-foreground">list</Label>
          <select id="task-list" value={draft.list} onChange={event => set("list", event.target.value)}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground">
            <option value="">inbox</option>
            {listsNow.map(list => <option key={list.uid} value={list.uid}>{list.name}</option>)}
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-dashed pt-3">
        <Label htmlFor="task-important" className="text-sm">important</Label>
        <Switch id="task-important" checked={draft.important} onCheckedChange={value => set("important", value)} />
      </div>

      <section className="space-y-2 border-t border-dashed pt-3">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">steps</Label>
        {draft.steps.map((item, index) => <div key={index} className="flex items-center gap-2">
          <button type="button" aria-label={(item.done ? "Reopen step " : "Complete step ") + item.text} aria-pressed={item.done}
            onClick={() => setDraft(current => ({ ...current, steps: current.steps.map((old, at) => at === index ? { ...old, done: !old.done } : old) }))}
            className={cn("grid size-5 shrink-0 place-items-center rounded-sm border text-[11px]",
              item.done ? "border-primary bg-primary text-primary-foreground" : "border-border text-transparent hover:border-primary")}>✓</button>
          <span className={cn("min-w-0 flex-1 break-words text-sm", item.done && "text-dim line-through")}>{item.text}</span>
          <Button size="sm" variant="ghost" aria-label={"Remove step " + item.text}
            onClick={() => setDraft(current => ({ ...current, steps: current.steps.filter((_, at) => at !== index) }))}>×</Button>
        </div>)}
        <form className="flex gap-2" onSubmit={event => { event.preventDefault(); addStep(); }}>
          <Input value={step} maxLength={160} placeholder="add a step…" aria-label="New step" onChange={event => setStep(event.target.value)} className="h-9" />
          <Button type="submit" size="sm" variant="ghost" disabled={!step.trim()}>add</Button>
        </form>
      </section>
    </div>

    <div className="flex flex-wrap gap-2">
      <Button onClick={save} className="flex-1">save task</Button>
      {task ? <Button variant="outline" onClick={() => attempt(() => { completeTask(task.uid); void navigate({ to: "/tasks" }); })}>{task.done ? "reopen" : "complete"}</Button> : null}
      <Button variant="ghost" onClick={() => void navigate({ to: "/tasks" })}>cancel</Button>
      {task ? <Button variant="ghost" className="text-destructive" onClick={() => void remove()}>delete</Button> : null}
    </div>
  </main>;
}
