import { lazy, Suspense, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useCollection } from "../data/bus.ts";
import { chosenTask, completeTask, createTask, listTasks, today } from "../data/tasks.ts";
import { openThoughts, parkThoughtText } from "../data/thoughts.ts";
import { toast, toastError } from "../ui/toast/toast.ts";

// Pocket's own components for generated surfaces. They follow the Terminal look (docs/agents/design.md):
//   label   a small caps line, dim (rule 4)
//   figure  one size, one weight, the mono face; a group of figures is columns divided by hairlines (rule 6)
//   rows    hairline rules, the main text bright, the note small and dim (rule 5)
// A card draws no frame: only arrangement and hairlines. The lists read live data themselves, so a generated screen
// stays true when a task is ticked off elsewhere.

export type Tone = "accent" | "movement" | "calendar" | "thought" | "warning" | "muted" | null | undefined;

const TONE_VAR: Record<NonNullable<Tone>, string> = {
  accent: "var(--primary)", movement: "var(--movement)", calendar: "var(--calendar)",
  thought: "var(--thought)", warning: "var(--destructive)", muted: "var(--muted-foreground)",
};
export const toneColor = (tone: Tone) => TONE_VAR[tone ?? "accent"];

/** Rule 4: the small line that names a block, with an optional count or note at the right. */
const LABEL = "text-[10.5px] uppercase tracking-[0.06em] text-dim";
/** Rule 8: a field is a prompt line, not a box. */
const LINE = "flex min-h-11 items-center gap-2 border-t py-2 sm:min-h-0";
const LINE_INPUT = "min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-sm text-foreground placeholder:text-dim";

function Label({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <p className={LABEL}>{children}</p>
      {note === undefined || note === null ? null : <span className="shrink-0 text-xs text-dim">{note}</span>}
    </div>
  );
}

/** A headline: a phrase is the one title of the page (pixel face, bright); a reading is a figure. */
const isPhrase = (value: string | number) => !/\d/.test(String(value));

export function Hero({ eyebrow, value, unit, caption }: { eyebrow?: string | null; value: string | number; unit?: string | null; caption?: string | null; tone?: Tone }) {
  return (
    <section className="arrive">
      {eyebrow ? <p className="text-xs text-dim">{eyebrow}</p> : null}
      <p className={cn("mt-1 leading-none text-hi", isPhrase(value) ? "font-pixel text-[30px]" : "text-[28px] font-medium")}>
        {value}{unit ? <span className="ml-1 text-[11px] text-dim">{unit}</span> : null}
      </p>
      {caption ? <p className="mt-1 text-sm text-muted-foreground">{caption}</p> : null}
    </section>
  );
}

export function Metric({ label, value, unit, hint, onPress }: { label: string; value: string | number; unit?: string | null; hint?: string | null; tone?: Tone; onPress?: () => void }) {
  const Tag = onPress ? "button" : "div";
  return (
    <Tag type={onPress ? "button" : undefined} onClick={onPress} className={cn("arrive min-w-0 text-left", onPress && "block w-full")}>
      <p className={LABEL}>{label}</p>
      <p className="mt-1 text-[19px] font-medium leading-none text-hi">
        {value}{unit ? <span className="ml-1 text-[11px] text-dim">{unit}</span> : null}
      </p>
      {hint ? <p className="mt-1 line-clamp-2 text-xs leading-tight text-dim">{hint}</p> : null}
    </Tag>
  );
}

