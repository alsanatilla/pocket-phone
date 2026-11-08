import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useCollection } from "../../data/bus.ts";
import { listNotes, noteExcerpt, noteTitle, searchNotes } from "../../data/notes.ts";
import { noteThoughts, thoughtDone } from "../../data/thoughts.ts";
import type { Note } from "../../data/types.ts";
import styles from "./Notes.module.css";

let lastQuery = ""; // the filter is still there when you come back

const shortDate = (at: number) => new Date(at).toLocaleDateString([], { day: "2-digit", month: "short" });

function Chips({ note }: { note: Note }) {
  const found = noteThoughts(note);
  if (!found.length) return null;
  return (
    <span className={styles.chips}>
      {found.slice(0, 3).map((item, index) => (
        <span key={index} title={item.state}
          className={styles.chip + (thoughtDone(item.state) ? " " + styles.done : item.state === "ready to revisit" ? " " + styles.back : "")}>» {item.text}</span>
      ))}
      {found.length > 3 ? <span className={styles.chip}>+{found.length - 3} more</span> : null}
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
    <main>
      <div className={styles.head}>
        <h1>notes</h1>
        <span className={styles.muted}>{all.length} notes</span>
        <button className={styles.button}
          onClick={() => void navigate({ to: "/notes/$noteId", params: { noteId: crypto.randomUUID() }, search: { fresh: true } })}>+ new note</button>
      </div>
      <input className={styles.search} type="search" value={query} placeholder="find in notes…" aria-label="Find in notes"
        onChange={event => { lastQuery = event.target.value; setQuery(event.target.value); }} />
      <div className={styles.rows}>
        {shown.length ? shown.map(note => {
          const excerpt = noteExcerpt(note);
          return (
            <Link key={note.uid} to="/notes/$noteId" params={{ noteId: note.uid }} className={styles.row}>
              <span className={styles.rowTitle}>{note.pinned ? <span className={styles.pin}>pinned</span> : null}{noteTitle(note)}</span>
              <span className={styles.rowSub}>{shortDate(note.updated)}{excerpt ? " · " + excerpt : ""}</span>
              <Chips note={note} />
            </Link>
          );
        }) : <p className={styles.muted}>{query.trim() ? "No note matches." : "No notes yet."}</p>}
      </div>
      <p className={styles.aside}>Journal pages, history and recently deleted are still in the <a href="/#/notes">classic notes</a>.</p>
    </main>
  );
}
