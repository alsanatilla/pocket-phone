import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
import { useCollection } from "../../data/bus.ts";
import { listNotes, noteExcerpt, noteTitle, searchNotes } from "../../data/notes.ts";
import { noteThoughts } from "../../data/thoughts.ts";
import type { Note } from "../../data/types.ts";
import { PageTitle } from "../../ui/PageTitle.tsx";
import { BARE_INPUT } from "../../ui/SendButton.tsx";
import { classicHref } from "../../lib/classic.ts";

// Notes: the list is for finding a note, not for reading it. Title first, then a line of it and the date, with parked
// thoughts kept to one quiet marker. Pinned notes get their own short group above the rest.

let lastQuery = ""; // the filter is still there when you come back

const shortDate = (at: number) => new Date(at).toLocaleDateString([], { day: "2-digit", month: "short" });

function ThoughtMark({ note }: { note: Note }) {
  const found = noteThoughts(note);
  if (!found.length) return null;
  return <span className="shrink-0 text-xs text-dim">» {found.length}</span>;
}

function Row({ note }: { note: Note }) {
  const excerpt = noteExcerpt(note);
  return <li className="border-t last:border-b">
    <Link to="/notes/$noteId" params={{ noteId: note.uid }} className="flex min-h-11 items-start gap-2.5 py-2 no-underline sm:min-h-0">
      <span className="min-w-0 flex-1">
        <span className="block break-words text-hi">{noteTitle(note)}</span>
        {excerpt ? <span className="mt-0.5 block truncate text-xs text-dim">{excerpt}</span> : null}
      </span>
      <span className="flex shrink-0 items-baseline gap-2 text-xs text-dim">
        <ThoughtMark note={note} />
        <span>{shortDate(note.updated)}</span>
      </span>
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
      ...(rest.length ? [["recent", rest] as [string, Note[]]] : []),
    ];
  }, [searching, shown]);

  const fresh = () => void navigate({ to: "/notes/$noteId", params: { noteId: crypto.randomUUID() }, search: { fresh: true } });

  return <main className="pb-4">
    <PageTitle title="notes" meta={`${all.length} notes`}>
      <button type="button" onClick={fresh} className="mb-1 flex min-h-11 items-center text-sm text-dim transition-colors hover:text-foreground sm:min-h-0">+ new</button>
    </PageTitle>

    {/* A prompt line for the filter, separated from the page by a hairline. */}
    <div className="mt-4 flex min-h-11 items-center gap-2 border-t sm:min-h-0">
      <span aria-hidden="true" className="text-dim">/</span>
      <Input type="search" value={query} placeholder="find in notes…" aria-label="Find in notes" className={BARE_INPUT}
        onChange={event => { lastQuery = event.target.value; setQuery(event.target.value); }} />
      {query ? <button type="button" onClick={() => { lastQuery = ""; setQuery(""); }}
        className="flex min-h-11 shrink-0 items-center text-xs text-dim transition-colors hover:text-foreground sm:min-h-0">
        clear
      </button> : null}
    </div>

    {groups.length ? groups.map(([title, notes]) => <section key={title} className="pt-[18px]">
      <div className="flex items-baseline justify-between pb-1">
        <h2 className="text-[10.5px] uppercase tracking-[0.06em] text-dim">{title}</h2>
        <span className="text-xs text-dim">{notes.length}</span>
      </div>
      <ul>{notes.map(note => <Row key={note.uid} note={note} />)}</ul>
    </section>) : <p className="pt-6 text-sm text-muted-foreground">
      {searching ? <>No note matches “{query.trim()}”. <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => { lastQuery = ""; setQuery(""); }}>clear the search</button></>
        : <>Nothing written yet. <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={fresh}>write the first note</button></>}
    </p>}

    <p className="pt-6 text-xs text-dim">Journal pages, history and recently deleted are still in the <a href={classicHref("/notes")} className="text-primary underline-offset-2 hover:underline">classic notes</a>.</p>
  </main>;
}
