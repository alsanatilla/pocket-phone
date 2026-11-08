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
import styles from "./Today.module.css";

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
    <main>
      <div className={styles.status}>
        <h1>{new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })}</h1>
        <p>{open.length} open · {due.length} due today · {done} done</p>
      </div>

      <Composer label="Capture a thought or ask Pip" placeholder="capture a thought, or ask pip…" action="keep" onSubmit={keep}
        secondary={{ label: "ask pip", run: ask }} />

      {brief?.facts.length ? (
        <article className={styles.card}>
          <h2>pip · today</h2>
          {brief.facts.slice(0, 3).map((fact, index) => <p key={index}>{fact.text}</p>)}
        </article>
      ) : null}

      <article className={styles.card}>
        <h2>today · {due.length}</h2>
        {due.length ? due.slice(0, 6).map(task => (
          <div className={styles.task} key={task.uid}>
            <button className={styles.check} aria-label={"Complete " + task.text}
              onClick={() => { try { completeTask(task.uid); } catch (error) { toastError(error); } }} />
            <div>
              <p className={styles.taskText}>{task.text}</p>
              <p className={styles.taskMeta}>{task.due}{task.important ? " · important" : ""}</p>
            </div>
          </div>
        )) : <p className={styles.muted}>Nothing due today.</p>}
      </article>

      <footer className={styles.quiet}>
        {parked ? <span>{parked} parked thoughts</span> : null}
        <Link to="/notes">{noteCount} notes</Link>
      </footer>
    </main>
  );
}
