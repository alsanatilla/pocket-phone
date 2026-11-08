import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCollection } from "../../data/bus.ts";
import { listNotes, noteExcerpt, noteTitle, searchNotes } from "../../data/notes.ts";
import { noteThoughts, thoughtDone } from "../../data/thoughts.ts";
import type { Note } from "../../data/types.ts";
import { PageTitle } from "../../ui/PageTitle.tsx";

let lastQuery = ""; // the filter is still there when you come back

const shortDate = (at: number) => new Date(at).toLocaleDateString([], { day: "2-digit", month: "short" });

function Chips({ note }: { note: Note }) {
  const found = noteThoughts(note);
  if (!found.length) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1.5">
      {found.slice(0, 3).map((item, index) => (
        <Badge key={index} title={item.state} variant="outline"
          className={cn("font-normal text-muted-foreground", thoughtDone(item.state) && "text-dim line-through", item.state === "ready to revisit" && "border-primary text-primary")}>
          » {item.text}
        </Badge>
      ))}
      {found.length > 3 ? <Badge variant="outline" className="font-normal">+{found.length - 3} more</Badge> : null}
    </span>
  );
}

export function NotesPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState(lastQuery);
  // Chips show Parking state, so the list follows parking.json too.
  const all = useCollection(["notes.json", "parking.json"], listNotes);
  const shown = searchNotes(all, query);

  return (
    <main className="space-y-3">
      <PageTitle title="notes" meta={`${all.length} notes`}>
        <Button variant="outline" size="lg"
          onClick={() => void navigate({ to: "/notes/$noteId", params: { noteId: crypto.randomUUID() }, search: { fresh: true } })}>+ new note</Button>
      </PageTitle>
      <Input type="search" value={query} placeholder="find in notes…" aria-label="Find in notes" className="h-11"
        onChange={event => { lastQuery = event.target.value; setQuery(event.target.value); }} />
      <div className="flex flex-col">
        {shown.length ? shown.map(note => {
          const excerpt = noteExcerpt(note);
          return (
            <Link key={note.uid} to="/notes/$noteId" params={{ noteId: note.uid }}
              className="group flex min-h-11 flex-col gap-0.5 border-t border-dashed py-3 no-underline">
              <span className="group-hover:text-primary">
                {note.pinned ? <span className="mr-2 text-[11px] text-primary">pinned</span> : null}{noteTitle(note)}
              </span>
              <span className="truncate text-xs text-dim">{shortDate(note.updated)}{excerpt ? " · " + excerpt : ""}</span>
              <Chips note={note} />
            </Link>
          );
        }) : <p className="text-sm text-muted-foreground">{query.trim() ? "No note matches." : "No notes yet."}</p>}
      </div>
      <p className="pt-4 text-xs text-dim">Journal pages, history and recently deleted are still in the <a href="/#/notes" className="text-muted-foreground">classic notes</a>.</p>
    </main>
  );
}
