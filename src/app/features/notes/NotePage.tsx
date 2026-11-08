import { useParams, useSearch } from "@tanstack/react-router";
import { NoteEditor } from "./NoteEditor.tsx";

/** /notes/<uid>; with ?fresh the note does not exist yet and the first save creates it under that uid. */
export function NotePage() {
  const { noteId } = useParams({ from: "/notes/$noteId" });
  const { fresh = false } = useSearch({ from: "/notes/$noteId" });
  return <NoteEditor key={noteId} uid={noteId} fresh={fresh} />;
}
