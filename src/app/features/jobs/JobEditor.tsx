import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { JobDraft } from "../../data/jobs.ts";
import { Row, SectionLabel, Segmented } from "../../ui/kit.tsx";
import { BARE_INPUT } from "../../ui/SendButton.tsx";

// One job, new or edited. The schedule is one of three: a time on chosen days, every N minutes within active
// hours, or once at a moment. Check-ins and briefs have fixed instructions; watches and prompts take the person's.

type Mode = "daily" | "every" | "once";
const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const INTERVALS = [15, 30, 60, 120, 240, 480, 1440];
const intervalName = (minutes: number) => minutes < 60 ? `${minutes} min` : minutes === 1440 ? "day" : `${minutes / 60} h`;

const localInput = (at: number) => { const date = new Date(at); return new Date(+date - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

const PROMPT = "flex min-h-11 items-center gap-2 sm:min-h-0";
const PROMPT_MULTI = "flex items-start gap-2";
const BARE_AREA = "min-h-24 w-full resize-none rounded-none border-0 bg-transparent p-0 text-sm shadow-none placeholder:text-dim focus-visible:ring-0 dark:bg-transparent";
const CLOCK = "h-11 w-36 shrink-0 rounded-none border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent";

export function JobEditor({ draft, open, onOpenChange, onSave, busy }: { draft: JobDraft | null; open: boolean; onOpenChange: (open: boolean) => void; onSave: (draft: JobDraft) => Promise<unknown>; busy: boolean }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-0 max-h-[90dvh] overflow-y-auto">
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
  // A job made here reports in its own chat, as before; only one set up in conversation starts in the big chat.
  const [home, setHome] = useState(draft.to === "home");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const base: JobDraft = { kind: draft.kind, ...(draft.id ? { id: draft.id } : {}), title: title.trim(), prompt: prompt.trim(), enabled: draft.enabled ?? true, delivery: notify ? "notify" : "quiet",
      to: home ? "home" : "own", ...(draft.grants ? { grants: draft.grants } : {}), ...(draft.web === false ? { web: false } : {}) };
    const schedule: Partial<JobDraft> = mode === "once" ? { at: new Date(at).getTime() }
      : mode === "every" ? { every, days, ...(windowed ? { activeHours: { start, end } } : {}) }
      : { time, days };
    void onSave({ ...base, ...schedule });
  };
  const toggleDay = (day: number) => setDays(current => current.includes(day) ? current.filter(item => item !== day) : [...current, day].sort());

  return (
    <form onSubmit={submit} className="grid min-w-0 gap-2">
      <DialogHeader className="place-items-start gap-1 text-left">
        <DialogTitle>{draft.id ? "edit job" : "new job"}</DialogTitle>
        <DialogDescription>{fixed ? "Pip knows what this job looks at; choose when it runs." : "Tell Pip what to do or look for; it keeps its own notes between runs."}</DialogDescription>
      </DialogHeader>

      <label className={PROMPT}>
        <span aria-hidden="true" className="text-dim">›</span>
        <span className="shrink-0 text-xs text-dim">name</span>
        <Input value={title} maxLength={80} placeholder={draft.kind === "watch" ? "e.g. Bike prices" : draft.kind === "checkin" ? "Morning check-in" : draft.kind === "brief" ? "Nightly brief" : "e.g. Call Sam"} onChange={event => setTitle(event.target.value)} className={BARE_INPUT} />
      </label>
      {!fixed ? (
        <label className={PROMPT_MULTI}>
          <span aria-hidden="true" className="pt-0.5 text-dim">›</span>
          <span className="grid min-w-0 flex-1 gap-1">
            <span className="text-xs text-dim">{draft.kind === "watch" ? "what to watch for" : "what Pip should do"}</span>
            <Textarea rows={4} maxLength={4000} value={prompt} required onChange={event => setPrompt(event.target.value)}
              placeholder={draft.kind === "watch" ? "Tell me when a used road bike under 900 € shows up near Berlin." : "Remind me to call Sam and look up his last message."}
              className={BARE_AREA} />
          </span>
        </label>
      ) : null}

      <div className="grid gap-2 pt-1">
        <SectionLabel>when</SectionLabel>
        <div className="flex"><Segmented<Mode> value={mode} label="Schedule" onChange={setMode}
          options={[{ value: "daily", label: "on days" }, { value: "every", label: "repeat" }, { value: "once", label: "once" }]} /></div>

        {mode !== "once" ? (
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Days">
            {DAYS.map((name, day) => (
              <Button key={day} type="button" aria-pressed={days.includes(day)} aria-label={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day]} onClick={() => toggleDay(day)}
                className={days.includes(day) ? "min-w-9 px-0 bg-accent text-hi" : "min-w-9 px-0 text-dim"}>{name}</Button>
            ))}
          </div>
        ) : null}

        {mode === "daily" ? <label className={PROMPT}><span className="shrink-0 text-xs text-dim">at</span><Input type="time" value={time} onChange={event => setTime(event.target.value)} aria-label="Time" className={CLOCK} /></label> : null}

        {mode === "every" ? (
          <div className="grid gap-2">
            <label className={PROMPT}>
              <span className="shrink-0 text-xs text-dim">every</span>
              <select value={every} onChange={event => setEvery(Number(event.target.value))} aria-label="Interval"
                className="h-11 min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-sm text-hi outline-none">
                {INTERVALS.map(minutes => <option key={minutes} value={minutes}>every {intervalName(minutes)}</option>)}
              </select>
            </label>
            <div className="flex min-h-11 items-center gap-2 sm:min-h-0">
              <span className="text-xs text-dim">only between</span>
              <Switch checked={windowed} onCheckedChange={setWindowed} aria-label="Only between" />
            </div>
            {windowed ? (
              <div className="flex items-center gap-2">
                <Input type="time" value={start} onChange={event => setStart(event.target.value)} aria-label="From" className={CLOCK} />
                <span className="text-dim">–</span>
                <Input type="time" value={end === "24:00" ? "23:59" : end} onChange={event => setEnd(event.target.value === "23:59" ? "24:00" : event.target.value)} aria-label="Until" className={CLOCK} />
              </div>
            ) : null}
          </div>
        ) : null}

        {mode === "once" ? <label className={PROMPT}><span className="shrink-0 text-xs text-dim">at</span><Input type="datetime-local" value={at} onChange={event => setAt(event.target.value)} aria-label="Moment" className="h-11 min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent" /></label> : null}
      </div>

      <div className="grid gap-1">
        <Row className="min-w-0" end={<Switch checked={notify} onCheckedChange={setNotify} aria-label="Notify me" />}>notify me</Row>
        <p className="text-xs text-dim">{notify ? "A push when Pip has something; nothing when a watch finds nothing." : "Quiet: Pip writes without a push."}</p>
      </div>

      {/* A watch that keeps a card current answers where the card is. */}
      {!draft.chat ? <div className="grid gap-1">
        <Row className="min-w-0" end={<Switch checked={home} onCheckedChange={setHome} aria-label="Report in pip" />}>report in pip</Row>
        <p className="text-xs text-dim">{home ? "Its reports land in your pip chat." : "Its reports go to a chat of its own."}</p>
      </div> : null}

      <DialogFooter className="flex-row items-center justify-end pt-1">
        <Button type="submit" variant="go" disabled={busy || (!fixed && (!title.trim() || !prompt.trim())) || (mode !== "once" && !days.length)}>
          {draft.id ? "save" : "create job"}
        </Button>
      </DialogFooter>
    </form>
  );
}