export function Gauge({ label, value, caption }: { label: string; value: number; caption?: string | null; tone?: Tone }) {
  const clamped = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return (
    <section className="arrive">
      <p className={LABEL}>{label}</p>
      <p className="mt-1 text-[19px] font-medium leading-none text-hi">{clamped}<span className="ml-1 text-[11px] text-dim">%</span></p>
      {caption ? <p className="mt-1 text-xs text-dim">{caption}</p> : null}
    </section>
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
    <p className="mt-2 text-xs text-dim">
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
    <section className="arrive">
      {title ? <Label note={unit ? unit : undefined}>{title}</Label> : null}
      {lines.length > 1 ? (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {lines.map((line, index) => <span key={index} className="flex items-center gap-1.5 text-xs text-dim"><span className="size-2 shrink-0" style={{ background: colors[index] }} />{line.name}</span>)}
        </div>
      ) : null}
      <div className="mt-2 h-44 w-full">
        <Suspense fallback={<div className="shimmer h-full w-full" aria-hidden="true" />}>
          <ChartPlot kind={kind} rows={rows} colors={colors} names={names} unit={unit} format={formatValue} />
        </Suspense>
      </div>
      <SourceLine source={source} note={note} />
    </section>
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
    <section className="arrive">
      {title ? <Label>{title}</Label> : null}
      {/* The table reads as rows, the same as a table in a reply: .prose table in global.css. */}
      <div className="prose mt-2">
        <table>
          <thead>
            <tr>{head.map((name, column) => <th key={column} className={cn("whitespace-nowrap", right[column] ? "text-right" : "text-left")}>{name}</th>)}</tr>
          </thead>
          <tbody>
            {body.map((row, index) => (
              <tr key={index}>
                {head.map((_, column) => (
                  <td key={column} className={cn("align-top", right[column] && "text-right tabular-nums", String(row[column] ?? "").length <= 14 && "whitespace-nowrap")}>
                    {row[column] == null ? "" : typeof row[column] === "number" ? formatValue(row[column] as number) : String(row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SourceLine source={source} note={note} />
    </section>
  );
}

interface TimelineItem { time: string; title: string; detail?: string | null; past?: boolean | null; now?: boolean | null }
export function Timeline({ title, items }: { title?: string | null; items: TimelineItem[] }) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return null;
  return (
    <section className="arrive">
      <Label>{title ?? "today"}</Label>
      <ol>
        {list.map((item, index) => (
          <li key={index} className="flex gap-2.5 border-t py-2 last:border-b">
            <span className="w-[3.25rem] shrink-0 text-xs text-dim">{item.time}</span>
            <span className="min-w-0 flex-1">
              <span className={cn("block", item.past ? "text-dim" : "text-hi")}>
                {item.title}
                {item.now ? <span className="ml-2 text-xs font-medium text-hi">now</span> : null}
              </span>
              {item.detail ? <span className="block truncate text-xs text-dim">{item.detail}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
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
    <section className="arrive">
      <Label note={tasks.length}>{name}</Label>
      {tasks.length ? (
        <ul>
          {tasks.slice(0, limit ?? 6).map(task => {
            const overdue = Boolean(task.due) && task.due < day;
            return (
              <li key={task.uid} className="border-t last:border-b">
                <button type="button" aria-label={"Complete " + task.text}
                  onClick={() => { try { completeTask(task.uid); toast("Done."); } catch (error) { toastError(error); } }}
                  className="flex min-h-11 w-full items-start gap-2.5 py-2 text-left sm:min-h-0">
                  <span aria-hidden="true" className="shrink-0 text-dim">[ ]</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-hi">
                      {task.important ? <span role="img" aria-label="Important" className="mr-1.5 text-dim">!</span> : null}{task.text}
                    </span>
                    <span className={cn("block truncate text-xs text-dim", overdue && "text-destructive")}>
                      {overdue ? "overdue · " + task.due : task.due === day ? "today" : task.due || "no date"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : <p className="border-t py-2 text-sm text-muted-foreground">Nothing here.</p>}
    </section>
  );
}

export function ThoughtList({ title, source, limit }: { title?: string | null; source: "ready" | "open"; limit?: number | null }) {
  const thoughts = useCollection(["parking.json"], () => {
    const now = Date.now(), all = openThoughts();
    return source === "ready" ? all.filter(item => item.due > 0 && item.due <= now) : all;
  }, [source]);
  if (!thoughts.length) return null;
  return (
    <section className="arrive">
      <Label note={thoughts.length}>{title ?? (source === "ready" ? "to revisit" : "parked thoughts")}</Label>
      <ul>
        {thoughts.slice(0, limit ?? 5).map(item => (
          <li key={item.id} className="flex min-h-11 items-start gap-2.5 border-t py-2 last:border-b sm:min-h-0">
            <p className="min-w-0 flex-1 text-hi">{item.text}</p>
            <button type="button" aria-label={"Make a task from " + item.text}
              onClick={() => { try { createTask(item.text); toast("Made into a task."); } catch (error) { toastError(error); } }}
              className="min-h-11 shrink-0 text-xs text-dim hover:text-foreground sm:min-h-0">task</button>
          </li>
        ))}
      </ul>
    </section>
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
    <form onSubmit={submit} className={LINE}>
      <span aria-hidden="true" className="shrink-0 font-medium text-primary">{mode === "ask" ? "›" : "+"}</span>
      <input value={text} onChange={event => setText(event.target.value)} aria-label={hint} maxLength={500} placeholder={hint} className={LINE_INPUT} />
      <button type="submit" disabled={!text.trim()} className="min-h-11 shrink-0 text-xs text-dim hover:text-foreground disabled:text-dim sm:min-h-0">{label}</button>
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
    <section className="arrive">
      {title ? <Label>{title}</Label> : null}
      {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      <form onSubmit={submit}>
        {fields.map(field => (
          <label key={field.name} className={LINE}>
            <span aria-hidden="true" className="shrink-0 text-dim">›</span>
            <span className="shrink-0 text-xs text-dim">{field.label.toLowerCase()}</span>
            {field.type === "choice" ? (
              <select value={values[field.name] ?? ""} aria-label={field.label} required={field.required === true}
                onChange={event => setValues(current => ({ ...current, [field.name]: event.target.value }))}
                className={LINE_INPUT}>
                {(field.options ?? []).map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            ) : (
              <input value={values[field.name] ?? ""} aria-label={field.label} required={field.required === true} maxLength={500} className={LINE_INPUT}
                inputMode={field.type === "number" ? "decimal" : undefined}
                placeholder={field.placeholder ?? undefined}
                onChange={event => setValues(current => ({ ...current, [field.name]: event.target.value }))} />
            )}
          </label>
        ))}
        <div className="flex justify-end border-t pt-2">
          <button type="submit" disabled={missing}
            className="min-h-11 bg-primary px-3 text-sm text-primary-foreground disabled:bg-secondary disabled:text-dim sm:min-h-0 sm:h-8">{submitLabel?.trim().toLowerCase() || "send"}</button>
        </div>
      </form>
    </section>
  );
}
