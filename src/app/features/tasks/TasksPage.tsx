import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { BARE_INPUT, FIELD, SendButton } from "../../ui/SendButton.tsx";
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
// a flag and steps; nothing else. The screen reads top to bottom: where you are, the tasks, then the field to add one.

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

/** A checkbox is the text [ ] or [x], and the whole square around it is the tap target on a phone. */
function Check({ done, onClick, label }: { done: boolean; onClick: () => void; label: string }) {
  return <button type="button" role="checkbox" aria-checked={done} aria-label={label} onClick={onClick}
    className="flex min-h-11 shrink-0 items-start pt-2 text-dim sm:min-h-0 sm:pt-0">
    {done ? "[x]" : "[ ]"}
  </button>;
}

interface RowProps { task: Task; list?: TaskList | null; showList: boolean; current: string }
function Row({ task, list, showList, current }: RowProps) {
  const due = dueLabel(task, current);
  const done = (task.steps ?? []).filter(step => step.done).length;
  return <li className="flex gap-2.5 border-t last:border-b">
    <Check done={task.done} label={(task.done ? "Reopen " : "Complete ") + task.text} onClick={() => attempt(() => completeTask(task.uid))} />
    <Link to="/tasks/$taskId" params={{ taskId: task.uid }} className="min-h-11 min-w-0 flex-1 py-2 pr-1 no-underline sm:min-h-0">
      <span className="flex items-start gap-1.5 leading-snug">
        {task.important ? <span role="img" aria-label="Important" className="shrink-0 text-dim">!</span> : null}
        <span className={cn("break-words text-hi", task.done && "text-dim line-through")}>{task.text}</span>
      </span>
      <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-dim">
        {due ? <span className={cn(due.late && "text-destructive")}>{due.text}</span> : null}
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
    className={cn("flex min-h-11 items-center text-sm transition-colors sm:min-h-0",
      active ? "font-medium text-hi" : "text-dim hover:text-foreground")}>{children}</button>;
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
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={"Options for " + currentList.name}
            className="mb-1 flex min-h-11 items-center text-sm text-dim transition-colors hover:text-foreground sm:min-h-0">more</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void rename(currentList)}>rename</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => makeTemplate(currentList)}>save as template</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void remove(currentList)} className="text-destructive">delete list</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu> : null}
    </PageTitle>

    <nav aria-label="Task views" className="mt-4 flex flex-wrap items-center gap-x-4">
      {MODES.map(mode => <ModeButton key={mode.key} active={view === mode.key} onClick={() => go(mode.key)}>{mode.label}</ModeButton>)}
      <ModeButton active={view === "done"} onClick={() => go("done")}>done</ModeButton>
    </nav>

    <nav aria-label="Lists" className="flex flex-wrap items-center gap-x-4">
      {listsNow.map(list => <button key={list.uid} type="button" onClick={() => go("list:" + list.uid)} aria-pressed={view === "list:" + list.uid}
        className={cn("flex min-h-11 items-center gap-1.5 text-sm transition-colors sm:min-h-0",
          view === "list:" + list.uid ? "font-medium text-hi" : "text-dim hover:text-foreground")}>
        <span className="truncate"># {list.name}</span>
        <span className="text-xs text-dim">{countOf(list.uid)}</span>
      </button>)}
      <button type="button" onClick={() => void newList()} className="flex min-h-11 items-center text-sm text-dim transition-colors hover:text-foreground sm:min-h-0">+ list</button>
    </nav>

    {groups.length ? groups.map(([title, tasks]) => <section key={title} className="pt-[18px]">
      <div className="flex items-baseline justify-between pb-1">
        <h2 className={cn("text-[10.5px] uppercase tracking-[0.06em]", title === "overdue" ? "text-destructive" : "text-dim")}>{title}</h2>
        <span className="text-xs text-dim">{tasks.length}</span>
      </div>
      <ul>{tasks.map(task => <Row key={task.uid} task={task} list={listsByUid.get(task.list ?? "") ?? null} showList={showList} current={current} />)}</ul>
    </section>) : <p className="pt-6 text-sm text-muted-foreground">
      {view === "done" ? "Nothing done yet."
        : view === "next" ? "Nothing planned for the next seven days."
        : view === "today" ? "Nothing due today."
        : currentList ? "This list is empty." : "The inbox is empty."}
    </p>}

    {templatesNow.length && view !== "done" ? <section className="pt-[18px]">
      <h2 className="text-[10.5px] uppercase tracking-[0.06em] text-dim">templates</h2>
      <ul className="mt-1">
        {templatesNow.map(template => <li key={template.uid} className="flex items-center gap-2.5 border-t py-2 last:border-b">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-hi">{template.name}</span>
            <span className="block text-xs text-dim">{templateItemsOf(template.uid)} {templateItemsOf(template.uid) === 1 ? "item" : "items"} · dated from today</span>
          </span>
          <button type="button" onClick={() => startTemplate(template)}
            className="flex min-h-11 shrink-0 items-center text-xs text-dim transition-colors hover:text-foreground sm:min-h-0">use</button>
        </li>)}
      </ul>
    </section> : null}

    {/* The one place to add a task: a date or an ! in the text is read as you type. */}
    <form onSubmit={add} className={cn("mt-[18px]", FIELD)}>
      <span aria-hidden="true" className="text-dim">+</span>
      <Input ref={addRef} value={text} onChange={event => setText(event.target.value)} aria-label="New task" maxLength={500}
        placeholder="add a task" className={BARE_INPUT} />
      <SendButton label="Add task (Enter)" disabled={!parsed.text.trim()} />
    </form>
    {text.trim() && parsed.labels.length ? <p className="text-xs text-dim" aria-live="polite">
      {parsed.labels.join(" · ")} · from the text
    </p> : null}
  </main>;
}

/** How many items a template holds. */
function templateItemsOf(uid: string): number {
  return listTasks().filter(task => task.list === uid).length;
}
