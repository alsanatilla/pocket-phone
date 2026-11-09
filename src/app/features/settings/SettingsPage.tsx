import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CATEGORIES } from "../../../client/pip-tools.js";
import { activeAccount } from "../../../client/workspace-storage.js";
import { PROVIDERS, type Provider } from "../../data/ai.ts";
import { PageTitle } from "../../ui/PageTitle.tsx";
import { useAiSettings, type Connection } from "./useAiSettings.ts";
import { classicHref } from "../../lib/classic.ts";

// Pip's settings in plain terms. Changes apply as they are made; model IDs stay under "advanced".

export { modelLabel } from "../../data/models.ts";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div>
        <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-primary">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function ConnectionLine({ connection, provider }: { connection: Connection; provider: string }) {
  if (connection.state === "checking") return <p className="text-sm text-muted-foreground">Checking…</p>;
  if (connection.state === "unreachable") return <p className="text-sm text-destructive">Connection unavailable.</p>;
  if (connection.state === "missing") return connection.stale
    ? <p className="text-sm text-destructive">{provider} key unavailable. Reconnect.</p>
    : <p className="text-sm text-muted-foreground">Not connected</p>;
  const { status } = connection;
  return (
    <p className="text-sm">
      <span className="text-movement">● connected</span>
      <span className="text-muted-foreground"> · {status.hint ? "key " + status.hint + " · " : ""}{status.mode === "account" ? "account" : "this tab only"}</span>
    </p>
  );
}

function KeyField({ onSave, busy, placeholder }: { onSave: (key: string) => Promise<boolean>; busy: boolean; placeholder: string }) {
  const [key, setKey] = useState("");
  return (
    <form className="flex gap-2" onSubmit={async event => { event.preventDefault(); if (await onSave(key)) setKey(""); }}>
      <Input type="password" value={key} onChange={event => setKey(event.target.value)} placeholder={placeholder} aria-label="API key" autoComplete="off" className="h-10" />
      <Button type="submit" disabled={busy || !key.trim()}>save</Button>
    </form>
  );
}

export function SettingsPage() {
  const ai = useAiSettings();
  const { profile, granted, usage } = ai;
  return (
    <main className="space-y-4">
      <PageTitle title="settings" />

      <Section title="AI connections">
        {(["opencode", "openrouter", "anthropic", "custom"] as const).map(provider => <ProviderConnection key={provider} provider={provider} />)}
      </Section>

      <Section title="what pip may read">
        <div className="divide-y divide-dashed">
          {CATEGORIES.map(([category, name]) => (
            <div key={category} className="flex items-center gap-3 py-2.5">
              <Label htmlFor={"read-" + category} className="min-w-0 flex-1 flex-col items-start gap-0.5">
                <span className="text-sm">{name}</span>
              </Label>
              <Switch id={"read-" + category} checked={granted.includes(category)} onCheckedChange={on => ai.toggleAccess(category, on)} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="today">
        <div className="flex items-center gap-3">
          <Label htmlFor="auto-arrange" className="min-w-0 flex-1 flex-col items-start gap-0.5">
            <span className="text-sm">Auto-arrange</span>
          </Label>
          <Switch id="auto-arrange" checked={profile.autoArrange} onCheckedChange={ai.setAutoArrange} />
        </div>
      </Section>

      <Section title="jobs">
        <Button asChild variant="outline"><Link to="/jobs">open jobs</Link></Button>
      </Section>

      <Section title="this month">
        <div className="grid grid-cols-3 gap-2">
          <Reading label="replies" value={String(usage.replies)} />
          <Reading label="tokens" value={compact(usage.inputTokens + usage.outputTokens)} />
          <Reading label="est. cost" value={usage.dollars < 0.01 ? "$0" : "$" + usage.dollars.toFixed(2)} />
        </div>
        {usage.unpriced ? <p className="text-xs text-muted-foreground">{usage.unpriced} replies unpriced</p> : null}
      </Section>
    </main>
  );
}

const compact = (n: number) => n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + "M" : n >= 1000 ? Math.round(n / 1000) + "k" : String(n);

function Reading({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2.5">
      <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-pixel text-3xl leading-none">{value}</p>
    </div>
  );
}

function Advanced({ current, onUse, active }: { current?: { baseUrl: string; model: string }; onUse: (custom: { baseUrl: string; model: string }) => void; active: boolean }) {
  const [baseUrl, setBaseUrl] = useState(current?.baseUrl ?? "");
  const [model, setModel] = useState(current?.model ?? "");
  return (
    <Collapsible defaultOpen={active} className="rounded-lg border">
      <CollapsibleTrigger className="group flex w-full items-center justify-between p-4 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        advanced <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-4 pb-4">
        <form className="space-y-2" onSubmit={event => { event.preventDefault(); onUse({ baseUrl: baseUrl.trim(), model: model.trim() }); }}>
          <Input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://your-provider.example/v1" aria-label="Endpoint" type="url" className="h-10" />
          <Input value={model} onChange={event => setModel(event.target.value)} placeholder="model ID" aria-label="Model ID" className="h-10" />
          <Button type="submit" variant="outline" disabled={!baseUrl.trim() || !model.trim()}>{active ? "update endpoint" : "save endpoint"}</Button>
        </form>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ProviderConnection({ provider }: { provider: Provider }) {
  const ai = useAiSettings(provider);
  const { profile, connection, busy } = ai;
  const providerName = profile.provider === "custom" ? "your endpoint" : PROVIDERS[profile.provider].name;
  const connected = connection.state === "connected";
  // OpenCode Go is relay-only: without a Pocket account there is nowhere to keep its key that can reach it.
  const needsAccount = profile.provider !== "custom" && PROVIDERS[profile.provider].relayOnly === true && !activeAccount();

  return <div className="space-y-3 rounded-md border p-3">
    <h3 className="text-sm font-medium">{providerName}</h3>
    {provider === "custom" ? <Advanced current={profile.custom} onUse={ai.setCustom} active={Boolean(profile.custom)} /> : null}
    <ConnectionLine connection={connection} provider={providerName} />
    {needsAccount ? (
      <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        <a href={classicHref("/account")} className="text-primary">Sign in to Pocket</a> to connect.
      </p>
    ) : connected ? (
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void ai.disconnect()}>disconnect</Button>
    ) : profile.provider === "openrouter" ? (
      <Button className="w-full" size="lg" disabled={busy} onClick={() => void ai.signInOpenRouter()}>sign in with OpenRouter</Button>
    ) : profile.provider === "opencode" ? (
      <>
        <KeyField key={profile.provider} busy={busy} onSave={ai.connectKey} placeholder="your OpenCode Go key" />
        <p className="text-xs text-muted-foreground"><a href="https://opencode.ai/auth" target="_blank" rel="noopener noreferrer" className="text-primary">get API key ↗</a></p>
      </>
    ) : profile.provider === "anthropic" ? (
      <KeyField key={profile.provider} busy={busy} onSave={ai.connectKey} placeholder="sk-ant-…" />
    ) : profile.custom ? (
      <KeyField key={profile.provider} busy={busy} onSave={ai.connectKey} placeholder="key for your endpoint" />
    ) : <p className="text-xs text-muted-foreground">Add an endpoint first.</p>}
  </div>;
}
