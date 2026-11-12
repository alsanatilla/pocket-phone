import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ChevronDown, Clock3, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { starters } from "../../../client/pip-presentation.js";
import { readAccess } from "../../data/ai.ts";
import { useCollection } from "../../data/bus.ts";
import { createChat, readChat, type Chat } from "../../data/chats.ts";
import { homeChat, homeChats, homeForSend, isHome } from "../../data/home.ts";
import { daySummary, listTasks, today } from "../../data/tasks.ts";
import { openThoughts } from "../../data/thoughts.ts";
import { ChatList } from "./ChatList.tsx";
import { PipComposer } from "./PipComposer.tsx";
import { threadOf } from "./thread.ts";
import { Turn } from "./Turn.tsx";
import { busy as runnerBusy, send, stop, useLiveReply, watchChat } from "./runner.ts";
import { toastError } from "../../ui/toast/toast.ts";

// Pip: one ongoing conversation, plus the separate chats in a side sheet. The header says which model answers and
// what Pip may read, both linking to settings. An empty chat offers questions that fit what Pip may read.

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

/** What the address opened: a separate chat, or home with every home segment oldest first. */
interface Screen { chat: Chat | null; segments: Chat[]; homeLink: boolean }

export function PipPage() {
  const { chat: picked, ask } = useSearch({ from: "/pip" });
  const navigate = useNavigate({ from: "/pip" });
  // Only what is on screen is read on each change (a streaming reply saves several times a second): a separate
  // chat reads itself, home reads every segment in one call. No chat is created here, in a render.
  const screen = useCollection(["chats"], (): Screen => {
    const found = picked ? readChat(picked) : null;
    if (found && !isHome(found)) return { chat: found, segments: [], homeLink: false };
    return { chat: null, segments: homeChats(), homeLink: Boolean(found) };
  }, [picked]);
  const home = !screen.chat;
  // Home is the segment created last; it is the one the composer writes to and the reply is watched in.
  const chat = screen.chat ?? screen.segments.at(-1) ?? null;
  const screenKey = home ? "home" : chat?.uid ?? "none";
  const live = useLiveReply();
  const [listOpen, setListOpen] = useState(false);
  const [shown, setShown] = useState(30);
  const thread = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const height = useRef<number | null>(null);
  const open = (uid: string) => { setListOpen(false); void navigate({ search: { chat: uid } }); };
  const goHome = () => { setListOpen(false); void navigate({ search: {} }); };
  const start = () => open(createChat().uid);

  // A notification may name a home segment; home has no chat in its address.
  useEffect(() => {
    if (screen.homeLink) void navigate({ search: ask ? { ask } : {}, replace: true });
  }, [screen.homeLink, ask, navigate]);
  // Opening home with nothing stored yet starts its first segment; StrictMode's second run finds it instead.
  useEffect(() => { if (home && !screen.segments.length) homeChat(); }, [home, screen.segments]);
  // The chat last opened answers "ask pip" from elsewhere; home records its current segment.
  useEffect(() => { if (chat) localStorage.setItem("pocket:pip-current", chat.uid); }, [chat?.uid]);
  // A new chat starts at its end.
  useLayoutEffect(() => { setShown(30); }, [screenKey]);

  // Follow the reply while it grows (text, cards, blocks arriving), unless the person scrolled up to read. The
  // observer reports growth after layout and before the frame is painted, so scrolling right there keeps the end in
  // view in the same frame; waiting for the next frame showed the new line below the fold first.
  useEffect(() => {
    const node = thread.current;
    if (!node) return;
    const onScroll = () => { following.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 120; };
    const observer = new ResizeObserver(() => { if (following.current) window.scrollTo({ top: document.documentElement.scrollHeight }); });
    observer.observe(node);
    addEventListener("scroll", onScroll, { passive: true });
    return () => { observer.disconnect(); removeEventListener("scroll", onScroll); };
  }, []);
  // A new message always brings the end into view; showing earlier messages does not. The effect names which
  // conversation is on screen and how many turns it has in total, never how many of them are shown.
  const total = screen.chat ? screen.chat.turns.length : screen.segments.reduce((count, segment) => count + segment.turns.length, 0);
  useLayoutEffect(() => { following.current = true; window.scrollTo({ top: document.documentElement.scrollHeight }); }, [screenKey, total]);
  // Showing earlier messages keeps the message that was first on screen where it is: measure before `shown`
  // changes, then scroll by exactly the height the messages added above it.
  useLayoutEffect(() => {
    if (height.current === null) return;
    const added = document.documentElement.scrollHeight - height.current;
    height.current = null;
    if (added) window.scrollBy(0, added);
  }, [shown]);
  const showEarlier = () => { height.current = document.documentElement.scrollHeight; setShown(count => count + 30); };

  // A reply running in this chat that this tab did not send (another device, or before a reload) shows here live.
  const watched = chat?.uid;
  useEffect(() => (watched ? watchChat(watched) : undefined), [watched]);

  const joined = threadOf(home ? screen.segments : screen.chat ? [screen.chat] : [], shown);
  const latest = chat?.turns.at(-1)?.uid ?? null;
  const locked = Boolean(live) || runnerBusy();
  const askPip = (prompt: string) => { const target = home ? homeForSend() : chat; if (target) send(target.uid, prompt).catch(toastError); };

  return (
    <main className="flex min-h-[calc(100dvh-45px)] flex-col">
      {/* One quiet line under the header: which conversation this is (it opens the list), then the two actions. */}
      <div className="sticky top-[45px] z-[5] mb-3 flex items-center gap-1 bg-background">
        <button onClick={() => setListOpen(true)} aria-expanded={listOpen} className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 text-left text-xs text-dim transition-colors hover:text-foreground" aria-label="All chats">
          <span className="truncate">{chat?.title || "pip"}</span>
          <ChevronDown className="size-3.5 shrink-0" />
        </button>
        <Button asChild variant="ghost" size="icon" className="text-dim" aria-label="Jobs: Pip on its own"><Link to="/jobs"><Clock3 className="size-4" /></Link></Button>
        <Button variant="ghost" size="icon" className="-mr-3 text-dim" aria-label="New chat" onClick={start}><Plus className="size-4" /></Button>
      </div>
      <div ref={thread} className="flex-1 space-y-8 pb-4">
        {!joined.items.length
          ? <Empty onAsk={askPip} />
          : <>
            {joined.earlier ? (
              <button type="button" onClick={showEarlier} className="flex min-h-11 w-full items-center justify-center text-xs text-dim transition-colors hover:text-muted-foreground sm:min-h-0">
                earlier messages
              </button>
            ) : null}
            {joined.items.map(item => (
              <Turn key={item.turn.uid} turn={item.turn} chatId={item.chatId} latest={item.chatId === chat?.uid && item.turn.uid === latest} locked={locked}
                live={live && live.chatId === item.chatId && live.turnId === item.turn.uid ? live.turn : null}
                blocks={live && live.chatId === item.chatId && live.turnId === item.turn.uid ? live.blocks : undefined} />
            ))}
          </>
        }
      </div>

      <div className="sticky bottom-0 bg-background pt-2 pb-3">
        {chat
          ? <PipComposer key={chat.uid + (ask ?? "")} chat={chat} busy={locked} initial={ask} onSend={text => send((home ? homeForSend() : chat).uid, text)} onStop={stop} />
          : null}
      </div>

      <ChatList open={listOpen} onOpenChange={setListOpen} current={home ? null : chat?.uid ?? null} homeCurrent={home} onPick={open} onHome={goHome} onNew={start} />
    </main>
  );
}
