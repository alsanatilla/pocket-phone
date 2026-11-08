import { useState } from "react";
import { useStore } from "../../lib/useStore.js";
import { clock } from "../../lib/format.js";
import { Composer } from "../../ui/Composer.jsx";
import { Prose } from "./Prose.jsx";
import { chats, usePipRunner } from "./usePipRunner.js";

// Pip: the same store, runner and markdown pipeline as the classic chat. The transcript is React, cards are
// json-render; the wire protocol is unchanged.

function Turn({ turn, live }) {
  const streaming = Boolean(live);
  const answer = live?.answer ?? turn.answer;
  return (
    <section className="turn">
      <div className="who"><time>{clock(turn.created)}</time><b>you</b></div>
      <p className="question">{turn.text}</p>
      <div className="who"><time>{clock(turn.created)}</time><b>pip</b></div>
      <div className="answer">
        {answer ? <Prose text={answer} streaming={streaming} /> : null}
        {streaming ? <p className="muted">{live.phase || "thinking"}…</p> : null}
        {!streaming && turn.error ? <p className="muted">{turn.error}</p> : null}
      </div>
    </section>
  );
}

export default function PipView({ route }) {
  const list = useStore(["chats"], () => { try { return chats.list(); } catch (error) { console.warn("chats", error); return []; } });
  const [picked, setPicked] = useState(() => route.params.get("chat"));
  const chat = list.find(item => item.uid === picked) ?? list[0] ?? null;
  const { live, send, stop } = usePipRunner();
  const streamingHere = live && chat && live.chatId === chat.uid;

  if (!chat) {
    return (
      <main className="pip">
        <p className="muted">No conversation yet.</p>
        <button className="link" onClick={() => setPicked(chats.create().uid)}>+ new chat</button>
      </main>
    );
  }

  return (
    <main className="pip">
      <div className="pip-head">
        <select value={chat.uid} onChange={event => setPicked(event.target.value)} aria-label="Conversation">
          {list.map(item => <option key={item.uid} value={item.uid}>{item.title || "untitled"}</option>)}
        </select>
        <button className="link" onClick={() => setPicked(chats.create().uid)}>+ new</button>
      </div>
      <div className="thread">
        {chat.turns.map(turn => <Turn key={turn.uid} turn={turn} live={streamingHere && live.turnId === turn.uid ? live.turn : null} />)}
      </div>
      <Composer placeholder="message pip…" label="Message Pip" action="send" maxLength={16000}
        busy={Boolean(live)} onCancel={stop} onSubmit={text => send(chat.uid, text)} />
    </main>
  );
}
