import { useState, type KeyboardEvent, type SyntheticEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { NOTE_LIMIT } from "../../data/notes.ts";
import { thoughtAnnotations } from "../../data/thoughts.ts";
import { Markdown } from "../../ui/Markdown.tsx";
import { confirm } from "../../ui/dialog/dialog.ts";
import { toastError } from "../../ui/toast/toast.ts";
import { useNoteEditor } from "./useNoteEditor.ts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

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
    return <main className="space-y-2 pt-4"><p className="text-sm text-muted-foreground">This note was deleted.</p><Link to="/notes" className="text-sm text-primary">‹ notes</Link></main>;
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
      <div className="sticky top-[60px] z-[5] flex flex-wrap items-center gap-1 bg-background py-1">
        <Button asChild variant="link" className="px-0"><Link to="/notes">‹ notes</Link></Button>
        <span className="ml-3 text-sm text-muted-foreground" aria-live="polite">{status}</span>
        <span className="flex-1" />
        <Button variant="ghost" onClick={togglePreview}>{preview ? "edit" : "preview"}</Button>
        <Button variant="ghost" onClick={note.togglePin} disabled={!note.stored}>{note.pinned ? "unpin" : "pin"}</Button>
        <Button variant="ghost" onClick={remove}>delete</Button>
      </div>
      {note.error ? <p role="alert" className="text-sm text-destructive">{note.error}</p> : null}
      {preview
        ? <Markdown text={note.text} options={{ annotations: thoughtAnnotations(note.stored ? uid : null, note.text) }} className="prose min-h-[40vh] rounded-md border p-4" />
        : <Textarea value={note.text} maxLength={NOTE_LIMIT} spellCheck autoFocus aria-label="Note text"
            placeholder={"# Title\n\nWrite in Markdown…  >> a thought @tomorrow parks it"}
            className="min-h-[65vh] resize-y bg-card p-4 text-[15px] leading-relaxed"
            onChange={event => note.edit(event.target.value, cursorLine(event))}
            onKeyUp={onKeyUp} onBlur={note.flush} />}
    </main>
  );
}
