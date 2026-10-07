// A read-only brief of saved Pocket records. No network, predictions or writes.
const HOUR = 3_600_000, MINUTE = 60_000, DATE = /^\d{4}-\d{2}-\d{2}$/;
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const rows = value => Array.isArray(value) ? value.filter(record) : [];
const epoch = value => Number.isSafeInteger(value) && value > 0 && value <= 253_402_300_799_999;
const id = value => typeof value === 'string' && value.trim() && value.length <= 200 ? value : Number.isSafeInteger(value) && value > 0 ? String(value) : '';
const clean = (value, limit = 105) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
const live = item => item.deleted === undefined || item.deleted === false;
const path = (kind, uid) => '/' + kind + (uid ? '/' + encodeURIComponent(uid) : '');
const plural = (count, word) => count + ' ' + word + (count === 1 ? '' : 's');
const compare = (a, b) => a === b ? 0 : a < b ? -1 : 1;

export function validBriefDay(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}
function shiftDay(day, delta) {
  const [year, month, date] = day.split('-').map(Number), at = new Date(0);
  at.setUTCFullYear(year, month - 1, date + delta); at.setUTCHours(0, 0, 0, 0);
  return String(at.getUTCFullYear()).padStart(4, '0') + '-' + String(at.getUTCMonth() + 1).padStart(2, '0') + '-' + String(at.getUTCDate()).padStart(2, '0');
}
function calendar(timeZone) {
  let formatter;
  const options = { calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  try { formatter = new Intl.DateTimeFormat('en-GB', { ...options, ...(timeZone ? { timeZone } : {}) }); }
  catch { formatter = new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }); }
  const parts = at => Object.fromEntries(formatter.formatToParts(at).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  const dayAt = at => { const p = parts(at); return p.year.padStart(4, '0') + '-' + p.month + '-' + p.day; };
  const timeAt = at => { const p = parts(at); return p.hour + ':' + p.minute; };
  // Find the first instant of a civil day, including shortened/lengthened DST days.
  const startOf = day => {
    const [year, month, date] = day.split('-').map(Number), dateUTC = new Date(0);
    dateUTC.setUTCFullYear(year, month - 1, date); dateUTC.setUTCHours(0, 0, 0, 0);
    let lower = dateUTC.getTime() - 48 * HOUR, upper = dateUTC.getTime() + 48 * HOUR;
    while (upper - lower > 1) { const middle = lower + Math.floor((upper - lower) / 2); if (dayAt(middle) < day) lower = middle; else upper = middle; }
    return upper;
  };
  return { dayAt, timeAt, startOf, timeZone: formatter.resolvedOptions().timeZone };
}

