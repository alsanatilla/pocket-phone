import { useState } from "react";
import { NoteList } from "./NoteList.jsx";
import { NoteEditor } from "./NoteEditor.jsx";

// #/notes is the list, #/notes/new a new note, #/notes/<uid> one note.
// A new note gets its uid on the first save; the URL then changes to that uid without remounting the editor,
// so the cursor and the text being typed stay where they are.

export default function NotesView({ route }) {
  const open = route.rest[0] || null;
  const [session, setSession] = useState({ key: open, uid: open });
  if (open !== session.uid) setSession({ key: open, uid: open });

  if (!open) return <NoteList />;
  const isNew = session.key === "new";
  return (
    <NoteEditor key={session.key} uid={isNew ? null : session.key}
      onCreated={uid => {
        setSession(current => ({ ...current, uid }));
        history.replaceState(null, "", "#/notes/" + uid);
      }} />
  );
}
