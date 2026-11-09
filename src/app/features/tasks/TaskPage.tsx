import { useEffect, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useCollection } from "../../data/bus.ts";
import { lists } from "../../data/lists.ts";
import { parseTask } from "../../data/parse.ts";
import { completeTask, createTask, getTask } from "../../data/tasks.ts";
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

const LABEL = "text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground";

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

  if (!fresh && !task) return <main className="pt-4">
    <button type="button" onClick={() => void navigate({ to: "/tasks" })} className="text-sm text-muted-foreground hover:text-foreground">‹ tasks</button>
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
    <button type="button" onClick={() => void navigate({ to: "/tasks" })} className="mt-4 text-sm text-muted-foreground hover:text-foreground">‹ tasks</button>
    <PageTitle title={fresh ? "new task" : "task"} meta={task ? (task.done ? "done" : "open") : "not saved yet"} />

    <div className="mt-6 space-y-6">
      <div>
        <Label htmlFor="task-text" className={LABEL}>what will you do?</Label>
        <Textarea id="task-text" value={draft.text} maxLength={500} rows={2} placeholder="one action, one line… “call the bank tomorrow !”"
          onChange={event => set("text", event.target.value)} className="mt-2" />
        {hint.labels.length ? <p className="mt-2 flex flex-wrap items-center gap-1.5" aria-live="polite">
          {hint.labels.map((label, index) => <span key={index} className="rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>)}
          <span className="text-[10px] text-dim">from the text, applied on save</span>
        </p> : null}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="task-due" className={LABEL}>date</Label>
          <Input id="task-due" type="date" value={draft.due} onChange={event => set("due", event.target.value)} className="mt-2 h-10" />
        </div>
        <div>
          <Label htmlFor="task-list" className={LABEL}>list</Label>
          <div className="relative mt-2">
            <select id="task-list" value={draft.list} onChange={event => set("list", event.target.value)}
              className="h-10 w-full appearance-none rounded-md border border-input bg-transparent pr-9 pl-3 text-sm text-foreground outline-none focus-visible:border-ring">
              <option value="">inbox</option>
              {listsNow.map(list => <option key={list.uid} value={list.uid}>{list.name}</option>)}
            </select>
            <ChevronDown aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-dashed pt-5">
        <Label htmlFor="task-important" className="text-sm">important</Label>
        <Switch id="task-important" checked={draft.important} onCheckedChange={value => set("important", value)} />
      </div>

      <section className="border-t border-dashed pt-5">
        <div className="flex items-baseline justify-between">
          <h2 className={LABEL}>steps</h2>
          <span className="text-[11px] text-dim">{draft.steps.filter(item => item.done).length}/{draft.steps.length}</span>
        </div>
        {draft.steps.length ? <ul className="mt-1">{draft.steps.map((item, index) => <li key={index} className="flex min-h-11 items-center gap-1 border-t border-dashed">
          <button type="button" role="checkbox" aria-checked={item.done} aria-label={(item.done ? "Reopen step " : "Complete step ") + item.text}
            onClick={() => setDraft(current => ({ ...current, steps: current.steps.map((old, at) => at === index ? { ...old, done: !old.done } : old) }))}
            className="-ml-3 grid size-11 shrink-0 place-items-center rounded-md">
            <span aria-hidden="true" className={cn("grid size-5 place-items-center rounded-sm border text-[11px] leading-none transition-colors",
              item.done ? "border-primary bg-primary text-primary-foreground" : "border-border text-transparent hover:border-primary")}>✓</span>
          </button>
          <span className={cn("min-w-0 flex-1 break-words text-sm", item.done && "text-dim line-through")}>{item.text}</span>
          <Button size="sm" variant="ghost" className="text-dim" aria-label={"Remove step " + item.text}
            onClick={() => setDraft(current => ({ ...current, steps: current.steps.filter((_, at) => at !== index) }))}>×</Button>
        </li>)}</ul> : null}
        <form className="mt-2 flex gap-2" onSubmit={event => { event.preventDefault(); addStep(); }}>
          <Input value={step} maxLength={160} placeholder="add a step…" aria-label="New step" onChange={event => setStep(event.target.value)} className="h-10" />
          <Button type="submit" variant="secondary" disabled={!step.trim()} className="h-10">add</Button>
        </form>
      </section>
    </div>

    <div className="mt-8 space-y-3">
      <Button onClick={save} className="h-11 w-full">save task</Button>
      <div className="flex gap-2">
        {task ? <Button variant="outline" className="h-10 flex-1" onClick={() => attempt(() => { completeTask(task.uid); void navigate({ to: "/tasks" }); })}>{task.done ? "reopen" : "complete"}</Button> : null}
        <Button variant="ghost" className="h-10 flex-1" onClick={() => void navigate({ to: "/tasks" })}>cancel</Button>
        {task ? <Button variant="ghost" className="h-10 text-destructive" onClick={() => void remove()}>delete</Button> : null}
      </div>
    </div>
  </main>;
}
