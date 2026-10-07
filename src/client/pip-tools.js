import { storage as localStorage, tabStorage as sessionStorage } from './workspace-storage.js';
import { notes, tasks, parking, gym, noteTitle } from "./store.js";
import { agenda } from './planner.js';

// Web search for providers without their own: Firecrawl search and page reading. Works without a key at low volume;
// a Firecrawl key (API settings) raises the limits. The key stays in this tab, like provider keys.
const FIRECRAWL = "https://api.firecrawl.dev/v2", FIRECRAWL_KEY = "pocket:firecrawl-key";
export const firecrawlKey = (storage = sessionStorage) => storage.getItem(FIRECRAWL_KEY) || "";
export function setFirecrawlKey(key, storage = sessionStorage) { const value = String(key || "").trim(); if (value.length > 200 || /\s/.test(value)) throw new Error("Check the Firecrawl key."); if (value) storage.setItem(FIRECRAWL_KEY, value); else storage.removeItem(FIRECRAWL_KEY); }
export const webTools = value => Boolean(value.webSearch);

export const CATEGORIES = [["notes", "Notes"], ["thoughts", "Thoughts"], ["tasks", "Tasks"], ["calendar", "Calendar"], ["gym", "Gym"], ["coros", "Movement · COROS cache"]];
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
const paging = { offset: integer("Character offset; use next_offset to continue.", 0, 200000, 0), length: integer("Characters to read.", 200, 6000, 6000) };
const recordId = { type: "string", description: "The id returned by a Pocket search.", maxLength: 80, minLength: 1, pattern: "^[A-Za-z0-9_-]+$" };
const tool = (category, name, description, properties, required = []) => ({ category, name, description, input_schema: { type: "object", properties, required, additionalProperties: false } });
const TOOLS = [
  tool("notes", "search_notes", "Search saved Pocket notes. All query words must match. Read a result by id for its text; drafts are excluded.", search),
  tool("notes", "read_note", "Read a saved Pocket note in pages. Use next_offset for more text. No drafts or writes.", { id: recordId, ...paging }, ["id"]),
  tool("thoughts", "search_thoughts", "Search undecided, parked Thoughts. Thoughts are separate from Tasks. Read only; never turns an idea into an action.", search),
  tool("tasks", "search_tasks", "Search chosen Pocket tasks, including completion and due date. Read only; never edits or completes a task.", search),
  tool("tasks", "read_task", "Read a chosen Pocket task, its steps, source, due date and completion. Never edits a task.", { id: recordId }, ["id"]),
  tool("calendar", "search_calendar", "Search saved Calendar appointments from today through the next 1–30 days. Read only.", { ...search, days: integer("Calendar days beginning today.", 1, 30, 7) }),
  tool("pocket", "search_pocket", "Search Notes, Tasks, parked Thoughts and Calendar together, using only granted categories. Returns links and excerpts.", { query: search.query, limit: integer("Maximum results.", 1, 10, 10), days: integer("Calendar days beginning today.", 1, 30, 7) }),
  tool("universal", "update_plan", "Show or update a short plan for this reply. Changes only the displayed plan; never saves Pocket records.", { steps: { type: "array", minItems: 1, maxItems: 6, items: { type: "object", properties: { text: { type: "string", minLength: 1, maxLength: 160 }, status: { type: "string", enum: ["pending", "in_progress", "done"] } }, required: ["text", "status"], additionalProperties: false } } }, ["steps"]),
  tool("universal", "propose_action", "Prepare a note, task or appointment for the user to review and save with a tap. Never saves or changes data. Appointment proposals need when; task due is YYYY-MM-DD.", { kind: { type: "string", enum: ["note", "task", "appointment"] }, title: { type: "string", minLength: 1, maxLength: 200 }, text: { type: "string", maxLength: 6000 }, due: { type: "string", maxLength: 10 }, steps: { type: "array", maxItems: 12, items: { type: "string", minLength: 1, maxLength: 160, pattern: "^[^\\r\\n]+$" } }, when: { type: "string", maxLength: 40 }, minutes: integer("Appointment duration in minutes.", 15, 480, 60) }, ["kind", "title", "text"]),
  tool("gym", "gym_summary", "Read locally saved workouts and their exercise sets from the last 1–30 days. Never edits a workout.", days),
  tool("coros", "coros_summary", "Read COROS readings already cached in Movement. Never refreshes or calls COROS. Check last_updated and stale; missing data is not a zero reading.", days)
];
const WEB = [
  { name: "search_web", description: "Search current web information. Optionally limit to five domains and a time range. Cite the urls you use.", input_schema: { type: "object", properties: { query: { type: "string", minLength: 1, description: "What to search for.", maxLength: 300 }, limit: integer("Maximum results.", 1, 5, 5), domains: { type: "array", maxItems: 5, items: { type: "string", maxLength: 253 } }, time_range: { type: "string", enum: ["any", "day", "week", "month", "year"], default: "any" } }, required: ["query"], additionalProperties: false } },
  { name: "read_web_page", description: "Read a public page in 200–6000 character pages. Use next_offset to continue. Optional query finds relevant passages at or after offset; pages are cached for this reply.", input_schema: { type: "object", properties: { url: { type: "string", description: "The page's public https URL.", maxLength: 2048 }, ...paging, query: search.query }, required: ["url"], additionalProperties: false } },
];
const pocketCategories = ["notes", "tasks", "thoughts", "calendar"];
const permitted = (value, definition) => definition.category === "universal" || definition.category === "pocket" ? definition.category === "universal" || access(value).some(c => pocketCategories.includes(c)) : definition.category ? access(value).includes(definition.category) : webTools(value);
export const definitions = value => [...TOOLS.filter(t => permitted(value, t)).map(({ category, ...definition }) => structuredClone(definition)), ...(webTools(value) ? structuredClone(WEB) : [])];
export const checkpointIdentity = value => [value.provider, value.baseUrl, value.model].join("|");
export const accessFingerprint = value => { const granted = access(value); return CATEGORIES.map(([category]) => granted.includes(category) ? "1" : "0").join(""); };
export const cacheKey = (name, args) => name + ":" + JSON.stringify(canonical(args));
function canonical(value) { return Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value; }
function valid(value, schema) {
  if (schema.type === "object") return value && typeof value === "object" && !Array.isArray(value) && (!schema.required || schema.required.every(key => Object.hasOwn(value, key))) && Object.keys(value).every(key => Object.hasOwn(schema.properties, key) && valid(value[key], schema.properties[key]));
  if (schema.type === "array") return Array.isArray(value) && value.length >= (schema.minItems || 0) && value.length <= (schema.maxItems ?? Infinity) && value.every(item => valid(item, schema.items));
  if (schema.type === "integer") return Number.isInteger(value) && value >= schema.minimum && value <= schema.maximum;
  return typeof value === "string" && value.length >= (schema.minLength || 0) && value.length <= (schema.maxLength ?? Infinity) && (!schema.enum || schema.enum.includes(value)) && (!schema.pattern || new RegExp(schema.pattern).test(value));
}
export function publicUrl(raw) {
  let url; try { url = new URL(raw); } catch { return null; }
  const host = url.hostname.toLowerCase().replace(/\.$/, ""), ip = host.split(".").map(Number);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || raw.length > 2048 || !host.includes(".") || host.includes(":") || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && (ip[0] === 0 || ip[0] === 10 || ip[0] === 127 || ip[0] >= 224 || ip[0] === 169 && ip[1] === 254 || ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31 || ip[0] === 192 && ip[1] === 168 || ip[0] === 100 && ip[1] >= 64 && ip[1] <= 127 || ip[0] === 198 && [18, 19].includes(ip[1]))) return null;
  return url;
}
function pageText(text, args) {
  const length = args.length ?? 6000, requested = args.offset ?? 0, query = (args.query || "").trim(), at = query ? text.toLowerCase().indexOf(query.toLowerCase(), requested) : requested, context = Math.min(100, Math.max(0, length - query.length)), offset = at < 0 ? requested : Math.max(requested, at - context);
  const end = Math.min(text.length, offset + length), result = { text: text.slice(offset, end), offset, total_length: text.length, next_offset: end < text.length && end <= 200000 ? end : null, truncated: end < text.length };
  if (query) { result.query = query; result.passages = at < 0 ? [] : [{ offset, text: result.text.slice(0, 600) }]; result.query_found = at >= 0; }
  return result;
}
async function web(value, name, args, signal, context) {
  if (!webTools(value)) return failure("access_disabled", "Web search is off.");
  const key = firecrawlKey(), headers = { "content-type": "application/json", ...(key ? { authorization: "Bearer " + key } : {}) };
  const post = (path, body) => fetch(FIRECRAWL + path, { method: "POST", headers, body: JSON.stringify(body), signal, credentials: "omit", referrerPolicy: "no-referrer" });
  const refused = status => failure("web_unavailable", status === 401 || status === 402 || status === 429 ? "Web search is unavailable right now (Firecrawl " + status + "). A Firecrawl key in API settings raises the limit." : "Web search failed (Firecrawl " + status + ").");
  if (name === "search_web") {
    const query = typeof args.query === "string" ? args.query.trim() : "", limit = args.limit ?? 5;
    const domains = args.domains || [], time = { day: "qdr:d", week: "qdr:w", month: "qdr:m", year: "qdr:y" }[args.time_range];
    if (!query || domains.some(domain => !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain) || !publicUrl("https://" + domain))) return failure("invalid_arguments", "Use a short query and public domain names without a protocol or path.");
    // Firecrawl's documented domain and recency filters: docs.firecrawl.dev/features/search.
    const response = await post("/search", { query, limit, timeout: 20000, ...(domains.length ? { includeDomains: domains.map(domain => domain.toLowerCase()) } : {}), ...(time ? { tbs: time } : {}) });
    if (!response.ok) return refused(response.status);
    const found = await response.json(), list = Array.isArray(found.data) ? found.data : found.data?.web || [];
    return { source: "web:firecrawl", query, results: list.slice(0, limit).filter(item => publicUrl(String(item.url || ""))).map(item => ({ title: String(item.title || item.url).slice(0, 160), url: String(item.url).slice(0, 2048), description: String(item.description || "").slice(0, 400) })) };
  }
  const url = publicUrl(args.url); if (!url) return failure("invalid_arguments", "Use a public https URL.");
  const pageKey = "page:" + url.href, cache = context?.cache;
  let page = cache?.get(pageKey), reused = Boolean(page);
  if (!page) {
    const pending = (async () => {
      const response = await post("/scrape", { url: url.href, formats: ["markdown"], onlyMainContent: true, timeout: 20000 });
      if (!response.ok) return refused(response.status);
      return (await response.json()).data || {};
    })();
    cache?.set(pageKey, pending);
    try { page = await pending; if (page.error) cache?.delete(pageKey); else cache?.set(pageKey, page); }
    catch (error) { cache?.delete(pageKey); throw error; }
  } else page = await page;
  if (page.error) return page;
  return { source: url.href, url: url.href, title: String(page.metadata?.title || url.hostname).slice(0, 160), ...pageText(String(page.markdown || ""), args), ...(reused ? { cached: true } : {}) };
}
const failure = (error, message) => ({ error, message });
const matches = (value, query) => query.toLowerCase().trim().split(/\s+/).filter(Boolean).every(word => String(value || "").toLowerCase().includes(word));
const excerpt = (value, query) => { const at = query.trim() ? value.toLowerCase().indexOf(query.trim().split(/\s+/)[0].toLowerCase()) : 0; return value.slice(Math.max(0, at - 100), Math.max(0, at - 100) + 500); };
const recent = (items, query) => items.filter(item => matches(item.text, query)).sort((a, b) => (b.updated || b.created || 0) - (a.updated || a.created || 0));
const cached = key => { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } };
const grantSignature = (value, name) => name === "search_pocket" ? access(value).filter(c => pocketCategories.includes(c)).sort().join("|") : name === "read_task" ? (access(value).includes("notes") ? "notes" : "") : "";
const bounded = result => JSON.stringify(result).length <= 8000 ? result : failure("result_too_large", "Use a shorter page or narrower request.");
const validDay = raw => /^\d{4}-\d{2}-\d{2}$/.test(raw) && Number.isFinite(Date.parse(raw + "T12:00:00Z")) && new Date(raw + "T12:00:00Z").toISOString().slice(0, 10) === raw;
function validInstant(raw) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(raw);
  return Boolean(match && validDay(match[1]) && +match[2] < 24 && +match[3] < 60 && +(match[4] || 0) < 60 && +(match[5] || 0) <= 18 && +(match[6] || 0) < 60 && (+match[5] !== 18 || +match[6] === 0) && Number.isFinite(Date.parse(raw)));
}
const calendarItems = days => { const start = new Date(); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + days); return agenda.all().filter(item => item.when < +end && item.when + item.minutes * 60000 > +start); };
export async function execute(value, name, args = {}, signal, context = {}) {
  if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
  const definition = TOOLS.find(t => t.name === name) || WEB.find(t => t.name === name);
  if (!definition || !permitted(value, definition)) return failure("access_disabled", "Access to this source is off or this tool is unavailable.");
  if (!valid(args, definition.input_schema)) return failure("invalid_arguments", "Check the tool arguments and their limits.");
  const cache = context.cache, entryKey = cacheKey(name, args), signature = grantSignature(value, name), reuse = definition.category !== "universal", saved = reuse && cache?.get(entryKey);
  if (saved && saved.permissions === signature) return bounded({ ...structuredClone(saved.result), cached: true });
  const query = args.query ?? "", limit = args.limit ?? (name === "search_pocket" ? 10 : 5), window = args.days ?? 7;
  let result;
  if (name === "search_web" || name === "read_web_page") result = await web(value, name, args, signal, context);
  else if (name === "update_plan") result = args.steps.some(step => !step.text.trim()) ? failure("invalid_arguments", "Write nonempty plan steps.") : { kind: "plan", plan: args.steps.map(step => ({ text: step.text.trim(), status: step.status })) };
  else if (name === "propose_action") {
    const due = args.due || "", when = args.when || "";
    if (!args.title.trim() || args.steps?.some(step => !step.trim()) || due && !validDay(due) || when && !validInstant(when) || args.kind === "appointment" && !when) return failure("invalid_arguments", "Use a title, valid date and time, and nonempty steps. Appointments need an ISO date and time with timezone.");
    result = { kind: "proposal", proposal: { kind: args.kind, title: args.title.trim(), text: args.text, due, steps: (args.steps || []).map(step => step.trim()), when, minutes: args.minutes ?? 60 }, requires_confirmation: true };
  } else if (name === "search_calendar") {
    const found = calendarItems(window).filter(item => matches(item.title, query));
    result = { source: "pocket:calendar", days: window, matched: found.length, truncated: found.length > limit, appointments: found.slice(0, limit).map(item => ({ id: item.uid, title: item.title, when: new Date(item.when).toISOString(), minutes: item.minutes, task_uid: item.task_uid || "", href: "/calendar/" + encodeURIComponent(item.uid) })) };
  } else if (name === "search_pocket") {
    const grants = access(value), found = [], add = (collection, item, title, content) => { const id = String(item.uid || item.id), href = "/" + collection + "/" + encodeURIComponent(id), kind = collection === "calendar" ? "appointment" : collection.slice(0, -1); if (matches(content, query)) found.push({ kind, type: kind, id, title: title.slice(0, 200), excerpt: excerpt(content, query), href, route: href, updated: item.updated || item.created || 0 }); };
    if (grants.includes("notes")) for (const item of notes.list()) add("notes", item, noteTitle(item), item.text);
    if (grants.includes("tasks")) for (const item of tasks.list()) add("tasks", item, item.text, [item.text, ...(item.steps || []).map(step => step.text)].join("\n"));
    if (grants.includes("thoughts")) for (const item of parking.open()) add("thoughts", item, item.text, item.text);
    if (grants.includes("calendar")) for (const item of calendarItems(window)) add("calendar", item, item.title, item.title);
    found.sort((a, b) => b.updated - a.updated);
    result = { source: "pocket:workspace", matched: found.length, truncated: found.length > limit, results: found.slice(0, limit).map(({ updated, ...item }) => item) };
  } else if (name === "read_task") {
    const item = tasks.get(args.id);
    const restricted = (item?.source?.kind === "note" || item?.source?.note_uid) && !access(value).includes("notes");
    result = item ? { source: "pocket:task:" + item.uid, id: item.uid, text: item.text, title: item.text, due: item.due || "", completed: Boolean(item.done), done: Boolean(item.done), steps: (item.steps || []).map(step => ({ text: String(step.text || "").slice(0, 200), done: Boolean(step.done) })), task_source: item.source ? { kind: item.source.kind || "", name: restricted ? "" : String(item.source.name || "").slice(0, 200), text: restricted ? "" : String(item.source.text || "").slice(0, 4000), note_uid: item.source.note_uid || "", ...(restricted ? { access_disabled: true } : {}) } : null } : failure("task_not_found", "That task is no longer available.");
  } else if (name === "search_notes") {
    const found = recent(notes.list(), query);
    result = { source: "pocket:notes", matched: found.length, truncated: found.length > limit, notes: found.slice(0, limit).map(n => ({ id: n.uid, title: noteTitle(n), excerpt: excerpt(n.text, query), text_truncated: n.text.length > 500 })) };
  } else if (name === "read_note") {
    if (typeof args.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(args.id)) return failure("invalid_arguments", "Use the id returned by search_notes.");
    const note = notes.get(args.id);
    result = note ? { source: "pocket:note:" + note.uid, id: note.uid, title: noteTitle(note), ...pageText(note.text, args) } : failure("note_not_found", "That saved note is no longer available.");
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
  if (!permitted(value, definition) || signature !== grantSignature(value, name)) return failure("access_disabled", "Access to this source was switched off.");
  if (reuse && !result.error) result = { ...result, access_fingerprint: accessFingerprint(value), request_identity: checkpointIdentity(value) };
  result = bounded(result);
  if (reuse && !result.error) cache?.set(entryKey, { permissions: signature, result: structuredClone(result) });
  return result;
}
export function label(name, input = {}) {
  const query = typeof input?.query === "string" ? input.query.slice(0, 200) : "";
  if (name === "web_search" || name === "search_web") return "search web" + (query ? " · “" + query + "”" : "");
  if (name === "read_web_page") { try { return "read page · " + new URL(input.url).hostname; } catch { return "read page"; } }
  if (name === "search_pocket") return "search Pocket" + (query ? " · “" + query + "”" : "");
  if (name.startsWith("search_")) return "search " + name.slice(7) + (query ? " · “" + query + "”" : "");
  if (name === "read_note") return "read note";
  if (name === "read_task") return "read task";
  if (name === "update_plan") return "update plan";
  if (name === "propose_action") return "prepare " + (input.kind || "action");
  if (name === "coros_summary") return "read COROS cache · " + (input.days || 7) + " days";
  if (name === "gym_summary") return "read Gym · " + (input.days || 7) + " days";
  return name.replaceAll("_", " ");
}
function resultSummary(name, result) {
  if (result.error) return result.message || result.error;
  if (result.available === false) return result.message || "No cached data";
  if (name === "read_note" || name === "read_task") return result.title || "Record read";
  if (name === "update_plan") return result.plan.filter(step => step.status === "done").length + "/" + result.plan.length + " steps";
  if (name === "propose_action") return result.proposal.title + " · ready to review";
  if (name === "search_web") return (result.results?.length || 0) + " results";
  if (name === "read_web_page") return result.title || "Page read";
  if (name === "coros_summary") return (result.stale ? "stale cache" : "cached readings") + (result.last_updated ? " · " + result.last_updated.slice(0, 10) : "");
  const count = result.matched || 0; return count + (name === "gym_summary" ? " workouts" : " matches") + (result.truncated ? " · partial" : "");
}
export const summary = (name, result) => (result.cached ? "cached · " : "") + resultSummary(name, result);
export function sources(name, result) {
  if (result.error || result.available === false) return [];
  if (name === "coros_summary") return [{ title: "Movement · COROS cache", href: "/movement" }];
  if (name === "read_note") return [{ title: result.title, href: "/notes/" + encodeURIComponent(result.id) }];
  if (name === "read_task") return [{ title: result.title, href: "/tasks/" + encodeURIComponent(result.id) }];
  if (name === "search_calendar") return (result.appointments || []).map(item => ({ title: item.title, href: item.href }));
  if (name === "search_pocket") return (result.results || []).map(item => ({ title: item.title, href: item.href }));
  if (name === "update_plan" || name === "propose_action") return [];
  if (name === "search_web") return (result.results || []).map(item => ({ title: item.title, href: item.url }));
  if (name === "read_web_page") return [{ title: result.title, href: result.url }];
  const kind = name === "search_notes" ? "notes" : name === "search_thoughts" ? "thoughts" : name === "search_tasks" ? "tasks" : "gym";
  const items = result[kind] || result.workouts || [];
  return items.slice(0, 5).map(item => ({ title: item.title || item.text?.slice(0, 80) || new Date(item.started).toLocaleDateString(), href: "/" + kind + "/" + (kind === "gym" ? "w:" : "") + encodeURIComponent(item.id) }));
}
