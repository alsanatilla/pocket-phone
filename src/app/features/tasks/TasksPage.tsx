import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCollection } from "../../data/bus.ts";
import { completeTask, createTask, listTasks, today } from "../../data/tasks.ts";
import { addDays, createList, dayOffset, getList, lists, removeList, renameList, saveAsTemplate, templates, useTemplate } from "../../data/lists.ts";
import type { Task, TaskList } from "../../data/types.ts";
import { PageTitle } from "../../ui/PageTitle.tsx";
import { confirm, prompt } from "../../ui/dialog/dialog.ts";
import { toast, toastError } from "../../ui/toast/toast.ts";

// Tasks, as lean as a list can be: four views (Inbox, Today, Next 7 days, Done), your own lists, and a template of
// a list you can start again. A task keeps a date, a list, a flag and steps; nothing else.

const attempt = (work: () => unknown) => { try { work(); } catch (error) { toastError(error); } };
const day = (value: string) => new Date(value + "T12:00:00");

/** "today", "tomorrow", "Fri 13 Nov", or how late it is. */
function dueLabel(task: Task, current: string): { text: string; late: boolean } | null {
  if (!task.due) return null;
  const distance = dayOffset(current, task.due);
  if (distance === 0) return { text: "today", late: false };
  if (distance === 1) return { text: "tomorrow", late: false };
  if (distance < 0) return { text: distance === -1 ? "yesterday" : `${-distance} days late`, late: true };
  if (distance <= 7) return { text: day(task.due).toLocaleDateString([], { weekday: "short" }), late: false };
  return { text: day(task.due).toLocaleDateString([], { day: "numeric", month: "short" }), late: false };
}

function Check({ done, onClick, label }: { done: boolean; onClick: () => void; label: string }) {
  return <button type="button" aria-label={label} aria-pressed={done} onClick={onClick}
    className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-sm border text-[13px] leading-none transition-colors",
      done ? "border-primary bg-primary text-primary-foreground" : "border-border text-transparent hover:border-primary hover:text-primary/40")}>✓</button>;
}

function Row({ task, list }: { task: Task; list?: TaskList | null }) {
  const current = today();
  const due = dueLabel(task, current);
  const open = (task.steps ?? []).filter(step => !step.done).length;
  return <div className="flex items-start gap-3 border-t border-dashed py-2.5">
    <Check done={task.done} label={(task.done ? "Reopen " : "Complete ") + task.text} onClick={() => attempt(() => completeTask(task.uid))} />
    <Link to="/tasks/$taskId" params={{ taskId: task.uid }} className="group min-w-0 flex-1 no-underline">
      <span className={cn("block break-words group-hover:text-primary", task.done && "text-dim line-through")}>
        {task.important ? <span className="mr-1.5 text-[11px] text-primary" aria-label="Important">!</span> : null}{task.text}
      </span>
      <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-[11px] text-dim">
        {due ? <span className={cn(due.late && "text-destructive")}>{due.text}</span> : null}
        {list ? <span>{list.name}</span> : null}
        {task.steps?.length ? <span>{task.steps.length - open}/{task.steps.length} steps</span> : null}
      </span>
    </Link>
  </div>;
}

const views = [
  { key: "inbox", label: "inbox" },
  { key: "today", label: "today" },
  { key: "next", label: "next 7 days" },
] as const;

