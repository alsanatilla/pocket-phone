import { useMemo, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { BARE_INPUT, FIELD, SendButton } from "../../ui/SendButton.tsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, dateAt } from "@/lib/utils";
import { Keys, Row, RowMenu, Section, Segmented, Tick } from "../../ui/kit.tsx";
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
  return { text: dateAt(atNoon(task.due).getTime()), late: false, now: false };
}

interface RowProps { task: Task; list?: TaskList | null; showList: boolean; showDue: boolean; current: string; onOpen: () => void }
function TaskRow({ task, list, showList, showDue, current, onOpen }: RowProps) {
  // Under a day's own heading (next 7 days) the date is said once, by the heading.
  const due = showDue ? dueLabel(task, current) : null;
  const done = (task.steps ?? []).filter(step => step.done).length;
  const sub: React.ReactNode[] = [];
  if (due) sub.push(<span key="due" className={cn(due.late && "text-destructive")}>{due.text}</span>);
  if (task.steps?.length) sub.push(<span key="steps">{done}/{task.steps.length} steps</span>);
  if (showList && list) sub.push(<span key="list" className="truncate"># {list.name}</span>);
  return <li className="flex items-start gap-2.5">
    <span className="flex min-h-11 shrink-0 items-center sm:min-h-0">
      <Tick checked={task.done} label={(task.done ? "Reopen " : "Complete ") + task.text}
        onChange={() => attempt(() => completeTask(task.uid))} />
    </span>
    <Row onOpen={onOpen} arrow={false} className="min-w-0 flex-1"
      sub={sub.length ? <>{sub.map((part, index) => <span key={index}>{index ? " · " : ""}{part}</span>)}</> : undefined}>
      <span className="flex items-start gap-1.5 leading-snug">
        {task.important ? <span role="img" aria-label="Important" className="shrink-0 text-dim">!</span> : null}
        <span className={cn("break-words", task.done && "text-dim line-through")}>{task.text}</span>
      </span>
    </Row>
  </li>;
}

const MODES = [
  { value: "inbox", label: "inbox" },
  { value: "today", label: "today" },
  { value: "next", label: "next 7 days" },
  { value: "done", label: "done" },
] as const;

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
      atNoon(date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" }).replace(",", ""), tasks,
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

  return <main className="flex min-h-[calc(100dvh-45px)] flex-col pb-4">
    <PageTitle title={currentList?.name ?? "tasks"} meta={currentList ? `${countOf(currentList.uid)} open` : `${dueToday} due · ${open.length} open`}>
      {currentList ? <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" aria-label={"Options for " + currentList.name}>more</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void rename(currentList)}>rename</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => makeTemplate(currentList)}>save as template</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void remove(currentList)} className="text-destructive">delete list</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu> : null}
    </PageTitle>

    <div className="flex-1">
    <div className="mt-4">
      <Segmented label="Task views" value={view} options={MODES} onChange={go} />
    </div>

    <nav aria-label="Lists" className="mt-2">
      <Keys>
        {listsNow.map(list => <Button key={list.uid} type="button" onClick={() => go("list:" + list.uid)} aria-pressed={view === "list:" + list.uid}
          className={cn(view === "list:" + list.uid && "bg-accent text-hi")}>
          <span className="truncate"># {list.name}</span>
          <span className="text-xs text-dim">{countOf(list.uid)}</span>
        </Button>)}
        <Button type="button" onClick={() => void newList()}>+ list</Button>
      </Keys>
    </nav>

    {groups.length ? groups.map(([title, tasks], index) => <Section key={title} label={<span role="heading" aria-level={2}>{title}</span>} count={tasks.length} tone={title === "overdue" ? "late" : undefined} className={index ? undefined : "mt-6"}>
      <ul className="space-y-1">{tasks.map(task => <TaskRow key={task.uid} task={task} list={listsByUid.get(task.list ?? "") ?? null} showList={showList} showDue={view !== "next"} current={current}
        onOpen={() => void navigate({ to: "/tasks/$taskId", params: { taskId: task.uid } })} />)}</ul>
    </Section>) : <p className="pt-6 text-sm text-muted-foreground">
      {view === "done" ? "Nothing done yet."
        : view === "next" ? "Nothing planned for the next seven days."
        : view === "today" ? "Nothing due today."
        : currentList ? "This list is empty." : "The inbox is empty."}
    </p>}

    {templatesNow.length && view !== "done" ? <Section label={<span role="heading" aria-level={2}>templates</span>} className={groups.length ? undefined : "mt-6"}>
      <ul className="space-y-1">
        {templatesNow.map(template => <li key={template.uid}>
          <Row end={<RowMenu label={"Options for template " + template.name}>
            <DropdownMenuItem onSelect={() => startTemplate(template)}>use</DropdownMenuItem>
          </RowMenu>}
            sub={<>{templateItemsOf(template.uid)} {templateItemsOf(template.uid) === 1 ? "item" : "items"} · dated from today</>}>
            {template.name}
          </Row>
        </li>)}
      </ul>
    </Section> : null}
    </div>

    {/* The one place to add a task: a date or an ! in the text is read as you type. */}
    <form onSubmit={add} className={cn("mt-6", FIELD)}>
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
