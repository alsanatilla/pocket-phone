import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCollection } from "../../data/bus.ts";
import { completeTask, createTask, listTasks, today } from "../../data/tasks.ts";
import { addDays, createList, dayOffset, getList, lists, removeList, renameList, saveAsTemplate, templates, useTemplate } from "../../data/lists.ts";
import { parseTask } from "../../data/parse.ts";
import type { Task, TaskList } from "../../data/types.ts";
import { PageTitle } from "../../ui/PageTitle.tsx";
import { confirm, prompt } from "../../ui/dialog/dialog.ts";
import { toast, toastError } from "../../ui/toast/toast.ts";

// Tasks: four views, your own lists, and a template of a list you can start again. One task keeps a date, a list,
// a flag and steps; nothing else. The screen reads top to bottom: what you add, where you are, then the tasks.

const attempt = (work: () => unknown) => { try { work(); } catch (error) { toastError(error); } };
const atNoon = (value: string) => new Date(value + "T12:00:00");

/** "today", "tomorrow", "Fri", or how late it is. */
function dueLabel(task: Task, current: string): { text: string; late: boolean; now: boolean } | null {
  if (!task.due) return null;
  const distance = dayOffset(current, task.due);
  if (distance === 0) return { text: "today", late: false, now: true };
  if (distance === 1) return { text: "tomorrow", late: false, now: false };
  if (distance < 0) return { text: distance === -1 ? "yesterday" : `${-distance} days late`, late: true, now: false };
  if (distance <= 7) return { text: atNoon(task.due).toLocaleDateString([], { weekday: "short" }), late: false, now: false };
  return { text: atNoon(task.due).toLocaleDateString([], { day: "numeric", month: "short" }), late: false, now: false };
}

function Check({ done, onClick, label }: { done: boolean; onClick: () => void; label: string }) {
  return <button type="button" role="checkbox" aria-checked={done} aria-label={label} onClick={onClick}
    className="-ml-3 mt-0.5 grid size-11 shrink-0 place-items-center rounded-md">
    <span aria-hidden="true" className={cn("grid size-5 place-items-center rounded-sm border text-[11px] leading-none transition-colors",
      done ? "border-primary bg-primary text-primary-foreground" : "border-border text-transparent hover:border-primary hover:bg-primary/10 hover:text-primary/50")}>✓</span>
  </button>;
}

interface RowProps { task: Task; list?: TaskList | null; showList: boolean; current: string }
function Row({ task, list, showList, current }: RowProps) {
  const due = dueLabel(task, current);
  const done = (task.steps ?? []).filter(step => step.done).length;
  return <li className="flex items-start gap-2 border-t border-dashed">
    <Check done={task.done} label={(task.done ? "Reopen " : "Complete ") + task.text} onClick={() => attempt(() => completeTask(task.uid))} />
    <Link to="/tasks/$taskId" params={{ taskId: task.uid }} className="group min-h-11 min-w-0 flex-1 py-2.5 pr-1 no-underline">
      <span className="flex items-start gap-1.5 leading-snug">
        {task.important ? <span role="img" aria-label="Important" className="mt-px shrink-0 text-primary">!</span> : null}
        <span className={cn("break-words group-hover:text-primary", task.done && "text-dim line-through")}>{task.text}</span>
      </span>
      <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] leading-tight text-dim">
        {due ? <span className={cn(due.late && "text-destructive", due.now && "text-primary")}>{due.text}</span> : null}
        {task.steps?.length ? <span>{done}/{task.steps.length} steps</span> : null}
        {showList && list ? <span className="truncate"># {list.name}</span> : null}
      </span>
    </Link>
  </li>;
}

const MODES = [
  { key: "inbox", label: "inbox" },
  { key: "today", label: "today" },
  { key: "next", label: "next 7 days" },
] as const;

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} aria-pressed={active}
    className={cn("relative px-0.5 pb-2 text-[12px] uppercase tracking-[0.08em] transition-colors",
      active ? "text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary" : "text-muted-foreground hover:text-foreground")}>{children}</button>;
}