/** Which tasks a view shows, and under which headings. */
function groupsFor(view: string, all: Task[], hidden: Set<string>, listsByUid: Map<string, TaskList>): [string, Task[]][] {
  const open = all.filter(task => !task.done && !hidden.has(task.list ?? ""));
  const current = today();
  const listOf = (task: Task) => listsByUid.get(task.list ?? "") ?? null;
  if (view === "done") {
    const done = all.filter(task => task.done && !hidden.has(task.list ?? "")).sort((a, b) => b.updated - a.updated).slice(0, 100);
    return done.length ? [["done", done]] : [];
  }
  if (view.startsWith("list:")) {
    const uid = view.slice(5);
    const found = open.filter(task => task.list === uid);
    return found.length ? [[listOf(found[0]!)?.name ?? "list", found]] : [];
  }
  if (view === "today") {
    const late = open.filter(task => task.due && task.due < current).sort((a, b) => a.due.localeCompare(b.due));
    const now = open.filter(task => task.due === current);
    return [...(late.length ? [["overdue", late] as [string, Task[]]] : []), ...(now.length ? [["today", now] as [string, Task[]]] : [])];
  }
  if (view === "next") {
    const end = addDays(current, 7);
    const upcoming = open.filter(task => task.due > current && task.due <= end);
    const byDay = new Map<string, Task[]>();
    for (const task of upcoming) byDay.set(task.due, [...(byDay.get(task.due) ?? []), task]);
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, tasks]) => [
      day(date).toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" }), tasks,
    ]);
  }
  // Inbox: anything without a list, plus every open task when a list is the current view? No: Inbox is unlisted only.
  const inbox = open.filter(task => !task.list).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
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
  const open = all.filter(task => !task.done && !hidden.has(task.list ?? "")).length;
  const currentList = view.startsWith("list:") ? getList(view.slice(5)) : null;

  const go = (next: string) => void navigate({ to: "/tasks", search: next === "today" ? {} : { view: next } });

  function add(event: React.FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    attempt(() => {
      createTask(value, { list: view.startsWith("list:") ? view.slice(5) : "", due: view === "today" ? today() : "" });
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

  return <main className="space-y-3">
    <PageTitle title="tasks" meta={`${open} open`}>
      <Button variant="outline" size="lg" onClick={() => addRef.current?.focus()}>+ task</Button>
    </PageTitle>

    <form onSubmit={add} className="flex gap-2">
      <Input ref={addRef} value={text} onChange={event => setText(event.target.value)} placeholder={view === "today" ? "add a task for today…" : "add a task…"} aria-label="New task" maxLength={500} className="h-11" />
      <Button type="submit" disabled={!text.trim()} variant="secondary">add</Button>
    </form>

    <nav aria-label="Task lists" className="flex flex-wrap gap-2">
      {views.map(item => <Button key={item.key} size="sm" variant={view === item.key ? "secondary" : "ghost"} onClick={() => go(item.key)} aria-pressed={view === item.key}>{item.label}</Button>)}
      {listsNow.map(list => <Button key={list.uid} size="sm" variant={view === "list:" + list.uid ? "secondary" : "ghost"} onClick={() => go("list:" + list.uid)} aria-pressed={view === "list:" + list.uid}>{list.name}</Button>)}
      <Button size="sm" variant="ghost" onClick={() => void newList()} aria-label="New list">+ list</Button>
      <Button size="sm" variant={view === "done" ? "secondary" : "ghost"} onClick={() => go("done")} aria-pressed={view === "done"} className="ml-auto">done</Button>
    </nav>

    {currentList ? <section className="flex flex-wrap items-center gap-2 border-t border-dashed pt-3 text-xs">
      <span className="text-dim">{currentList.name}</span>
      <Button size="sm" variant="ghost" onClick={() => void rename(currentList)}>rename</Button>
      <Button size="sm" variant="ghost" onClick={() => makeTemplate(currentList)}>save as template</Button>
      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void remove(currentList)}>delete</Button>
    </section> : null}

    {groups.length ? groups.map(([title, tasks]) => <section key={title} className="pt-1">
      <h2 className="pt-2 text-[11px] uppercase tracking-wider text-muted-foreground">{title}</h2>
      {tasks.map(task => <Row key={task.uid} task={task} list={listsByUid.get(task.list ?? "") ?? null} />)}
    </section>) : <p className="pt-4 text-sm text-muted-foreground">
      {view === "done" ? "Nothing done yet." : view === "next" ? "Nothing planned for the next seven days." : view === "today" ? "Nothing due today." : "Nothing here."}
    </p>}

    {templatesNow.length ? <details className="pt-6">
      <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-muted-foreground">templates <ChevronRight className="inline size-3" /></summary>
      <div className="mt-2 space-y-1">
        {templatesNow.map(template => <div key={template.uid} className="flex items-center gap-2 border-t border-dashed py-2">
          <span className="min-w-0 flex-1 truncate text-sm">{template.name} <Badge variant="outline" className="ml-1 font-normal">{templateItemsOf(template.uid)} items</Badge></span>
          <Button size="sm" variant="outline" onClick={() => startTemplate(template)}>use</Button>
        </div>)}
      </div>
    </details> : null}
  </main>;
}

/** How many items a template holds, without loading the tasks twice in the render. */
function templateItemsOf(uid: string): number {
  return listTasks().filter(task => task.list === uid).length;
}
