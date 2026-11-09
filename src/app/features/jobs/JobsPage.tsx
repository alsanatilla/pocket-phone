import { defaultConfig, providerOf, PROVIDER_NAMES } from "../../data/models.ts";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { readAccess } from "../../data/ai.ts";
import { nextLabel, PRESETS, scheduleLabel, STATUS_LABEL, type Job, type JobDraft, type JobsState } from "../../data/jobs.ts";
import { classicHref } from "../../lib/classic.ts";
import { confirm } from "../../ui/dialog/dialog.ts";
import { PageTitle } from "../../ui/PageTitle.tsx";
import { modelLabel } from "../settings/SettingsPage.tsx";
import { JobEditor } from "./JobEditor.tsx";
import { useJobs } from "./useJobs.ts";

// Pip on its own: jobs that run on Pocket's server while the phone is in a pocket. Each job has a schedule, says
// whether it pushes, and keeps notes between its runs that only Pip writes; the person can read and clear them.

const BACKGROUND_GRANTS = ["notes", "thoughts", "tasks", "gym", "coros"];
const LIMITS = [50_000, 200_000, 1_000_000];
const tokens = (n: number) => n >= 1_000_000 ? n / 1_000_000 + "M" : Math.round(n / 1000) + "k";
const KIND_NAME: Record<string, string> = { checkin: "check-in", brief: "brief", watch: "watch", prompt: "task", training: "training" };

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between"><h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-primary">{title}</h2>{action}</div>
      {children}
    </section>
  );
}

/** Turning Pip on its own on: the model Pip uses already, the key the account keeps, a daily limit. */
function Setup({ state, onSetup, busy }: { state: JobsState; onSetup: ReturnType<typeof useJobs>["setup"]; busy: boolean }) {
  const [limit, setLimit] = useState(state.settings?.dailyTokens ?? 200_000);
  let config: ReturnType<typeof defaultConfig> | null = null;
  try { config = defaultConfig(); } catch { config = null; }
  const provider = config ? PROVIDER_NAMES[providerOf(config)] : "your provider";
  const turnOn = () => config && void onSetup({
    ...config, grants: readAccess().filter(grant => BACKGROUND_GRANTS.includes(grant)), dailyTokens: limit,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, enabled: true, useAccountKey: true,
  });
  return (
    <div className="arrive space-y-3 rounded-lg border bg-card p-4">
      <p className="font-pixel text-2xl leading-none">let pip work on its own</p>
      <p className="text-sm text-muted-foreground">Jobs run on Pocket's server, with {config ? modelLabel(config.model) : "your model"} through {provider} and the key you keep in your account. Pip reads only what you allow in settings and never saves anything without you.</p>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">at most</span>
        {LIMITS.map(value => (
          <button key={value} type="button" onClick={() => setLimit(value)} aria-pressed={limit === value}
            className={cn("rounded-sm border px-2.5 py-1.5", limit === value ? "border-primary text-primary" : "text-muted-foreground")}>{tokens(value)}</button>
        ))}
        <span className="text-muted-foreground">tokens a day</span>
      </div>
      <Button onClick={turnOn} disabled={busy || !config}>turn on</Button>
      <p className="text-xs text-dim">No key in your account yet? Connect one in <Link to="/settings" className="text-primary">settings</Link> first.</p>
    </div>
  );
}

