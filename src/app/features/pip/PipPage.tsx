import { useNavigate, useSearch } from "@tanstack/react-router";
import { hydrateCards, releaseCards } from "../../../client/pip-cards.jsx";
import { useCollection } from "../../data/bus.ts";
import { createChat, listChats, type ChatTurn } from "../../data/chats.ts";
import { Composer } from "../../ui/Composer.tsx";
import { Markdown } from "../../ui/Markdown.tsx";
import { send, stop, useLiveReply } from "./runner.ts";
import styles from "./Pip.module.css";

// Pip: the same store, runner and markdown pipeline as the classic chat. Cards inside answers are json-render
// React roots mounted by pip-cards. Settings, sources and routines are still in the classic chat.

const clock = (at: number) => new Date(Number(at) || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

function Answer({ text, streaming }: { text: string; streaming: boolean }) {
  return <Markdown text={text} options={{ streaming, onBeforeRender: releaseCards, onRender: node => { hydrateCards(node); } }} />;
}

function Turn({ turn, live }: { turn: ChatTurn; live: Partial<ChatTurn> | null }) {
  const answer = live?.answer ?? turn.answer;
  return (
    <section className={styles.turn + (answer ? " " + styles.answered : "")}>
      <div className={styles.who}><time>{clock(turn.created)}</time><b>you</b></div>
      <p className={styles.question}>{turn.text}</p>
      <div className={styles.who}><time>{clock(turn.created)}</time><b>pip</b></div>
      <div className={styles.answer}>
        {answer ? <Answer text={answer} streaming={Boolean(live)} /> : null}
        {live ? <p className={styles.muted}>{live.phase || "thinking"}…</p> : null}
        {!live && turn.error ? <p className={styles.muted}>{turn.error}</p> : null}
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
      <main className={styles.pip}>
        <p className={styles.muted}>No conversation yet.</p>
        <button className={styles.link} onClick={() => open(createChat().uid)}>+ new chat</button>
      </main>
    );
  }

  return (
    <main className={styles.pip}>
      <div className={styles.head}>
        <select value={chat.uid} onChange={event => open(event.target.value)} aria-label="Conversation">
          {list.map(item => <option key={item.uid} value={item.uid}>{item.title || "untitled"}</option>)}
        </select>
        <button className={styles.link} onClick={() => open(createChat().uid)}>+ new</button>
      </div>
      {chat.context.length ? (
        <p className={styles.muted}>with {chat.context.map(source => source.title).join(" · ")}</p>
      ) : null}
      <div className={styles.thread}>
        {chat.turns.map(turn => (
          <Turn key={turn.uid} turn={turn} live={live && live.chatId === chat.uid && live.turnId === turn.uid ? live.turn : null} />
        ))}
      </div>
      <div className={styles.composer}>
        <Composer label="Message Pip" placeholder="message pip…" action="send" maxLength={16000}
          busy={Boolean(live)} onCancel={stop} onSubmit={text => send(chat.uid, text)} />
      </div>
    </main>
  );
}
