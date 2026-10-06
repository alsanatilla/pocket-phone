import { FILES, EMPTY, merge, mergeById, pruneParking } from '../shared/workspace.js';
export { FILES, merge, mergeById };
import { storage as localStorage } from './workspace-storage.js';
// Local copies of the synced documents and the merge rules. These mirror the phone exactly:
// SyncMerge.java, ParkingStore.java, ReceiptTape.java, NoteSync.java and DiceActivity.merge. Change both sides together.

const HOUR = 3_600_000, DAY = 24 * HOUR, KEEP_CLOSED = 7 * DAY, KEEP_DAYS = 30, DAY_LIMIT = 300, KEEP_DELETED = 30 * DAY;
export const NOTE_LIMIT = 8000;
export const DELAYS = ["1 hour", "tonight", "tomorrow", "next week"];
export const HECKLE = 3;
export const KIND = { ROLL: "ROLL", PARK: "PARK", CLEAR: "CLEAR", KILL: "KILL", MEMO: "MEMO", DONE: "DONE", PHOTO: "PHOTO", ALARM: "ALARM", TASK: "TASK" };

const listeners = new Set();
export const onChange = fn => listeners.add(fn);
export const changed = name => { markDirty(name); listeners.forEach(fn => fn(name)); };

export function load(name) {
  try { const doc = JSON.parse(localStorage.getItem("pocket:" + name)); if (doc && typeof doc === "object") return doc; } catch { /* damaged copy reads as empty */ }
  return EMPTY[name]();
}
export function save(name, doc) { localStorage.setItem("pocket:" + name, JSON.stringify(doc)); }
export function importDocument(name, doc) { if (!FILES.includes(name)) throw new Error('Unknown Pocket collection.'); save(name, doc); changed(name); }
export function dirty() { try { return new Set(JSON.parse(localStorage.getItem("pocket:dirty") || "[]")); } catch { return new Set(); } }
function markDirty(name) { const set = dirty(); set.add(name); localStorage.setItem("pocket:dirty", JSON.stringify([...set])); }
export function clean(name) { const set = dirty(); set.delete(name); localStorage.setItem("pocket:dirty", JSON.stringify([...set])); }

// ── Journal pages: photographed on the phone, read by Claude; each line knows where it sits on the photo. ──
export const journal = {
  /** A page uploaded here waits until it is read: by the phone, or on demand with Claude from this browser. */
  addWaiting(uid) {
    const doc = load("journal.json"), now = Date.now();
    doc.pages.push({ uid, created: now, updated: now, state: "waiting", title: "", lines: [], groups: [], source: "web" });
    save("journal.json", doc); changed("journal.json");
  },
  /** Pages without a note yet, newest first: waiting, being read, or failed. */
  unread() { return load("journal.json").pages.filter(p => !p.deleted && p.state !== "done").sort((a, b) => b.created - a.created); },
  get(uid) { return load("journal.json").pages.find(p => p.uid === uid && !p.deleted) || null; },
  edit(uid, change) {
    const doc = load("journal.json"), page = doc.pages.find(p => p.uid === uid && !p.deleted);
    if (!page) throw new Error("This page was removed.");
    change(page); page.updated = Math.max(Date.now(), (page.updated || 0) + 1); save("journal.json", doc); changed("journal.json"); return page;
  },
  remove(uid) {
    const doc = load("journal.json"), page = doc.pages.find(p => p.uid === uid); if (!page) return;
    Object.assign(page, { deleted: true, lines: [], groups: [], updated: Date.now() }); save("journal.json", doc); changed("journal.json");
  },
  forNote(noteUid) { return noteUid ? load("journal.json").pages.find(p => p.note === noteUid && !p.deleted) || null : null; },
  /** The page line a note line came from, matched by its exact text, so edited lines simply lose their strip. */
  lineFor(page, noteLine) { const key = noteLine.trim(); return key && page ? (page.lines || []).find(l => (l.note_line || "").trim() === key && l.bottom > l.top) || null : null; },
};

