import { useState, type FormEvent } from "react";
import { Area, AreaChart, Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCollection } from "../data/bus.ts";
import { completeTask, listTasks, today, chosenTask } from "../data/tasks.ts";
import { openThoughts, parkThoughtText } from "../data/thoughts.ts";
import { createTask } from "../data/tasks.ts";
import { toast, toastError } from "../ui/toast/toast.ts";

// Pocket's own components for generated surfaces. Each takes the props its catalog entry declares; the lists
// read live data themselves, so a generated screen stays true when a task is ticked off elsewhere.

export type Tone = "accent" | "movement" | "calendar" | "thought" | "warning" | "muted" | null | undefined;

const TONE_VAR: Record<NonNullable<Tone>, string> = {
  accent: "var(--primary)", movement: "var(--movement)", calendar: "var(--calendar)",
  thought: "var(--thought)", warning: "var(--destructive)", muted: "var(--muted-foreground)",
};
export const toneColor = (tone: Tone) => TONE_VAR[tone ?? "accent"];

export function Hero({ eyebrow, value, unit, caption, tone }: { eyebrow?: string | null; value: string | number; unit?: string | null; caption?: string | null; tone?: Tone }) {
  return (
    <section className="py-2">
      {eyebrow ? <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{eyebrow}</p> : null}
      <p className="font-pixel text-[clamp(3.5rem,16vw,7rem)] leading-[0.9]" style={{ color: toneColor(tone) }}>
        {value}{unit ? <span className="ml-2 text-[0.4em] text-muted-foreground">{unit}</span> : null}
      </p>
      {caption ? <p className="mt-2 max-w-prose text-base text-foreground/90">{caption}</p> : null}
    </section>
  );
}

export function Metric({ label, value, unit, hint, tone, onPress }: { label: string; value: string | number; unit?: string | null; hint?: string | null; tone?: Tone; onPress?: () => void }) {
  const Tag = onPress ? "button" : "div";
  return (
    <Tag onClick={onPress} className={cn("flex min-h-24 flex-col justify-between rounded-lg border bg-card p-3 text-left", onPress && "transition-colors hover:border-primary")}>
      <span className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="font-pixel text-5xl leading-none" style={{ color: toneColor(tone) }}>
        {value}{unit ? <span className="ml-1 text-lg text-muted-foreground">{unit}</span> : null}
      </span>
      {hint ? <span className="truncate text-xs text-dim">{hint}</span> : null}
    </Tag>
  );
}

export function Gauge({ label, value, caption, tone }: { label: string; value: number; caption?: string | null; tone?: Tone }) {
  const clamped = Math.max(0, Math.min(100, Number(value) || 0));
  const radius = 52, circumference = 2 * Math.PI * radius;
  return (
    <div className="flex items-center gap-4 rounded-lg border bg-card p-4">
      <svg viewBox="0 0 120 120" className="size-32 shrink-0 -rotate-90" role="img" aria-label={`${label}: ${clamped}`}>
        <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--border)" strokeWidth="10" />
        <circle cx="60" cy="60" r={radius} fill="none" stroke={toneColor(tone)} strokeWidth="10" strokeLinecap="butt"
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - clamped / 100)} />
        <text x="60" y="60" textAnchor="middle" dominantBaseline="central" transform="rotate(90 60 60)"
          className="font-pixel" fontSize="40" fill="var(--foreground)">{clamped}</text>
      </svg>
      <div>
        <p className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</p>
        {caption ? <p className="mt-1 text-base">{caption}</p> : null}
      </div>
    </div>
  );
}

