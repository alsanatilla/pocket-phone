import { useEffect, useState } from "react";
import { Popover } from "radix-ui";
import { Check, ChevronDown, Globe, SlidersHorizontal } from "lucide-react";
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
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <button type="button" disabled={busy} aria-label="Web search" aria-pressed={chat.config.webSearch}
        className="flex items-center gap-1.5 rounded px-1 py-1 hover:text-foreground disabled:opacity-50"
        onClick={() => { try { chats.update(chat.uid, value => { value.config.webSearch = !value.config.webSearch; }); } catch (error) { toastError(error); } }}>
        <Globe className="size-3.5" /> web {chat.config.webSearch ? "on" : "off"}
      </button>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button type="button" disabled={busy} aria-label="Choose model" className="ml-auto flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-accent disabled:opacity-50">
            <SlidersHorizontal className="size-3.5 shrink-0" /><span className="max-w-48 truncate">{name}</span>
            {free && !/free/i.test(name) ? <span className="text-movement">free</span> : null}<ChevronDown className="size-3 shrink-0" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content side="top" align="end" sideOffset={12} aria-label="OpenRouter free models"
            className="z-50 w-[min(25rem,calc(100vw-2rem))] rounded-xl border bg-popover p-3 text-popover-foreground shadow-xl">
            <h2 className="text-sm font-medium">OpenRouter · free models</h2>
            <p className="mt-1 mb-3 text-xs text-muted-foreground">For this chat and new chats. Requires an OpenRouter connection in <a href="/#/settings" className="underline">settings</a>.</p>
            <Input aria-label="Search free models" placeholder="Search models…" value={query} onChange={event => setQuery(event.target.value)} />
            {loading ? <p role="status" className="py-2 text-xs text-muted-foreground">Loading current models…</p> : null}
            {error ? <div role="alert" className="py-2 text-xs text-destructive">{error}<Button type="button" size="sm" variant="ghost" onClick={() => setAttempt(value => value + 1)}>retry</Button></div> : null}
            <div className="mt-2 max-h-[min(22rem,45dvh)] space-y-1 overflow-y-auto" aria-label="Available models">
              {filtered.map(model => <button type="button" key={model.id} disabled={busy || !model.tools} aria-pressed={isOpenRouter && chat.config.model === model.id}
                onClick={() => choose(model)} className="w-full rounded-md p-2.5 text-left hover:bg-accent aria-pressed:bg-accent disabled:opacity-50">
                <span className="flex items-center gap-2 text-sm"><span className="flex-1">{model.name}</span>{isOpenRouter && chat.config.model === model.id ? <Check className="size-4 text-primary" /> : null}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{model.context ? `${tokenSize(model.context)} context · ` : "Dynamic context · "}{model.tools ? "tools" : "No tools — unavailable for Pip"}{model.reasoning ? " · reasoning" : ""}{model.vision ? " · vision" : ""}{model.maxOutput ? ` · ${tokenSize(model.maxOutput)} max output` : ""}</span>
              </button>)}
              {!filtered.length && !loading ? <p className="p-3 text-xs text-muted-foreground">No matching free models.</p> : null}
            </div>
            <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">$0 model tokens · OpenRouter limits and availability apply. A selected free model may fall back to another free model.</p>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <span className="w-full px-1 text-xs text-dim">{isOpenRouter ? "OpenRouter" : chat.config.provider === "anthropic" ? "Anthropic" : chat.config.baseUrl.startsWith("https://opencode.ai/") ? "OpenCode Go" : "Custom provider"}{selected?.context ? ` · ${tokenSize(selected.context)} context` : ""} · {tokenSize(chat.config.maxTokens)} reply limit{chat.config.thinking ? " · reasoning on" : ""}</span>
    </div>
  );
}
