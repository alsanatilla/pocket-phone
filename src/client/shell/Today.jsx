import { useEffect, useMemo, useState } from "react";
import { tasks, parking, taskDay, notes } from "../store.js";

// Today, on the new shell: one status line, one composer, a feed. The data comes from the same stores the
// classic app writes, so nothing has to be migrated for this route to be useful.

const stamp = value => new Date(Number(value) || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

export default function Today() {
  const [version, setVersion] = useState(0), [text, setText] = useState(""), [brief, setBrief] = useState(null);
  // The brief is a nice-to-have strip: load its module after paint instead of in the route's first chunk.
  useEffect(() => {
    let live = true;
    import("../daily-brief.js").then(module => { if (live && module.briefEnabled()) setBrief(module.readBrief()); }).catch(() => {});
    return () => { live = false; };
  }, [version]);
  const refresh = () => setVersion(n => n + 1);

  const { open, due, done, parked } = useMemo(() => {
    void version;
    const all = tasks.list(), today = taskDay();
    const openTasks = all.filter(task => !task.done);
    return {
      open: openTasks,
      due: openTasks.filter(task => task.due && task.due <= today),
      done: all.filter(task => task.done).length,
      parked: parking.open().length
    };
  }, [version]);

  const keep = event => {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    try { parking.park(value); setText(""); refresh(); } catch (error) { console.warn(error); }
  };

  return (
    <main className="today">
      <div className="today-status">
        <h1>{new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })}</h1>
        <p>{open.length} open · {due.length} due today · {done} done</p>
      </div>

      <form className="today-composer" onSubmit={keep}>
        <span className="glyph" aria-hidden="true">▌</span>
        <input value={text} onChange={event => setText(event.target.value)} placeholder="capture a thought…" aria-label="Capture a thought" maxLength={500} />
        <button type="submit" disabled={!text.trim()}>keep</button>
      </form>

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
            <button
              className="task-check"
              aria-label={"Complete " + task.text}
              onClick={() => { try { tasks.complete(task.uid); refresh(); } catch (error) { console.warn(error); } }}
            />
            <div>
              <p className="task-text">{task.text}</p>
              <p className="task-meta">{task.due}{task.important ? " · important" : ""}</p>
            </div>
          </div>
        )) : <p className="muted">Nothing due today.</p>}
      </article>

      <footer className="today-quiet">
        {parked ? <span>{parked} parked thoughts</span> : null}
        <span>{notes.list().length} notes</span>
      </footer>
    </main>
  );
}
