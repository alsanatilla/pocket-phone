import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { JobDraft } from "../../data/jobs.ts";

// One job, new or edited. The schedule is one of three: a time on chosen days, every N minutes within active
// hours, or once at a moment. Check-ins and briefs have fixed instructions; watches and prompts take the person's.

type Mode = "daily" | "every" | "once";
const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const INTERVALS = [15, 30, 60, 120, 240, 480, 1440];
const intervalName = (minutes: number) => minutes < 60 ? `${minutes} min` : minutes === 1440 ? "day" : `${minutes / 60} h`;

const localInput = (at: number) => { const date = new Date(at); return new Date(+date - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

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
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="text-lg font-semibold">{draft.id ? "edit job" : "new job"}</DialogTitle>
        <DialogDescription>{fixed ? "Pip knows what this job looks at; choose when it runs." : "Tell Pip what to do or look for; it keeps its own notes between runs."}</DialogDescription>
      </DialogHeader>

      <Label className="grid gap-1.5"><span className="text-xs text-muted-foreground">name</span>
        <Input value={title} maxLength={80} placeholder={draft.kind === "watch" ? "e.g. Bike prices" : draft.kind === "checkin" ? "Morning check-in" : draft.kind === "brief" ? "Nightly brief" : "e.g. Call Sam"} onChange={event => setTitle(event.target.value)} />
      </Label>
      {!fixed ? (
        <Label className="grid gap-1.5"><span className="text-xs text-muted-foreground">{draft.kind === "watch" ? "what to watch for" : "what Pip should do"}</span>
          <Textarea rows={4} maxLength={4000} value={prompt} required onChange={event => setPrompt(event.target.value)}
            placeholder={draft.kind === "watch" ? "Tell me when a used road bike under 900 € shows up near Berlin." : "Remind me to call Sam and look up his last message."} />
        </Label>
      ) : null}

      <div className="grid gap-2">
        <span className="text-xs text-muted-foreground">when</span>
        <div role="radiogroup" aria-label="Schedule" className="grid grid-cols-3 gap-1 rounded-md border p-1">
          {(["daily", "every", "once"] as Mode[]).map(option => (
            <button key={option} type="button" role="radio" aria-checked={mode === option} onClick={() => setMode(option)}
              className={cn("rounded-sm py-2 text-sm transition-colors", mode === option ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              {option === "daily" ? "on days" : option === "every" ? "repeat" : "once"}
            </button>
          ))}
        </div>

        {mode !== "once" ? (
          <div className="flex gap-1" role="group" aria-label="Days">
            {DAYS.map((name, day) => (
              <button key={day} type="button" aria-pressed={days.includes(day)} aria-label={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day]} onClick={() => toggleDay(day)}
                className={cn("size-10 rounded-sm border text-sm transition-colors", days.includes(day) ? "border-primary bg-accent text-primary" : "text-muted-foreground")}>{name}</button>
            ))}
          </div>
        ) : null}

        {mode === "daily" ? <Input type="time" value={time} onChange={event => setTime(event.target.value)} aria-label="Time" className="w-36" /> : null}

        {mode === "every" ? (
          <div className="grid gap-2">
            <select value={every} onChange={event => setEvery(Number(event.target.value))} aria-label="Interval" className="h-10 w-40 rounded-md border bg-card px-2 text-sm">
              {INTERVALS.map(minutes => <option key={minutes} value={minutes}>every {intervalName(minutes)}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm"><Switch checked={windowed} onCheckedChange={setWindowed} /> only between</label>
            {windowed ? (
              <div className="flex items-center gap-2">
                <Input type="time" value={start} onChange={event => setStart(event.target.value)} aria-label="From" className="w-36" />
                <span className="text-muted-foreground">–</span>
                <Input type="time" value={end === "24:00" ? "23:59" : end} onChange={event => setEnd(event.target.value === "23:59" ? "24:00" : event.target.value)} aria-label="Until" className="w-36" />
              </div>
            ) : null}
          </div>
        ) : null}

        {mode === "once" ? <Input type="datetime-local" value={at} onChange={event => setAt(event.target.value)} aria-label="Moment" className="w-56" /> : null}
      </div>

      <label className="flex items-center justify-between gap-3 rounded-md border p-3">
        <span className="grid gap-0.5">
          <span className="text-sm">Notify me</span>
          <span className="text-xs text-muted-foreground">{notify ? "A push when Pip has something; nothing when a watch finds nothing." : "Quiet: Pip writes in the job's chat without a push."}</span>
        </span>
        <Switch checked={notify} onCheckedChange={setNotify} />
      </label>

      <DialogFooter><Button type="submit" disabled={busy || (!fixed && (!title.trim() || !prompt.trim())) || (mode !== "once" && !days.length)}>{draft.id ? "save" : "create job"}</Button></DialogFooter>
    </form>
  );
}
