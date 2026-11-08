import { createRoot } from "react-dom/client";
import { useSyncExternalStore, useEffect, useRef } from "react";
import { createChatStore } from "./store.js";

// The chat's structure, in React: header, transcript, composer. Everything a future feature needs has a named place
// here — a turn's body is a slot the controller fills today, and each slot can move into React on its own without
// touching the others. The runner and the markdown pipeline stay where they are.

const stamp = value => {
  const at = new Date(Number(value) || Date.now());
  return at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
};

function Gutter({ turn }) {
  return (
    <div className="pip-who">
      <time>{stamp(turn.created)}</time>
      <b>{turn.speaker}</b>
    </div>
  );
}

/** A slot is a stable div per (turn, part) that the controller can append a legacy widget into. */
function TurnBody({ uid, register }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) return register(uid, ref.current);
  }, [uid, register]);
  return <div className="pip-col pip-turn-body" ref={ref} />;
}

function Empty({ node, register }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    if (node) ref.current.replaceChildren(node);
    else ref.current.replaceChildren();
  }, [node]);
  return <div className="pip-empty-slot" ref={ref} />;
}

function Transcript({ turns, active, register, empty }) {
  if (!turns.length) return <div className="pip-thread" tabIndex={0} aria-label="Conversation"><Empty node={empty} register={register} /></div>;
  return (
    <div className="pip-thread" tabIndex={0} aria-label="Conversation">
      {turns.map(turn => (
        <section className="pip-message" data-turn={turn.uid} key={turn.uid} aria-label="Conversation turn">
          <div className="pip-turn you">
            <Gutter turn={{ ...turn, speaker: "you" }} />
            <div className="pip-col">
              <p className="pip-question">{turn.text}</p>
            </div>
          </div>
          <div className="pip-turn pip">
            <Gutter turn={{ ...turn, speaker: "pip" }} />
            <TurnBody uid={turn.uid} register={register} />
          </div>
        </section>
      ))}
    </div>
  );
}

function Composer({ draft, active, onDraft, onSend, onStop, scope, onScope, options, onOptions }) {
  const field = useRef(null);
  useEffect(() => { if (field.current) field.current.focus({ preventScroll: true }); }, []);
  return (
    <form className="pip-composer" onSubmit={event => { event.preventDefault(); if (draft.trim()) onSend(draft); }}>
      <div className="pip-compose-line">
        <span className="pip-glyph" aria-hidden="true">▌</span>
        <textarea
          ref={field}
          id="pip-prompt"
          aria-label="Message Pip"
          placeholder="message Pip…"
          maxLength={16000}
          rows={1}
          value={draft}
          onChange={event => onDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
              event.preventDefault();
              if (!active && draft.trim()) onSend(draft);
            }
          }}
        />
        {active
          ? <button type="button" className="accent pip-send" onClick={onStop}>stop</button>
          : <button type="submit" className="accent pip-send" disabled={!draft.trim()}>send</button>}
      </div>
      <div className="pip-compose-hint">
        <button type="button" className="pip-compose-scope" onClick={onScope}>{scope}</button>
        {options && onOptions ? <button type="button" className="pip-options-trigger" onClick={onOptions}>options</button> : null}
      </div>
    </form>
  );
}

export function createChatView(container, handlers = {}) {
  const store = createChatStore({ draft: "", scope: "choose what pip can read", options: false });
  const bodies = new Map();
  const roots = [];

  const register = (uid, node) => {
    const entry = bodies.get(uid);
    bodies.set(uid, { node, pending: entry?.pending ?? null });
    if (entry?.pending) node.replaceChildren(entry.pending);
    return () => bodies.delete(uid);
  };

  function App() {
    const state = useSyncExternalStore(store.subscribe, store.get, store.get);
    return (
      <div className="pip-chat">
        <header className="pip-heading">
          <h1 className="workspace-title">pip</h1>
          <button className="pip-chip" type="button" onClick={() => handlers.onChats?.()}>chats · {state.chatCount ?? 0} ▾</button>
          <button className="pip-new" type="button" onClick={() => handlers.onNew?.()}>+ new</button>
        </header>
        <Transcript turns={state.turns} active={state.active} register={register} empty={state.empty} />
        <Composer
          draft={state.draft}
          active={Boolean(state.active)}
          onDraft={value => { store.setDraft(value); handlers.onDraft?.(value); }}
          onSend={text => handlers.onSend?.(text)}
          onStop={() => handlers.onStop?.()}
          scope={state.scope}
          onScope={() => handlers.onScope?.()}
          options={state.options}
          onOptions={() => handlers.onOptions?.()}
        />
      </div>
    );
  }

  const root = createRoot(container);
  roots.push(root);
  root.render(<App />);

  return {
    store,
    /** The transcript's turn list. Bodies are mounted separately, so a reply update never re-renders them. */
    setTurns(turns) { store.set({ turns }); },
    setActive(active) { store.setActive(active); },
    /** The empty state is a legacy widget too; React gives it a place and the controller fills it. */
    setEmpty(node) { store.set({ empty: node }); },
    /** Replaces a turn's body slot with a freshly built widget, whether or not it has mounted yet. */
    setBody(uid, node) {
      const entry = bodies.get(uid);
      if (entry?.node) { entry.node.replaceChildren(node); return true; }
      bodies.set(uid, { node: entry?.node ?? null, pending: node });
      return false;
    },
    setChat({ count, scope, options } = {}) {
      store.set({ chatCount: count, ...(scope === undefined ? {} : { scope }), ...(options === undefined ? {} : { options }) });
    },
    draft() { return store.get().draft; },
    setDraft(value) { store.setDraft(value); },
    /** Appends a legacy widget into a turn's body slot, before or after it mounts. */
    mountBody(uid, node) {
      const entry = bodies.get(uid);
      if (entry) { entry.node.append(node); return true; }
      const held = bodies.get(uid) ?? { node: null, pending: null };
      bodies.set(uid, { ...held, pending: node });
      return false;
    },
    release(uid) { bodies.delete(uid); },
    destroy() { for (const root of roots) root.unmount(); }
  };
}
