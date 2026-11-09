import { useEffect, useState } from "react";
import { Popover } from "radix-ui";
import { Check, ChevronDown, Globe } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Chat } from "../../data/chats.ts";
import { chats } from "../../data/chats.ts";
import { chooseModel, providerOf, connectionOf, isConnected, customEndpoint, CURATED, PROVIDER_KEYS, PROVIDER_NAMES, modelLabel, type ModelChoice, type ProviderKey } from "../../data/models.ts";
import { FREE_ROUTER, loadFreeModels, tokenSize, type FreeModel } from "../../data/openrouter-models.ts";
import { toastError } from "../../ui/toast/toast.ts";

// The model picker: one list, grouped by the account it comes from, with what the model is good for and what a
// chat would get. Search filters names, ids and providers; a disconnected account is shown, disabled, and says so.

const GROUPS: { provider: ProviderKey; label: string }[] = [
  { provider: "opencode", label: "OpenCode Go" },
  { provider: "anthropic", label: "Anthropic" },
  { provider: "openrouter", label: "OpenRouter" },
  { provider: "custom", label: "Your endpoint" },
];

export function ModelPicker({ chat, busy }: { chat: Chat; busy: boolean }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState("");
  const [models, setModels] = useState<FreeModel[]>([FREE_ROUTER]);
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [connections, setConnections] = useState<Partial<Record<ProviderKey, boolean>>>({});
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all(PROVIDER_KEYS.map(async provider => [provider, await connectionOf(provider).then(isConnected).catch(() => false)] as const))
      .then(entries => { if (!cancelled) setConnections(Object.fromEntries(entries)); });
    return () => { cancelled = true; };
  }, [open, attempt]);
  const isOpenRouter = chat.config.baseUrl === "https://openrouter.ai/api/v1";
  useEffect(() => {
    if (!open && !isOpenRouter) return;
    let cancelled = false;
    setLoading(true); setError("");
    loadFreeModels().then(value => { if (!cancelled) setModels(value); })
      .catch(() => { if (!cancelled) setError("Model list unavailable."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, isOpenRouter, attempt]);
  const selected = isOpenRouter ? models.find(model => model.id === chat.config.model) : undefined;
  const free = isOpenRouter && (chat.config.model === "openrouter/free" || chat.config.model.endsWith(":free"));
  const name = selected?.name ?? modelLabel(chat.config.model);
  const choose = (model: ModelChoice) => {
    if (busy) return;
    try { chooseModel(chat.uid, model); setOpen(false); setQuery(""); } catch (error) { toastError(error); }
  };
  const custom = customEndpoint();
  const choices: ModelChoice[] = [
    ...CURATED.opencode, ...CURATED.anthropic,
    ...models.map(model => ({ ...model, provider: "openrouter" as const, free: true })), ...CURATED.openrouter,
    ...(custom ? [{ provider: "custom" as const, id: custom.model, name: custom.model }] : []),
  ];
  const needle = query.toLowerCase().trim();
  const filtered = choices.filter(model => (model.name + " " + model.id + " " + PROVIDER_NAMES[model.provider]).toLowerCase().includes(needle));
  const groups = GROUPS.map(group => ({ ...group, models: filtered.filter(model => model.provider === group.provider) })).filter(group => group.models.length);
  const providerName = PROVIDER_NAMES[providerOf(chat.config)];
  const current = [providerName, selected?.context ? `${tokenSize(selected.context)} context` : "", `${tokenSize(chat.config.maxTokens)} reply limit`, chat.config.thinking ? "reasoning on" : ""].filter(Boolean).join(" · ");
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 text-xs text-muted-foreground">
      <button type="button" disabled={busy} aria-label="Web search" aria-pressed={chat.config.webSearch}
        className="flex items-center gap-1.5 rounded px-1 py-1.5 hover:text-foreground disabled:opacity-50"
        onClick={() => { try { chats.update(chat.uid, value => { value.config.webSearch = !value.config.webSearch; }); } catch (error) { toastError(error); } }}>
        <Globe className="size-4" /> web {chat.config.webSearch ? "on" : "off"}
      </button>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button type="button" disabled={busy} aria-label="Choose model" title={current}
            className="ml-auto flex min-w-0 max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm text-foreground hover:border-primary disabled:opacity-50">
            <span className="max-w-48 truncate">{name}</span>
            {free && !/free/i.test(name) ? <span className="text-xs text-movement">free</span> : null}<ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content side="top" align="end" sideOffset={10} aria-label="Chat models"
            className="z-50 flex max-h-[min(34rem,75dvh)] w-[min(27rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl">
            <div className="flex items-baseline justify-between gap-3 border-b px-4 pt-3 pb-2.5">
              <h2 className="font-pixel text-2xl leading-none">choose a model</h2>
              <a href="/#/settings" className="text-[11px] uppercase tracking-[0.08em] text-primary no-underline hover:underline">connections ↗</a>
            </div>

            <div className="px-4 pt-3 pb-2">
              <Input aria-label="Search models" placeholder="search models…" value={query} onChange={event => setQuery(event.target.value)}
                className="h-10 bg-transparent focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-transparent" />
              {loading ? <p role="status" className="pt-2 text-[11px] text-muted-foreground">Loading models…</p> : null}
              {error ? <div role="alert" className="flex items-center gap-2 pt-2 text-[11px] text-destructive">{error}<Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setAttempt(value => value + 1)}>retry</Button></div> : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Available models">
              {groups.map(group => <section key={group.provider} className="pt-3 first:pt-1">
                <h3 className="flex items-baseline justify-between px-2 pb-1 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                  {group.label}<span className="text-dim">{group.models.length}</span>
                </h3>
                {group.models.map(model => {
                  const chosen = providerName === PROVIDER_NAMES[model.provider] && chat.config.model === model.id;
                  const traits = [model.reasoning && "reasoning", model.vision && "images"].filter(Boolean) as string[];
                  const connected = connections[model.provider];
                  return (
                    <button type="button" key={model.provider + model.id} disabled={busy || model.tools === false || !connected} aria-pressed={chosen} onClick={() => choose(model)}
                      className={cn("flex min-h-11 w-full flex-col justify-center rounded-md border-l-2 px-3 py-2 text-left transition-colors hover:bg-accent disabled:opacity-40",
                        chosen ? "border-primary bg-accent" : "border-transparent")}>
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{model.name}</span>
                        <span className="shrink-0 text-[11px] text-dim">{model.context ? `${Math.round(model.context / 1000)}k` : model.id === "openrouter/free" ? "auto" : ""}</span>
                        {chosen ? <Check className="size-4 shrink-0 self-center text-primary" /> : null}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-dim">
                        <span>{PROVIDER_NAMES[model.provider]}{!connected ? " · not connected" : model.free ? " · free" : ""}</span>
                        {model.tools === false ? <span className="uppercase tracking-wide">no tools</span>
                          : traits.map(trait => <span key={trait} className="rounded-sm border border-border/70 px-1 py-px text-[10px] uppercase tracking-wide">{trait}</span>)}
                      </span>
                    </button>
                  );
                })}
              </section>)}
              {!groups.length && !loading ? <p className="px-3 py-6 text-sm text-muted-foreground">
                No model matches “{query.trim()}”. <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => setQuery("")}>clear the search</button>
              </p> : null}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
