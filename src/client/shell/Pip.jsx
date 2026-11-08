import { useEffect, useMemo, useRef, useState } from "react";
import { ChatStore } from "../pip-core.js";
import { resolve } from "../pip-credentials.js";
import { markdownNode } from "../../shared/markdown.js";
import { hydrateCards } from "../pip-cards.jsx";

// Pip on the new shell: the same store, runner and markdown pipeline the classic chat uses, with the transcript
// drawn by React and cards drawn by json-render. Nothing about the wire protocol changed.

const store = new ChatStore();

const stamp = value => new Date(Number(value) || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

/** Prose keeps the server-side renderer and its sanitizer; this element only owns the container. */
function Prose({ text, streaming }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const node = markdownNode(text, { streaming, onRender: element => { void hydrateCards(element); } });
    ref.current.replaceChildren(node);
    ref.current._markdown = node;
    return () => { node.disposeMarkdown?.(); };
  }, []);
  useEffect(() => {
    const node = ref.current?._markdown;
    if (node) node.updateMarkdown(text, { streaming, onRender: element => { void hydrateCards(element); } });
  }, [text, streaming]);
  return <div className="prose" ref={ref} />;
}

export default function Pip() {
  const [chatId, setChatId] = useState(() => store.list()[0]?.uid ?? null);
  const [draft, setDraft] = useState("");
  const [, setTick] = useState(0);
  // Sending needs the provider stack; opening a chat does not. The runner arrives with the first message.
  const runnerRef = useRef(null);
  let lastPaint = 0;
  const runner = useMemo(() => {
    const api = {
      active: null,
      stop() { api.active = null; setTick(n => n + 1); },
      async send(uid, options) {
        if (!runnerRef.current) {
          const [{ ReplyRunner, streamReply }, { resolve }] = await Promise.all([import("../pip-core.js"), import("../pip-credentials.js")]);
          runnerRef.current = new ReplyRunner(store, {
            key: value => resolve(value),
            stream: (chat, turn, opts) => streamReply(chat, turn, opts),
            title: async () => {},
            onChange: event => {
              api.active = runnerRef.current?.active ?? null;
              // Deltas arrive many times a second; a repaint per frame is enough for the caret and the text.
              const now = Date.now();
              if (event.type === "delta" && now - lastPaint < 90) return;
              lastPaint = now;
              setTick(n => n + 1);
            }
          });
        }
        const result = await runnerRef.current.send(uid, options);
        api.active = runnerRef.current.active ?? null;
        setTick(n => n + 1);
        return result;
      }
    };
    return api;
  }, []);

  const chat = chatId ? store.get(chatId) : null;
  const active = runner.active?.chatId === chatId ? runner.active : null;

  const send = text => {
    if (!chat || runner.active || !text.trim()) return;
    setDraft("");
    void runner.send(chat.uid, { text, context: store.get(chat.uid).context });
  };

  if (!chat) {
    return (
      <main className="pip">
        <p className="muted">No conversation yet.</p>
        <button onClick={() => { const created = store.create(); setChatId(created.uid); }}>+ new chat</button>
      </main>
    );
  }

  return (
    <main className="pip">
      <div className="pip-thread">
        {chat.turns.map(turn => (
          <section className="turn" key={turn.uid}>
            <div className="who"><time>{stamp(turn.created)}</time><b>you</b></div>
            <p className="question">{turn.text}</p>
            <div className="who"><time>{stamp(turn.created)}</time><b>pip</b></div>
            <div className="answer">
              {turn.answer ? <Prose text={turn.answer} streaming={active?.turnId === turn.uid} /> : null}
              {active?.turnId === turn.uid ? <p className="muted">{active.turn.phase || "thinking"}…</p> : null}
            </div>
          </section>
        ))}
      </div>
      <form className="pip-composer" onSubmit={event => { event.preventDefault(); send(draft); }}>
        <span className="glyph" aria-hidden="true">▌</span>
        <input value={draft} onChange={event => setDraft(event.target.value)} placeholder="message pip…" aria-label="Message Pip" maxLength={16000} />
        {active
          ? <button type="button" onClick={() => runner.stop()}>stop</button>
          : <button type="submit" disabled={!draft.trim()}>send</button>}
      </form>
    </main>
  );
}