/** Which tasks a view shows, and under which headings. */
function groupsFor(view: string, all: Task[], hidden: Set<string>, listsByUid: Map<string, TaskList>): [string, Task[]][] {
  const open = all.filter(task => !task.done && !hidden.has(task.list ?? ""));
  const current = today();
  if (view === "done") {
    const done = all.filter(task => task.done && !hidden.has(task.list ?? "")).sort((a, b) => b.updated - a.updated).slice(0, 100);
    return done.length ? [["done", done]] : [];
  }
  if (view.startsWith("list:")) {
    const uid = view.slice(5);
    const found = open.filter(task => task.list === uid).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || b.created - a.created);
    return found.length ? [[listsByUid.get(uid)?.name ?? "list", found]] : [];
  }
  if (view === "today") {
    const late = open.filter(task => task.due && task.due < current).sort((a, b) => a.due.localeCompare(b.due));
    const now = open.filter(task => task.due === current).sort((a, b) => a.created - b.created);
    return [...(late.length ? [["overdue", late] as [string, Task[]]] : []), ...(now.length ? [["today", now] as [string, Task[]]] : [])];
  }
  if (view === "next") {
    const end = addDays(current, 7);
    const byDay = new Map<string, Task[]>();
    for (const task of open.filter(item => item.due > current && item.due <= end)) byDay.set(task.due, [...(byDay.get(task.due) ?? []), task]);
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, tasks]) => [
      atNoon(date).toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" }), tasks,
    ]);
  }
  const inbox = open.filter(task => !task.list).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || b.created - a.created);
  return inbox.length ? [["inbox", inbox]] : [];
}

