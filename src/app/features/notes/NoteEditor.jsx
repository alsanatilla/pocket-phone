import { useEffect, useRef, useState } from "react";
import { notes, NOTE_LIMIT } from "../../../client/store.js";
import { activeAccount } from "../../../client/workspace-storage.js";
import { href, navigate } from "../../router.js";
import { message } from "../../lib/format.js";
import { Markdown } from "../../ui/Markdown.jsx";
import { initialSeen, parkFinished, thoughtAnnotations } from "./thoughts.js";

// The note editor. Text saves itself 600 ms after typing stops (150 ms after Enter or an arrow key), when the
// field loses focus and when the editor closes. Until then every keystroke is kept as a draft under the same
// key the classic editor uses, so a reload or a crash loses nothing and both editors see the same draft.

const draftKeyFor = uid => "pocket:note-draft" + (uid ? ":" + uid : "");
const readDraft = key => { try { return localStorage.getItem(key); } catch { return null; } };
const dropDraft = key => { try { localStorage.removeItem(key); } catch { /* storage blocked */ } };

let previewing = false; // kept across notes, like the classic editor

export function NoteEditor({ uid: initialUid, onCreated }) {
  const initial = initialUid ? notes.get(initialUid) : null;
  const uid = useRef(initialUid);
  const owner = useRef(activeAccount());
  const draftKey = useRef(draftKeyFor(initialUid));
  const draft = readDraft(draftKey.current);

  const [text, setText] = useState(() => draft ?? initial?.text ?? "");
  const [status, setStatus] = useState(draft != null ? "draft" : initial ? "saved" : "new");
  const [preview, setPreview] = useState(previewing && Boolean(initial)); // a new note always opens to type
  const [pinned, setPinned] = useState(Boolean(initial?.pinned));
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  const area = useRef(null);
  const latest = useRef(text);
  const saved = useRef(initial?.text || "");
  const seen = useRef(null);
  const timer = useRef(0);
  seen.current ??= initialSeen(initialUid, text);
  latest.current = text;

  const save = (finished = false) => {
    clearTimeout(timer.current);
    if (activeAccount() !== owner.current) return; // signed into another account since this opened
    if (uid.current && !notes.get(uid.current)) return; // deleted elsewhere
    const value = latest.current;
    try {
      if (!uid.current) {
        if (!value.trim()) return;
        uid.current = notes.create(value).uid;
        dropDraft(draftKey.current);
        draftKey.current = draftKeyFor(uid.current);
        onCreated(uid.current);
      } else if (saved.current !== value) notes.update(uid.current, value);
      saved.current = value;
      dropDraft(draftKey.current);
      const cursor = area.current ? value.slice(0, area.current.selectionStart).split("\n").length - 1 : -1;
      const result = parkFinished(uid.current, value, cursor, finished, seen.current);
      seen.current = result.seen;
      setStatus(result.parked ? (result.parked === 1 ? "saved · 1 thought parked" : `saved · ${result.parked} thoughts parked`) : "saved");
      setError("");
    } catch (failure) { setError(message(failure)); }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  // Closing the editor (another note, another route, the tab) saves what is there.
  useEffect(() => {
    const flush = () => saveRef.current(true);
    addEventListener("pagehide", flush);
    return () => { removeEventListener("pagehide", flush); flush(); };
  }, []);

  useEffect(() => { if (!preview) area.current?.focus({ preventScroll: true }); }, [preview]);

  const schedule = delay => { clearTimeout(timer.current); timer.current = setTimeout(() => saveRef.current(), delay); };
  const edit = value => {
    setText(value); latest.current = value; setStatus("…");
    try { localStorage.setItem(draftKey.current, value); } catch (failure) { setError(message(failure)); }
    schedule(600);
  };
  const togglePreview = () => { save(true); previewing = !preview; setPreview(!preview); };
  const togglePin = () => { save(true); if (!uid.current) return; try { notes.pin(uid.current, !pinned); setPinned(!pinned); } catch (failure) { setError(message(failure)); } };
  const remove = () => {
    if (uid.current) { try { notes.remove(uid.current); } catch (failure) { setError(message(failure)); return; } }
    dropDraft(draftKey.current); uid.current = null; latest.current = ""; navigate("notes");
  };

  if (initialUid && !initial) {
    return <main className="note"><p className="notice">This note was deleted.</p><a className="link" href={href("notes")}>‹ notes</a></main>;
  }

  return (
    <main className="note">
      <div className="editor-bar">
        <a className="link" href={href("notes")}>‹ notes</a>
        <span className="muted">{status}</span>
        <span className="spacer" />
        <button className="link" onClick={togglePreview}>{preview ? "edit" : "preview"}</button>
        <button className="link" onClick={togglePin} disabled={!uid.current}>{pinned ? "unpin" : "pin"}</button>
        {confirming
          ? <><button className="link danger" onClick={remove}>delete on all devices</button><button className="link" onClick={() => setConfirming(false)}>keep</button></>
          : <button className="link" onClick={() => { save(true); setConfirming(true); }}>delete</button>}
      </div>
      {error ? <p className="notice error" role="alert">{error}</p> : null}
      {preview
        ? <Markdown text={text} options={{ annotations: thoughtAnnotations(uid.current, text) }} className="prose note-preview" />
        : <textarea ref={area} className="note-text" value={text} maxLength={NOTE_LIMIT} spellCheck
            placeholder={"# Title\n\nWrite in Markdown…  >> a thought @tomorrow parks it"} aria-label="Note text"
            onChange={event => edit(event.target.value)}
            onKeyUp={event => { if (event.key === "Enter" || event.key.startsWith("Arrow")) schedule(150); }}
            onBlur={() => save(true)} />}
    </main>
  );
}
