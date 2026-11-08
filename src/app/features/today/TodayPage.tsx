import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import type { Brief } from "../../../client/daily-brief.js";
import { useCollection } from "../../data/bus.ts";
import { completeTask, daySummary, listTasks, today } from "../../data/tasks.ts";
import { openThoughts, parkThoughtText } from "../../data/thoughts.ts";
import { listNotes } from "../../data/notes.ts";
import { withContext } from "../../data/chats.ts";
import { Composer } from "../../ui/Composer.tsx";
import { toast, toastError } from "../../ui/toast/toast.ts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageTitle } from "../../ui/PageTitle.tsx";

// Today: the date and where the day stands, one field to keep a thought or ask Pip, Pip's read of the day,
// and what is due.

/** The daily brief is optional; its module loads after first paint, not in this route's chunk. */
function useBrief(): Brief | null {
  const [brief, setBrief] = useState<Brief | null>(null);
  useEffect(() => {
    let live = true;
    import("../../../client/daily-brief.js")
      .then(module => { if (live && module.briefEnabled()) setBrief(module.readBrief()); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return brief;
}

export function TodayPage() {
  const navigate = useNavigate();
  const brief = useBrief();
  const day = today();
  const { open, due, done } = useCollection(["tasks.json"], () => daySummary(listTasks(), day), [day]);
  const parked = useCollection(["parking.json"], () => openThoughts().length);
  const noteCount = useCollection(["notes.json"], () => listNotes().length);

  const keep = (text: string) => { parkThoughtText(text); toast("Kept."); };
  const ask = (text: string) => {
    const chat = withContext({ kind: "today", uid: day, title: "Today", text, href: "/today" });
    void navigate({ to: "/pip", search: { chat } });
  };

  return (
    <main className="space-y-4">
      <PageTitle title={new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })}
        meta={`${open.length} open · ${due.length} due today · ${done} done`} />

      <Composer label="Capture a thought or ask Pip" placeholder="capture a thought, or ask pip…" action="keep" onSubmit={keep}
        secondary={{ label: "ask pip", run: ask }} />

      {brief?.facts.length ? (
        <Card>
          <CardHeader><CardTitle className="text-xs tracking-widest text-primary">pip · today</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">{brief.facts.slice(0, 3).map((fact, index) => <p key={index}>{fact.text}</p>)}</CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle className="text-xs tracking-widest text-primary">today · {due.length}</CardTitle></CardHeader>
        <CardContent>
          {due.length ? due.slice(0, 6).map(task => (
            <div key={task.uid} className="flex items-start gap-3 border-t border-dashed py-2.5 first:border-t-0">
              <button aria-label={"Complete " + task.text} className="-mt-1.5 size-11 shrink-0 rounded-sm border hover:border-primary"
                onClick={() => { try { completeTask(task.uid); } catch (error) { toastError(error); } }} />
              <div>
                <p>{task.text}</p>
                <p className="text-xs text-dim">{task.due}{task.important ? " · important" : ""}</p>
              </div>
            </div>
          )) : <p className="text-sm text-muted-foreground">Nothing due today.</p>}
        </CardContent>
      </Card>

      <footer className="flex gap-4 pt-2 text-xs text-dim">
        {parked ? <span>{parked} parked thoughts</span> : null}
        <Link to="/notes" className="text-muted-foreground">{noteCount} notes</Link>
      </footer>
    </main>
  );
}