// ── Notes ──
export const notes = {
  list() { return load("notes.json").notes.filter(n => !n.deleted).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updated - a.updated); },
  get(uid) { return load("notes.json").notes.find(n => n.uid === uid && !n.deleted) || null; },
  create(text) {
    const value = String(text || "").slice(0, NOTE_LIMIT); if (!value.trim()) throw new Error("Write something first.");
    const doc = load("notes.json"), now = Date.now(), note = { uid: crypto.randomUUID(), text: value, pinned: false, created: now, updated: now, deleted: false };
    doc.notes.push(note); save("notes.json", doc); changed("notes.json"); return note;
  },
  edit(uid, change) {
    const doc = load("notes.json"), note = doc.notes.find(n => n.uid === uid && !n.deleted);
    if (!note) throw new Error("This note was deleted.");
    change(note); note.updated = Math.max(Date.now(), (note.updated || 0) + 1); save("notes.json", doc); changed("notes.json"); return note;
  },
  update(uid, text) { return this.edit(uid, n => { n.text = String(text).slice(0, NOTE_LIMIT); }); },
  pin(uid, pinned) { return this.edit(uid, n => { n.pinned = pinned; }); },
  remove(uid) { return this.edit(uid, n => { n.text = ""; n.pinned = false; n.deleted = true; }); },
};
// ── Thoughts inside notes: a line ">> call Sam @tomorrow" parks "call Sam". Mirrors NoteThoughts.java. ──
const THOUGHT = /^[ \t]*>>[ \t]+(.+?)(?:[ \t]+@(1h|tonight|tomorrow|tmrw|nextweek|\d{1,2}[:.]\d{2}))?[ \t]*$/i;
const THOUGHT_DELAY = { tonight: "tonight", tomorrow: "tomorrow", tmrw: "tomorrow", nextweek: "next week" };
export const thoughtKey = text => text.trim().replace(/[ \t]+/g, " ").toLowerCase();
export function thought(line) {
  const m = line.replace(/\r/g, "").match(THOUGHT); if (!m || !m[1].trim()) return null;
  const tag = (m[2] || "").toLowerCase();
  return { text: m[1].trim(), key: thoughtKey(m[1]), delay: THOUGHT_DELAY[tag] || (/^\d{1,2}[:.]\d{2}$/.test(tag) ? tag : tag ? "1 hour" : "none") };
}
/** FNV-1a over "uid\nkey", in a range no timestamp id reaches, so the phone and the web create the same item. */
export function thoughtId(uid, key) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(uid + "\n" + key)) { hash ^= byte; hash = Math.imul(hash, 0x01000193) >>> 0; }
  return 9_000_000_000_000_000 + hash;
}
export function parkThought(uid, item) {
  const id = thoughtId(uid, item.key), due = when(item.delay), doc = load("parking.json"), now = Date.now();
  const existing = doc.items.find(i => String(i.id) === String(id));
  if (existing?.state === "parked") return null;
  const parked = Object.assign(existing || { id, created: now, notches: 0 }, { text: item.text, due, closed: 0, state: "parked", note: uid, updated: now });
  if (!existing) doc.items.push(parked);
  save("parking.json", doc); changed("parking.json"); receipt.log(KIND.PARK, parked.text); return parked;
}
/** Whether this note line already has a Parking item, in any state. */
export const thoughtParked = (uid, key) => Boolean(uid) && load("parking.json").items.some(i => String(i.id) === String(thoughtId(uid, key)));
export function thoughtStatus(uid, text, now = Date.now()) {
  const t = thought(text); if (!t || !uid) return "not parked yet";
  const item = load("parking.json").items.find(i => String(i.id) === String(thoughtId(uid, t.key)));
  if (!item) return "not parked yet";
  if (item.state === "cleared") return "cleared"; if (item.state === "killed") return "let go"; if (item.state === "task") return "made into a task";
  return !item.due ? "saved to thoughts" : item.due <= now ? "ready to revisit" : "revisit " + relative(item.due, now);
}

