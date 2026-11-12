import { useEffect, useState } from "react";
import { Popover } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Row, Section } from "../../ui/kit.tsx";
import type { Chat } from "../../data/chats.ts";
import { chats } from "../../data/chats.ts";
import { chooseModel, providerOf, connectionOf, isConnected, customEndpoint, CURATED, PROVIDER_KEYS, PROVIDER_NAMES, modelLabel, type ModelChoice, type ProviderKey } from "../../data/models.ts";
import { FREE_ROUTER, loadFreeModels, tokenSize, type FreeModel } from "../../data/openrouter-models.ts";
import { toastError } from "../../ui/toast/toast.ts";

// The model picker: the search is its head, then one line per model, grouped by the account it comes from. A line
// says only what tells models apart (name, context, reasoning, free); the group already says the account. An
// account that is not connected is one row that leads to connecting it, not a list of models that cannot be used.

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
  const connectedGroups = groups.filter(group => connections[group.provider] !== false);
  const unconnected = GROUPS.filter(group => connections[group.provider] === false && (group.provider !== "custom" || custom));
  return (
    <div className="flex min-w-0 items-center gap-3 text-xs">
      <span className={cn("flex min-h-11 shrink-0 items-center gap-1.5 transition-colors sm:min-h-0", chat.config.webSearch ? "text-hi" : "text-dim")}>
        web
        <Switch size="sm" checked={chat.config.webSearch} disabled={busy} aria-label="Web search"
          onCheckedChange={() => { try { chats.update(chat.uid, value => { value.config.webSearch = !value.config.webSearch; }); } catch (error) { toastError(error); } }} />
      </span>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <Button type="button" variant="ghost" disabled={busy} aria-label="Choose model" title={current}
            className="min-w-0 justify-start gap-1 text-dim">
            <span className="truncate">{name}</span>
            <ChevronDown className="size-3 shrink-0" />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content side="top" align="start" sideOffset={8} collisionPadding={12} aria-label="Chat models"
            className="z-50 flex max-h-[min(30rem,70dvh)] w-[min(22rem,calc(100vw-1.5rem))] origin-(--radix-popover-content-transform-origin) flex-col overflow-hidden rounded-sm border bg-popover text-popover-foreground duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.97]">
            <label className="flex items-center gap-2 px-3">
              <span aria-hidden="true" className="text-dim">/</span>
              <input aria-label="Search models" placeholder="search models" value={query} onChange={event => setQuery(event.target.value)} autoFocus
                className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-dim" />
            </label>
            {loading || error ? <div role={error ? "alert" : "status"} className={cn("flex items-center gap-2 px-3 pt-2 text-xs", error ? "text-destructive" : "text-muted-foreground")}>
              {error || "Loading models…"}{error ? <Button type="button" onClick={() => setAttempt(value => value + 1)}>retry</Button> : null}
            </div> : null}

            <div className="min-h-0 flex-1 overflow-y-auto pb-1 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]" aria-label="Available models">
              {connectedGroups.map(group => <Section key={group.provider} label={<span role="heading" aria-level={3}>{group.label}</span>} className="mb-2 px-3 pt-1 first:pt-0.5 last:mb-0">
                {group.models.map(model => {
                  const chosen = providerName === PROVIDER_NAMES[model.provider] && chat.config.model === model.id;
                  const size = model.context ? `${Math.round(model.context / 1000)}k` : "";
                  return (
                    <Row key={model.provider + model.id} onOpen={busy || model.tools === false ? undefined : () => choose(model)}
                      className={cn(chosen && "bg-secondary")}
                      lead={chosen ? <Check aria-hidden="true" className="size-3.5 text-hi" /> : <span aria-hidden="true" className="w-3.5" />}
                      end={<>
                        {model.reasoning ? <span aria-label="reasons first">think</span> : null}
                        {model.free && model.id !== "openrouter/free" ? <span>free</span> : null}
                        {model.tools === false ? <span>no tools</span> : size ? <span className="w-9 text-right tabular-nums">{size}</span> : null}
                      </>}>
                      <span title={model.note ? model.name + " · " + model.note : model.name}
                        className={cn("truncate", chosen ? "text-hi" : "text-foreground")}>
                        {model.name.replace(/^[^:·]{1,30}:\s+/, "")}
                      </span>
                      {chosen ? <span className="sr-only"> chosen</span> : null}
                      {model.tools === false ? <span className="sr-only"> unavailable</span> : null}
                    </Row>
                  );
                })}
              </Section>)}
              {!connectedGroups.length && !loading ? <p className="px-3 py-5 text-sm text-muted-foreground">
                {query.trim() ? <>No model matches “{query.trim()}”. <Button type="button" variant="link" onClick={() => setQuery("")}>clear</Button></> : "No account connected yet."}
              </p> : null}
              {unconnected.length && !query.trim() ? <div className="px-3">
                {unconnected.map(group => (
                  <Row key={group.provider} href="/#/settings" end="connect">{group.label}</Row>
                ))}
              </div> : null}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
