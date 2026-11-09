import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { CATEGORIES, type Category } from "../../../client/pip-tools.js";
import { activeAccount } from "../../../client/workspace-storage.js";
import { MODEL_NAMES, MODELS, PROVIDERS, TIERS, type Provider, type Tier } from "../../data/ai.ts";
import { PageTitle } from "../../ui/PageTitle.tsx";
import { useAiSettings, type Connection } from "./useAiSettings.ts";
import { classicHref } from "../../lib/classic.ts";

// Pip's settings in plain terms. Changes apply as they are made; model IDs stay under "advanced".

const READS: Record<Category, string> = {
  notes: "Search and read your notes.",
  thoughts: "See the thoughts you parked.",
  tasks: "See your tasks and steps.",
  calendar: "See your appointments.",
  gym: "See the workouts you logged.",
  coros: "Read recovery and training from COROS.",
};

/** "anthropic/claude-sonnet-5.5" → "Sonnet 5.5"; models Pocket picks have their own names. */
export function modelLabel(id: string): string {
  if (MODEL_NAMES[id]) return MODEL_NAMES[id];
  const match = /(haiku|sonnet|opus)[-.]?([\d.-]+)?/i.exec(id);
  if (!match) return id;
  return match[1]![0]!.toUpperCase() + match[1]!.slice(1) + (match[2] ? " " + match[2].replace(/-/g, ".") : "");
}

const LIGHT: Record<Provider, string> = {
  opencode: "Fast and cheap: DeepSeek Flash for everything.",
  openrouter: "Free models, nothing to pay.",
  anthropic: "Fast and cheap: Haiku for everything.",
  custom: "Your endpoint's model.",
};

const PROVIDER_NOTE: Record<Exclude<Provider, "custom">, string> = {
  opencode: "one subscription, many open models; needs a Pocket account",
  openrouter: "sign in, free models included",
  anthropic: "use your Claude API key",
};

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div>
        <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-primary">{title}</h2>
        {hint ? <p className="mt-1 text-sm text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Choice({ selected, onSelect, children, label }: { selected: boolean; onSelect: () => void; children: ReactNode; label: string }) {
  return (
    <button type="button" role="radio" aria-checked={selected} aria-label={label} onClick={onSelect}
      className={cn("w-full rounded-md border p-3 text-left transition-colors hover:border-primary/60", selected && "border-primary bg-accent")}>
      {children}
    </button>
  );
}