/** The phone shows a note's first line as its title. */
export const noteTitle = note => (note.text.split("\n").find(line => line.trim()) || "Empty note")
  .replace(/^\s*(#+|>>)\s*/, "").replace(/\s+@(1h|tonight|tomorrow|tmrw|nextweek|\d{1,2}[:.]\d{2})\s*$/i, "").trim();

// ── Parking Lot ──
export const parking = {
  open(now = Date.now()) { return load("parking.json").items.filter(i => i.state === "parked").sort((a, b) => (a.due || Number.MAX_SAFE_INTEGER) - (b.due || Number.MAX_SAFE_INTEGER) || b.created - a.created); },
  park(text, due) {
    const value = (text || "").trim(); if (!value) throw new Error("Type the thought first.");
    const doc = load("parking.json"), now = Date.now();
    if(value.length>500)throw new Error("Keep a thought within 500 characters.");
    const item = { id: now * 1000 + Math.floor(Math.random() * 1000), text: value, created: now, due: due || 0, closed: 0, notches: 0, state: "parked", updated: now };
    doc.items.push(item); save("parking.json", doc); changed("parking.json"); return item;
  },
  update(id, edit) {
    const doc = load("parking.json"), item = doc.items.find(i => String(i.id) === String(id) && i.state === "parked");
    if (!item) throw new Error("This item was already cleared.");
    edit(item); item.updated = Math.max(Date.now(),item.updated+1); doc.items = pruneParking(doc.items, item.updated); save("parking.json", doc); changed("parking.json"); return item;
  },
  repark(id, due) { return this.update(id, i => { i.due = due; i.notches = (i.notches || 0) + 1; }); },
  bringBack(id) { return this.update(id, i => { i.due = Date.now(); }); },
  close(id, state) { return this.update(id, i => { i.state = state; i.closed = Date.now(); }); },
};
export function when(delay, now = Date.now()) {
  if (delay === "none") return 0;
  const at = new Date(now); at.setSeconds(0, 0);
  // A clock time ("16:30") means the next time the clock shows it: today, or tomorrow once it has passed. Same as ParkingStore.when.
  const time = /^(\d{1,2})[:.](\d{2})$/.exec(delay);
  if (time && +time[1] < 24 && +time[2] < 60) { at.setHours(+time[1], +time[2]); if (+at <= now) at.setDate(at.getDate() + 1); return +at; }
  if (delay === "tonight") { at.setHours(20, 0); if (at - now < HOUR / 2) at.setDate(at.getDate() + 1); return +at; }
  if (delay === "tomorrow") { at.setDate(at.getDate() + 1); at.setHours(9, 0); return +at; }
  if (delay === "next week") { at.setHours(9, 0); do at.setDate(at.getDate() + 1); while (at.getDay() !== 1); return +at; }
  return now + HOUR;
}
export const meter = n => "[" + Array.from({ length: 5 }, (_, i) => (i < n ? "#" : "·")).join("") + "]";
export const daysOld = (item, now = Date.now()) => Math.max(0, Math.floor((now - item.created) / DAY));
export function heckle(item, now = Date.now()) {
  const n = item.notches || 0, days = daysOld(item, now);
  if (n >= 6) return `PARKED ${n}×. I AM BEGGING YOU.`;
  if (n >= 4) return `PARKED ${n}×. JUST LET IT GO. NOBODY WILL KNOW.`;
  if (n >= HECKLE) return days === 0 ? `PARKED ${n}× TODAY. DO IT OR LET IT GO.` : `THIS HAS BEEN HERE ${days === 1 ? "1 DAY" : days + " DAYS"}. DO SOMETHING OR LET IT GO.`;
  if (n === 2) return "parked twice. hmm.";
  if (n === 1) return "back again.";
  return "";
}
export function relative(due, now = Date.now()) {
  const minutes = Math.max(0, Math.ceil((due - now) / 60000));
  if (minutes < 60) return minutes <= 1 ? "now" : `in ${minutes} min`;
  const time = new Date(due).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const day = new Date(now); if (sameDay(day, due)) return "today " + time;
  day.setDate(day.getDate() + 1); if (sameDay(day, due)) return "tomorrow " + time;
  return new Date(due).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }) + " " + time;
}
const sameDay = (a, b) => { const d = new Date(b); return a.getFullYear() === d.getFullYear() && a.getMonth() === d.getMonth() && a.getDate() === d.getDate(); };

