import { lazy, Suspense, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCollection } from "../data/bus.ts";
import { chosenTask, completeTask, createTask, listTasks, today } from "../data/tasks.ts";
import { openThoughts, parkThoughtText } from "../data/thoughts.ts";
import { toast, toastError } from "../ui/toast/toast.ts";
import { BARE_INPUT, FIELD, SendButton } from "../ui/SendButton.tsx";

// Pocket's own components for generated surfaces. One type scale for all of them:
//   label   11px caps, slight tracking, muted (or the block's tone)
//   body    14px
//   reading VT323, sized by how long the value is, so a time never runs into the tile's edge
// The lists read live data themselves, so a generated screen stays true when a task is ticked off elsewhere.

export type Tone = "accent" | "movement" | "calendar" | "thought" | "warning" | "muted" | null | undefined;

const TONE_VAR: Record<NonNullable<Tone>, string> = {
  accent: "var(--primary)", movement: "var(--movement)", calendar: "var(--calendar)",
  thought: "var(--thought)", warning: "var(--destructive)", muted: "var(--muted-foreground)",
};
export const toneColor = (tone: Tone) => TONE_VAR[tone ?? "accent"];

/** The small caps line that names a block. */
function Label({ children, tone }: { children: ReactNode; tone?: Tone }) {
  // One quiet line names a block; capitals on every block made a reply shout.
  return <p className="text-xs font-medium first-letter:uppercase" style={{ color: tone ? toneColor(tone) : "var(--muted-foreground)" }}>{children}</p>;
}

/** A block's frame: the same border, ground and padding everywhere. */
function Block({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("arrive rounded-lg border bg-card p-4", className)}>{children}</section>;
}

/** Pixel readings shrink as they get longer: "2" can be huge, "22:46" cannot. */
function readingSize(value: string | number, sizes: [string, string, string]): string {
  const length = String(value).length;
  return length <= 2 ? sizes[0] : length <= 5 ? sizes[1] : sizes[2];
}

export function Hero({ eyebrow, value, unit, caption, tone }: { eyebrow?: string | null; value: string | number; unit?: string | null; caption?: string | null; tone?: Tone }) {
  return (
    <section className="arrive pt-1 pb-1">
      {eyebrow ? <p className="text-xs font-medium text-muted-foreground first-letter:uppercase">{eyebrow}</p> : null}
      <p className={cn("mt-1.5 font-pixel leading-none", readingSize(value, ["text-7xl", "text-6xl", "text-4xl"]))} style={{ color: toneColor(tone) }}>
        {value}{unit ? <span className="ml-2 text-2xl text-muted-foreground">{unit}</span> : null}
      </p>
      {caption ? <p className="mt-2 text-sm leading-snug text-muted-foreground">{caption}</p> : null}
    </section>
  );
}

export function Metric({ label, value, unit, hint, tone, onPress }: { label: string; value: string | number; unit?: string | null; hint?: string | null; tone?: Tone; onPress?: () => void }) {
  const Tag = onPress ? "button" : "div";
  return (
    <Tag onClick={onPress} className={cn("arrive flex min-w-0 flex-col rounded-lg border bg-card p-3 text-left", onPress && "transition-colors hover:border-primary focus-visible:border-primary")}>
      <Label>{label}</Label>
      <p className={cn("mt-2 truncate font-pixel leading-none", readingSize(value, ["text-5xl", "text-4xl", "text-2xl"]))} style={{ color: toneColor(tone) }}>
        {value}{unit ? <span className="ml-1 text-base text-muted-foreground">{unit}</span> : null}
      </p>
      {hint ? <p className="mt-1 line-clamp-2 text-[11px] leading-tight text-muted-foreground">{hint}</p> : null}
    </Tag>
  );
}

export function Gauge({ label, value, caption, tone }: { label: string; value: number; caption?: string | null; tone?: Tone }) {
  const clamped = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const radius = 44, circumference = 2 * Math.PI * radius;
  return (
    <Block className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" className="size-24 shrink-0 -rotate-90" role="img" aria-label={`${label}: ${clamped}`}>
        <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--border)" strokeWidth="8" />
        <circle cx="50" cy="50" r={radius} fill="none" stroke={toneColor(tone)} strokeWidth="8"
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - clamped / 100)} />
        <text x="50" y="50" textAnchor="middle" dominantBaseline="central" transform="rotate(90 50 50)" fontFamily="VT323, monospace" fontSize="34" fill="var(--foreground)">{clamped}</text>
      </svg>
      <div className="min-w-0">
        <Label tone={tone}>{label}</Label>
        {caption ? <p className="mt-1 text-sm">{caption}</p> : null}
      </div>
    </Block>
  );
}