export function Chart({ kind, title, data, unit, tone }: { kind: "area" | "bar" | "line"; title?: string | null; data: { label: string; value: number }[]; unit?: string | null; tone?: Tone }) {
  const color = toneColor(tone);
  const points = Array.isArray(data) ? data.filter(point => Number.isFinite(point?.value)) : [];
  if (points.length < 2) return null;
  const axis = <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} interval="preserveStartEnd" minTickGap={16} />;
  const tooltip = <Tooltip cursor={{ fill: "var(--accent)" }} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 4 }}
    formatter={(value: unknown) => [String(value) + (unit ? " " + unit : ""), title ?? ""]} />;
  return (
    <figure className="rounded-lg border bg-card p-4">
      {title ? <figcaption className="mb-2 text-[11px] uppercase tracking-widest text-muted-foreground">{title}</figcaption> : null}
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {kind === "bar" ? (
            <BarChart data={points}>{axis}{tooltip}<Bar dataKey="value" fill={color} radius={[2, 2, 0, 0]} /></BarChart>
          ) : kind === "line" ? (
            <LineChart data={points}>{axis}{tooltip}<Line dataKey="value" stroke={color} strokeWidth={2} dot={false} /></LineChart>
          ) : (
            <AreaChart data={points}>
              <defs><linearGradient id="pocket-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.5} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
              {axis}{tooltip}<Area dataKey="value" stroke={color} strokeWidth={2} fill="url(#pocket-area)" />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

interface TimelineItem { time: string; title: string; detail?: string | null; past?: boolean | null; now?: boolean | null }
export function Timeline({ title, items }: { title?: string | null; items: TimelineItem[] }) {
  const list = Array.isArray(items) ? items : [];
  return (
    <section className="rounded-lg border bg-card p-4">
      {title ? <p className="mb-3 text-[11px] uppercase tracking-widest text-muted-foreground">{title}</p> : null}
      {list.length ? (
        <ol className="relative ml-2 border-l">
          {list.map((item, index) => (
            <li key={index} className={cn("relative pb-4 pl-5 last:pb-0", item.past && "opacity-50")}>
              <span className={cn("absolute -left-[5px] top-1.5 size-2.5 rounded-full border bg-background", item.now && "border-primary bg-primary")} />
              <p className="font-pixel text-xl leading-none" style={{ color: item.now ? "var(--primary)" : "var(--calendar)" }}>{item.time}</p>
              <p className="mt-0.5">{item.title}</p>
              {item.detail ? <p className="text-xs text-muted-foreground">{item.detail}</p> : null}
            </li>
          ))}
        </ol>
      ) : <p className="text-sm text-muted-foreground">Nothing on the calendar.</p>}
    </section>
  );
}

export function TaskList({ title, source, limit }: { title?: string | null; source: "due" | "open" | "chosen"; limit?: number | null }) {
  const tasks = useCollection(["tasks.json"], () => {
    const day = today(), open = listTasks().filter(task => !task.done);
    if (source === "chosen") { const chosen = chosenTask(); return chosen && !chosen.done ? [chosen] : []; }
    return source === "due" ? open.filter(task => task.due && task.due <= day) : open;
  }, [source]);
  const shown = tasks.slice(0, limit ?? 6);
  const day = today();
  return (
    <section className="rounded-lg border bg-card p-4">
      <p className="mb-1 text-[11px] uppercase tracking-widest text-primary">{title ?? (source === "due" ? "due today" : source === "chosen" ? "next" : "open tasks")} · {tasks.length}</p>
      {shown.length ? shown.map(task => (
        <div key={task.uid} className="flex items-start gap-3 border-t border-dashed py-2.5 first:border-t-0">
          <button aria-label={"Complete " + task.text} className="-mt-1 size-11 shrink-0 rounded-sm border transition-colors hover:border-primary"
            onClick={() => { try { completeTask(task.uid); toast("Done."); } catch (error) { toastError(error); } }} />
          <div className="min-w-0">
            <p>{task.text}</p>
            <p className={cn("text-xs text-dim", task.due && task.due < day && "text-destructive")}>
              {task.due ? (task.due < day ? "overdue · " : "") + task.due : "no date"}{task.important ? " · important" : ""}
            </p>
          </div>
        </div>
      )) : <p className="text-sm text-muted-foreground">Nothing here.</p>}
    </section>
  );
}

export function ThoughtList({ title, source, limit }: { title?: string | null; source: "ready" | "open"; limit?: number | null }) {
  const thoughts = useCollection(["parking.json"], () => {
    const now = Date.now(), all = openThoughts();
    return source === "ready" ? all.filter(item => item.due > 0 && item.due <= now) : all;
  }, [source]);
  return (
    <section className="rounded-lg border bg-card p-4">
      <p className="mb-1 text-[11px] uppercase tracking-widest text-thought">{title ?? (source === "ready" ? "to revisit" : "parked thoughts")} · {thoughts.length}</p>
      {thoughts.slice(0, limit ?? 5).map(item => (
        <div key={item.id} className="flex items-center gap-3 border-t border-dashed py-2.5 first:border-t-0">
          <p className="min-w-0 flex-1">{item.text}</p>
          <Button size="sm" variant="outline" onClick={() => { try { createTask(item.text); toast("Made into a task."); } catch (error) { toastError(error); } }}>make task</Button>
        </div>
      ))}
      {!thoughts.length ? <p className="text-sm text-muted-foreground">Nothing parked.</p> : null}
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
  return (
    <form onSubmit={submit} className="flex items-center gap-2 rounded-lg border bg-card p-1.5 pl-3 focus-within:border-primary">
      <span aria-hidden="true" className="font-pixel text-lg text-primary">▌</span>
      <Input value={text} onChange={event => setText(event.target.value)} aria-label={placeholder ?? label} maxLength={500}
        placeholder={placeholder ?? (mode === "thought" ? "capture a thought…" : mode === "task" ? "add a task…" : "ask pip…")}
        className="h-11 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent" />
      <Button type="submit" size="lg" disabled={!text.trim()}>{label}</Button>
    </form>
  );
}
