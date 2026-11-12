import { useEffect, useState } from "react";
import { Popover } from "radix-ui";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Chat } from "../../data/chats.ts";
import { chats } from "../../data/chats.ts";
import { chooseModel, providerOf, connectionOf, isConnected, customEndpoint, CURATED, PROVIDER_KEYS, PROVIDER_NAMES, modelLabel, type ModelChoice, type ProviderKey } from "../../data/models.ts";
import { FREE_ROUTER, loadFreeModels, tokenSize, type FreeModel } from "../../data/openrouter-models.ts";
import { toastError } from "../../ui/toast/toast.ts";

// The model picker: the search is its head, then one line per model, grouped by the account it comes from. A line
// says only what tells models apart (name, context, reasoning, free); the group already says the account. An
// account that is not connected is one line that leads to connecting it, not a list of models that cannot be used.

const GROUPS: { provider: ProviderKey; label: string }[] = [
  { provider: "opencode", label: "OpenCode Go" },
  { provider: "anthropic", label: "Anthropic" },
  { provider: "openrouter", label: "OpenRouter" },
  { provider: "custom", label: "Your endpoint" },
];

const LABEL = "text-[10.5px] uppercase tracking-[0.06em] text-dim";
const ROW = "flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary disabled:opacity-40 sm:min-h-0";

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
      <button type="button" disabled={busy} aria-label="Web search" aria-pressed={chat.config.webSearch}
        title={chat.config.webSearch ? "Web search on" : "Web search off"}
        className={cn("flex min-h-11 shrink-0 items-center text-xs transition-colors disabled:opacity-50 sm:min-h-0", chat.config.webSearch ? "text-hi" : "text-dim hover:text-foreground")}
        onClick={() => { try { chats.update(chat.uid, value => { value.config.webSearch = !value.config.webSearch; }); } catch (error) { toastError(error); } }}>
        web
      </button>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button type="button" disabled={busy} aria-label="Choose model" title={current}
            className="flex min-h-11 min-w-0 items-center gap-1 text-xs text-dim transition-colors hover:text-foreground disabled:opacity-50 data-[state=open]:text-foreground sm:min-h-0">
            <span className="truncate">{name}</span>
            <ChevronDown className="size-3 shrink-0" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content side="top" align="start" sideOffset={8} collisionPadding={12} aria-label="Chat models"
            className="z-50 flex max-h-[min(30rem,70dvh)] w-[min(22rem,calc(100vw-1.5rem))] origin-(--radix-popover-content-transform-origin) flex-col overflow-hidden rounded-sm border bg-popover text-popover-foreground duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.97]">
            <label className="flex items-center gap-2 border-b px-3">
              <span aria-hidden="true" className="text-dim">/</span>
              <input aria-label="Search models" placeholder="search models" value={query} onChange={event => setQuery(event.target.value)} autoFocus
                className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-dim" />
            </label>
            {loading || error ? <div role={error ? "alert" : "status"} className={cn("flex items-center gap-2 px-3 pt-2 text-xs", error ? "text-destructive" : "text-muted-foreground")}>
              {error || "Loading models…"}{error ? <button type="button" onClick={() => setAttempt(value => value + 1)}
                className="flex min-h-11 items-center text-xs text-dim transition-colors hover:text-foreground sm:min-h-0">retry</button> : null}
            </div> : null}

            <div className="min-h-0 flex-1 overflow-y-auto pb-1 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]" aria-label="Available models">
              {connectedGroups.map(group => <section key={group.provider} className="pt-2 first:pt-0.5">
                <h3 className={cn("px-3 pb-1", LABEL)}>{group.label}</h3>
                {group.models.map(model => {
                  const chosen = providerName === PROVIDER_NAMES[model.provider] && chat.config.model === model.id;
                  const size = model.context ? `${Math.round(model.context / 1000)}k` : "";
                  return (
                    <button type="button" key={model.provider + model.id} disabled={busy || model.tools === false} aria-pressed={chosen} onClick={() => choose(model)}
                      title={model.note ? model.name + " · " + model.note : model.name}
                      className={ROW}>
                      <span aria-hidden="true" className="w-[3ch] shrink-0 text-xs text-dim">{chosen ? "[x]" : ""}</span>
                      <span className={cn("min-w-0 flex-1 truncate", chosen ? "text-hi" : "text-foreground")}>{model.name.replace(/^[^:·]{1,30}:\s+/, "")}</span>
                      {model.reasoning ? <span aria-label="reasons first" className="shrink-0 text-xs text-dim">think</span> : null}
                      {model.free && model.id !== "openrouter/free" ? <span className="shrink-0 text-xs text-dim">free</span> : null}
                      {model.tools === false ? <span className="shrink-0 text-xs text-dim">no tools</span> : size ? <span className="w-9 shrink-0 text-right text-xs tabular-nums text-dim">{size}</span> : null}
                    </button>
                  );
                })}
              </section>)}
              {!connectedGroups.length && !loading ? <p className="px-3 py-5 text-sm text-muted-foreground">
                {query.trim() ? <>No model matches “{query.trim()}”. <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => setQuery("")}>clear</button></> : "No account connected yet."}
              </p> : null}
              {unconnected.length && !query.trim() ? <div className="mt-2 border-t pt-1">
                {unconnected.map(group => (
                  <a key={group.provider} href="/#/settings" className="flex min-h-11 items-center gap-2 px-3 py-2 text-sm text-dim no-underline transition-colors hover:bg-secondary hover:text-foreground sm:min-h-0">
                    <span className="flex-1">{group.label}</span><span className="text-xs">connect</span>
                  </a>
                ))}
              </div> : null}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
