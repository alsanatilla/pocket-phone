const DAY = 86400000, KEEP_DAYS = 30, DAY_LIMIT = 300;
const dayKey = time => { const d = new Date(time); return String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); };
export const FILES = ['parking.json','receipt.json','dice.json','notes.json','tasks.json','journal.json','gym.json'];
export const EMPTY = { "gym.json": () => ({ v: 1, workouts: [] }), "parking.json": () => ({ v: 1, items: [] }), "receipt.json": () => ({ v: 1, days: {} }), "dice.json": () => ({ v: 1, list: "", updated: 0 }), "notes.json": () => ({ v: 1, notes: [] }), "tasks.json": () => ({ v: 1, tasks: [], next: { uid: "", updated: 0 } }), "journal.json": () => ({ v: 1, pages: [] }) };
const arrays = { 'parking.json': 'items', 'notes.json': 'notes', 'tasks.json': 'tasks', 'journal.json': 'pages', 'gym.json': 'workouts' };
export function validDocument(name, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (arrays[name]) return Array.isArray(value[arrays[name]]) && value[arrays[name]].length <= 20000;
  if (name === 'dice.json') return typeof value.list === 'string' && value.list.length <= 100000;
  if (name === 'receipt.json') return value.days && typeof value.days === 'object' && !Array.isArray(value.days) && Object.values(value.days).every(day => Array.isArray(day) && day.length <= 300);
  return false;
}

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
export const pruneParking = items => items; // Keep handled records so an offline device cannot revive them.
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
  // Keep deletion markers so a device returning after a long absence cannot revive old records.
  "notes.json": (local, remote, now) => ({ v: 1, notes: mergeById(local.notes, remote?.notes, "uid", "updated") }),
  // Tasks use the same records and source links on the phone and the web.
  "tasks.json": (local, remote, now) => ({ v: 1,
    tasks: mergeById(local.tasks, remote?.tasks, "uid", "updated"),
    next: (remote?.next?.updated || 0) > (local.next?.updated || 0) ? remote.next : (local.next || { uid: "", updated: 0 }),
  }),
  // Journal pages are written by the phone; same rule as JournalStore.merge.
  "journal.json": (local, remote, now) => ({ v: 1, pages: mergeById(local.pages, remote?.pages, "uid", "updated") }),
  // Workouts: same rule as GymStore.merge; deleted workouts stay as markers.
  "gym.json": (local, remote) => ({ v: 1, workouts: mergeById(local.workouts, remote?.workouts, "id", "updated") }),
};

