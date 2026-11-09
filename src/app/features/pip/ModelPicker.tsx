import { useEffect, useState } from "react";
import { Popover } from "radix-ui";
import { Check, ChevronDown, Globe } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { Chat } from "../../data/chats.ts";
import { chats } from "../../data/chats.ts";
import { selectFreeModel } from "../../data/chat-models.ts";
import { FREE_ROUTER, loadFreeModels, tokenSize, type FreeModel } from "../../data/openrouter-models.ts";
import { modelLabel } from "../settings/SettingsPage.tsx";
import { toastError } from "../../ui/toast/toast.ts";

export function ModelPicker({ chat, busy }: { chat: Chat; busy: boolean }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState("");
  const [models, setModels] = useState<FreeModel[]>([FREE_ROUTER]);
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const isOpenRouter = chat.config.baseUrl === "https://openrouter.ai/api/v1";
  useEffect(() => {
    if (!open && !isOpenRouter) return;
    let cancelled = false;
    setLoading(true); setError("");
    loadFreeModels().then(value => { if (!cancelled) setModels(value); })
      .catch(() => { if (!cancelled) setError("Model list unavailable. Auto is still available; retry to load specific models."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, isOpenRouter, attempt]);
  const selected = isOpenRouter ? models.find(model => model.id === chat.config.model) : undefined;
  const free = isOpenRouter && (chat.config.model === "openrouter/free" || chat.config.model.endsWith(":free"));
  const name = selected?.name ?? modelLabel(chat.config.model);
  const choose = (model: FreeModel) => {
    if (busy) return;
    try { selectFreeModel(chat.uid, model); setOpen(false); setQuery(""); } catch (error) { toastError(error); }
  };
  const filtered = models.filter(model => (model.name + " " + model.id).toLowerCase().includes(query.toLowerCase().trim()));
  const providerName = isOpenRouter ? "OpenRouter" : chat.config.provider === "anthropic" ? "Anthropic" : chat.config.baseUrl.startsWith("https://opencode.ai/") ? "OpenCode Go" : "Custom provider";
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
          <Popover.Content side="top" align="end" sideOffset={10} aria-label="OpenRouter free models"
            className="z-50 flex max-h-[min(34rem,75dvh)] w-[min(26rem,calc(100vw-1.5rem))] flex-col rounded-lg border bg-popover text-popover-foreground shadow-xl">
            <div className="space-y-1 border-b p-3.5">
              <h2 className="text-sm font-medium">Free models · OpenRouter</h2>
              <p className="text-xs leading-relaxed text-muted-foreground">Now: {current}. A choice applies to this chat and new ones. Needs OpenRouter connected in <a href="/#/settings" className="text-primary">settings</a>.</p>
            </div>
            <div className="p-3 pb-2">
              <Input aria-label="Search free models" placeholder="search models…" value={query} onChange={event => setQuery(event.target.value)} />
              {loading ? <p role="status" className="pt-2 text-xs text-muted-foreground">Loading current models…</p> : null}
              {error ? <div role="alert" className="flex items-center gap-2 pt-2 text-xs text-destructive">{error}<Button type="button" size="sm" variant="ghost" onClick={() => setAttempt(value => value + 1)}>retry</Button></div> : null}
            </div>
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2" aria-label="Available models">
              {filtered.map(model => {
                const chosen = isOpenRouter && chat.config.model === model.id;
                const traits = [model.reasoning && "reasoning", model.vision && "images"].filter(Boolean) as string[];
                return (
                  <button type="button" key={model.id} disabled={busy || !model.tools} aria-pressed={chosen} onClick={() => choose(model)}
                    className={"w-full rounded-md border-l-2 px-3 py-2.5 text-left hover:bg-accent disabled:opacity-40 " + (chosen ? "border-primary bg-accent" : "border-transparent")}>
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{model.name}</span>
                      {chosen ? <Check className="size-4 shrink-0 self-center text-primary" /> : <span className="shrink-0 text-xs text-muted-foreground">{model.context ? `${Math.round(model.context / 1000)}k context` : "picks for you"}</span>}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {!model.tools ? <span className="text-xs text-muted-foreground">no tools · Pip can't use it</span>
                        : traits.map(trait => <span key={trait} className="rounded-sm bg-secondary px-1.5 py-px text-xs text-muted-foreground">{trait}</span>)}
                    </span>
                  </button>
                );
              })}
              {!filtered.length && !loading ? <p className="p-3 text-xs text-muted-foreground">No matching free models.</p> : null}
            </div>
            <p className="border-t px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground">Free, with OpenRouter's limits. When a model is busy, Pip falls back to Auto.</p>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
