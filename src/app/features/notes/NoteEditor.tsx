import { useState, type KeyboardEvent, type SyntheticEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { NOTE_LIMIT } from "../../data/notes.ts";
import { thoughtAnnotations } from "../../data/thoughts.ts";
import { Markdown } from "../../ui/Markdown.tsx";
import { confirm } from "../../ui/dialog/dialog.ts";
import { toastError } from "../../ui/toast/toast.ts";
import { useNoteEditor } from "./useNoteEditor.ts";
import styles from "./Notes.module.css";

let previewing = false; // kept across notes for this visit, like the classic editor

const cursorLine = (event: SyntheticEvent<HTMLTextAreaElement>) => {
  const area = event.currentTarget;
  return area.value.slice(0, area.selectionStart).split("\n").length - 1;
};

const STATUS = { new: "new", draft: "draft", saving: "…", saved: "saved" } as const;

export function NoteEditor({ uid, fresh }: { uid: string; fresh: boolean }) {
  const navigate = useNavigate();
  const note = useNoteEditor(uid, fresh);
  // A new note always opens to type.
  const [preview, setPreview] = useState(previewing && note.stored);

  if (!note.exists) {
    return <main><p className={styles.muted}>This note was deleted.</p><Link to="/notes" className={styles.link}>‹ notes</Link></main>;
  }

  const togglePreview = () => { note.flush(); previewing = !preview; setPreview(!preview); };
  const remove = async () => {
    note.flush();
    if (!await confirm({ title: "Delete this note on all devices?", confirmLabel: "delete", danger: true })) return;
    try { note.remove(); void navigate({ to: "/notes" }); } catch (error) { toastError(error); }
  };
  const onKeyUp = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" || event.key.startsWith("Arrow")) note.nudge(cursorLine(event));
  };
  const status = STATUS[note.status] + (note.parked ? ` · ${note.parked} thought${note.parked === 1 ? "" : "s"} parked` : "");

  return (
    <main>
      <div className={styles.editorBar}>
        <Link to="/notes" className={styles.link}>‹ notes</Link>
        <span className={styles.muted} aria-live="polite">{status}</span>
        <span className={styles.spacer} />
        <button className={styles.link} onClick={togglePreview}>{preview ? "edit" : "preview"}</button>
        <button className={styles.link} onClick={note.togglePin} disabled={!note.stored}>{note.pinned ? "unpin" : "pin"}</button>
        <button className={styles.link} onClick={remove}>delete</button>
      </div>
      {note.error ? <p className={styles.error} role="alert">{note.error}</p> : null}
      {preview
        ? <Markdown text={note.text} options={{ annotations: thoughtAnnotations(note.stored ? uid : null, note.text) }} className={"prose " + styles.preview} />
        : <textarea className={styles.text} value={note.text} maxLength={NOTE_LIMIT} spellCheck autoFocus aria-label="Note text"
            placeholder={"# Title\n\nWrite in Markdown…  >> a thought @tomorrow parks it"}
            onChange={event => note.edit(event.target.value, cursorLine(event))}
            onKeyUp={onKeyUp} onBlur={note.flush} />}
    </main>
  );
}