function recoveryFact(value, day, now) {
  if (!record(value) || typeof value.recovery !== 'number' || !Number.isFinite(value.recovery) || value.recovery < 0 || value.recovery > 100) return null;
  const sampleDay = validBriefDay(value.date) ? value.date : '';
  if (sampleDay > day) return null;
  const at = epoch(value.at) && value.at <= now ? value.at : 0;
  const ageHours = at ? Math.floor((now - at) / HOUR) : null;
  const stale = Boolean(sampleDay && sampleDay < day || at && now - at > 24 * HOUR);
  const freshness = stale ? 'stale' : sampleDay === day ? 'dated' : at ? 'cached' : 'unknown';
  const source = value.source === 'Pocket' ? 'Pocket' : 'COROS';
  const reading = sampleDay ? 'saved ' + sampleDay : at ? 'cached ' + ageHours + 'h ago' : 'saved reading · age unknown';
  return { id: 'recovery', kind: 'recovery', href: '/movement', text: source + ' recovery ' + Math.round(value.recovery) + '% · ' + reading + (stale ? ' · stale' : ''), recovery: Math.round(value.recovery), source, date: sampleDay, at, stale, freshness, ageHours };
}
function agendaFact(input, horizon, now, cal, day) {
  const allEvents = rows(input).filter(event => live(event) && id(event.uid) && clean(event.title) && epoch(event.when) && Number.isInteger(event.minutes) && event.minutes >= 1 && event.minutes <= 1440)
    .map(event => ({ ...event, uid: id(event.uid), end: event.when + event.minutes * MINUTE }))
    .sort((a, b) => a.when - b.when || compare(a.uid, b.uid));
  const events = allEvents.filter(event => event.when < horizon.end && event.end > horizon.start);
  if (!events.length) return null;
  let conflicts = 0;
  for (let i = 0; i < events.length; i++) for (let j = i + 1; j < events.length; j++) if (events[j].when < events[i].end && events[i].when < events[j].end) conflicts++;
  const current = events.find(event => event.when <= now && event.end > now), next = events.find(event => event.when > now);
  let nextFree = now;
  if (current) {
    nextFree = current.end;
    for (const event of allEvents) if (event.when <= nextFree && event.end > nextFree) nextFree = event.end;
  }
  const chosen = current || next || events.at(-1), clock = at => (cal.dayAt(at) === day ? '' : cal.dayAt(at) + ' ') + cal.timeAt(at);
  const schedule = current ? 'now: ' + clean(current.title) + ' · free at ' + clock(nextFree)
    : next ? 'next ' + clock(next.when) + ': ' + clean(next.title) + ' · free until ' + clock(next.when)
      : 'finished';
  return { id: 'agenda', kind: 'agenda', uid: chosen.uid, href: path('calendar', chosen.uid), text: plural(events.length, 'appointment') + ' · ' + schedule + (conflicts ? ' · ' + plural(conflicts, 'overlap') : ''), count: events.length, conflicts, nextFree, nextAt: next?.when || 0, current: Boolean(current), when: chosen.when, until: chosen.end };
}
function taskFact(input, nextUid, day) {
  const tasks = rows(input).filter(task => live(task) && task.done === false && id(task.uid) && clean(task.text))
    .map(task => ({ ...task, uid: id(task.uid), due: validBriefDay(task.due) ? task.due : '' }))
    .sort((a, b) => compare(a.due || '9999-12-31', b.due || '9999-12-31') || Number(b.important === true) - Number(a.important === true)
      || (epoch(a.created) ? a.created : Number.MAX_SAFE_INTEGER) - (epoch(b.created) ? b.created : Number.MAX_SAFE_INTEGER) || compare(a.uid, b.uid));
  if (!tasks.length) return null;
  const overdue = tasks.filter(task => task.due && task.due < day), dueToday = tasks.filter(task => task.due === day);
  const chosen = tasks.find(task => task.uid === id(nextUid)), selected = chosen || overdue[0] || dueToday[0];
  const lead = chosen ? 'chosen next: ' + clean(chosen.text) : overdue.length ? plural(overdue.length, 'task') + ' overdue · ' + clean(selected.text)
    : dueToday.length ? plural(dueToday.length, 'task') + ' due today · ' + clean(selected.text) : plural(tasks.length, 'open task');
  return { id: 'task', kind: 'task', ...(selected ? { uid: selected.uid } : {}), href: path('tasks', selected?.uid), text: lead + (chosen && overdue.length ? ' · ' + overdue.length + ' overdue' : ''), open: tasks.length, overdue: overdue.length, dueToday: dueToday.length, chosenNext: Boolean(chosen), due: selected?.due || '' };
}
function thoughtFact(input, now) {
  const ready = rows(input).filter(item => live(item) && item.state === 'parked' && id(item.id) && clean(item.text) && epoch(item.due) && item.due <= now)
    .sort((a, b) => (epoch(a.created) ? a.created : epoch(a.updated) ? a.updated : a.due) - (epoch(b.created) ? b.created : epoch(b.updated) ? b.updated : b.due) || compare(id(a.id), id(b.id)));
  if (!ready.length) return null;
  const oldest = ready[0];
  return { id: 'thoughts', kind: 'thought', uid: id(oldest.id), href: path('thoughts', id(oldest.id)), text: plural(ready.length, 'thought') + ' ready to revisit · ' + clean(oldest.text), count: ready.length, due: oldest.due };
}
function trainingFact(input, horizon, now, cal) {
  const saved = rows(input).filter(workout => live(workout) && id(workout.id) && epoch(workout.started) && workout.started <= now);
  const active = saved.filter(workout => workout.ended === 0).sort((a, b) => b.started - a.started || compare(id(a.id), id(b.id)))[0];
  const workouts = saved.filter(workout => epoch(workout.ended) && workout.ended >= workout.started && workout.ended <= now
    && rows(workout.entries).some(entry => rows(entry.sets).some(set => typeof set.kg === 'number' && Number.isFinite(set.kg) && set.kg >= 0 && Number.isInteger(set.reps) && set.reps > 0)))
    .sort((a, b) => b.started - a.started || compare(id(a.id), id(b.id)));
  if (!workouts.length && !active) return null;
  const latest = active || workouts[0], sessions = workouts.filter(workout => workout.started >= horizon.weekStart).length;
  return { id: 'training', kind: 'training', uid: id(latest.id), href: '/gym/w:' + encodeURIComponent(id(latest.id)), text: plural(sessions, 'gym session') + ' this week · ' + (active ? 'workout in progress' : 'last ' + cal.dayAt(latest.started)), sessions, active: Boolean(active), started: latest.started, ended: latest.ended };
}
function noteFact(input) {
  const latest = rows(input).filter(note => live(note) && id(note.uid) && clean(note.text) && epoch(note.updated)).sort((a, b) => b.updated - a.updated || compare(id(a.uid), id(b.uid)))[0];
  if (!latest) return null;
  return { id: 'note', kind: 'note', uid: id(latest.uid), href: path('notes', id(latest.uid)), text: 'latest note · ' + clean(latest.text.split(/\r?\n/).find(line => line.trim())), updated: latest.updated };
}

export function buildBrief(input = {}, options = {}) {
  input = record(input) ? input : {};
  options = record(options) ? options : {};
  const now = Number.isSafeInteger(options.now) && options.now >= 0 && options.now <= 253_402_300_799_999 ? options.now : Date.now(), cal = calendar(options.timeZone), day = cal.dayAt(now);
  const [year, month, date] = day.split('-').map(Number), civil = new Date(0); civil.setUTCFullYear(year, month - 1, date); civil.setUTCHours(0, 0, 0, 0); const weekday = civil.getUTCDay();
  const horizon = { start: cal.startOf(day), end: cal.startOf(shiftDay(day, 1)), weekStart: cal.startOf(shiftDay(day, -((weekday + 6) % 7))) };
  const facts = [recoveryFact(input.coros, day, now), agendaFact(input.agenda, horizon, now, cal, day), taskFact(input.tasks, input.nextTaskUid, day), thoughtFact(input.thoughts, now), trainingFact(input.workouts, horizon, now, cal)].filter(Boolean);
  if (!facts.length) { const note = noteFact(input.notes); if (note) facts.push(note); }
  const text = facts.length ? facts.map(fact => fact.text).join('\n') : 'Nothing saved for this brief yet.';
  const context = ('Daily brief · ' + day + ' · ' + cal.timeZone + '\nSaved Pocket facts as of ' + new Date(now).toISOString() + '\n' + (facts.length ? facts.map(fact => fact.text + '\nSource: ' + fact.href).join('\n') : text)).slice(0, 6000);
  return { day, horizon, heading: 'daily brief', text, facts, context };
}
