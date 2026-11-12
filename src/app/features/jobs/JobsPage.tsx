import { defaultConfig, providerOf, PROVIDER_NAMES } from "../../data/models.ts";
import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { readAccess } from "../../data/ai.ts";
import { nextLabel, PRESETS, scheduleLabel, STATUS_LABEL, type Job, type JobDraft, type JobsState } from "../../data/jobs.ts";
import { classicHref } from "../../lib/classic.ts";
import { confirm } from "../../ui/dialog/dialog.ts";
import { Keys, Row, Section, Segmented } from "../../ui/kit.tsx";
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
    <section className="arrive mb-6 space-y-3">
      <p className="text-hi">let pip work on its own</p>
      <p className="text-sm text-muted-foreground">Jobs run on Pocket's server, with {config ? modelLabel(config.model) : "your model"} through {provider} and the key you keep in your account. Pip reads only what you allow in settings and never saves anything without you.</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-xs text-dim">at most</span>
        <Segmented value={String(limit)} label="Daily token limit" onChange={value => setLimit(Number(value))}
          options={LIMITS.map(value => ({ value: String(value), label: tokens(value) }))} />
        <span className="text-xs text-dim">tokens a day</span>
      </div>
      <Button type="button" variant="go" onClick={turnOn} disabled={busy || !config}>turn on</Button>
      <p className="text-xs text-dim">No key in your account yet? Connect one in <Link to="/settings" className="text-primary underline underline-offset-2">settings</Link> first.</p>
    </section>
  );
}

function JobCard({ job, jobs }: { job: Job; jobs: ReturnType<typeof useJobs> }) {
  const [editing, setEditing] = useState(false);
  const training = job.kind === "training";
  const failed = job.lastStatus === "failed";
  const draft: JobDraft = { ...job };
  return (
    <li className={cn("pb-2", !job.enabled && "opacity-60")}>
      <Row
        sub={`${KIND_NAME[job.kind]} · ${scheduleLabel(job)}${job.delivery === "quiet" ? " · quiet" : ""}`}
        end={<Switch checked={job.enabled} disabled={training} aria-label={job.title + " enabled"}
          onCheckedChange={enabled => void jobs.toggle({ ...draft, enabled })} />}>
        {job.title}
      </Row>
      <p className={cn("text-xs", failed ? "text-destructive" : "text-dim")}>
        next {nextLabel(job)}{job.lastRun ? ` · last ${STATUS_LABEL[job.lastStatus] ?? job.lastStatus}` : ""}{failed && job.lastError ? ` · ${job.lastError}` : ""}
      </p>
      <Keys className="pt-1">
        <Button type="button" disabled={jobs.busy === "run:" + job.id} onClick={() => void jobs.run(job.id)}>run now</Button>
        {job.lastChat ? <Button asChild><Link to="/pip" search={{ chat: job.lastChat }}>open chat</Link></Button> : null}
        {training
          ? <Button asChild><a href={classicHref("/pip")}>edit in classic</a></Button>
          : <Button type="button" onClick={() => setEditing(true)}>edit</Button>}
        {!training ? (
          <Button type="button" variant="destructive" onClick={async () => {
            if (await confirm({ title: "Remove “" + job.title + "”?", message: "Its notes go with it; its chat stays.", confirmLabel: "remove", danger: true })) void jobs.remove(job.id);
          }}>remove</Button>
        ) : null}
      </Keys>
      {job.scratch ? (
        <Collapsible className="group/notes pt-1">
          <CollapsibleTrigger asChild><Button type="button" className="text-dim">pip's notes for this job</Button></CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2">
            <p className="whitespace-pre-wrap text-xs text-muted-foreground">{job.scratch}</p>
            <Keys><Button type="button" onClick={() => void jobs.clear(job.id)}>clear notes</Button></Keys>
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
  const navigate = useNavigate();
  const [creating, setCreating] = useState<JobDraft | null>(null);
  const [picking, setPicking] = useState(false);
  const { state, error } = jobs;

  if (error) {
    return (
      <main className="pb-4">
        <PageTitle title="jobs" meta="pip on its own" />
        <div className="mt-6 space-y-2">
          <p className="text-sm text-destructive">{error}</p>
          <p className="text-sm text-muted-foreground">Jobs run on Pocket's server, so they need your Pocket account. <a href={classicHref("/account")} className="text-primary underline underline-offset-2">Sign in</a></p>
        </div>
      </main>
    );
  }
  if (!state) return <main className="space-y-3 pt-4"><div className="shimmer h-9 w-1/3 rounded-sm" /><div className="shimmer h-4 w-2/3 rounded-sm" /><div className="shimmer h-4 w-1/2 rounded-sm" /></main>;

  const on = Boolean(state.settings?.enabled && state.hasKey);
  const limit = state.settings?.dailyTokens ?? 0;
  return (
    <main className="pb-4">
      <PageTitle title="jobs" meta={on ? `pip on its own · today ${tokens(state.usedToday)} of ${tokens(limit)} tokens` : "pip on its own · off"}>
        <Button type="button" onClick={() => setPicking(true)}>+ new job</Button>
      </PageTitle>

      <div className="mt-6">
        {!on ? <Setup state={state} onSetup={jobs.setup} busy={jobs.busy === "setup"} /> : null}

        {picking ? (
          <Section label="what kind of job" note={<Button type="button" onClick={() => setPicking(false)}>cancel</Button>}>
            <ul>
              {PRESETS.map(preset => (
                <li key={preset.name}>
                  <Row sub={preset.blurb} onOpen={() => { setPicking(false); setCreating({ ...preset.draft, title: preset.draft.title ?? preset.name }); }}>
                    {preset.name}
                  </Row>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Section label="jobs" note={state.routines.length}>
          {state.routines.length
            ? <ul>{state.routines.map(job => <JobCard key={job.id} job={job} jobs={jobs} />)}</ul>
            : <p className="text-sm text-muted-foreground">No jobs yet. A morning check-in is a good first one.</p>}
        </Section>

        {state.runs.length ? (
          <Section label="recent runs">
            <ul>
              {state.runs.slice(0, 12).map((run, index) => (
                <li key={index}>
                  <Row
                    lead={<time className="w-24 shrink-0 text-xs">{new Date(run.at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })}</time>}
                    end={<span className={run.status === "failed" ? "text-destructive" : undefined}>{STATUS_LABEL[run.status] ?? run.status}</span>}
                    onOpen={run.chat ? () => void navigate({ to: "/pip", search: { chat: run.chat } }) : undefined}>
                    {run.title}
                  </Row>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>

      <JobEditor draft={creating} open={Boolean(creating)} onOpenChange={open => { if (!open) setCreating(null); }} busy={jobs.busy === "save"}
        onSave={async draft => { if (await jobs.save(draft)) setCreating(null); }} />
    </main>
  );
}