function ConnectionLine({ connection, provider }: { connection: Connection; provider: string }) {
  if (connection.state === "checking") return <p className="text-sm text-muted-foreground">Checking…</p>;
  if (connection.state === "unreachable") return <p className="text-sm text-destructive">Pocket could not reach your key vault. Check your connection.</p>;
  if (connection.state === "missing") return <p className="text-sm text-muted-foreground">Not connected to {provider} yet.</p>;
  const { status } = connection;
  return (
    <p className="text-sm">
      <span className="text-movement">● connected</span>
      <span className="text-muted-foreground"> · {status.hint ? "key " + status.hint + " · " : ""}{status.mode === "account" ? "stored on your account" : "this tab only"}</span>
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
  const { profile, connection, granted, usage, busy } = ai;
  const providerName = profile.provider === "custom" ? "your endpoint" : PROVIDERS[profile.provider].name;
  const connected = connection.state === "connected";
  // OpenCode Go is relay-only: without a Pocket account there is nowhere to keep its key that can reach it.
  const needsAccount = profile.provider !== "custom" && PROVIDERS[profile.provider].relayOnly === true && !activeAccount();

  return (
    <main className="space-y-4">
      <PageTitle title="settings" meta="pip and the screens it arranges" />

      <Section title="connection" hint="Pip runs on your own model account; you pay your provider directly.">
        <div role="radiogroup" aria-label="Provider" className="space-y-2">
          {(["opencode", "openrouter", "anthropic"] as const).map(provider => (
            <Choice key={provider} label={PROVIDERS[provider].name} selected={profile.provider === provider} onSelect={() => ai.setProvider(provider)}>
              <p className="text-sm font-medium">{PROVIDERS[provider].name}{provider === "opencode" ? <span className="ml-2 text-xs font-normal text-primary">recommended</span> : null}</p>
              <p className="text-xs text-muted-foreground">{PROVIDER_NOTE[provider]}</p>
            </Choice>
          ))}
        </div>
        <ConnectionLine connection={connection} provider={providerName} />
        {needsAccount ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            OpenCode Go only answers through Pocket's server. <a href={classicHref("/account")} className="text-primary">Sign in to Pocket</a>, then add your key here; it is stored encrypted on your account.
          </p>
        ) : connected ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void ai.disconnect()}>disconnect</Button>
        ) : profile.provider === "openrouter" ? (
          <Button className="w-full" size="lg" disabled={busy} onClick={() => void ai.signInOpenRouter()}>sign in with OpenRouter</Button>
        ) : profile.provider === "opencode" ? (
          <>
            <KeyField busy={busy} onSave={ai.connectKey} placeholder="your OpenCode Go key" />
            <p className="text-xs text-muted-foreground">Create one at <a href="https://opencode.ai/auth" target="_blank" rel="noopener noreferrer" className="text-primary">opencode.ai/auth</a>.</p>
          </>
        ) : profile.provider === "anthropic" ? (
          <KeyField busy={busy} onSave={ai.connectKey} placeholder="sk-ant-…" />
        ) : (
          <KeyField busy={busy} onSave={ai.connectKey} placeholder="key for your endpoint" />
        )}
      </Section>

      <Section title="how much ai" hint="Pocket picks the model for each job: replies in Pip, and the screens it arranges.">
        <div role="radiogroup" aria-label="How much AI" className="space-y-2">
          {(Object.keys(TIERS) as Tier[]).map(tier => {
            const models = profile.provider === "custom" ? null : MODELS[profile.provider][tier];
            return (
              <Choice key={tier} label={TIERS[tier].name} selected={profile.tier === tier} onSelect={() => ai.setTier(tier)}>
                <p className="font-pixel text-2xl leading-none">{TIERS[tier].name.toLowerCase()}</p>
                {models ? <p className="mt-1 text-xs text-muted-foreground">pip: {modelLabel(models.chat)} · screens: {modelLabel(models.surface)}</p> : null}
                <p className="mt-1 text-sm text-muted-foreground">
                  {tier === "light" ? LIGHT[profile.provider] : TIERS[tier].blurb}
                </p>
              </Choice>
            );
          })}
        </div>
        {profile.provider === "custom" ? <p className="text-xs text-muted-foreground">With your own endpoint every job uses {profile.custom?.model ?? "its model"}.</p> : null}
      </Section>

      <Section title="what pip may read" hint="Only what is switched on leaves this device, and only when you ask Pip something.">
        <div className="divide-y divide-dashed">
          {CATEGORIES.map(([category, name]) => (
            <div key={category} className="flex items-center gap-3 py-2.5">
              <Label htmlFor={"read-" + category} className="min-w-0 flex-1 flex-col items-start gap-0.5">
                <span className="text-sm">{name}</span>
                <span className="text-xs font-normal text-muted-foreground">{READS[category]}</span>
              </Label>
              <Switch id={"read-" + category} checked={granted.includes(category)} onCheckedChange={on => ai.toggleAccess(category, on)} />
            </div>
          ))}
          <div className="flex items-center gap-3 py-2.5">
            <Label htmlFor="read-web" className="min-w-0 flex-1 flex-col items-start gap-0.5">
              <span className="text-sm">Web</span>
              <span className="text-xs font-normal text-muted-foreground">Let Pip search the web when a question needs it.</span>
            </Label>
            <Switch id="read-web" checked={profile.web} onCheckedChange={ai.setWeb} />
          </div>
        </div>
      </Section>

      <Section title="today">
        <div className="flex items-center gap-3">
          <Label htmlFor="auto-arrange" className="min-w-0 flex-1 flex-col items-start gap-0.5">
            <span className="text-sm">Arrange Today by itself</span>
            <span className="text-xs font-normal text-muted-foreground">When the moment changes (morning, an event soon, evening), Pip arranges the screen. Off: only when you ask.</span>
          </Label>
          <Switch id="auto-arrange" checked={profile.autoArrange} onCheckedChange={ai.setAutoArrange} />
        </div>
      </Section>

      <Section title="this month">
        <div className="grid grid-cols-3 gap-2">
          <Reading label="replies" value={String(usage.replies)} />
          <Reading label="tokens" value={compact(usage.inputTokens + usage.outputTokens)} />
          <Reading label="about" value={usage.dollars < 0.01 ? "$0" : "$" + usage.dollars.toFixed(2)} />
        </div>
        <p className="text-xs text-muted-foreground">Estimated from list prices{usage.unpriced ? `; ${usage.unpriced} replies through other models count tokens only` : ""}. Your provider's bill is the real number.</p>
      </Section>

      <Advanced current={profile.custom} onUse={ai.setCustom} active={profile.provider === "custom"} />
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
        <p className="text-sm text-muted-foreground">Any OpenAI-compatible endpoint. Pocket then uses this one model for everything.</p>
        <form className="space-y-2" onSubmit={event => { event.preventDefault(); onUse({ baseUrl: baseUrl.trim(), model: model.trim() }); }}>
          <Input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://your-provider.example/v1" aria-label="Endpoint" type="url" className="h-10" />
          <Input value={model} onChange={event => setModel(event.target.value)} placeholder="model ID" aria-label="Model ID" className="h-10" />
          <Button type="submit" variant="outline" disabled={!baseUrl.trim() || !model.trim()}>{active ? "update endpoint" : "use this endpoint"}</Button>
        </form>
      </CollapsibleContent>
    </Collapsible>
  );
}
