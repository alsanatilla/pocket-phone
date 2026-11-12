import { useEffect, useState, type ComponentProps } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
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

const LABEL = "text-[10.5px] uppercase tracking-[0.06em] text-dim";

/** An action on a task is a word, with a 44px tap target on a touch screen. */
function Action({ className, children, type = "button", ...props }: ComponentProps<"button">) {
  return <button type={type} {...props}
    className={cn("flex min-h-11 items-center text-sm text-dim transition-colors hover:text-foreground disabled:opacity-50 sm:min-h-0", className)}>{children}</button>;
}

/** A step's checkbox is the text [ ] or [x], not a box of its own. */
function StepCheck({ done, onClick, label }: { done: boolean; onClick: () => void; label: string }) {
  return <button type="button" role="checkbox" aria-checked={done} aria-label={label} onClick={onClick}
    className="flex min-h-11 shrink-0 items-start text-dim sm:min-h-0">{done ? "[x]" : "[ ]"}</button>;
}

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
    <Action onClick={() => void navigate({ to: "/tasks" })} className="mt-4 text-xs">‹ tasks</Action>
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
    <Action onClick={() => void navigate({ to: "/tasks" })} className="mt-4 text-xs">‹ tasks</Action>
    <PageTitle title={fresh ? "new task" : "task"} meta={task ? (task.done ? "done" : "open") : "not saved yet"} />

    <div className="mt-[18px]">
      {/* The task itself reads as the page's title; the other fields follow as label/value rows. */}
      <div className="border-t pt-2">
        <label htmlFor="task-text" className={LABEL}>what will you do?</label>
        <Textarea id="task-text" value={draft.text} maxLength={500} rows={2} placeholder="one action, one line… “call the bank tomorrow !”"
          onChange={event => set("text", event.target.value)}
          className="mt-1 min-h-11 resize-none rounded-none border-0 bg-transparent px-0 py-1 text-hi shadow-none placeholder:text-dim focus-visible:ring-0 dark:bg-transparent" />
      </div>
      {hint.labels.length ? <p className="text-xs text-dim" aria-live="polite">
        {hint.labels.join(" · ")} · applied on save
      </p> : null}

      <div className="mt-2">
        <div className="flex min-h-11 items-center gap-3 border-t py-2 sm:min-h-0">
          <label htmlFor="task-due" className={cn(LABEL, "shrink-0")}>date</label>
          <Input id="task-due" type="date" value={draft.due} onChange={event => set("due", event.target.value)} className={cn(BARE_INPUT, "text-right")} />
        </div>
        <div className="flex min-h-11 items-center gap-3 border-t py-2 sm:min-h-0">
          <label htmlFor="task-list" className={cn(LABEL, "shrink-0")}>list</label>
          <div className="relative min-w-0 flex-1">
            <select id="task-list" value={draft.list} onChange={event => set("list", event.target.value)}
              className="min-h-11 w-full appearance-none rounded-none border-0 bg-transparent pr-6 pl-0 text-right text-sm text-foreground outline-none focus-visible:ring-0 sm:min-h-0">
              <option value="">inbox</option>
              {listsNow.map(list => <option key={list.uid} value={list.uid}>{list.name}</option>)}
            </select>
            <ChevronDown aria-hidden="true" className="pointer-events-none absolute top-1/2 right-0 size-3.5 -translate-y-1/2 text-dim" />
          </div>
        </div>
        <div className="flex min-h-11 items-center gap-3 border-t py-2 sm:min-h-0">
          <span className={cn(LABEL, "shrink-0")}>important</span>
          <Action role="switch" aria-checked={draft.important} aria-label="important" onClick={() => set("important", !draft.important)}
            className="ml-auto justify-end">{draft.important ? "[x]" : "[ ]"}</Action>
        </div>
      </div>

      <section className="mt-[18px] border-t pt-2">
        <div className="flex items-baseline justify-between pb-1">
          <h2 className={LABEL}>steps</h2>
          <span className="text-xs text-dim">{draft.steps.filter(item => item.done).length}/{draft.steps.length}</span>
        </div>
        {draft.steps.length ? <ul>
          {draft.steps.map((item, index) => <li key={index} className="flex gap-2.5 border-t py-2 last:border-b">
            <StepCheck done={item.done} label={(item.done ? "Reopen step " : "Complete step ") + item.text}
              onClick={() => setDraft(current => ({ ...current, steps: current.steps.map((old, at) => at === index ? { ...old, done: !old.done } : old) }))} />
            <span className={cn("min-w-0 flex-1 text-sm", item.done ? "text-dim line-through" : "text-hi")}>{item.text}</span>
            <Action aria-label={"Remove step " + item.text} onClick={() => setDraft(current => ({ ...current, steps: current.steps.filter((_, at) => at !== index) }))}
              className="shrink-0 items-start text-xs">remove</Action>
          </li>)}
        </ul> : null}
        <form className="flex min-h-11 items-center gap-2 border-t sm:min-h-0" onSubmit={event => { event.preventDefault(); addStep(); }}>
          <span aria-hidden="true" className="text-dim">+</span>
          <Input value={step} maxLength={160} placeholder="add a step…" aria-label="New step" onChange={event => setStep(event.target.value)} className={BARE_INPUT} />
          <Action type="submit" disabled={!step.trim()} className="shrink-0 text-xs">add</Action>
        </form>
      </section>
    </div>

    <div className="mt-[18px] flex flex-wrap items-center gap-x-4 border-t pt-2">
      <Action onClick={save}>save task</Action>
      {task ? <Action onClick={() => attempt(() => { completeTask(task.uid); void navigate({ to: "/tasks" }); })}>{task.done ? "reopen" : "complete"}</Action> : null}
      <Action onClick={() => void navigate({ to: "/tasks" })}>cancel</Action>
      {task ? <Action onClick={() => void remove()}>delete</Action> : null}
    </div>
  </main>;
}
