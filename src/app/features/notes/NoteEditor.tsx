import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Pin, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { NOTE_LIMIT } from "../../data/notes.ts";
import { thoughtAnnotations } from "../../data/thoughts.ts";
import { Markdown } from "../../ui/Markdown.tsx";
import { confirm } from "../../ui/dialog/dialog.ts";
import { toastError } from "../../ui/toast/toast.ts";
import { NoteText } from "./NoteText.tsx";
import { useNoteEditor } from "./useNoteEditor.ts";
import { Button } from "@/components/ui/button";

// One note: the page is the page. A quiet bar for where you are and what you can do with it, then the words in one
// reading column. Editing and previewing share that measure, so ⌘E never moves a line.

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
    <main className="pb-4">
      <div className="sticky top-[60px] z-[5] -mx-1 flex flex-wrap items-center gap-1 bg-background/95 py-1 backdrop-blur">
        <Link to="/notes" className="px-1 py-2 text-sm text-muted-foreground no-underline hover:text-foreground">‹ notes</Link>
        <span className="ml-2 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.08em] text-dim" aria-live="polite">
          <span aria-hidden="true" className={cn("size-1.5 rounded-full", dot)} />
          {status}{parked ? " · " + parked : ""}
        </span>
        <span className="flex-1" />
        <Button variant="outline" className="h-10" onClick={() => toggle.current()}>{preview ? "edit" : "preview"}</Button>
        <Button variant="ghost" size="icon" className="size-10" onClick={note.togglePin} disabled={!note.stored} aria-label={note.pinned ? "Unpin note" : "Pin note"} aria-pressed={note.pinned}><Pin className={cn("size-4", note.pinned && "text-primary")} /></Button>
        <Button variant="ghost" size="icon" className="size-10 text-destructive" onClick={() => void remove()} aria-label="Delete note"><Trash2 className="size-4" /></Button>
      </div>

      {note.error ? <p role="alert" className="mt-2 text-sm text-destructive">{note.error}</p> : null}

      <div className="group mt-2 rounded-md border bg-card transition-colors focus-within:border-primary/60">
        {preview
          ? <Markdown text={note.text} options={{ annotations: thoughtAnnotations(note.stored ? uid : null, note.text) }}
              className="note-prose min-h-[40vh] px-4 py-6" />
          : <div className="mx-auto w-full max-w-[62ch] px-4 py-6">
              <NoteText value={note.text} autoFocus startAt={fresh ? "start" : "end"}
                onChange={note.edit} onNudge={note.nudge} onBlur={note.flush} />
            </div>}
      </div>

      <p className="mx-auto mt-2 max-w-[62ch] px-4 text-[11px] text-dim">» at the start of a line parks a thought · # makes a heading · saved as you type · ⌘E previews</p>
    </main>
  );
}
