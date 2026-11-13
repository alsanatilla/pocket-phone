import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Row, Section } from "../../ui/kit.tsx";
import { useCollection } from "../../data/bus.ts";
import { listNotes, noteExcerpt, noteTitle, searchNotes } from "../../data/notes.ts";
import { noteThoughts } from "../../data/thoughts.ts";
import type { Note } from "../../data/types.ts";
import { PageTitle } from "../../ui/PageTitle.tsx";
import { BARE_INPUT } from "../../ui/SendButton.tsx";
import { classicHref } from "../../lib/classic.ts";
import { dateAt } from "@/lib/utils";

// Notes: the list is for finding a note, not for reading it. Title first, then a line of it and the date, with parked
// thoughts kept to one quiet marker. Pinned notes get their own short group above the rest.

let lastQuery = ""; // the filter is still there when you come back


function ThoughtMark({ note }: { note: Note }) {
  const found = noteThoughts(note);
  if (!found.length) return null;
  return <span className="shrink-0 text-xs text-dim">» {found.length}</span>;
}

function NoteRow({ note }: { note: Note }) {
  const excerpt = noteExcerpt(note);
  return <li>
    <Row href={"#/notes/" + note.uid} arrow={false} sub={excerpt || undefined}
      end={<><ThoughtMark note={note} /><span>{dateAt(note.updated)}</span></>}>
      {noteTitle(note)}
    </Row>
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
      <Button type="button" onClick={fresh} className="mb-1">+ new</Button>
    </PageTitle>

    {/* A prompt line for the filter: a field inside the page has no line of its own (docs/DESIGN.md 11). */}
    <div className="mt-4 flex min-h-11 items-center gap-2 sm:min-h-0">
      <span aria-hidden="true" className="text-dim">/</span>
      <Input type="search" value={query} placeholder="find in notes…" aria-label="Find in notes" className={BARE_INPUT}
        onChange={event => { lastQuery = event.target.value; setQuery(event.target.value); }} />
      {query ? <Button type="button" onClick={() => { lastQuery = ""; setQuery(""); }}>clear</Button> : null}
    </div>

    {groups.length ? groups.map(([title, notes], index) => <Section key={title} label={<span role="heading" aria-level={2}>{title}</span>} count={notes.length} className={index ? undefined : "mt-6"}>
      <ul>{notes.map(note => <NoteRow key={note.uid} note={note} />)}</ul>
    </Section>) : <p className="pt-6 text-sm text-muted-foreground">
      {searching ? <>No note matches “{query.trim()}”. <Button type="button" variant="link" onClick={() => { lastQuery = ""; setQuery(""); }}>clear the search</Button></>
        : <>Nothing written yet. <Button type="button" variant="link" onClick={fresh}>write the first note</Button></>}
    </p>}

    <p className="pt-6 text-xs text-dim">Journal pages, history and recently deleted are still in the <a href={classicHref("/notes")} className="text-primary underline underline-offset-2">classic notes</a>.</p>
  </main>;
}
