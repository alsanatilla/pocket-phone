import { useState, type FormEvent } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { JobDraft } from "../../data/jobs.ts";
import { BARE_INPUT } from "../../ui/SendButton.tsx";

// One job, new or edited. The schedule is one of three: a time on chosen days, every N minutes within active
// hours, or once at a moment. Check-ins and briefs have fixed instructions; watches and prompts take the person's.

type Mode = "daily" | "every" | "once";
const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const INTERVALS = [15, 30, 60, 120, 240, 480, 1440];
const intervalName = (minutes: number) => minutes < 60 ? `${minutes} min` : minutes === 1440 ? "day" : `${minutes / 60} h`;

const localInput = (at: number) => { const date = new Date(at); return new Date(+date - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

const LINE = "flex min-h-11 items-center gap-2 border-t py-2 sm:min-h-0";
const MULTILINE = "flex gap-2 border-t py-2";
const BARE_AREA = "min-h-24 w-full resize-none rounded-none border-0 bg-transparent p-0 text-sm shadow-none placeholder:text-dim focus-visible:ring-0 dark:bg-transparent";
const CLOCK = "h-11 w-36 shrink-0 rounded-none border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent";

export function JobEditor({ draft, open, onOpenChange, onSave, busy }: { draft: JobDraft | null; open: boolean; onOpenChange: (open: boolean) => void; onSave: (draft: JobDraft) => Promise<unknown>; busy: boolean }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        {draft ? <Form key={draft.id ?? draft.kind + (draft.title ?? "")} draft={draft} onSave={onSave} busy={busy} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Form({ draft, onSave, busy }: { draft: JobDraft; onSave: (draft: JobDraft) => Promise<unknown>; busy: boolean }) {
  const fixed = draft.kind === "checkin" || draft.kind === "brief";
  const [title, setTitle] = useState(draft.title ?? "");
  const [prompt, setPrompt] = useState(draft.prompt ?? "");
  const [mode, setMode] = useState<Mode>(draft.at !== undefined ? "once" : draft.every ? "every" : "daily");
  const [time, setTime] = useState(draft.time && draft.time !== "00:00" ? draft.time : "08:00");
  const [days, setDays] = useState<number[]>(draft.days?.length ? draft.days : [1, 2, 3, 4, 5]);
  const [every, setEvery] = useState(draft.every ?? 120);
  const [windowed, setWindowed] = useState(Boolean(draft.activeHours) || !draft.id);
  const [start, setStart] = useState(draft.activeHours?.start ?? "08:00");
  const [end, setEnd] = useState(draft.activeHours?.end === "00:00" ? "24:00" : draft.activeHours?.end ?? "22:00");
  const [at, setAt] = useState(() => localInput(draft.at || Date.now() + 3600000));
  const [notify, setNotify] = useState(draft.delivery !== "quiet");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const base: JobDraft = { kind: draft.kind, ...(draft.id ? { id: draft.id } : {}), title: title.trim(), prompt: prompt.trim(), enabled: draft.enabled ?? true, delivery: notify ? "notify" : "quiet" };
    const schedule: Partial<JobDraft> = mode === "once" ? { at: new Date(at).getTime() }
      : mode === "every" ? { every, days, ...(windowed ? { activeHours: { start, end } } : {}) }
      : { time, days };
    void onSave({ ...base, ...schedule });
  };
  const toggleDay = (day: number) => setDays(current => current.includes(day) ? current.filter(item => item !== day) : [...current, day].sort());

  return (
    <form onSubmit={submit} className="grid gap-1">
      <DialogHeader className="place-items-start gap-1 text-left">
        <DialogTitle className="text-sm font-medium leading-tight text-hi">{draft.id ? "edit job" : "new job"}</DialogTitle>
        <DialogDescription>{fixed ? "Pip knows what this job looks at; choose when it runs." : "Tell Pip what to do or look for; it keeps its own notes between runs."}</DialogDescription>
      </DialogHeader>

      <label className={LINE}>
        <span aria-hidden="true" className="text-dim">›</span>
        <span className="shrink-0 text-xs text-dim">name</span>
        <Input value={title} maxLength={80} placeholder={draft.kind === "watch" ? "e.g. Bike prices" : draft.kind === "checkin" ? "Morning check-in" : draft.kind === "brief" ? "Nightly brief" : "e.g. Call Sam"} onChange={event => setTitle(event.target.value)} className={BARE_INPUT} />
      </label>
      {!fixed ? (
        <label className={MULTILINE}>
          <span aria-hidden="true" className="pt-0.5 text-dim">›</span>
          <span className="grid min-w-0 flex-1 gap-1">
            <span className="text-xs text-dim">{draft.kind === "watch" ? "what to watch for" : "what Pip should do"}</span>
            <Textarea rows={4} maxLength={4000} value={prompt} required onChange={event => setPrompt(event.target.value)}
              placeholder={draft.kind === "watch" ? "Tell me when a used road bike under 900 € shows up near Berlin." : "Remind me to call Sam and look up his last message."}
              className={BARE_AREA} />
          </span>
        </label>
      ) : null}

      <div className="border-t pt-2">
        <p className="text-xs text-dim">when</p>
        <div role="radiogroup" aria-label="Schedule" className="flex flex-wrap items-center gap-x-4">
          {(["daily", "every", "once"] as Mode[]).map(option => (
            <button key={option} type="button" role="radio" aria-checked={mode === option} onClick={() => setMode(option)}
              className={cn("flex min-h-11 items-center text-sm transition-colors sm:min-h-0", mode === option ? "text-hi" : "text-dim hover:text-foreground")}>
              {option === "daily" ? "on days" : option === "every" ? "repeat" : "once"}
            </button>
          ))}
        </div>

        {mode !== "once" ? (
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Days">
            {DAYS.map((name, day) => (
              <button key={day} type="button" aria-pressed={days.includes(day)} aria-label={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day]} onClick={() => toggleDay(day)}
                className={cn("flex min-h-11 min-w-9 items-center justify-center text-sm transition-colors sm:min-h-0 sm:min-w-0", days.includes(day) ? "text-hi" : "text-dim hover:text-foreground")}>{name}</button>
            ))}
          </div>
        ) : null}

        {mode === "daily" ? <label className={LINE}><span className="shrink-0 text-xs text-dim">at</span><Input type="time" value={time} onChange={event => setTime(event.target.value)} aria-label="Time" className={CLOCK} /></label> : null}

        {mode === "every" ? (
          <div className="grid gap-1">
            <label className={LINE}>
              <span className="shrink-0 text-xs text-dim">every</span>
              <select value={every} onChange={event => setEvery(Number(event.target.value))} aria-label="Interval"
                className="h-11 min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-sm text-hi outline-none">
                {INTERVALS.map(minutes => <option key={minutes} value={minutes}>every {intervalName(minutes)}</option>)}
              </select>
            </label>
            <button type="button" role="switch" aria-checked={windowed} onClick={() => setWindowed(!windowed)}
              className="flex min-h-11 items-center gap-2 text-sm transition-colors sm:min-h-0">
              <span className="text-dim">only between</span>
              <span aria-hidden="true" className="text-dim">[{windowed ? "x" : " "}]</span>
            </button>
            {windowed ? (
              <div className="flex items-center gap-2">
                <Input type="time" value={start} onChange={event => setStart(event.target.value)} aria-label="From" className={CLOCK} />
                <span className="text-dim">–</span>
                <Input type="time" value={end === "24:00" ? "23:59" : end} onChange={event => setEnd(event.target.value === "23:59" ? "24:00" : event.target.value)} aria-label="Until" className={CLOCK} />
              </div>
            ) : null}
          </div>
        ) : null}

        {mode === "once" ? <label className={LINE}><span className="shrink-0 text-xs text-dim">at</span><Input type="datetime-local" value={at} onChange={event => setAt(event.target.value)} aria-label="Moment" className="h-11 min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent" /></label> : null}
      </div>

      <button type="button" role="switch" aria-checked={notify} onClick={() => setNotify(!notify)}
        className="flex min-h-11 w-full items-center justify-between gap-3 border-t py-2 text-left">
        <span className="grid gap-0.5">
          <span className="text-sm text-hi">notify me</span>
          <span className="text-xs text-dim">{notify ? "A push when Pip has something; nothing when a watch finds nothing." : "Quiet: Pip writes in the job's chat without a push."}</span>
        </span>
        <span aria-hidden="true" className="shrink-0 text-dim">[{notify ? "x" : " "}]</span>
      </button>

      <DialogFooter className="flex-row items-center justify-end border-t pt-1">
        <button type="submit" disabled={busy || (!fixed && (!title.trim() || !prompt.trim())) || (mode !== "once" && !days.length)}
          className="flex min-h-11 items-center text-sm text-primary transition-colors hover:text-hi disabled:text-dim sm:min-h-0">{draft.id ? "save" : "create job"}</button>
      </DialogFooter>
    </form>
  );
}
