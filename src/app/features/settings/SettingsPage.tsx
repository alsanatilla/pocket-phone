import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { CATEGORIES } from "../../../client/pip-tools.js";
import { activeAccount } from "../../../client/workspace-storage.js";
import { PROVIDERS, type Provider } from "../../data/ai.ts";
import { classicHref } from "../../lib/classic.ts";
import { Figures, Figure, Row, Section } from "../../ui/kit.tsx";
import { PageTitle } from "../../ui/PageTitle.tsx";
import { BARE_INPUT } from "../../ui/SendButton.tsx";
import { useAiSettings, type Connection } from "./useAiSettings.ts";

// Pip's settings in plain terms. Changes apply as they are made; model IDs stay under "advanced".

export { modelLabel } from "../../data/models.ts";

const PROMPT = "flex min-h-11 items-center gap-2 sm:min-h-0";

function ConnectionLine({ connection, provider }: { connection: Connection; provider: string }) {
  if (connection.state === "checking") return <span>checking…</span>;
  if (connection.state === "unreachable") return <span className="text-destructive">connection unavailable.</span>;
  if (connection.state === "missing") return connection.stale
    ? <span className="text-destructive">{provider} key unavailable. Reconnect.</span>
    : <span>not connected</span>;
  const { status } = connection;
  return (
    <span>
      <span className="text-hi">connected</span>
      <span> · {status.hint ? "key " + status.hint + " · " : ""}{status.mode === "account" ? "account" : "this tab only"}</span>
    </span>
  );
}

function KeyField({ onSave, busy, placeholder }: { onSave: (key: string) => Promise<boolean>; busy: boolean; placeholder: string }) {
  const [key, setKey] = useState("");
  return (
    <form className={PROMPT} onSubmit={async event => { event.preventDefault(); if (await onSave(key)) setKey(""); }}>
      <span aria-hidden="true" className="text-dim">›</span>
      <Input type="password" value={key} onChange={event => setKey(event.target.value)} placeholder={placeholder} aria-label="API key" autoComplete="off" className={BARE_INPUT} />
      <Button type="submit" disabled={busy || !key.trim()}>save</Button>
    </form>
  );
}

export function SettingsPage() {
  const ai = useAiSettings();
  const navigate = useNavigate();
  const { profile, granted, usage } = ai;
  return (
    <main className="pb-4">
      <PageTitle title="settings" />
      <a href="/ios" className="text-primary underline underline-offset-2">Pocket on iPhone · widget & shortcuts</a>

      <div className="mt-6">
        <Section label="AI connections">
          {(["opencode", "openrouter", "anthropic", "custom"] as const).map(provider => <ProviderConnection key={provider} provider={provider} />)}
        </Section>

        <Section label="what pip may read">
          {CATEGORIES.map(([category, name]) => (
            <Row key={category} end={<Switch checked={granted.includes(category)} aria-label={name} onCheckedChange={next => ai.toggleAccess(category, next)} />}>
              {name}
            </Row>
          ))}
        </Section>

        <Section label="today">
          <Row end={<Switch checked={profile.autoArrange} aria-label="Auto-arrange" onCheckedChange={next => ai.setAutoArrange(next)} />}>
            auto-arrange
          </Row>
        </Section>

        <Section label="jobs">
          <Row onOpen={() => void navigate({ to: "/jobs" })}>open jobs</Row>
        </Section>

        <Section label="memory">
          <Row onOpen={() => void navigate({ to: "/memory" })}>memory: what pip remembers about you</Row>
        </Section>

        <Section label="this month">
          <Figures>
            <Figure label="replies" value={String(usage.replies)} />
            <Figure label="tokens" value={compact(usage.inputTokens + usage.outputTokens)} />
            <Figure label="est. cost" value={usage.dollars < 0.01 ? "$0" : "$" + usage.dollars.toFixed(2)} />
          </Figures>
          {usage.unpriced ? <p className="text-xs text-muted-foreground">{usage.unpriced} replies unpriced</p> : null}
        </Section>
      </div>
    </main>
  );
}

const compact = (n: number) => n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + "M" : n >= 1000 ? Math.round(n / 1000) + "k" : String(n);

function Advanced({ current, onUse, active }: { current?: { baseUrl: string; model: string }; onUse: (custom: { baseUrl: string; model: string }) => void; active: boolean }) {
  const [baseUrl, setBaseUrl] = useState(current?.baseUrl ?? "");
  const [model, setModel] = useState(current?.model ?? "");
  return (
    <Collapsible defaultOpen={active}>
      <CollapsibleTrigger asChild><Button type="button" className="text-dim">advanced</Button></CollapsibleTrigger>
      <CollapsibleContent>
        <form className="grid gap-2 pt-1" onSubmit={event => { event.preventDefault(); onUse({ baseUrl: baseUrl.trim(), model: model.trim() }); }}>
          <label className={PROMPT}>
            <span aria-hidden="true" className="text-dim">›</span>
            <span className="shrink-0 text-xs text-dim">endpoint</span>
            <Input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://your-provider.example/v1" aria-label="Endpoint" type="url" className={BARE_INPUT} />
          </label>
          <label className={PROMPT}>
            <span aria-hidden="true" className="text-dim">›</span>
            <span className="shrink-0 text-xs text-dim">model</span>
            <Input value={model} onChange={event => setModel(event.target.value)} placeholder="model ID" aria-label="Model ID" className={BARE_INPUT} />
          </label>
          <div className="flex justify-end pt-1">
            <Button type="submit" disabled={!baseUrl.trim() || !model.trim()}>{active ? "update endpoint" : "save endpoint"}</Button>
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
  const action = connected
    ? <Button type="button" disabled={busy} onClick={() => void ai.disconnect()}>disconnect</Button>
    : !needsAccount && profile.provider === "openrouter"
      ? <Button type="button" disabled={busy} onClick={() => void ai.signInOpenRouter()}>sign in with OpenRouter</Button>
      : undefined;

  return <div className="pb-2">
    <Row sub={<ConnectionLine connection={connection} provider={providerName} />} end={action}>
      {providerName}
    </Row>
    {provider === "custom" ? <Advanced current={profile.custom} onUse={ai.setCustom} active={Boolean(profile.custom)} /> : null}
    {needsAccount ? (
      <p className="text-sm text-muted-foreground">
        <a href={classicHref("/account")} className="text-primary underline underline-offset-2">Sign in to Pocket</a> to connect.
      </p>
    ) : connected ? null : profile.provider === "opencode" ? (
      <>
        <KeyField key={profile.provider} busy={busy} onSave={ai.connectKey} placeholder="your OpenCode Go key" />
        <p className="text-xs text-dim"><a href="https://opencode.ai/auth" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">get API key ↗</a></p>
      </>
    ) : profile.provider === "anthropic" ? (
      <KeyField key={profile.provider} busy={busy} onSave={ai.connectKey} placeholder="sk-ant-…" />
    ) : profile.custom ? (
      <KeyField key={profile.provider} busy={busy} onSave={ai.connectKey} placeholder="key for your endpoint" />
    ) : profile.provider === "openrouter" ? null : <p className="text-xs text-dim">Add an endpoint first.</p>}
  </div>;
}