export function TasksPage() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { view?: string };
  const view = search.view ?? "today";
  const addRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");

  const all = useCollection(["tasks.json"], listTasks);
  const listsNow = useCollection(["tasks.json"], lists);
  const templatesNow = useCollection(["tasks.json"], templates);
  const listsByUid = useMemo(() => new Map(listsNow.map(list => [list.uid, list])), [listsNow]);
  const hidden = useMemo(() => new Set(templatesNow.map(template => template.uid)), [templatesNow]);
  const groups = useMemo(() => groupsFor(view, all, hidden, listsByUid), [view, all, hidden, listsByUid]);
  const parsed = useMemo(() => parseTask(text, { lists: listsNow }), [text, listsNow]);

  const current = today();
  const open = all.filter(task => !task.done && !hidden.has(task.list ?? ""));
  const dueToday = open.filter(task => task.due && task.due <= current).length;
  const currentList = view.startsWith("list:") ? getList(view.slice(5)) : null;
  const showList = !view.startsWith("list:");
  const countOf = (uid: string) => open.filter(task => task.list === uid).length;

  const go = (next: string) => void navigate({ to: "/tasks", search: next === "today" ? {} : { view: next } });

  function add(event: React.FormEvent) {
    event.preventDefault();
    if (!parsed.text.trim()) return;
    attempt(() => {
      createTask(parsed.text, {
        list: parsed.list ?? (currentList?.uid ?? ""),
        due: parsed.due ?? (view === "today" ? current : ""),
        important: Boolean(parsed.important),
      });
      setText("");
    });
  }

  async function newList() {
    const name = await prompt({ title: "New list", placeholder: "groceries, work, lisbon…", maxLength: 60, okLabel: "create" });
    if (!name) return;
    try { const list = createList(name); go("list:" + list.uid); } catch (error) { toastError(error); }
  }

  async function rename(list: TaskList) {
    const name = await prompt({ title: "Rename list", value: list.name, maxLength: 60, okLabel: "save" });
    if (!name || name === list.name) return;
    attempt(() => { renameList(list.uid, name); toast("Renamed."); });
  }

  async function remove(list: TaskList) {
    if (!await confirm({ title: "Delete \"" + list.name + "\"?", message: "Its tasks stay and move back to the Inbox.", confirmLabel: "delete", danger: true })) return;
    attempt(() => { removeList(list.uid); go("inbox"); toast("List deleted."); });
  }

  function makeTemplate(list: TaskList) {
    attempt(() => { const template = saveAsTemplate(list.uid); toast("Saved as \"" + template.name + "\" template."); });
  }

  function startTemplate(template: TaskList) {
    attempt(() => { const list = useTemplate(template.uid); go("list:" + list.uid); toast(list.name + " is ready."); });
  }

  return <main className="pb-4">
    <PageTitle title={currentList?.name ?? "tasks"} meta={currentList ? `${countOf(currentList.uid)} open` : `${dueToday} due · ${open.length} open`}>
      {currentList ? <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={"Options for " + currentList.name}><MoreHorizontal /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void rename(currentList)}>rename</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => makeTemplate(currentList)}>save as template</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void remove(currentList)} className="text-destructive">delete list</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu> : null}
      <Button variant="outline" className="h-10" onClick={() => addRef.current?.focus()}>+ task</Button>
    </PageTitle>

    <form onSubmit={add} className="mt-4 flex gap-2">
      <Input ref={addRef} value={text} onChange={event => setText(event.target.value)} aria-label="New task" maxLength={500}
        placeholder="add a task… “call the bank tomorrow !”" className="h-11" />
      <Button type="submit" variant="secondary" disabled={!parsed.text.trim()} className="h-11">add</Button>
    </form>
    {text.trim() && parsed.labels.length ? <p className="mt-2 flex flex-wrap items-center gap-1.5" aria-live="polite">
      {parsed.labels.map((label, index) => <span key={index} className="rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>)}
      <span className="text-[10px] text-dim">from the text</span>
    </p> : null}

    <nav aria-label="Task views" className="mt-6 flex items-end gap-5 border-b border-dashed">
      {MODES.map(mode => <ModeButton key={mode.key} active={view === mode.key} onClick={() => go(mode.key)}>{mode.label}</ModeButton>)}
      <ModeButton active={view === "done"} onClick={() => go("done")}>done</ModeButton>
    </nav>

    <nav aria-label="Lists" className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
      {listsNow.map(list => <button key={list.uid} type="button" onClick={() => go("list:" + list.uid)} aria-pressed={view === "list:" + list.uid}
        className={cn("group flex min-h-8 items-baseline gap-1.5 text-[12px] uppercase tracking-[0.06em] transition-colors",
          view === "list:" + list.uid ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
        <span className="truncate"># {list.name}</span>
        <span className="text-[10px] text-dim">{countOf(list.uid)}</span>
      </button>)}
      <button type="button" onClick={() => void newList()} className="min-h-8 text-[12px] uppercase tracking-[0.06em] text-dim transition-colors hover:text-foreground">+ list</button>
    </nav>

    {groups.length ? groups.map(([title, tasks]) => <section key={title} className="pt-6 first:pt-3">
      <div className="flex items-baseline justify-between pb-1">
        <h2 className={cn("text-[11px] uppercase tracking-[0.08em]", title === "overdue" ? "text-destructive" : "text-muted-foreground")}>{title}</h2>
        <span className="text-[11px] text-dim">{tasks.length}</span>
      </div>
      <ul className="flex flex-col">{tasks.map(task => <Row key={task.uid} task={task} list={listsByUid.get(task.list ?? "") ?? null} showList={showList} current={current} />)}</ul>
    </section>) : <p className="pt-8 text-sm text-muted-foreground">
      {view === "done" ? "Nothing done yet."
        : view === "next" ? "Nothing planned for the next seven days."
        : view === "today" ? "Nothing due today. "
        : currentList ? "This list is empty. " : "The inbox is empty. "}
      {view !== "done" ? <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => addRef.current?.focus()}>add a task</button> : null}
    </p>}

    {templatesNow.length && view !== "done" ? <section className="pt-10">
      <h2 className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">templates</h2>
      <ul className="mt-1 flex flex-col">
        {templatesNow.map(template => <li key={template.uid} className="flex min-h-11 items-center gap-3 border-t border-dashed">
          <span className="min-w-0 flex-1 py-2">
            <span className="block truncate">{template.name}</span>
            <span className="text-[11px] text-dim">{templateItemsOf(template.uid)} {templateItemsOf(template.uid) === 1 ? "item" : "items"} · dated from today</span>
          </span>
          <Button size="sm" variant="outline" onClick={() => startTemplate(template)}>use</Button>
        </li>)}
      </ul>
    </section> : null}
  </main>;
}

/** How many items a template holds. */
function templateItemsOf(uid: string): number {
  return listTasks().filter(task => task.list === uid).length;
}
