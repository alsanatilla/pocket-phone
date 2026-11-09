import { defaultConfig } from "../../data/models.ts";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ChevronDown, Clock3, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { starters } from "../../../client/pip-presentation.js";
import { readAccess } from "../../data/ai.ts";
import { useCollection } from "../../data/bus.ts";
import { createChat, listChats, readChat } from "../../data/chats.ts";
import { daySummary, listTasks, today } from "../../data/tasks.ts";
import { openThoughts } from "../../data/thoughts.ts";
import { modelLabel } from "../settings/SettingsPage.tsx";
import { ChatList } from "./ChatList.tsx";
import { PipComposer } from "./PipComposer.tsx";
import { Turn } from "./Turn.tsx";
import { busy as runnerBusy, send, stop, useLiveReply, watchChat } from "./runner.ts";
import { toastError } from "../../ui/toast/toast.ts";

// Pip: one conversation at a time, the list of all of them in a side sheet. The header says which model answers
// and what Pip may read, both linking to settings. An empty chat offers questions that fit what Pip may read.

function Empty({ onAsk }: { onAsk: (prompt: string) => void }) {
  const enabled = readAccess();
  const { due } = daySummary(listTasks(), today());
  const ideas = starters({ enabled, overdue: due.filter(task => task.due < today()).length, thoughts: openThoughts().length });
  return (
    <div className="space-y-4 py-8">
      <p className="font-pixel text-5xl leading-none text-primary">pip</p>
      <p className="max-w-prose text-sm text-muted-foreground">Ask about anything you keep in Pocket. Pip only reads what you allow in settings, and nothing is saved without you.</p>
      <div className="grid gap-2">
        {ideas.map(idea => (
          <button key={idea.label} onClick={() => onAsk(idea.prompt)} className="rounded-lg border bg-card px-3.5 py-3 text-left text-sm transition-colors hover:border-primary">
            {idea.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PipPage() {
  const { chat: picked, ask } = useSearch({ from: "/pip" });
  const navigate = useNavigate({ from: "/pip" });
  // Only the open chat is read on each change (a streaming reply saves several times a second); the list of all
  // chats is read when the side sheet opens. Without a chat in the URL, the most recent one is opened once.
  const chat = useCollection(["chats"], () => (picked ? readChat(picked) : null), [picked]);
  useEffect(() => {
    if (picked && chat) return;
    const latest = listChats()[0];
    if (latest) void navigate({ search: { chat: latest.uid, ...(ask ? { ask } : {}) }, replace: true });
  }, [picked, chat, ask, navigate]);
  const live = useLiveReply();
  const [listOpen, setListOpen] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const open = (uid: string) => { setListOpen(false); void navigate({ search: { chat: uid } }); };
  const start = () => open(createChat().uid);

  // Follow the reply while it grows (text, cards, rendered blocks arriving), unless the person scrolled up to read.
  // Growth is observed on the thread itself and followed once per frame, so a burst of changes is one scroll.
  useEffect(() => {
    const node = thread.current;
    if (!node) return;
    let frame = 0;
    const onScroll = () => { following.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 120; };
    const follow = () => {
      if (frame || !following.current) return;
      frame = requestAnimationFrame(() => { frame = 0; window.scrollTo({ top: document.documentElement.scrollHeight }); });
    };
    const observer = new ResizeObserver(follow);
    observer.observe(node);
    addEventListener("scroll", onScroll, { passive: true });
    return () => { observer.disconnect(); removeEventListener("scroll", onScroll); cancelAnimationFrame(frame); };
  }, []);
  // A new message always brings the end into view.
  // A reply running in this chat that this tab did not send (another device, or before a reload) shows here live.
  const watched = chat?.uid;
  useEffect(() => (watched ? watchChat(watched) : undefined), [watched]);
  useLayoutEffect(() => { following.current = true; window.scrollTo({ top: document.documentElement.scrollHeight }); }, [chat?.uid, chat?.turns.length]);

  const model = (() => { try { return modelLabel(chat?.config.model ?? defaultConfig().model); } catch { return "no model"; } })();
  const reads = readAccess();
  const locked = Boolean(live) || runnerBusy();

  return (
    <main className="flex min-h-[calc(100dvh-72px)] flex-col">
      <div className="sticky top-[60px] z-[5] flex items-center gap-2 bg-background py-1.5">
        <button onClick={() => setListOpen(true)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left" aria-label="All chats">
          <span className="truncate font-pixel text-2xl leading-none">{chat?.title || "pip"}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
        <Button asChild variant="ghost" size="icon" aria-label="Jobs: Pip on its own"><Link to="/jobs"><Clock3 /></Link></Button>
        <Button variant="ghost" size="icon" aria-label="New chat" onClick={start}><Plus /></Button>
      </div>
      <Link to="/settings" className="mb-3 truncate text-[11px] text-dim no-underline hover:text-muted-foreground">
        {model} · {reads.length ? "reads " + reads.join(", ") : "reads nothing yet"}
      </Link>

      <div ref={thread} className="flex-1 space-y-8 pb-4">
        {!chat || !chat.turns.length
          ? <Empty onAsk={prompt => { const target = chat ?? createChat(); if (!chat) open(target.uid); send(target.uid, prompt).catch(toastError); }} />
          : chat.turns.map((turn, index) => (
            <Turn key={turn.uid} turn={turn} chatId={chat.uid} latest={index === chat.turns.length - 1} locked={locked}
              live={live && live.chatId === chat.uid && live.turnId === turn.uid ? live.turn : null} />
          ))}
      </div>

      <div className="sticky bottom-0 bg-background pt-2 pb-3">
        {chat
          ? <PipComposer key={chat.uid + (ask ?? "")} chat={chat} busy={locked} initial={ask} onSend={text => send(chat.uid, text)} onStop={stop} />
          : <Button className="w-full" onClick={start}>start a chat</Button>}
      </div>

      <ChatList open={listOpen} onOpenChange={setListOpen} current={chat?.uid ?? null} onPick={open} onNew={start} />
    </main>
  );
}
