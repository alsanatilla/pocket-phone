import { useState } from "react";
import { notes, noteTitle, thought } from "../../../client/store.js";
import { noteProseLines } from "../../../shared/note-lines.js";
import { useStore } from "../../lib/useStore.js";
import { href } from "../../router.js";
import { noteThoughts } from "./thoughts.js";

// Survives leaving the route, like the classic list: come back and the same filter is still there.
let lastQuery = "";

const shortDate = at => new Date(at).toLocaleDateString([], { day: "2-digit", month: "short" });

/** The second and later prose lines, without Markdown markers or thought lines. */
function excerpt(note) {
  return noteProseLines(note.text).map(item => item.line).filter(line => line.trim()).slice(1)
    .filter(line => !thought(line))
    .map(line => line.replace(/^\s*(#+|>|[-*+]\s+(\[[ xX]\]\s*)?|\d+[.)])\s*/, ""))
    .join(" ").slice(0, 60);
}

function Chips({ note }) {
  const found = noteThoughts(note);
  if (!found.length) return null;
  return (
    <span className="chips">
      {found.slice(0, 3).map((item, index) => {
        const done = /cleared|let go|made into a task/.test(item.state);
        return <span key={index} className={"chip" + (done ? " done" : item.state === "ready to revisit" ? " back" : "")} title={item.state}>» {item.text}</span>;
      })}
      {found.length > 3 ? <span className="chip more">+{found.length - 3} more</span> : null}
    </span>
  );
}

export function NoteList() {
  const [query, setQuery] = useState(lastQuery);
  // Chips show Parking state, so the list also follows parking.json.
  const all = useStore(["notes.json", "parking.json"], () => notes.list());
  const q = query.trim().toLowerCase();
  const shown = q ? all.filter(note => note.text.toLowerCase().includes(q)) : all;

  return (
    <main className="notes">
      <div className="head">
        <h1>notes</h1>
        <span className="muted">{all.length} notes</span>
        <a className="button" href={href("notes/new")}>+ new note</a>
      </div>
      <input className="search" type="search" value={query} placeholder="find in notes…" aria-label="Find in notes"
        onChange={event => { lastQuery = event.target.value; setQuery(event.target.value); }} />
      <div className="rows">
        {shown.length ? shown.map(note => (
          <a key={note.uid} className="row" href={href("notes/" + note.uid)}>
            <span className="row-title">{note.pinned ? <span className="pin">pinned</span> : null}{noteTitle(note)}</span>
            <span className="row-sub">{shortDate(note.updated)}{excerpt(note) ? " · " + excerpt(note) : ""}</span>
            <Chips note={note} />
          </a>
        )) : <p className="muted">{q ? "No note matches." : "No notes yet."}</p>}
      </div>
      <p className="aside">Journal pages, history and recently deleted are still in the <a href="/#/notes">classic notes</a>.</p>
    </main>
  );
}
