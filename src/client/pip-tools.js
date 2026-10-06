import { storage as localStorage } from './workspace-storage.js';
import { notes, tasks, parking, gym, noteTitle } from "./store.js";

export const CATEGORIES = [["notes", "Notes"], ["thoughts", "Thoughts"], ["tasks", "Tasks"], ["gym", "Gym"], ["coros", "Movement · COROS cache"]];
const permissionKey = value => "pocket:pip-access:" + value.provider + "|" + value.baseUrl;
export function access(value, storage = localStorage) {
  try { const allowed = JSON.parse(storage?.getItem(permissionKey(value)) || "[]"); return CATEGORIES.map(([key]) => key).filter(key => Array.isArray(allowed) && allowed.includes(key)); } catch { return []; }
}
export function saveAccess(value, categories, storage = localStorage) {
  storage.setItem(permissionKey(value), JSON.stringify(CATEGORIES.map(([key]) => key).filter(key => categories.includes(key))));
}
const text = description => ({ type: "string", description, maxLength: 200 });
const integer = (description, min, max, fallback) => ({ type: "integer", description, minimum: min, maximum: max, default: fallback });
const search = { query: text("Words to match; empty lists recent records."), limit: integer("Maximum results.", 1, 5, 5) };
const days = { days: integer("Calendar days ending today.", 1, 30, 7) };
const tool = (category, name, description, properties, required = []) => ({ category, name, description, input_schema: { type: "object", properties, required, additionalProperties: false } });
const TOOLS = [
  tool("notes", "search_notes", "Search saved Pocket notes. All query words must match. Read a result by id for its text; drafts are excluded.", search),
  tool("notes", "read_note", "Read one saved Pocket note, up to 6000 characters. No drafts or writes.", { id: { type: "string", description: "The id from search_notes.", maxLength: 80 } }, ["id"]),
  tool("thoughts", "search_thoughts", "Search undecided, parked Thoughts. Thoughts are separate from Tasks. Read only; never turns an idea into an action.", search),
  tool("tasks", "search_tasks", "Search chosen Pocket tasks, including completion and due date. Read only; never edits or completes a task.", search),
  tool("gym", "gym_summary", "Read locally saved workouts and their exercise sets from the last 1–30 days. Never edits a workout.", days),
  tool("coros", "coros_summary", "Read COROS readings already cached in Movement. Never refreshes or calls COROS. Check last_updated and stale; missing data is not a zero reading.", days)
];
export const definitions = value => TOOLS.filter(t => access(value).includes(t.category)).map(({ category, ...definition }) => structuredClone(definition));
const failure = (error, message) => ({ error, message });
const matches = (value, query) => query.toLowerCase().trim().split(/\s+/).filter(Boolean).every(word => value.toLowerCase().includes(word));
const excerpt = (value, query) => { const at = query.trim() ? value.toLowerCase().indexOf(query.trim().split(/\s+/)[0].toLowerCase()) : 0; return value.slice(Math.max(0, at - 100), Math.max(0, at - 100) + 500); };
const recent = (items, query) => items.filter(item => matches(item.text, query)).sort((a, b) => (b.updated || b.created || 0) - (a.updated || a.created || 0));
const cached = key => { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } };
export async function execute(value, name, args = {}, signal) {
  if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
  const definition = TOOLS.find(t => t.name === name);
  if (!definition || !access(value).includes(definition.category)) return failure("access_disabled", "Access to this Pocket source is off.");
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some(key => !(key in definition.input_schema.properties))) return failure("invalid_arguments", "Unrecognized tool arguments.");
  const query = args.query ?? "", limit = args.limit ?? 5, window = args.days ?? 7;
  if (typeof query !== "string" || query.length > 200 || !Number.isInteger(limit) || limit < 1 || limit > 5 || !Number.isInteger(window) || window < 1 || window > 30) return failure("invalid_arguments", "Use a short query, 1–5 results and 1–30 days.");
  let result;
  if (name === "search_notes") {
    const found = recent(notes.list(), query);
    result = { source: "pocket:notes", matched: found.length, truncated: found.length > limit, notes: found.slice(0, limit).map(n => ({ id: n.uid, title: noteTitle(n), excerpt: excerpt(n.text, query), text_truncated: n.text.length > 500 })) };
  } else if (name === "read_note") {
    if (typeof args.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(args.id)) return failure("invalid_arguments", "Use the id returned by search_notes.");
    const note = notes.get(args.id);
    result = note ? { source: "pocket:note:" + note.uid, id: note.uid, title: noteTitle(note), text: note.text.slice(0, 6000), truncated: note.text.length > 6000 } : failure("note_not_found", "That saved note is no longer available.");
  } else if (name === "search_thoughts" || name === "search_tasks") {
    const thought = name === "search_thoughts", found = recent(thought ? parking.open() : tasks.list(), query);
    const kind = thought ? "thoughts" : "tasks";
    result = { source: "pocket:" + kind, matched: found.length, truncated: found.length > limit, [kind]: found.slice(0, limit).map(item => ({ id: String(item.uid || item.id), text: excerpt(item.text, query), truncated: item.text.length > 500, ...(thought ? { state: "parked" } : { done: Boolean(item.done), due: item.due || "" }) })) };
  } else {
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - window + 1);
    if (name === "gym_summary") {
      const found = gym.all().filter(w => w.started >= +start);
      result = { source: "pocket:gym", days: window, matched: found.length, truncated: found.length > 10, workouts: found.slice(0, 10).map(w => ({ id: w.id, started: w.started, ended: w.ended, sets: gym.count(w), volume_kg: gym.volume(w), exercises: (w.entries || []).slice(0, 12).map(e => ({ exercise: e.exercise, sets: e.sets.slice(-8), truncated: e.sets.length > 8 })) })) };
    } else {
      // These two caches contain parsed readings, not the COROS session or OAuth tokens.
      const cockpit = cached("pocket:coros-cockpit"), activities = cached("pocket:coros-activities");
      const updated = Math.max(cockpit?.at || 0, activities?.at || 0);
      result = { source: "pocket:coros", available: Boolean(updated), cached_only: true, days: window, last_updated: updated ? new Date(updated).toISOString() : null, stale: !updated || Date.now() - updated >= 864e5 };
      if (!updated) result.message = "No cached COROS readings. Open Movement to refresh them.";
      const inRange = row => new Date(String(row.date) + "T12:00:00") >= start;
      if (cockpit) {
        for (const key of ["recovery", "fitness"]) if (cockpit[key] != null) result[key] = cockpit[key];
        for (const key of ["load", "sleep", "hrv", "resting"]) if (Array.isArray(cockpit[key])) result[key] = cockpit[key].filter(inRange).slice(-30);
        if (cockpit.daily) result.daily = { restingHr: cockpit.daily.restingHr, hrvBaseline: cockpit.daily.hrvBaseline, days: (cockpit.daily.days || []).filter(inRange).slice(-30) };
      }
      if (activities?.list) result.activities = activities.list.filter(item => item.start >= +start).slice(0, 10).map(item => ({ id: item.id, date: new Date(item.start).toISOString(), sport: item.type, distance_km: item.km, duration_seconds: item.seconds, average_hr_bpm: item.hr, name: item.name }));
    }
  }
  if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
  if (!access(value).includes(definition.category)) return failure("access_disabled", "Access to this Pocket source was switched off.");
  return JSON.stringify(result).length <= 8000 ? result : failure("result_too_large", "Use a narrower request.");
}
export function label(name, input = {}) {
  const query = typeof input?.query === "string" ? input.query.slice(0, 200) : "";
  if (name === "web_search") return "search web" + (query ? " · “" + query + "”" : "");
  if (name.startsWith("search_")) return "search " + name.slice(7) + (query ? " · “" + query + "”" : "");
  if (name === "read_note") return "read note";
  if (name === "coros_summary") return "read COROS cache · " + (input.days || 7) + " days";
  if (name === "gym_summary") return "read Gym · " + (input.days || 7) + " days";
  return name.replaceAll("_", " ");
}
export function summary(name, result) {
  if (result.error) return result.message || result.error;
  if (result.available === false) return result.message || "No cached data";
  if (name === "read_note") return result.title || "Note read";
  if (name === "coros_summary") return (result.stale ? "stale cache" : "cached readings") + (result.last_updated ? " · " + result.last_updated.slice(0, 10) : "");
  const count = result.matched || 0; return count + (name === "gym_summary" ? " workouts" : " matches") + (result.truncated ? " · partial" : "");
}
export function sources(name, result) {
  if (result.error || result.available === false) return [];
  if (name === "coros_summary") return [{ title: "Movement · COROS cache", href: "/movement" }];
  if (name === "read_note") return [{ title: result.title, href: "/notes/" + encodeURIComponent(result.id) }];
  const kind = name === "search_notes" ? "notes" : name === "search_thoughts" ? "thoughts" : name === "search_tasks" ? "tasks" : "gym";
  const items = result[kind] || result.workouts || [];
  return items.slice(0, 5).map(item => ({ title: item.title || item.text?.slice(0, 80) || new Date(item.started).toLocaleDateString(), href: "/" + kind + "/" + (kind === "gym" ? "w:" : "") + encodeURIComponent(item.id) }));
}
