// Local copies of the synced documents and the merge rules. These mirror the phone exactly:
// SyncMerge.java, ParkingStore.java, ReceiptTape.java, NoteSync.java and DiceActivity.merge. Change both sides together.

const HOUR = 3_600_000, DAY = 24 * HOUR, KEEP_CLOSED = 7 * DAY, KEEP_DAYS = 30, DAY_LIMIT = 300, KEEP_DELETED = 30 * DAY;
export const NOTE_LIMIT = 8000;
export const FILES = ["parking.json", "receipt.json", "dice.json", "notes.json"];
export const DELAYS = ["1 hour", "tonight", "tomorrow", "next week"];
export const HECKLE = 3;
export const KIND = { ROLL: "ROLL", PARK: "PARK", CLEAR: "CLEAR", KILL: "KILL", MEMO: "MEMO", DONE: "DONE", PHOTO: "PHOTO", ALARM: "ALARM", TASK: "TASK" };

const EMPTY = { "parking.json": () => ({ v: 1, items: [] }), "receipt.json": () => ({ v: 1, days: {} }), "dice.json": () => ({ v: 1, list: "", updated: 0 }), "notes.json": () => ({ v: 1, notes: [] }) };
const listeners = new Set();
export const onChange = fn => listeners.add(fn);
const changed = name => { markDirty(name); listeners.forEach(fn => fn(name)); };

export function load(name) {
  try { const doc = JSON.parse(localStorage.getItem("pocket:" + name)); if (doc && typeof doc === "object") return doc; } catch { /* damaged copy reads as empty */ }
  return EMPTY[name]();
}
export function save(name, doc) { localStorage.setItem("pocket:" + name, JSON.stringify(doc)); }
export function dirty() { try { return new Set(JSON.parse(localStorage.getItem("pocket:dirty") || "[]")); } catch { return new Set(); } }
function markDirty(name) { const set = dirty(); set.add(name); localStorage.setItem("pocket:dirty", JSON.stringify([...set])); }
export function clean(name) { const set = dirty(); set.delete(name); localStorage.setItem("pocket:dirty", JSON.stringify([...set])); }

/** Per item, the later edit wins; a tie keeps the local copy. */
export function mergeById(local = [], remote = [], idKey, updatedKey) {
  const merged = new Map();
  for (const item of local || []) if (item && item[idKey] != null) merged.set(String(item[idKey]), item);
  for (const item of remote || []) {
    if (!item || item[idKey] == null) continue;
    const mine = merged.get(String(item[idKey]));
    if (!mine || (item[updatedKey] || 0) > (mine[updatedKey] || 0)) merged.set(String(item[idKey]), item);
  }
  return [...merged.values()];
}
const pruneParking = (items, now) => items.filter(i => i.state === "parked" || now - (i.closed || 0) <= KEEP_CLOSED);
export const merge = {
  "parking.json": (local, remote, now) => ({ v: 1, items: pruneParking(mergeById(local.items, remote?.items, "id", "updated"), now) }),
  "receipt.json": (local, remote, now) => {
    const cutoff = dayKey(now - KEEP_DAYS * DAY), days = {}, names = new Set([...Object.keys(local.days || {}), ...Object.keys(remote?.days || {})]);
    for (const day of [...names].sort()) {
      if (!/^\d{8}$/.test(day) || day < cutoff) continue;
      days[day] = mergeById(local.days?.[day], remote?.days?.[day], "i", "t").sort((a, b) => a.t - b.t).slice(0, DAY_LIMIT);
    }
    return { v: 1, days };
  },
  "dice.json": (local, remote) => (remote && (remote.updated || 0) > (local.updated || 0) ? { v: 1, list: remote.list || "", updated: remote.updated } : { v: 1, list: local.list || "", updated: local.updated || 0 }),
  // Deleted notes stay as markers for 30 days so an older copy cannot bring them back.
  "notes.json": (local, remote, now) => ({ v: 1, notes: mergeById(local.notes, remote?.notes, "uid", "updated").filter(n => !n.deleted || now - (n.updated || 0) <= KEEP_DELETED) }),
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
    change(note); note.updated = Date.now(); save("notes.json", doc); changed("notes.json"); return note;
  },
  update(uid, text) { return this.edit(uid, n => { n.text = String(text).slice(0, NOTE_LIMIT); }); },
  pin(uid, pinned) { return this.edit(uid, n => { n.pinned = pinned; }); },
  remove(uid) { return this.edit(uid, n => { n.text = ""; n.pinned = false; n.deleted = true; }); },
};
// ── Thoughts inside notes: a line ">> call Sam @tomorrow" parks "call Sam". Mirrors NoteThoughts.java. ──
const THOUGHT = /^[ \t]*>>[ \t]+(.+?)(?:[ \t]+@(1h|tonight|tomorrow|tmrw|nextweek))?[ \t]*$/i;
const THOUGHT_DELAY = { tonight: "tonight", tomorrow: "tomorrow", tmrw: "tomorrow", nextweek: "next week" };
export const thoughtKey = text => text.trim().replace(/[ \t]+/g, " ").toLowerCase();
export function thought(line) {
  const m = line.replace(/\r/g, "").match(THOUGHT); if (!m || !m[1].trim()) return null;
  return { text: m[1].trim(), key: thoughtKey(m[1]), delay: THOUGHT_DELAY[(m[2] || "").toLowerCase()] || "1 hour" };
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
  if (item.state === "cleared") return "cleared"; if (item.state === "killed") return "let go"; if (item.state === "task") return "moved to Today";
  return item.due <= now ? "back now" : "back " + relative(item.due, now);
}

/** The phone shows a note's first line as its title. */
export const noteTitle = note => (note.text.split("\n").find(line => line.trim()) || "Empty note")
  .replace(/^\s*(#+|>>)\s*/, "").replace(/\s+@(1h|tonight|tomorrow|tmrw|nextweek)\s*$/i, "").trim();

// ── Parking Lot ──
export const parking = {
  open(now = Date.now()) { return load("parking.json").items.filter(i => i.state === "parked").sort((a, b) => a.due - b.due); },
  park(text, due) {
    const value = (text || "").trim(); if (!value) throw new Error("Type the thought first.");
    const doc = load("parking.json"), now = Date.now();
    const item = { id: now * 1000 + Math.floor(Math.random() * 1000), text: value.slice(0, 200), created: now, due, closed: 0, notches: 0, state: "parked", updated: now };
    doc.items.push(item); save("parking.json", doc); changed("parking.json"); return item;
  },
  update(id, edit) {
    const doc = load("parking.json"), item = doc.items.find(i => String(i.id) === String(id) && i.state === "parked");
    if (!item) throw new Error("This item was already cleared.");
    edit(item); item.updated = Date.now(); doc.items = pruneParking(doc.items, item.updated); save("parking.json", doc); changed("parking.json"); return item;
  },
  repark(id, due) { return this.update(id, i => { i.due = due; i.notches = (i.notches || 0) + 1; }); },
  bringBack(id) { return this.update(id, i => { i.due = Date.now(); }); },
  close(id, state) { return this.update(id, i => { i.state = state; i.closed = Date.now(); }); },
};
export function when(delay, now = Date.now()) {
  const at = new Date(now); at.setSeconds(0, 0);
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
