import { defaultConfig, providerOf, PROVIDER_NAMES } from "../../data/models.ts";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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

const LABEL = "text-[10.5px] uppercase tracking-[0.06em] text-dim";
const WORD = "flex min-h-11 shrink-0 items-center text-xs text-dim transition-colors hover:text-foreground disabled:opacity-50 sm:min-h-0";

function Section({ title, note, children, action }: { title: string; note?: string | number; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center justify-between gap-3 pb-1">
        <h2 className={LABEL}>{title}</h2>
        <div className="flex items-center gap-3">
          {note === undefined || note === null ? null : <span className="text-xs text-dim">{note}</span>}
          {action}
        </div>
      </div>
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
    <div className="arrive space-y-2 border-t pt-2">
      <p className="text-hi">let pip work on its own</p>
      <p className="text-sm text-muted-foreground">Jobs run on Pocket's server, with {config ? modelLabel(config.model) : "your model"} through {provider} and the key you keep in your account. Pip reads only what you allow in settings and never saves anything without you.</p>
      <div className="flex flex-wrap items-center gap-x-3 text-sm">
        <span className="text-xs text-dim">at most</span>
        {LIMITS.map(value => (
          <button key={value} type="button" onClick={() => setLimit(value)} aria-pressed={limit === value}
            className={cn(WORD, "text-sm", limit === value ? "text-hi" : "text-dim")}>{tokens(value)}</button>
        ))}
        <span className="text-xs text-dim">tokens a day</span>
      </div>
      <button type="button" onClick={turnOn} disabled={busy || !config}
        className="flex h-8 items-center bg-primary px-3 text-sm text-primary-foreground transition-colors disabled:bg-secondary disabled:text-dim">turn on</button>
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
    <li className={cn("border-t last:border-b", !job.enabled && "opacity-60")}>
      <div className="flex items-start gap-2.5 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-hi">{job.title}</p>
          <p className="text-xs text-dim">{KIND_NAME[job.kind]} · {scheduleLabel(job)}{job.delivery === "quiet" ? " · quiet" : ""}</p>
          <p className={cn("text-xs", failed ? "text-destructive" : "text-dim")}>
            next {nextLabel(job)}{job.lastRun ? ` · last ${STATUS_LABEL[job.lastStatus] ?? job.lastStatus}` : ""}{failed && job.lastError ? ` · ${job.lastError}` : ""}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-4">
            <button type="button" disabled={jobs.busy === "run:" + job.id} onClick={() => void jobs.run(job.id)} className={WORD}>run now</button>
            {job.lastChat ? <Link to="/pip" search={{ chat: job.lastChat }} className={WORD}>open chat</Link> : null}
            {training
              ? <a href={classicHref("/pip")} className={WORD}>edit in classic</a>
              : <button type="button" onClick={() => setEditing(true)} className={WORD}>edit</button>}
            {!training ? (
              <button type="button" className={cn(WORD, "text-muted-foreground")} onClick={async () => {
                if (await confirm({ title: "Remove “" + job.title + "”?", message: "Its notes go with it; its chat stays.", confirmLabel: "remove", danger: true })) void jobs.remove(job.id);
              }}>remove</button>
            ) : null}
          </div>
        </div>
        {/* The row's state, and the way to change it: a word, not a switch. */}
        <button type="button" aria-label={(job.enabled ? "Pause " : "Resume ") + job.title} disabled={training}
          onClick={() => void jobs.toggle({ ...draft, enabled: !job.enabled })}
          className={cn(WORD, "mt-0.5")}>{job.enabled ? "pause" : "resume"}</button>
      </div>
      {job.scratch ? (
        <Collapsible className="group/notes pb-2">
          <CollapsibleTrigger className="flex min-h-11 items-center text-xs text-dim transition-colors hover:text-foreground sm:min-h-0">pip's notes for this job</CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-1">
            <p className="whitespace-pre-wrap text-xs text-muted-foreground">{job.scratch}</p>
            <button type="button" className={WORD} onClick={() => void jobs.clear(job.id)}>clear notes</button>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      <JobEditor draft={editing ? draft : null} open={editing} onOpenChange={setEditing} busy={jobs.busy === "save"}
        onSave={async next => { if (await jobs.save(next)) setEditing(false); }} />
    </li>
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
        <div className="space-y-1 border-t pt-2">
          <p className="text-sm text-destructive">{error}</p>
          <p className="text-sm text-muted-foreground">Jobs run on Pocket's server, so they need your Pocket account. <a href={classicHref("/account")} className="text-primary">Sign in</a></p>
        </div>
      </main>
    );
  }
  if (!state) return <main className="space-y-3 pt-4"><div className="shimmer h-9 w-1/3 rounded-sm" /><div className="shimmer h-4 w-2/3 rounded-sm" /><div className="shimmer h-4 w-1/2 rounded-sm" /></main>;

  const on = Boolean(state.settings?.enabled && state.hasKey);
  const limit = state.settings?.dailyTokens ?? 0;
  return (
    <main className="space-y-5">
      <PageTitle title="jobs" meta={on ? `pip on its own · today ${tokens(state.usedToday)} of ${tokens(limit)} tokens` : "pip on its own · off"}>
        <button type="button" onClick={() => setPicking(true)}
          className="mb-1 flex min-h-11 shrink-0 items-center whitespace-nowrap text-sm text-dim transition-colors hover:text-foreground sm:min-h-0">+ new job</button>
      </PageTitle>

      {!on ? <Setup state={state} onSetup={jobs.setup} busy={jobs.busy === "setup"} /> : null}

      {picking ? (
        <Section title="what kind of job" action={<button type="button" className="flex min-h-11 items-center text-xs text-dim transition-colors hover:text-foreground sm:min-h-0" onClick={() => setPicking(false)}>cancel</button>}>
          <ul>
            {PRESETS.map(preset => (
              <li key={preset.name} className="border-t last:border-b">
                <button onClick={() => { setPicking(false); setCreating({ ...preset.draft, title: preset.draft.title ?? preset.name }); }}
                  className="arrive flex min-h-11 w-full flex-col items-start gap-0.5 py-2 text-left transition-colors hover:bg-secondary sm:min-h-0">
                  <span className="text-hi">{preset.name}</span>
                  <span className="text-xs text-dim">{preset.blurb}</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="jobs" note={state.routines.length}>
        {state.routines.length
          ? <ul>{state.routines.map(job => <JobCard key={job.id} job={job} jobs={jobs} />)}</ul>
          : <p className="border-t py-2 text-sm text-muted-foreground">No jobs yet. A morning check-in is a good first one.</p>}
      </Section>

      {state.runs.length ? (
        <Section title="recent runs">
          <ul>
            {state.runs.slice(0, 12).map((run, index) => (
              <li key={index} className="flex items-baseline gap-3 border-t py-2 text-sm last:border-b">
                <time className="w-24 shrink-0 text-xs text-dim">{new Date(run.at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })}</time>
                <span className="min-w-0 flex-1 truncate text-hi">{run.title}</span>
                {run.chat ? <Link to="/pip" search={{ chat: run.chat }} className={cn("shrink-0 text-xs", run.status === "failed" ? "text-destructive" : "text-dim")}>{STATUS_LABEL[run.status] ?? run.status}</Link>
                  : <span className={cn("shrink-0 text-xs", run.status === "failed" ? "text-destructive" : "text-dim")}>{STATUS_LABEL[run.status] ?? run.status}</span>}
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
