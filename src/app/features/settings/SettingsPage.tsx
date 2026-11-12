import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { CATEGORIES } from "../../../client/pip-tools.js";
import { activeAccount } from "../../../client/workspace-storage.js";
import { PROVIDERS, type Provider } from "../../data/ai.ts";
import { PageTitle } from "../../ui/PageTitle.tsx";
import { BARE_INPUT } from "../../ui/SendButton.tsx";
import { useAiSettings, type Connection } from "./useAiSettings.ts";
import { classicHref } from "../../lib/classic.ts";

// Pip's settings in plain terms. Changes apply as they are made; model IDs stay under "advanced".

export { modelLabel } from "../../data/models.ts";

const LABEL = "text-[10.5px] uppercase tracking-[0.06em] text-dim";
const WORD = "flex min-h-11 shrink-0 items-center text-xs text-dim transition-colors hover:text-foreground disabled:opacity-50 sm:min-h-0";
const LINE = "flex min-h-11 items-center gap-2 border-t py-2 sm:min-h-0";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className={LABEL}>{title}</h2>
      {children}
    </section>
  );
}

function ConnectionLine({ connection, provider }: { connection: Connection; provider: string }) {
  if (connection.state === "checking") return <p className="text-xs text-dim">checking…</p>;
  if (connection.state === "unreachable") return <p className="text-xs text-destructive">connection unavailable.</p>;
  if (connection.state === "missing") return connection.stale
    ? <p className="text-xs text-destructive">{provider} key unavailable. Reconnect.</p>
    : <p className="text-xs text-dim">not connected</p>;
  const { status } = connection;
  return (
    <p className="text-xs text-dim">
      <span className="text-hi">connected</span>
      <span> · {status.hint ? "key " + status.hint + " · " : ""}{status.mode === "account" ? "account" : "this tab only"}</span>
    </p>
  );
}

function KeyField({ onSave, busy, placeholder }: { onSave: (key: string) => Promise<boolean>; busy: boolean; placeholder: string }) {
  const [key, setKey] = useState("");
  return (
    <form className={LINE} onSubmit={async event => { event.preventDefault(); if (await onSave(key)) setKey(""); }}>
      <span aria-hidden="true" className="text-dim">›</span>
      <Input type="password" value={key} onChange={event => setKey(event.target.value)} placeholder={placeholder} aria-label="API key" autoComplete="off" className={BARE_INPUT} />
      <button type="submit" disabled={busy || !key.trim()} className={WORD}>save</button>
    </form>
  );
}

export function SettingsPage() {
  const ai = useAiSettings();
  const { profile, granted, usage } = ai;
  return (
    <main className="space-y-[18px] pb-4">
      <PageTitle title="settings" />

      <Section title="AI connections">
        {(["opencode", "openrouter", "anthropic", "custom"] as const).map(provider => <ProviderConnection key={provider} provider={provider} />)}
      </Section>

      <Section title="what pip may read">
        {CATEGORIES.map(([category, name]) => (
          <button key={category} type="button" role="switch" aria-checked={granted.includes(category)} aria-label={name}
            onClick={() => ai.toggleAccess(category, !granted.includes(category))}
            className="flex min-h-11 w-full items-center gap-3 border-t py-2 text-left sm:min-h-0">
            <span className="min-w-0 flex-1 text-sm text-hi">{name}</span>
            <span aria-hidden="true" className="shrink-0 text-xs text-dim">[{granted.includes(category) ? "x" : " "}]</span>
          </button>
        ))}
      </Section>

      <Section title="today">
        <button type="button" role="switch" aria-checked={profile.autoArrange} aria-label="Auto-arrange"
          onClick={() => ai.setAutoArrange(!profile.autoArrange)}
          className="flex min-h-11 w-full items-center gap-3 border-t py-2 text-left sm:min-h-0">
          <span className="min-w-0 flex-1 text-sm text-hi">auto-arrange</span>
          <span aria-hidden="true" className="shrink-0 text-xs text-dim">[{profile.autoArrange ? "x" : " "}]</span>
        </button>
      </Section>

      <Section title="jobs">
        <Link to="/jobs" className="flex min-h-11 items-center border-t py-2 text-sm text-hi no-underline hover:text-primary sm:min-h-0">open jobs</Link>
      </Section>

      <Section title="memory">
        <Link to="/memory" className="flex min-h-11 items-center border-t py-2 text-sm text-hi no-underline hover:text-primary sm:min-h-0">memory: what pip remembers about you</Link>
      </Section>

      <Section title="this month">
        <div className="grid grid-cols-3 border-y">
          <Figure label="replies" value={String(usage.replies)} />
          <Figure label="tokens" value={compact(usage.inputTokens + usage.outputTokens)} />
          <Figure label="est. cost" value={usage.dollars < 0.01 ? "$0" : "$" + usage.dollars.toFixed(2)} />
        </div>
        {usage.unpriced ? <p className="text-xs text-muted-foreground">{usage.unpriced} replies unpriced</p> : null}
      </Section>
    </main>
  );
}

