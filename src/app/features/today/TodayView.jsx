import { useEffect, useState } from "react";
import { tasks, parking, taskDay, notes } from "../../../client/store.js";
import { useStore } from "../../lib/useStore.js";
import { dayTitle } from "../../lib/format.js";
import { Composer } from "../../ui/Composer.jsx";
import { href } from "../../router.js";

// Today: one status line, one capture field, Pip's facts, what is due. Reads the same stores the classic app
// writes, so nothing has to migrate for this route to be useful.

function useBrief() {
  const [brief, setBrief] = useState(null);
  // Optional strip: its module loads after first paint, not in the route's chunk.
  useEffect(() => {
    let live = true;
    import("../../../client/daily-brief.js")
      .then(module => { if (live && module.briefEnabled()) setBrief(module.readBrief()); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return brief;
}

export default function TodayView() {
  const brief = useBrief();
  const { open, due, done } = useStore(["tasks.json"], () => {
    const all = tasks.list(), today = taskDay();
    const openTasks = all.filter(task => !task.done);
    return { open: openTasks, due: openTasks.filter(task => task.due && task.due <= today), done: all.length - openTasks.length };
  });
  const parked = useStore(["parking.json"], () => parking.open().length);
  const noteCount = useStore(["notes.json"], () => notes.list().length);

  return (
    <main className="today">
      <div className="status">
        <h1>{dayTitle()}</h1>
        <p>{open.length} open · {due.length} due today · {done} done</p>
      </div>

      <Composer placeholder="capture a thought…" label="Capture a thought" action="keep" onSubmit={text => { parking.park(text); }} />

      {brief?.facts?.length ? (
        <article className="card">
          <h2>pip · today</h2>
          {brief.facts.slice(0, 3).map((fact, index) => <p key={index}>{fact.text}</p>)}
        </article>
      ) : null}

      <article className="card">
        <h2>today · {due.length}</h2>
        {due.length ? due.slice(0, 6).map(task => (
          <div className="task" key={task.uid}>
            <button className="check" aria-label={"Complete " + task.text}
              onClick={() => { try { tasks.complete(task.uid); } catch (error) { console.warn(error); } }} />
            <div>
              <p className="task-text">{task.text}</p>
              <p className="task-meta">{task.due}{task.important ? " · important" : ""}</p>
            </div>
          </div>
        )) : <p className="muted">Nothing due today.</p>}
      </article>

      <footer className="quiet">
        {parked ? <span>{parked} parked thoughts</span> : null}
        <a href={href("notes")}>{noteCount} notes</a>
      </footer>
    </main>
  );
}
