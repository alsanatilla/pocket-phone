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

export function Chart({ kind, title, data, unit, tone }: { kind: "area" | "bar" | "line"; title?: string | null; data: { label: string; value: number }[]; unit?: string | null; tone?: Tone }) {
  const color = toneColor(tone);
  const points = Array.isArray(data) ? data.filter(point => Number.isFinite(point?.value)) : [];
  if (points.length < 2) return null;
  const axis = <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} interval="preserveStartEnd" minTickGap={24} />;
  const tooltip = <Tooltip cursor={{ fill: "var(--accent)" }} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 4, fontSize: 12 }}
    formatter={(value: unknown) => [String(value) + (unit ? " " + unit : ""), title ?? ""]} />;
  return (
    <Block>
      {title ? <Label tone={tone}>{title}</Label> : null}
      <div className="mt-2 h-36 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {kind === "bar" ? (
            <BarChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>{axis}{tooltip}<Bar dataKey="value" fill={color} radius={[2, 2, 0, 0]} /></BarChart>
          ) : kind === "line" ? (
            <LineChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>{axis}{tooltip}<Line dataKey="value" stroke={color} strokeWidth={2} dot={false} /></LineChart>
          ) : (
            <AreaChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <defs><linearGradient id="pocket-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.45} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
              {axis}{tooltip}<Area dataKey="value" stroke={color} strokeWidth={2} fill="url(#pocket-area)" />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
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
