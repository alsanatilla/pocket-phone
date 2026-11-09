import { useState, type FormEvent, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCollection } from "../data/bus.ts";
import { chosenTask, completeTask, createTask, listTasks, today } from "../data/tasks.ts";
import { openThoughts, parkThoughtText } from "../data/thoughts.ts";
import { toast, toastError } from "../ui/toast/toast.ts";

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
  return <p className="text-[11px] font-medium uppercase tracking-[0.08em]" style={{ color: tone ? toneColor(tone) : "var(--muted-foreground)" }}>{children}</p>;
}

/** A block's frame: the same border, ground and padding everywhere. */
function Block({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("rounded-lg border bg-card p-4", className)}>{children}</section>;
}

/** Pixel readings shrink as they get longer: "2" can be huge, "22:46" cannot. */
function readingSize(value: string | number, sizes: [string, string, string]): string {
  const length = String(value).length;
  return length <= 2 ? sizes[0] : length <= 5 ? sizes[1] : sizes[2];
}

export function Hero({ eyebrow, value, unit, caption, tone }: { eyebrow?: string | null; value: string | number; unit?: string | null; caption?: string | null; tone?: Tone }) {
  return (
    <section className="pt-2 pb-1">
      {eyebrow ? <p className="text-xs text-muted-foreground">{eyebrow}</p> : null}
      <p className={cn("mt-1 font-pixel leading-none", readingSize(value, ["text-7xl", "text-6xl", "text-4xl"]))} style={{ color: toneColor(tone) }}>
        {value}{unit ? <span className="ml-2 text-2xl text-muted-foreground">{unit}</span> : null}
      </p>
      {caption ? <p className="mt-1 text-base">{caption}</p> : null}
    </section>
  );
}

export function Metric({ label, value, unit, hint, tone, onPress }: { label: string; value: string | number; unit?: string | null; hint?: string | null; tone?: Tone; onPress?: () => void }) {
  const Tag = onPress ? "button" : "div";
  return (
    <Tag onClick={onPress} className={cn("flex min-w-0 flex-col rounded-lg border bg-card p-3 text-left", onPress && "transition-colors hover:border-primary focus-visible:border-primary")}>
      <Label>{label}</Label>
      <p className={cn("mt-2 truncate font-pixel leading-none", readingSize(value, ["text-5xl", "text-4xl", "text-2xl"]))} style={{ color: toneColor(tone) }}>
        {value}{unit ? <span className="ml-1 text-base text-muted-foreground">{unit}</span> : null}
      </p>
      {hint ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{hint}</p> : null}
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

export function Chart({ kind, title, data, series, unit, tone, note, source }: {
  kind: "area" | "bar" | "line"; title?: string | null; data?: Point[] | null; series?: Series[] | null;
  unit?: string | null; tone?: Tone; note?: string | null; source?: Source | null;
}) {
  const lines: Series[] = Array.isArray(series) && series.length ? series.slice(0, 5) : [{ name: title ?? "", tone, data: Array.isArray(data) ? data : [] }];
  const rows = mergeSeries(lines);
  if (rows.length < 2) return null;
  const colors = lines.map((line, index) => line.tone ? toneColor(line.tone) : lines.length === 1 ? toneColor(tone) : PALETTE[index]!);
  const id = "area-" + Math.random().toString(36).slice(2, 8);
  const axis = <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} interval="preserveStartEnd" minTickGap={24} />;
  const tooltip = <Tooltip cursor={{ fill: "var(--accent)" }} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 4, fontSize: 12 }}
    formatter={(value: unknown, key: unknown) => [formatValue(Number(value)) + (unit ? " " + unit : ""), lines[Number(String(key).slice(1))]?.name || title || ""]} />;
  const margin = { top: 12, right: 4, bottom: 0, left: 4 };
  return (
    <Block>
      {title ? <Label tone={lines.length === 1 ? tone : null}>{title}{unit ? <span className="normal-case tracking-normal text-dim"> · {unit}</span> : null}</Label> : null}
      {lines.length > 1 ? (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {lines.map((line, index) => <span key={index} className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="size-2 rounded-full" style={{ background: colors[index] }} />{line.name}</span>)}
        </div>
      ) : null}
      <div className="mt-2 h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {kind === "bar" ? (
            <BarChart data={rows} margin={margin}>{axis}{tooltip}{lines.map((_, index) => <Bar key={index} dataKey={"s" + index} fill={colors[index]} radius={[2, 2, 0, 0]} />)}</BarChart>
          ) : kind === "line" ? (
            <LineChart data={rows} margin={margin}>{axis}{tooltip}{lines.map((_, index) => <Line key={index} dataKey={"s" + index} stroke={colors[index]} strokeWidth={2} dot={false} connectNulls />)}</LineChart>
          ) : (
            <AreaChart data={rows} margin={margin}>
              <defs>{lines.map((_, index) => (
                <linearGradient key={index} id={id + index} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={colors[index]} stopOpacity={lines.length > 1 ? 0.25 : 0.45} /><stop offset="100%" stopColor={colors[index]} stopOpacity={0} /></linearGradient>
              ))}</defs>
              {axis}{tooltip}{lines.map((_, index) => <Area key={index} dataKey={"s" + index} stroke={colors[index]} strokeWidth={2} fill={`url(#${id}${index})`} connectNulls />)}
            </AreaChart>
          )}
        </ResponsiveContainer>
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
          <tr>{head.map((name, column) => <th key={column} className={cn("whitespace-nowrap pb-1.5 pr-3 align-bottom text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground last:pr-0", right[column] ? "text-right" : "text-left")}>{name}</th>)}</tr>
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
              {item.detail ? <span className="block text-xs text-muted-foreground">{item.detail}</span> : null}
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
            <li key={task.uid} className="flex items-start gap-3 border-t border-dashed py-3 first:border-t-0">
              <Check label={"Complete " + task.text} onCheck={() => { try { completeTask(task.uid); toast("Done."); } catch (error) { toastError(error); } }} />
              <div className="min-w-0">
                <p className="text-sm">{task.text}</p>
                <p className={cn("text-xs text-muted-foreground", overdue && "text-destructive")}>
                  {overdue ? "overdue · " + task.due : task.due === day ? "today" : task.due || "no date"}{task.important ? " · important" : ""}
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
          <li key={item.id} className="flex items-center gap-3 border-t border-dashed py-2.5 first:border-t-0">
            <p className="min-w-0 flex-1 text-sm">{item.text}</p>
            <Button size="sm" variant="ghost" className="text-thought" onClick={() => { try { createTask(item.text); toast("Made into a task."); } catch (error) { toastError(error); } }}>→ task</Button>
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
    <form onSubmit={submit} className="flex items-center gap-2 rounded-lg border bg-card py-1 pr-1 pl-3 focus-within:border-primary">
      <span aria-hidden="true" className="font-pixel text-lg text-primary">▌</span>
      <Input value={text} onChange={event => setText(event.target.value)} aria-label={hint} maxLength={500} placeholder={hint}
        className="h-10 min-w-0 flex-1 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent" />
      <Button type="submit" disabled={!text.trim()}>{label}</Button>
    </form>
  );
}
