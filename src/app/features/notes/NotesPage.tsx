import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCollection } from "../../data/bus.ts";
import { listNotes, noteExcerpt, noteTitle, searchNotes } from "../../data/notes.ts";
import { noteThoughts, thoughtDone } from "../../data/thoughts.ts";
import type { Note } from "../../data/types.ts";
import { PageTitle } from "../../ui/PageTitle.tsx";
import { classicHref } from "../../lib/classic.ts";

// Notes: the list is for finding a note, not for reading it. Title first, then when and a line of it, with parked
// thoughts kept to one quiet marker. Pinned notes get their own short group above the rest.

let lastQuery = ""; // the filter is still there when you come back

const shortDate = (at: number) => new Date(at).toLocaleDateString([], { day: "2-digit", month: "short" });

function ThoughtMark({ note }: { note: Note }) {
  const found = noteThoughts(note);
  if (!found.length) return null;
  const ready = found.filter(item => !thoughtDone(item.state)).length;
  return <span className={cn("shrink-0 text-[11px]", ready ? "text-primary" : "text-dim")}>» {found.length}</span>;
}

function Row({ note }: { note: Note }) {
  const excerpt = noteExcerpt(note);
  return <li className="border-t border-dashed">
    <Link to="/notes/$noteId" params={{ noteId: note.uid }} className="group flex min-h-11 items-start gap-3 py-3 no-underline">
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          {note.pinned ? <span role="img" aria-label="Pinned" className="mt-0.5 size-1.5 shrink-0 rounded-full bg-primary" /> : null}
          <span className="break-words group-hover:text-primary">{noteTitle(note)}</span>
        </span>
        <span className="mt-1 block truncate text-[11px] leading-tight text-dim">{shortDate(note.updated)}{excerpt ? " · " + excerpt : ""}</span>
      </span>
      <ThoughtMark note={note} />
    </Link>
  </li>;
}

export function NotesPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState(lastQuery);
  // Chips show Parking state, so the list follows parking.json too.
  const all = useCollection(["notes.json", "parking.json"], listNotes);
  const shown = searchNotes(all, query);
  const searching = Boolean(query.trim());
  const groups = useMemo(() => {
    if (searching) return shown.length ? [["results", shown] as [string, Note[]]] : [];
    const pinned = shown.filter(note => note.pinned);
    const rest = shown.filter(note => !note.pinned);
    return [
      ...(pinned.length ? [["pinned", pinned] as [string, Note[]]] : []),
      ...(rest.length ? [[pinned.length ? "recent" : "notes", rest] as [string, Note[]]] : []),
    ];
  }, [searching, shown]);

  return <main className="pb-4">
    <PageTitle title="notes" meta={`${all.length} notes`}>
      <Button variant="outline" className="h-10"
        onClick={() => void navigate({ to: "/notes/$noteId", params: { noteId: crypto.randomUUID() }, search: { fresh: true } })}>+ new note</Button>
    </PageTitle>

    <div className="relative mt-4">
      <Input type="search" value={query} placeholder="find in notes…" aria-label="Find in notes" className="h-11 pr-11"
        onChange={event => { lastQuery = event.target.value; setQuery(event.target.value); }} />
      {query ? <button type="button" aria-label="Clear the search" onClick={() => { lastQuery = ""; setQuery(""); }}
        className="absolute top-1/2 right-0 grid size-11 -translate-y-1/2 place-items-center text-muted-foreground hover:text-foreground">
        <X className="size-4" />
      </button> : null}
    </div>

    {groups.length ? groups.map(([title, notes]) => <section key={title} className="pt-6 first:pt-3">
      <div className="flex items-baseline justify-between pb-1">
        <h2 className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{title}</h2>
        <span className="text-[11px] text-dim">{notes.length}</span>
      </div>
      <ul className="flex flex-col">{notes.map(note => <Row key={note.uid} note={note} />)}</ul>
    </section>) : <p className="pt-8 text-sm text-muted-foreground">
      {searching ? <>No note matches “{query.trim()}”. <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => { lastQuery = ""; setQuery(""); }}>clear the search</button></>
        : <>Nothing written yet. <button type="button" className="text-primary underline-offset-2 hover:underline"
          onClick={() => void navigate({ to: "/notes/$noteId", params: { noteId: crypto.randomUUID() }, search: { fresh: true } })}>write the first note</button></>}
    </p>}

    <p className="pt-8 text-[11px] text-dim">Journal pages, history and recently deleted are still in the <a href={classicHref("/notes")} className="text-muted-foreground underline-offset-2 hover:underline">classic notes</a>.</p>
  </main>;
}
