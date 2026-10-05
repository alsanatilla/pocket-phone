// Local copies of the synced documents and the merge rules. These mirror the phone exactly:
// SyncMerge.java, ParkingStore.java, ReceiptTape.java and DiceActivity.merge. Change both sides together.

const HOUR = 3_600_000, DAY = 24 * HOUR, KEEP_CLOSED = 7 * DAY, KEEP_DAYS = 30, DAY_LIMIT = 300;
export const FILES = ["parking.json", "receipt.json", "dice.json"];
export const DELAYS = ["1 hour", "tonight", "tomorrow", "next week"];
export const HECKLE = 3;
export const KIND = { ROLL: "ROLL", PARK: "PARK", CLEAR: "CLEAR", KILL: "KILL", MEMO: "MEMO", DONE: "DONE", PHOTO: "PHOTO", ALARM: "ALARM", TASK: "TASK" };

const EMPTY = { "parking.json": () => ({ v: 1, items: [] }), "receipt.json": () => ({ v: 1, days: {} }), "dice.json": () => ({ v: 1, list: "", updated: 0 }) };
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
};

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
