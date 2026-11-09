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

// One note: the page is the page. One bar for where you are and what you can do with it, then the text at a
// comfortable measure — editing and previewing share the same surface, so switching does not move the words.

let previewing = false; // kept across notes for this visit, like the classic editor

const cursorLine = (event: SyntheticEvent<HTMLTextAreaElement>) => {
  const area = event.currentTarget;
  return area.value.slice(0, area.selectionStart).split("\n").length - 1;
};

const STATUS = { new: "new", draft: "draft", saving: "saving…", saved: "saved" } as const;

export function NoteEditor({ uid, fresh }: { uid: string; fresh: boolean }) {
  const navigate = useNavigate();
  const note = useNoteEditor(uid, fresh);
  // A new note always opens to type.
  const [preview, setPreview] = useState(previewing && note.stored);

  if (!note.exists) {
    return <main className="pt-4">
      <button type="button" onClick={() => void navigate({ to: "/notes" })} className="text-sm text-muted-foreground hover:text-foreground">‹ notes</button>
      <p className="mt-6 text-sm text-muted-foreground">This note was deleted.</p>
    </main>;
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
  const status = STATUS[note.status];
  const parked = note.parked ? `${note.parked} thought${note.parked === 1 ? "" : "s"} parked` : "";

  return (
    <main className="pb-4">
      <div className="sticky top-[60px] z-[5] -mx-1 flex flex-wrap items-center gap-1 bg-background/95 py-1 backdrop-blur">
        <Link to="/notes" className="px-1 py-2 text-sm text-muted-foreground no-underline hover:text-foreground">‹ notes</Link>
        <span className="ml-2 text-[10px] uppercase tracking-[0.08em] text-dim" aria-live="polite">{status}{parked ? " · " + parked : ""}</span>
        <span className="flex-1" />
        <Button variant="outline" className="h-10" onClick={togglePreview}>{preview ? "edit" : "preview"}</Button>
        <Button variant="ghost" className="h-10" onClick={note.togglePin} disabled={!note.stored}>{note.pinned ? "unpin" : "pin"}</Button>
        <Button variant="ghost" className="h-10 text-destructive" onClick={() => void remove()}>delete</Button>
      </div>

      {note.error ? <p role="alert" className="mt-2 text-sm text-destructive">{note.error}</p> : null}

      {preview
        ? <Markdown text={note.text} options={{ annotations: thoughtAnnotations(note.stored ? uid : null, note.text) }}
            className="prose mt-2 min-h-[40vh] rounded-md border bg-card p-4" />
        : <Textarea value={note.text} maxLength={NOTE_LIMIT} spellCheck autoFocus aria-label="Note text"
            placeholder={"# Title\n\nWrite in Markdown…  >> a thought @tomorrow parks it"}
            className="mt-2 min-h-[65vh] resize-y rounded-md border bg-card p-4 text-[15px] leading-relaxed"
            onChange={event => note.edit(event.target.value, cursorLine(event))}
            onKeyUp={onKeyUp} onBlur={note.flush} />}
    </main>
  );
}