type Point = { label: string; value: number };
type Series = { name: string; tone?: Tone; data: Point[] };
type Source = { title: string; url?: string | null };

/** Series colours: each its own tone if given, else Pocket's chart palette in order. */
const PALETTE = ["var(--chart-1)", "var(--chart-3)", "var(--chart-2)", "var(--chart-4)", "var(--chart-5)"];

/** "12 400" for 12400, "3.2k"-style shortening only on the axis would hide values, so ticks stay plain. */
const formatValue = (value: number) => Math.abs(value) >= 10000 ? Math.round(value).toLocaleString() : String(Math.round(value * 100) / 100);

/** Rows keyed by label with one column per series, in the order the labels first appear. */
export function mergeSeries(series: Series[]): Record<string, string | number>[] {
  const rows = new Map<string, Record<string, string | number>>();
  series.forEach((line, index) => {
    for (const point of line.data) {
      if (!Number.isFinite(point?.value)) continue;
      const row = rows.get(point.label) ?? { label: point.label };
      row["s" + index] = point.value;
      rows.set(point.label, row);
    }
  });
  return [...rows.values()];
}

function SourceLine({ source, note }: { source?: Source | null; note?: string | null }) {
  if (!source && !note) return null;
  const safe = source?.url && /^https?:\/\//.test(source.url) ? source.url : null;
  return (
    <p className="mt-2 text-[11px] text-muted-foreground">
      {note}{note && source ? " · " : ""}
      {source ? <>source: {safe ? <a href={safe} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">{source.title}</a> : source.title}</> : null}
    </p>
  );
}

const ChartPlot = lazy(() => import("./ChartPlot.tsx"));

export function Chart({ kind, title, data, series, unit, tone, note, source }: {
  kind: "area" | "bar" | "line"; title?: string | null; data?: Point[] | null; series?: Series[] | null;
  unit?: string | null; tone?: Tone; note?: string | null; source?: Source | null;
}) {
  // Props arrive with the same identity while nothing changed (the streaming spec keeps unchanged elements), so
  // these stay the same arrays and the plot does not redraw.
  const lines = useMemo<Series[]>(() => Array.isArray(series) && series.length ? series.slice(0, 5) : [{ name: title ?? "", tone, data: Array.isArray(data) ? data : [] }], [series, data, title, tone]);
  const rows = useMemo(() => mergeSeries(lines), [lines]);
  const colors = useMemo(() => lines.map((line, index) => line.tone ? toneColor(line.tone) : lines.length === 1 ? toneColor(tone) : PALETTE[index]!), [lines, tone]);
  const names = useMemo(() => lines.map(line => line.name || title || ""), [lines, title]);
  if (rows.length < 2) return null;
  return (
    <Block>
      {title ? <Label tone={lines.length === 1 ? tone : null}>{title}{unit ? <span className="text-dim"> · {unit}</span> : null}</Label> : null}
      {lines.length > 1 ? (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {lines.map((line, index) => <span key={index} className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="size-2 rounded-full" style={{ background: colors[index] }} />{line.name}</span>)}
        </div>
      ) : null}
      <div className="mt-2 h-44 w-full">
        <Suspense fallback={<div className="shimmer h-full w-full rounded-md" aria-hidden="true" />}>
          <ChartPlot kind={kind} rows={rows} colors={colors} names={names} unit={unit} format={formatValue} />
        </Suspense>
      </div>
      <SourceLine source={source} note={note} />
    </Block>
  );
}

const numeric = (value: unknown) => typeof value === "number" || (typeof value === "string" && /^[+−-]?[\d.,\s]+%?$/.test(value.trim()) && /\d/.test(value));

export function Table({ title, columns, rows, note, source }: { title?: string | null; columns: string[]; rows: (string | number | null)[][]; note?: string | null; source?: Source | null }) {
  const head = Array.isArray(columns) ? columns.slice(0, 6) : [];
  const body = Array.isArray(rows) ? rows.slice(0, 40) : [];
  if (!head.length) return null;
  // A column of numbers aligns right, so figures can be compared down the column.
  const right = head.map((_, column) => body.length > 0 && body.every(row => row[column] == null || numeric(row[column])));
  return (
    <Block className="overflow-x-auto">
      {title ? <Label>{title}</Label> : null}
      <table className="mt-2 w-full border-collapse text-sm">
        <thead>
          <tr>{head.map((name, column) => <th key={column} className={cn("whitespace-nowrap pb-1.5 pr-3 align-bottom text-xs font-medium text-muted-foreground last:pr-0", right[column] ? "text-right" : "text-left")}>{name}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((row, index) => (
            <tr key={index} className="border-t border-dashed">
              {head.map((_, column) => (
                <td key={column} className={cn("py-1.5 pr-3 align-top last:pr-0", right[column] && "text-right tabular-nums", String(row[column] ?? "").length <= 14 && "whitespace-nowrap")}>
                  {row[column] == null ? "" : typeof row[column] === "number" ? formatValue(row[column] as number) : String(row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <SourceLine source={source} note={note} />
    </Block>
  );
}

interface TimelineItem { time: string; title: string; detail?: string | null; past?: boolean | null; now?: boolean | null }
export function Timeline({ title, items }: { title?: string | null; items: TimelineItem[] }) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return null;
  return (
    <Block>
      <Label tone="calendar">{title ?? "today"}</Label>
      <ol className="mt-3 space-y-3">
        {list.map((item, index) => (
          <li key={index} className={cn("grid grid-cols-[3.25rem_minmax(0,1fr)] items-baseline gap-3", item.past && "opacity-45")}>
            <span className="font-pixel text-xl leading-none" style={{ color: item.now ? "var(--primary)" : "var(--calendar)" }}>{item.time}</span>
            <span className="min-w-0 text-sm">
              {item.title}
              {item.now ? <span className="ml-2 text-xs text-primary">now</span> : null}
              {item.detail ? <span className="block text-[11px] leading-tight text-muted-foreground">{item.detail}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </Block>
  );
}

function Check({ label, onCheck }: { label: string; onCheck: () => void }) {
  // A 44px target around a quiet 20px box.
  return (
    <button aria-label={label} onClick={onCheck} className="group -m-3 grid size-11 shrink-0 place-items-center">
      <span className="size-5 rounded-sm border border-muted-foreground/60 transition-colors group-hover:border-primary group-focus-visible:border-primary" />
    </button>
  );
}

export function TaskList({ title, source, limit }: { title?: string | null; source: "due" | "open" | "chosen"; limit?: number | null }) {
  const tasks = useCollection(["tasks.json"], () => {
    const day = today(), open = listTasks().filter(task => !task.done);
    if (source === "chosen") { const chosen = chosenTask(); return chosen && !chosen.done ? [chosen] : []; }
    return source === "due" ? open.filter(task => task.due && task.due <= day) : open;
  }, [source]);
  const day = today();
  const name = title ?? (source === "due" ? "due today" : source === "chosen" ? "next" : "open tasks");
  return (
    <Block>
      <Label tone="accent">{name} · {tasks.length}</Label>
      <ul className="mt-2">
        {tasks.slice(0, limit ?? 6).map(task => {
          const overdue = Boolean(task.due) && task.due < day;
          return (
            <li key={task.uid} className="flex min-h-11 items-start gap-3 border-t border-dashed py-2.5 first:border-t-0">
              <Check label={"Complete " + task.text} onCheck={() => { try { completeTask(task.uid); toast("Done."); } catch (error) { toastError(error); } }} />
              <div className="min-w-0">
                <p className="text-sm leading-snug">
                  {task.important ? <span role="img" aria-label="Important" className="mr-1.5 text-primary">!</span> : null}{task.text}
                </p>
                <p className="mt-0.5 text-[11px] leading-tight text-dim">
                  <span className={cn(overdue && "text-destructive", !overdue && task.due === day && "text-primary")}>
                    {overdue ? "overdue · " + task.due : task.due === day ? "today" : task.due || "no date"}
                  </span>
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {!tasks.length ? <p className="mt-2 text-sm text-muted-foreground">Nothing here.</p> : null}
    </Block>
  );
}

export function ThoughtList({ title, source, limit }: { title?: string | null; source: "ready" | "open"; limit?: number | null }) {
  const thoughts = useCollection(["parking.json"], () => {
    const now = Date.now(), all = openThoughts();
    return source === "ready" ? all.filter(item => item.due > 0 && item.due <= now) : all;
  }, [source]);
  if (!thoughts.length) return null;
  return (
    <Block>
      <Label tone="thought">{title ?? (source === "ready" ? "to revisit" : "parked thoughts")} · {thoughts.length}</Label>
      <ul className="mt-2">
        {thoughts.slice(0, limit ?? 5).map(item => (
          <li key={item.id} className="flex min-h-11 items-center gap-3 border-t border-dashed py-2 first:border-t-0">
            <p className="min-w-0 flex-1 text-sm leading-snug">{item.text}</p>
            <Button size="sm" variant="ghost" className="h-9 text-thought" onClick={() => { try { createTask(item.text); toast("Made into a task."); } catch (error) { toastError(error); } }}>→ task</Button>
          </li>
        ))}
      </ul>
    </Block>
  );
}

export function Capture({ mode, placeholder, onAsk }: { mode: "thought" | "task" | "ask"; placeholder?: string | null; onAsk: (prompt: string) => void }) {
  const [text, setText] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    try {
      if (mode === "thought") { parkThoughtText(value); toast("Kept."); }
      else if (mode === "task") { createTask(value); toast("Task added."); }
      else onAsk(value);
      setText("");
    } catch (error) { toastError(error); }
  };
  const label = mode === "thought" ? "keep" : mode === "task" ? "add" : "ask";
  const hint = placeholder ?? (mode === "thought" ? "a thought…" : mode === "task" ? "a task…" : "ask pip…");
  return (
    <form onSubmit={submit} className={FIELD}>
      <Input value={text} onChange={event => setText(event.target.value)} aria-label={hint} maxLength={500} placeholder={hint} className={BARE_INPUT} />
      <SendButton label={label[0]!.toUpperCase() + label.slice(1)} disabled={!text.trim()} />
    </form>
  );
}

/** A few answers in one card: labeled fields and one send, instead of question after question in the chat. */
export interface FormField { name: string; label: string; type: "text" | "number" | "choice"; options?: string[] | null; placeholder?: string | null; required?: boolean | null }

export function Form({ title, description, fields, submitLabel, onAsk }: { title?: string | null; description?: string | null; fields: FormField[]; submitLabel?: string | null; onAsk: (prompt: string) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(field => [field.name, field.type === "choice" ? (field.options?.[0] ?? "") : ""])));
  const missing = fields.some(field => field.required === true && !String(values[field.name] ?? "").trim());
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (missing) return;
    const lines = fields.map(field => {
      const value = String(values[field.name] ?? "").trim();
      return value ? field.label.trim() + ": " + value : "";
    }).filter(Boolean);
    if (!lines.length) return;
    onAsk((title?.trim() ? title.trim() + "\n" : "") + lines.join("\n"));
    setValues(Object.fromEntries(fields.map(field => [field.name, field.type === "choice" ? (field.options?.[0] ?? "") : ""])));
  };
  return (
    <Block>
      {title ? <Label>{title}</Label> : null}
      {description ? <p className="mt-1.5 text-sm text-muted-foreground">{description}</p> : null}
      <form onSubmit={submit} className="mt-3 grid gap-2.5">
        {fields.map(field => (
          <label key={field.name} className="grid gap-1">
            <span className="text-xs text-muted-foreground">{field.label}</span>
            {field.type === "choice" ? (
              <select value={values[field.name] ?? ""} aria-label={field.label} required={field.required === true}
                onChange={event => setValues(current => ({ ...current, [field.name]: event.target.value }))}
                className="h-11 w-full rounded-md border border-input bg-background px-2 text-sm sm:h-9">
                {(field.options ?? []).map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            ) : (
              <Input value={values[field.name] ?? ""} aria-label={field.label} required={field.required === true} maxLength={500} className="h-11 sm:h-9"
                inputMode={field.type === "number" ? "decimal" : undefined}
                placeholder={field.placeholder ?? undefined}
                onChange={event => setValues(current => ({ ...current, [field.name]: event.target.value }))} />
            )}
          </label>
        ))}
        <div className="mt-1 flex justify-end">
          <Button type="submit" size="sm" className="h-11 px-4 sm:h-9" disabled={missing}>{submitLabel?.trim() || "send"}</Button>
        </div>
      </form>
    </Block>
  );
}
