import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Eye, PenLine, Pin, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { NOTE_LIMIT } from "../../data/notes.ts";
import { thoughtAnnotations } from "../../data/thoughts.ts";
import { Markdown } from "../../ui/Markdown.tsx";
import { confirm } from "../../ui/dialog/dialog.ts";
import { toastError } from "../../ui/toast/toast.ts";
import { NoteText } from "./NoteText.tsx";
import { useNoteEditor } from "./useNoteEditor.ts";
import { Button } from "@/components/ui/button";

// One note: the page is the page, as in Obsidian. No box around the words: a quiet bar, then the text, both in the
// same reading column, so nothing sits off to one side. Editing and previewing share that column, so ⌘E never moves
// a line.

let previewing = false; // kept across notes for this visit, like the classic editor

const STATUS = { new: "new", draft: "draft", saving: "saving…", saved: "saved" } as const;

export function NoteEditor({ uid, fresh }: { uid: string; fresh: boolean }) {
  const navigate = useNavigate();
  const note = useNoteEditor(uid, fresh);
  // A new note always opens to type.
  const [preview, setPreview] = useState(previewing && note.stored);
  const toggle = useRef(() => {});

  // ⌘E / Ctrl+E toggles preview, the one shortcut a writing surface needs.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "e") { event.preventDefault(); toggle.current(); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  if (!note.exists) {
    return <main className="pt-4">
      <button type="button" onClick={() => void navigate({ to: "/notes" })} className="text-sm text-muted-foreground hover:text-foreground">‹ notes</button>
      <p className="mt-6 text-sm text-muted-foreground">This note was deleted.</p>
    </main>;
  }

  toggle.current = () => { note.flush(); previewing = !previewing; setPreview(previewing); };
  const remove = async () => {
    note.flush();
    if (!await confirm({ title: "Delete this note on all devices?", confirmLabel: "delete", danger: true })) return;
    try { note.remove(); void navigate({ to: "/notes" }); } catch (error) { toastError(error); }
  };
  const status = STATUS[note.status];
  const parked = note.parked ? `${note.parked} thought${note.parked === 1 ? "" : "s"} parked` : "";
  const dot = note.error ? "bg-destructive" : note.status === "saving" ? "bg-primary animate-pulse" : note.status === "draft" ? "bg-muted-foreground" : "bg-movement";

  return (
    <main className="mx-auto w-full max-w-[66ch] pb-16">
      <div className="sticky top-[60px] z-[5] flex items-center gap-1 bg-background py-2">
        <Link to="/notes" className="-ml-1 px-1 py-2 text-sm text-muted-foreground no-underline hover:text-foreground">‹ notes</Link>
        <span className="ml-2 flex items-center gap-1.5 text-xs text-dim" aria-live="polite">
          <span aria-hidden="true" className={cn("size-1.5 rounded-full", dot)} />
          {status}{parked ? " · " + parked : ""}
        </span>
        <span className="flex-1" />
        <Button variant="ghost" size="icon" className="size-9" onClick={() => toggle.current()} aria-label={preview ? "Edit note" : "Preview note"} title={preview ? "Edit (⌘E)" : "Preview (⌘E)"}>
          {preview ? <PenLine className="size-4" /> : <Eye className="size-4" />}
        </Button>
        <Button variant="ghost" size="icon" className="size-9" onClick={note.togglePin} disabled={!note.stored} aria-label={note.pinned ? "Unpin note" : "Pin note"} aria-pressed={note.pinned}><Pin className={cn("size-4", note.pinned && "text-primary")} /></Button>
        <Button variant="ghost" size="icon" className="-mr-2 size-9 text-muted-foreground hover:text-destructive" onClick={() => void remove()} aria-label="Delete note"><Trash2 className="size-4" /></Button>
      </div>

      {note.error ? <p role="alert" className="mt-2 text-sm text-destructive">{note.error}</p> : null}

      <div className="mt-6">
        {preview
          ? <Markdown text={note.text} options={{ annotations: thoughtAnnotations(note.stored ? uid : null, note.text) }} className="note-prose min-h-[50vh]" />
          : <NoteText value={note.text} autoFocus startAt={fresh ? "start" : "end"} onChange={note.edit} onNudge={note.nudge} onBlur={note.flush} />}
      </div>

      {!note.text.trim() && !preview
        ? <p className="mt-6 text-xs text-dim"># makes a heading · » at the start of a line parks a thought · saved as you type · ⌘E previews</p>
        : null}
    </main>
  );
}