function JobCard({ job, jobs }: { job: Job; jobs: ReturnType<typeof useJobs> }) {
  const [editing, setEditing] = useState(false);
  const training = job.kind === "training";
  const failed = job.lastStatus === "failed";
  const draft: JobDraft = { ...job };
  return (
    <article className={cn("arrive rounded-lg border bg-card p-3.5", !job.enabled && "opacity-60")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate">{job.title}</p>
          <p className="text-xs text-muted-foreground">{KIND_NAME[job.kind]} · {scheduleLabel(job)}{job.delivery === "quiet" ? " · quiet" : ""}</p>
          <p className={cn("mt-1 text-xs", failed ? "text-destructive" : "text-dim")}>
            next {nextLabel(job)}{job.lastRun ? ` · last ${STATUS_LABEL[job.lastStatus] ?? job.lastStatus}` : ""}{failed && job.lastError ? ` · ${job.lastError}` : ""}
          </p>
        </div>
        <Switch aria-label={(job.enabled ? "Pause " : "Resume ") + job.title} checked={job.enabled} disabled={training}
          onCheckedChange={enabled => void jobs.toggle({ ...draft, enabled })} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <Button size="sm" variant="ghost" disabled={jobs.busy === "run:" + job.id} onClick={() => void jobs.run(job.id)}><Play className="size-3.5" /> run now</Button>
        {job.lastChat ? <Button asChild size="sm" variant="ghost"><Link to="/pip" search={{ chat: job.lastChat }}>open chat</Link></Button> : null}
        {training
          ? <Button asChild size="sm" variant="ghost"><a href={classicHref("/pip")}>edit in classic</a></Button>
          : <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>edit</Button>}
        {!training ? (
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={async () => {
            if (await confirm({ title: "Remove “" + job.title + "”?", message: "Its notes go with it; its chat stays.", confirmLabel: "remove", danger: true })) void jobs.remove(job.id);
          }}>remove</Button>
        ) : null}
      </div>
      {job.scratch ? (
        <Collapsible className="group/notes mt-1 border-t border-dashed pt-2">
          <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <ChevronRight className="size-3.5 transition-transform group-data-[state=open]/notes:rotate-90" />Pip's notes for this job
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-2">
            <p className="whitespace-pre-wrap rounded-md bg-muted p-2.5 text-xs">{job.scratch}</p>
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => void jobs.clear(job.id)}>clear notes</Button>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      <JobEditor draft={editing ? draft : null} open={editing} onOpenChange={setEditing} busy={jobs.busy === "save"}
        onSave={async next => { if (await jobs.save(next)) setEditing(false); }} />
    </article>
  );
}

export function JobsPage() {
  const jobs = useJobs();
  const [creating, setCreating] = useState<JobDraft | null>(null);
  const [picking, setPicking] = useState(false);
  const { state, error } = jobs;

  if (error) {
    return (
      <main className="space-y-4">
        <PageTitle title="jobs" meta="pip on its own" />
        <div className="space-y-2 rounded-lg border border-dashed p-4 text-sm">
          <p>{error}</p>
          <p className="text-muted-foreground">Jobs run on Pocket's server, so they need your Pocket account. <a href={classicHref("/account")} className="text-primary">Sign in</a></p>
        </div>
      </main>
    );
  }
  if (!state) return <main className="space-y-3 pt-4"><div className="shimmer h-9 w-1/3 rounded-md" /><div className="shimmer h-24 rounded-lg" /><div className="shimmer h-24 rounded-lg" /></main>;

  const on = Boolean(state.settings?.enabled && state.hasKey);
  const limit = state.settings?.dailyTokens ?? 0;
  return (
    <main className="space-y-5">
      <PageTitle title="jobs" meta={on ? `pip on its own · today ${tokens(state.usedToday)} of ${tokens(limit)} tokens` : "pip on its own · off"}>
        <Button variant="outline" size="lg" onClick={() => setPicking(true)}>+ new job</Button>
      </PageTitle>

      {!on ? <Setup state={state} onSetup={jobs.setup} busy={jobs.busy === "setup"} /> : null}

      {picking ? (
        <Section title="what kind of job" action={<Button size="sm" variant="ghost" onClick={() => setPicking(false)}>cancel</Button>}>
          <div className="grid gap-2">
            {PRESETS.map(preset => (
              <button key={preset.name} onClick={() => { setPicking(false); setCreating({ ...preset.draft, title: preset.draft.title ?? preset.name }); }}
                className="arrive rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary">
                <p>{preset.name}</p>
                <p className="text-xs text-muted-foreground">{preset.blurb}</p>
              </button>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title={`jobs · ${state.routines.length}`}>
        {state.routines.length
          ? <div className="grid gap-2">{state.routines.map(job => <JobCard key={job.id} job={job} jobs={jobs} />)}</div>
          : <p className="text-sm text-muted-foreground">No jobs yet. A morning check-in is a good first one.</p>}
      </Section>

      {state.runs.length ? (
        <Section title="recent runs">
          <ul className="divide-y divide-dashed rounded-lg border bg-card px-3.5">
            {state.runs.slice(0, 12).map((run, index) => (
              <li key={index} className="flex items-baseline gap-3 py-2 text-sm">
                <time className="w-24 shrink-0 text-xs text-dim">{new Date(run.at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })}</time>
                <span className="min-w-0 flex-1 truncate">{run.title}</span>
                {run.chat ? <Link to="/pip" search={{ chat: run.chat }} className={cn("text-xs", run.status === "failed" ? "text-destructive" : "text-muted-foreground")}>{STATUS_LABEL[run.status] ?? run.status}</Link>
                  : <span className={cn("text-xs", run.status === "failed" ? "text-destructive" : "text-muted-foreground")}>{STATUS_LABEL[run.status] ?? run.status}</span>}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <JobEditor draft={creating} open={Boolean(creating)} onOpenChange={open => { if (!open) setCreating(null); }} busy={jobs.busy === "save"}
        onSave={async draft => { if (await jobs.save(draft)) setCreating(null); }} />
    </main>
  );
}