// ── Receipt ──
export const dayKey = when => { const d = new Date(when); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; };
export const receipt = {
  lines(day) { return [...(load("receipt.json").days?.[dayKey(day)] || [])].sort((a, b) => a.t - b.t); },
  log(kind, text, at = Date.now()) {
    let value = String(text || "").replace(/\n/g, " ").trim(); if (value.length > 120) value = value.slice(0, 119) + "…";
    const doc = load("receipt.json"), key = dayKey(at); doc.days = doc.days || {};
    const lines = doc.days[key] = doc.days[key] || []; if (lines.length >= DAY_LIMIT) return;
    lines.push({ i: at.toString(36) + "-" + Math.floor(Math.random() * 2 ** 30).toString(36), t: at, k: kind, x: value });
    save("receipt.json", merge["receipt.json"](doc, null, at)); changed("receipt.json");
  },
  totals(lines) {
    const totals = [["ITEMS", lines.length]];
    for (const [kind, name] of [["DONE", "TASKS DONE"], ["CLEAR", "CLEARED"], ["KILL", "LET GO"], ["PHOTO", "PHOTOS"], ["ROLL", "ROLLS"], ["ALARM", "ALARMS"]]) {
      const n = lines.filter(l => l.k === kind).length; if (n) totals.push([name, n]);
    }
    return totals;
  },
  /** Plain 32-column text, the same as the phone's share. */
  text(day, lines) {
    const rule = "-".repeat(32), center = s => " ".repeat(Math.max(0, Math.floor((32 - s.length) / 2))) + s;
    const out = [center("POCKET PHONE"), center("** DAY RECEIPT **"), center(longDate(day)), rule];
    if (!lines.length) out.push(center("NO ITEMS"));
    for (const l of lines) out.push(clock(l.t).padEnd(7) + l.k.padEnd(6) + l.x);
    out.push(rule); for (const [name, n] of receipt.totals(lines)) out.push(name.padEnd(26) + String(n).padStart(6));
    out.push(rule, center("THANK YOU FOR LIVING"), center("PLEASE COME AGAIN"));
    return out.join("\n");
  },
};
export const clock = t => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }).toLowerCase();
export const longDate = t => new Date(t).toLocaleDateString([], { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).replace(/,/g, "").toUpperCase();

// ── Dice ──
export const dice = {
  list() { return (load("dice.json").list || "").split("\n").map(s => s.trim()).filter(Boolean); },
  raw() { return load("dice.json").list || ""; },
  setList(text) { save("dice.json", { v: 1, list: text, updated: Date.now() }); changed("dice.json"); },
};

// Tasks are commitments. Thoughts become tasks only when the user chooses this transition.
export const taskDay = (at = Date.now()) => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
export const tasks = {
  list() { return load("tasks.json").tasks.filter(t => !t.deleted).sort((a,b)=>(a.due||"9999").localeCompare(b.due||"9999") || Number(b.important)-Number(a.important)); },
  get(uid) { return this.list().find(t => t.uid === uid) || null; },
  create(text, source = null, fields = {}) {
    const value = String(text||"").trim(); if(!value || value.length>500)throw new Error("Write an action, up to 500 characters.");
    if(source?.token){const existing=this.list().find(t=>t.source?.token===source.token);if(existing)return existing;}
    if(this.list().length+notes.list().length>=250)throw new Error("The workspace is full. Remove an old entry.");
    const doc=load("tasks.json"), now=Date.now(), task={uid:crypto.randomUUID(),text:value,done:false,due:fields.due||"",important:Boolean(fields.important),steps:fields.steps||[],created:now,updated:now,deleted:false};
    if(source)task.source=source;doc.tasks.push(task);save("tasks.json",doc);changed("tasks.json");return task;
  },
  edit(uid, change) { const doc=load("tasks.json"), item=doc.tasks.find(t=>t.uid===uid&&!t.deleted);if(!item)throw new Error("This task was removed.");change(item);item.updated=Math.max(Date.now(),item.updated+1);save("tasks.json",doc);changed("tasks.json");return item; },
  complete(uid) { const item=this.edit(uid,t=>{t.done=!t.done;});if(item.done)receipt.log(KIND.DONE,item.text);return item; },
  remove(uid) { return this.edit(uid,t=>{t.deleted=true;}); },
  next(uid) { const doc=load("tasks.json");doc.next={uid,updated:Math.max(Date.now(),(doc.next?.updated||0)+1)};save("tasks.json",doc);changed("tasks.json"); },
  fromThought(item) {
    const current=load("parking.json").items.find(t=>String(t.id)===String(item.id));if(!current)throw new Error("This thought was removed.");
    const existing=this.list().find(t=>t.source?.token==="thought:"+current.id);
    if(existing){if(current.state==="parked")parking.close(current.id,"task");return existing;}
    if(current.state!=="parked")throw new Error("This thought has already been handled.");
    const note=current.note?notes.get(current.note):null,source={kind:note?"note":"shared",name:note?noteTitle(note):"Thought",text:note?note.text:current.text,token:"thought:"+current.id};if(note)source.note_uid=note.uid;
    const task=this.create(current.text,source);parking.close(current.id,"task");receipt.log(KIND.TASK,current.text);return task;
  },
};

// ── Gym: workouts of sets; the same records and rules as GymStore.java. ──
export const STARTERS = ["Squat", "Bench press", "Deadlift", "Overhead press", "Barbell row", "Pull-up"];
export const e1rm = (kg, reps) => reps <= 1 ? kg : kg * (1 + reps / 30);
export const kgText = v => Math.abs(v - Math.round(v)) < .05 ? String(Math.round(v)) : v.toFixed(1);
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
export const weekStart = at => { const d = new Date(at); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.getTime(); };
export const gym = {
  all() { return load("gym.json").workouts.filter(w => !w.deleted).sort((a, b) => b.started - a.started); },
  get(id) { return gym.all().find(w => w.id === id) || null; },
  active() { return gym.all().find(w => !w.ended) || null; },
  edit(id, change) {
    const doc = load("gym.json"), w = doc.workouts.find(x => x.id === id && !x.deleted);
    if (!w) throw new Error("This workout was removed.");
    change(w); w.updated = Math.max(Date.now(), (w.updated || 0) + 1); save("gym.json", doc); changed("gym.json"); return w;
  },
  start() {
    const open = gym.active(); if (open) return open;
    const doc = load("gym.json"), now = Date.now(), w = { id: crypto.randomUUID(), started: now, ended: 0, updated: now, entries: [] };
    doc.workouts.push(w); save("gym.json", doc); changed("gym.json"); return w;
  },
  entry(w, exercise) { let e = (w.entries ||= []).find(x => same(x.exercise, exercise)); if (!e) { e = { exercise, sets: [] }; w.entries.push(e); } return e; },
  addExercise(id, exercise) { return gym.edit(id, w => gym.entry(w, exercise.trim())); },
  addSet(id, exercise, kg, reps) {
    if (!exercise?.trim()) throw new Error("Choose an exercise.");
    if (!(reps >= 1 && reps <= 100 && kg >= 0 && kg <= 1000)) throw new Error("Use 1–100 reps and up to 1000 kg.");
    return gym.edit(id, w => gym.entry(w, exercise.trim()).sets.push({ kg: Math.round(kg * 100) / 100, reps: Math.round(reps), at: Date.now() }));
  },
  undoSet(id, exercise) { gym.edit(id, w => gym.entry(w, exercise).sets.pop()); },
  finish(id) { gym.edit(id, w => { w.ended = Date.now(); w.entries = (w.entries || []).filter(e => e.sets.length); if (!w.entries.length) w.deleted = true; }); },
  remove(id) { gym.edit(id, w => { w.deleted = true; w.entries = []; }); },
  sets(w, exercise) { return (w.entries || []).filter(e => same(e.exercise, exercise)).flatMap(e => e.sets || []); },
  names(w) { return (w.entries || []).map(e => e.exercise); },
  count(w) { return (w.entries || []).reduce((n, e) => n + (e.sets?.length || 0), 0); },
  volume(w) { return (w.entries || []).reduce((n, e) => n + (e.sets || []).reduce((m, s) => m + s.kg * s.reps, 0), 0); },
  /** Exercises with sets, most recently used first. */
  trained() { const seen = new Map(); for (const w of gym.all()) for (const name of gym.names(w)) if (gym.sets(w, name).length && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name); return [...seen.values()]; },
  exercises() { const seen = new Map(gym.trained().map(n => [n.toLowerCase(), n])); for (const n of STARTERS) if (!seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n); return [...seen.values()]; },
  previous(exercise, exceptId) { for (const w of gym.all()) { if (w.id === exceptId) continue; const sets = gym.sets(w, exercise); if (sets.length) return sets; } return []; },
  /** One point per workout, oldest first: the best estimated single. */
  history(exercise) {
    return gym.all().map(w => { const best = gym.sets(w, exercise).reduce((b, s) => !b || e1rm(s.kg, s.reps) > e1rm(b.kg, b.reps) ? s : b, null); return best && { at: w.started, e1rm: e1rm(best.kg, best.reps), best }; }).filter(Boolean).reverse();
  },
  record(history) { return history.reduce((b, p) => !b || p.e1rm > b.e1rm ? p : b, null); },
  weekly(weeks = 8) {
    const out = Array(weeks).fill(0), start = weekStart(Date.now());
    for (const w of gym.all()) { const ago = Math.round((start - weekStart(w.started)) / (7 * DAY)); if (ago >= 0 && ago < weeks) out[weeks - 1 - ago] += gym.volume(w); }
    return out;
  },
};
