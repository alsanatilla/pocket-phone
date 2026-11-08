// Facts a brief can stand on without asking a model to count. Everything here is derived from the workspace
// documents that were already read, is deterministic, and is never invented: if a collection is missing the line
// simply is not produced. The brief may quote these numbers; it must still read a record before describing it.

const DAY = 86400000;
const day = value => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '');
const today = now => new Date(now).toISOString().slice(0, 10);

/** How many days an ISO date is in the past (negative when it is in the future). */
const age = (date, now) => Math.round((Date.parse(today(now)) - Date.parse(date)) / DAY);

/**
 * A compact, factual digest for a scheduled run. `documents` is readDocuments()'s result (name → { value }).
 * Returns a list of short sentences, empty when the workspace holds nothing worth stating.
 */
export function patternDigest(documents = {}, now = Date.now()) {
  const lines = [];
  const tasks = Array.isArray(documents['tasks.json']?.value?.tasks) ? documents['tasks.json'].value.tasks : [];
  const notes = Array.isArray(documents['notes.json']?.value?.notes) ? documents['notes.json'].value.notes : [];
  const thoughts = Array.isArray(documents['parking.json']?.value?.items) ? documents['parking.json'].value.items : [];
  const workouts = Array.isArray(documents['gym.json']?.value?.workouts) ? documents['gym.json'].value.workouts : [];
  const since = now - 28 * DAY;

  if (tasks.length) {
    const open = tasks.filter(task => !task.done);
    const overdue = open.filter(task => day(task.due) && age(day(task.due), now) > 0);
    const completed = tasks.filter(task => task.done && Number(task.updated) >= since);
    lines.push(`Tasks: ${open.length} open, ${overdue.length} overdue, ${completed.length} completed in the last 28 days.`);
    if (overdue.length) lines.push(`Oldest overdue: "${String(overdue.sort((a, b) => String(a.due).localeCompare(String(b.due)))[0].text || '').slice(0, 80)}".`);
  }
  if (notes.length) {
    const fresh = notes.filter(note => !note.deleted && Number(note.updated) >= since);
    lines.push(`Notes: ${notes.filter(note => !note.deleted).length} kept, ${fresh.length} touched in the last 28 days.`);
  }
  if (thoughts.length) {
    const parked = thoughts.filter(item => !item.done && !item.deleted);
    const oldest = parked.map(item => Number(item.created || item.updated || 0)).filter(Boolean).sort((a, b) => a - b)[0];
    lines.push(`Thoughts: ${parked.length} parked${oldest ? `, the oldest ${Math.floor((now - oldest) / DAY)} days old` : ''}.`);
  }
  if (workouts.length) {
    const recent = workouts.filter(workout => Number(workout.started) >= since);
    const last = workouts.map(workout => Number(workout.started)).filter(Boolean).sort((a, b) => b - a)[0];
    lines.push(`Gym: ${recent.length} sessions in the last 28 days${last ? `, last on ${new Date(last).toISOString().slice(0, 10)}` : ''}.`);
  }
  return lines;
}
