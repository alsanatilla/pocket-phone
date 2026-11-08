import { useNavigate, useSearch } from "@tanstack/react-router";
import { hydrateCards, releaseCards } from "../../../client/pip-cards.jsx";
import { useCollection } from "../../data/bus.ts";
import { createChat, listChats, type ChatTurn } from "../../data/chats.ts";
import { Composer } from "../../ui/Composer.tsx";
import { Markdown } from "../../ui/Markdown.tsx";
import { send, stop, useLiveReply } from "./runner.ts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Pip: the same store, runner and markdown pipeline as the classic chat. Cards inside answers are json-render
// React roots mounted by pip-cards. Settings, sources and routines are still in the classic chat.

const clock = (at: number) => new Date(Number(at) || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

function Answer({ text, streaming }: { text: string; streaming: boolean }) {
  return <Markdown text={text} options={{ streaming, onBeforeRender: releaseCards, onRender: node => { hydrateCards(node); } }} />;
}

function Who({ at, name }: { at: number; name: string }) {
  return (
    <div className="col-start-1 flex flex-col">
      <time className="text-[11px] text-dim">{clock(at)}</time>
      <b className="font-pixel text-lg font-normal leading-none text-muted-foreground">{name}</b>
    </div>
  );
}

function Turn({ turn, live }: { turn: ChatTurn; live: Partial<ChatTurn> | null }) {
  const answer = live?.answer ?? turn.answer;
  return (
    <section className={cn("mb-6 grid grid-cols-[52px_minmax(0,1fr)] gap-x-3.5 border-l-2 pl-3.5", answer && "border-l-primary")}>
      <Who at={turn.created} name="you" />
      <p>{turn.text}</p>
      <Who at={turn.created} name="pip" />
      <div className="mt-3 col-start-2">
        {answer ? <Answer text={answer} streaming={Boolean(live)} /> : null}
        {live ? <p className="text-sm text-muted-foreground">{live.phase || "thinking"}…</p> : null}
        {!live && turn.error ? <p className="text-sm text-muted-foreground">{turn.error}</p> : null}
      </div>
    </section>
  );
}

export function PipPage() {
  const { chat: picked } = useSearch({ from: "/pip" });
  const navigate = useNavigate({ from: "/pip" });
  const list = useCollection(["chats"], listChats);
  const chat = list.find(item => item.uid === picked) ?? list[0] ?? null;
  const live = useLiveReply();
  const open = (uid: string) => void navigate({ search: { chat: uid } });

  if (!chat) {
    return (
      <main className="space-y-2 pt-4">
        <p className="text-sm text-muted-foreground">No conversation yet.</p>
        <Button variant="outline" onClick={() => open(createChat().uid)}>+ new chat</Button>
      </main>
    );
  }

  return (
    <main className="pt-2">
      <div className="my-2 flex items-center gap-3">
        <select value={chat.uid} onChange={event => open(event.target.value)} aria-label="Conversation"
          className="h-11 min-w-0 flex-1 rounded-md border bg-card px-2.5">
          {list.map(item => <option key={item.uid} value={item.uid}>{item.title || "untitled"}</option>)}
        </select>
        <Button variant="ghost" onClick={() => open(createChat().uid)}>+ new</Button>
      </div>
      {chat.context.length ? (
        <p className="text-sm text-muted-foreground">with {chat.context.map(source => source.title).join(" · ")}</p>
      ) : null}
      <div className="mt-4 min-h-[50vh]">
        {chat.turns.map(turn => (
          <Turn key={turn.uid} turn={turn} live={live && live.chatId === chat.uid && live.turnId === turn.uid ? live.turn : null} />
        ))}
      </div>
      <div className="sticky bottom-0 bg-background py-3">
        <Composer label="Message Pip" placeholder="message pip…" action="send" maxLength={16000}
          busy={Boolean(live)} onCancel={stop} onSubmit={text => send(chat.uid, text)} />
      </div>
    </main>
  );
}