const compact = (n: number) => n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + "M" : n >= 1000 ? Math.round(n / 1000) + "k" : String(n);

/** Rule 6: a group of figures is columns divided by hairlines, between a hairline above and below. */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-l py-2 pl-3 first:border-l-0 first:pl-0">
      <p className={LABEL}>{label}</p>
      <p className="mt-1 text-[19px] font-medium leading-none text-hi">{value}</p>
    </div>
  );
}

function Advanced({ current, onUse, active }: { current?: { baseUrl: string; model: string }; onUse: (custom: { baseUrl: string; model: string }) => void; active: boolean }) {
  const [baseUrl, setBaseUrl] = useState(current?.baseUrl ?? "");
  const [model, setModel] = useState(current?.model ?? "");
  return (
    <Collapsible defaultOpen={active}>
      <CollapsibleTrigger className="flex min-h-11 items-center text-xs text-dim transition-colors hover:text-foreground sm:min-h-0">advanced</CollapsibleTrigger>
      <CollapsibleContent>
        <form className="grid gap-1" onSubmit={event => { event.preventDefault(); onUse({ baseUrl: baseUrl.trim(), model: model.trim() }); }}>
          <label className={LINE}>
            <span aria-hidden="true" className="text-dim">›</span>
            <span className="shrink-0 text-xs text-dim">endpoint</span>
            <Input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://your-provider.example/v1" aria-label="Endpoint" type="url" className={BARE_INPUT} />
          </label>
          <label className={LINE}>
            <span aria-hidden="true" className="text-dim">›</span>
            <span className="shrink-0 text-xs text-dim">model</span>
            <Input value={model} onChange={event => setModel(event.target.value)} placeholder="model ID" aria-label="Model ID" className={BARE_INPUT} />
          </label>
          <div className="flex justify-end border-t pt-1">
            <button type="submit" disabled={!baseUrl.trim() || !model.trim()} className="flex min-h-11 items-center text-xs text-dim transition-colors hover:text-foreground disabled:opacity-50 sm:min-h-0">{active ? "update endpoint" : "save endpoint"}</button>
          </div>
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

  return <div>
    <div className="flex min-h-11 items-start gap-3 border-t py-2 sm:min-h-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-hi">{providerName}</p>
        <ConnectionLine connection={connection} provider={providerName} />
      </div>
      {connected ? <button type="button" className={WORD} disabled={busy} onClick={() => void ai.disconnect()}>disconnect</button> : null}
    </div>
    {provider === "custom" ? <Advanced current={profile.custom} onUse={ai.setCustom} active={Boolean(profile.custom)} /> : null}
    {needsAccount ? (
      <p className={LINE + " text-sm text-muted-foreground"}>
        <a href={classicHref("/account")} className="text-primary">Sign in to Pocket</a> to connect.
      </p>
    ) : connected ? null : profile.provider === "openrouter" ? (
      <div className={LINE}>
        <button type="button" className={WORD} disabled={busy} onClick={() => void ai.signInOpenRouter()}>sign in with OpenRouter</button>
      </div>
    ) : profile.provider === "opencode" ? (
      <>
        <KeyField key={profile.provider} busy={busy} onSave={ai.connectKey} placeholder="your OpenCode Go key" />
        <p className="border-t py-2 text-xs text-dim"><a href="https://opencode.ai/auth" target="_blank" rel="noopener noreferrer" className="text-primary">get API key ↗</a></p>
      </>
    ) : profile.provider === "anthropic" ? (
      <KeyField key={profile.provider} busy={busy} onSave={ai.connectKey} placeholder="sk-ant-…" />
    ) : profile.custom ? (
      <KeyField key={profile.provider} busy={busy} onSave={ai.connectKey} placeholder="key for your endpoint" />
    ) : <p className="border-t py-2 text-xs text-dim">Add an endpoint first.</p>}
  </div>;
}
