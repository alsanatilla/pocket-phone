import { storage as localStorage, tabStorage as sessionStorage, activeAccount } from './workspace-storage.js';
import { corosAction, corosProblem, corosTitle } from '../shared/coros-course.js';
import { notes, tasks, parking, gym, noteTitle, NOTE_LIMIT } from "./store.js";
import { agenda } from './planner.js';
import { readChatHistory } from './pip-memory.js';
import { applyProposal, applyChange, applyCoros } from './pip-actions.js';

// Web search runs through Firecrawl for every provider: search_web and read_web_page. Works without a key at low volume;
// a Firecrawl key (API settings) raises the limits. The key stays in this tab, like provider keys.
const FIRECRAWL = "https://api.firecrawl.dev/v2", FIRECRAWL_KEY = "pocket:firecrawl-key";
export const firecrawlKey = (storage = sessionStorage) => storage.getItem(FIRECRAWL_KEY) || "";
export function setFirecrawlKey(key, storage = sessionStorage) { const value = String(key || "").trim(); if (value.length > 200 || /\s/.test(value)) throw new Error("Check the Firecrawl key."); if (value) storage.setItem(FIRECRAWL_KEY, value); else storage.removeItem(FIRECRAWL_KEY); }
export const webTools = value => Boolean(value.webSearch);

export const CATEGORIES = [["notes", "Notes"], ["thoughts", "Thoughts"], ["tasks", "Tasks"], ["calendar", "Calendar"], ["gym", "Gym"], ["coros", "COROS"]];
const permissionKey = value => "pocket:pip-access:" + value.provider + "|" + value.baseUrl;
export function access(value, storage = localStorage) {
  try { const allowed = JSON.parse(storage?.getItem(permissionKey(value)) || "[]"); return CATEGORIES.map(([key]) => key).filter(key => Array.isArray(allowed) && allowed.includes(key)); } catch { return []; }
}
export function saveAccess(value, categories, storage = localStorage) {
  storage.setItem(permissionKey(value), JSON.stringify(CATEGORIES.map(([key]) => key).filter(key => categories.includes(key))));
}
// Live COROS (MCP through the Pocket account). Training plans stay read-only: a plan is larger than a whole reply budget.
export const COROS_READS = ["querySportRecords", "getActivityDetail", "analyzeActivityDetail", "queryActivityLapData", "queryCustomActivityLapData", "queryActivityFitFileDownloadUrls", "queryDailyHealthData", "querySleepOverview", "querySleepHrv", "queryRestingHeartRate", "queryAvgHeartRate", "queryStressLevel", "queryStressTimeSeries", "queryHealthCheckTimeSeries", "queryRecoveryStatus", "queryTrainingLoadAssessment", "queryFitnessAssessmentOverview", "queryMenstruationCycles", "queryTrainingSchedule", "queryScheduledWorkoutDetails", "queryWorkoutLibrary", "queryWorkoutDetails", "queryTrainingPlanLibrary", "queryTrainingPlanDetails", "queryUserInfo", "queryDevices"];
export const COROS_WRITES = ["createScheduledWorkout", "scheduleWorkout", "createSingleWorkout", "updateScheduledWorkout", "updateWorkoutDetails"];
export const COROS_INDEX = [
  "querySportRecords(startDate, endDate, sportTypeCodes, minDistanceKm, maxDistanceKm, minDurationMinutes, maxDurationMinutes, maxAveragePace, locationKeyword, limit): activities with filters",
  "getActivityDetail / analyzeActivityDetail(labelId, sportType[, focus]) · queryActivityLapData(labelId, sportType) · queryCustomActivityLapData(labelId, sportType, startTimestamp, endTimestamp): one activity",
  "queryDailyHealthData(days) · querySleepOverview / querySleepHrv / queryAvgHeartRate / queryHealthCheckTimeSeries / queryStressTimeSeries(startDate, endDate, days) · queryRestingHeartRate / queryStressLevel(days): health",
  "queryRecoveryStatus() · queryTrainingLoadAssessment(days) · queryFitnessAssessmentOverview(): recovery, load, VO2max and race predictions",
  "queryTrainingSchedule(startDate, endDate) · queryScheduledWorkoutDetails(date, idInPlan) · queryWorkoutLibrary(sportType, courseType) · queryWorkoutDetails(workoutId): planned and saved workouts",
  "queryTrainingPlanLibrary(statusList, planType, weeks, cursor) · queryTrainingPlanDetails(planId, startDay, endDay) · queryMenstruationCycles(startDay, endDay) · queryUserInfo() · queryDevices() · queryActivityFitFileDownloadUrls(startDate, endDate, sportType, labelId, limit)"
].join("\n");
export const COROS_ARGUMENTS = { coros_read: 4000, coros_write: 6000 };
// The grant each tool needs. Descriptions and input schemas live in pip-sdk-tools.js, which loads with the AI SDK.
const TOOL_CATEGORIES = { search_notes: "notes", read_note: "notes", search_thoughts: "thoughts", search_tasks: "tasks", read_task: "tasks", search_calendar: "calendar", search_pocket: "pocket",
  read_chat_history: "universal", update_plan: "universal", create_record: "universal", change_record: "changes", gym_summary: "gym",
  coros_summary: "coros", coros_read: "coros", coros_format: "coros", coros_write: "coros", search_web: "web", read_web_page: "web" };
const pocketCategories = ["notes", "tasks", "thoughts", "calendar"];
/** Tools that show or change something instead of reading: never cached, never replayed as observations. The propose_* names are earlier replies' review cards. */
export const STATE_TOOLS = ["update_plan", "create_record", "change_record", "coros_write", "propose_action", "propose_change", "propose_coros"];
/** Tools that write to Pocket or COROS. The AI SDK holds each call until the user approves or declines it. */
export const WRITE_TOOLS = ["create_record", "change_record", "coros_write"];
const CHANGE_CATEGORY = { complete_task: "tasks", update_task: "tasks", append_note: "notes", move_appointment: "calendar" };
const CHANGE_NAMES = { complete_task: "complete task", update_task: "update task", append_note: "add to note", move_appointment: "move appointment" };
export const changeName = change => CHANGE_NAMES[change] || "change";
export const changeTarget = change => ({ tasks: "task", notes: "note", calendar: "appointment" })[CHANGE_CATEGORY[change]] || "record";
const permitted = (value, name) => {
  const category = TOOL_CATEGORIES[name];
  if (category === "universal") return true;
  if (category === "changes") return access(value).some(c => ["tasks", "notes", "calendar"].includes(c));
  if (category === "pocket") return access(value).some(c => pocketCategories.includes(c));
  return category === "web" ? webTools(value) : Boolean(category) && access(value).includes(category);
};
export const toolNames = value => Object.keys(TOOL_CATEGORIES).filter(name => permitted(value, name));
export const checkpointIdentity = value => [value.provider, value.baseUrl, value.model].join("|");
export const accessFingerprint = value => { const granted = access(value); return CATEGORIES.map(([category]) => granted.includes(category) ? "1" : "0").join(""); };
export const historyPolicy = value => ({ offered: toolNames(value), stateTools: STATE_TOOLS, identity: checkpointIdentity(value), fingerprint: accessFingerprint(value), grants: access(value), webSearch: webTools(value) });
export const cacheKey = (name, args) => name + ":" + JSON.stringify(canonical(args));
function canonical(value) { return Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value; }
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
    const sources = args.sources || [], categories = args.categories || [];
    if (!query || domains.some(domain => !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain) || !publicUrl("https://" + domain))
      || sources.some(source => !["web", "news", "images"].includes(source)) || categories.some(category => !["research", "pdf", "github"].includes(category))) return failure("invalid_arguments", "Use a short query, public domains without a protocol or path, and known sources or categories.");
    // Firecrawl's documented filters: docs.firecrawl.dev/features/search.
    const response = await post("/search", { query, limit, timeout: 20000, ...(domains.length ? { includeDomains: domains.map(domain => domain.toLowerCase()) } : {}), ...(time ? { tbs: time } : {}), ...(sources.length ? { sources } : {}), ...(categories.length ? { categories } : {}) });
    if (!response.ok) return refused(response.status);
    const found = await response.json();
    if (!found || found.success === false || found.error || !found.data || typeof found.data !== "object") return failure("web_unavailable", "Web search returned an unsuccessful response.");
    const groups = Array.isArray(found.data) ? [["web", found.data]] : Object.entries(found.data).filter(([kind, items]) => ["web", "news", "images"].includes(kind) && Array.isArray(items));
    const results = [], seen = new Set();
    // Interleave groups: five web hits must not hide all the news hits in a mixed search.
    for (let index = 0; index < Math.max(0, ...groups.map(([, items]) => items.length)) && results.length < limit; index++) {
      for (const [kind, items] of groups) {
        const item = items[index], url = item && publicUrl(String(item.url || ""));
        if (!url || seen.has(url.href) || results.length >= limit) continue;
        seen.add(url.href);
        results.push({ title: String(item.title || item.url).slice(0, 160), url: url.href, description: String(item.description || item.snippet || "").slice(0, 400), source_type: kind, ...(typeof item.date === "string" && item.date ? { date: item.date.slice(0, 120) } : {}) });
      }
    }
    return { source: "web:firecrawl", query, results };
  }
  const url = publicUrl(args.url); if (!url) return failure("invalid_arguments", "Use a public https URL.");
  const pageKey = "page:" + url.href, cache = context?.cache;
  let page = cache?.get(pageKey), reused = Boolean(page);
  if (!page) {
    const pending = (async () => {
      const response = await post("/scrape", { url: url.href, formats: ["markdown"], onlyMainContent: true, timeout: 20000 });
      if (!response.ok) return refused(response.status);
      const found = await response.json(), page = found?.data;
      if (!found || found.success === false || found.error || !page || typeof page !== "object") return failure("web_unavailable", "The page could not be retrieved.");
      const status = Number(page.metadata?.statusCode);
      if (page.metadata?.error || status && !(status >= 200 && status < 300 || status === 304)) return failure("web_unavailable", "The source page did not load successfully.");
      if (typeof page.markdown !== "string" || !page.markdown.trim()) return failure("web_unavailable", "The source returned no readable page text.");
      return page;
    })();
    cache?.set(pageKey, pending);
    try { page = await pending; if (page.error) cache?.delete(pageKey); else cache?.set(pageKey, page); }
    catch (error) { cache?.delete(pageKey); throw error; }
  } else page = await page;
  if (page.error) return page;
  const metadata = page.metadata || {}, date = keys => keys.map(key => metadata[key]).find(value => typeof value === "string" && value.trim());
  const published = date(["publishedTime", "publishedDate", "datePublished", "article:published_time"]), modified = date(["modifiedTime", "modifiedDate", "dateModified", "article:modified_time"]);
  return { source: url.href, url: url.href, title: String(metadata.title || url.hostname).slice(0, 160), ...(published ? { published_at: published.slice(0, 120) } : {}), ...(modified ? { modified_at: modified.slice(0, 120) } : {}), ...pageText(page.markdown, args), ...(reused ? { cached: true } : {}) };
}
const failure = (error, message) => ({ error, message });
const matches = (value, query) => query.toLowerCase().trim().split(/\s+/).filter(Boolean).every(word => String(value || "").toLowerCase().includes(word));
const excerpt = (value, query) => { const at = query.trim() ? value.toLowerCase().indexOf(query.trim().split(/\s+/)[0].toLowerCase()) : 0; return value.slice(Math.max(0, at - 100), Math.max(0, at - 100) + 500); };
const recent = (items, query) => items.filter(item => matches(item.text, query)).sort((a, b) => (b.updated || b.created || 0) - (a.updated || a.created || 0));
const cached = key => { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } };
export const grantSignature = (value, name) => name === "read_chat_history" ? accessFingerprint(value) + "|" + Number(webTools(value)) : name === "search_pocket" ? access(value).filter(c => pocketCategories.includes(c)).sort().join("|") : name === "read_task" ? (access(value).includes("notes") ? "notes" : "") : "";
const bounded = result => JSON.stringify(result).length <= 8000 ? result : failure("result_too_large", "Use a shorter page or narrower request.");
const validDay = raw => /^\d{4}-\d{2}-\d{2}$/.test(raw) && Number.isFinite(Date.parse(raw + "T12:00:00Z")) && new Date(raw + "T12:00:00Z").toISOString().slice(0, 10) === raw;
function validInstant(raw) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(raw);
  return Boolean(match && validDay(match[1]) && +match[2] < 24 && +match[3] < 60 && +(match[4] || 0) < 60 && +(match[5] || 0) <= 18 && +(match[6] || 0) < 60 && (+match[5] !== 18 || +match[6] === 0) && Number.isFinite(Date.parse(raw)));
}
const calendarItems = days => { const start = new Date(); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + days); return agenda.all().filter(item => item.when < +end && item.when + item.minutes * 60000 > +start); };
/** Validates a change against the record as it is now and keeps a short "before" for the review. Nothing is written here. */
function changeProposal(value, args) {
  const category = CHANGE_CATEGORY[args.change], reason = (args.reason || "").trim();
  if (!access(value).includes(category)) return failure("access_disabled", "Turn on " + category + " access before proposing this change.");
  const ready = (change, before) => ({ kind: "change", change: { change: args.change, ...change, ...(reason ? { reason } : {}) }, before, requires_confirmation: true });
  if (args.change === "complete_task" || args.change === "update_task") {
    const task = tasks.get(args.id); if (!task) return failure("task_not_found", "That task is no longer available.");
    const before = { title: task.text, due: task.due || "", done: Boolean(task.done), steps: (task.steps || []).length };
    if (args.change === "complete_task") return task.done ? failure("already_done", "That task is already complete.") : ready({ id: task.uid }, before);
    const add = (args.add_steps || []).map(step => step.trim()).filter(step => !(task.steps || []).some(old => old.text === step));
    if (args.title !== undefined && !args.title.trim() || args.due && !validDay(args.due) || (args.add_steps || []).some(step => !step.trim())) return failure("invalid_arguments", "Use a nonempty title, a YYYY-MM-DD due date (or empty to clear) and nonempty steps.");
    if ((task.steps || []).length + add.length > 12) return failure("too_many_steps", "A task keeps at most 12 steps.");
    if (args.title === undefined && args.due === undefined && !add.length) return failure("invalid_arguments", "Change the title, due date or steps.");
    return ready({ id: task.uid, ...(args.title !== undefined ? { title: args.title.trim() } : {}), ...(args.due !== undefined ? { due: args.due } : {}), add_steps: add }, before);
  }
  if (args.change === "append_note") {
    const note = notes.get(args.id), text = (args.text || "").trim();
    if (!note) return failure("note_not_found", "That saved note is no longer available.");
    if (!text) return failure("invalid_arguments", "Write the text to add.");
    if (note.text.trimEnd().length + text.length + 2 > NOTE_LIMIT) return failure("note_full", "The note would exceed its length limit.");
    return ready({ id: note.uid, text }, { title: noteTitle(note), ending: note.text.trimEnd().slice(-240) });
  }
  const item = agenda.get(args.id);
  if (!item) return failure("appointment_not_found", "That appointment is no longer available.");
  if (!args.when || !validInstant(args.when)) return failure("invalid_arguments", "Use an ISO date and time with timezone.");
  return ready({ id: item.uid, when: args.when, minutes: args.minutes ?? item.minutes }, { title: item.title, when: new Date(item.when).toISOString(), minutes: item.minutes });
}
/** Live COROS goes through the signed-in Pocket account, which holds the COROS connection. */
async function corosApi(action, body, signal) {
  if (!activeAccount()) return { failed: failure("coros_unavailable", "Sign in to Pocket and connect COROS in Movement to use live COROS data.") };
  let response, value = {};
  try { response = await fetch("/api/coros/" + action, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, accountId: activeAccount() }), signal }); }
  catch (error) { if (error?.name === "AbortError") throw error; return { failed: failure("coros_unavailable", "Pocket could not reach COROS. Try again shortly.") }; }
  try { value = await response.json(); } catch { /* reported below */ }
  if (!response.ok) return { failed: failure(response.status === 422 ? "coros_refused" : "coros_unavailable", String(value.error || "COROS is unavailable.").slice(0, 800)) };
  return { value };
}
/** A page that still fits the 8,000-character result limit after JSON escaping (COROS formats are full of quotes). */
function fitted(text, args, fields) {
  for (let length = args.length ?? 6000; ; length = Math.floor(length * 0.8)) {
    const result = { ...fields, ...pageText(text, { ...args, length }) };
    if (JSON.stringify(result).length <= 7600 || length <= 200) return result;
  }
}
const formats = new Map();
const firstSentence = text => (String(text).match(/^[\s\S]*?\.(?:\s|$)/)?.[0] || String(text)).trim();
const slimSchema = value => Array.isArray(value) ? value.map(slimSchema) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === "description" && typeof item === "string" ? firstSentence(item) : slimSchema(item)])) : value;
async function corosFormat(args, signal) {
  let text = formats.get(args.tool);
  if (!text) {
    const { failed, value } = await corosApi("catalog", { names: [args.tool] }, signal); if (failed) return failed;
    const found = value.tools?.[0]; if (!found) return failure("coros_unavailable", "COROS does not offer this tool right now.");
    // COROS's own rules in full; per-field notes keep their first sentence, since the rules repeat them.
    text = found.description + "\n\nArguments (JSON schema):\n" + JSON.stringify(slimSchema(found.inputSchema)); formats.set(args.tool, text);
  }
  return fitted(text, args, { source: "coros:format", tool: args.tool });
}
async function corosRead(args, signal, context) {
  const request = args.arguments || {}, key = "coros-text:" + cacheKey(args.tool, request);
  let text = context.cache?.get(key);
  if (typeof text !== "string") {
    const { failed, value } = await corosApi("tool", { name: args.tool, arguments: request }, signal); if (failed) return failed;
    if (value.error) return failure("coros_refused", "COROS: " + String(value.text || "the request was refused").slice(0, 800));
    text = String(value.text || ""); context.cache?.set(key, text);
  }
  return fitted(text, args, { source: "coros:" + args.tool, tool: args.tool });
}
/** Checks the shape and, for updates and library workouts, reads what is there now. Nothing is written to COROS here. */
async function corosProposal(args, signal) {
  const problem = corosProblem(args.tool, args.arguments); if (problem) return failure("invalid_arguments", problem);
  const lookup = args.tool === "updateScheduledWorkout" ? ["queryScheduledWorkoutDetails", { date: args.arguments.date, idInPlan: String(args.arguments.idInPlan) }]
    : args.tool === "updateWorkoutDetails" || args.tool === "scheduleWorkout" ? ["queryWorkoutDetails", { workoutId: args.arguments.workoutId }] : null;
  let before = "";
  if (lookup) {
    const { failed, value } = await corosApi("tool", { name: lookup[0], arguments: lookup[1] }, signal); if (failed) return failed;
    if (value.error) return failure("workout_not_found", "COROS: " + String(value.text || "that workout was not found").slice(0, 600));
    before = String(value.text || "").slice(0, 1200);
  }
  return { kind: "coros", coros: { tool: args.tool, arguments: structuredClone(args.arguments), summary: args.summary.trim() }, title: corosTitle(args.tool, args.arguments), ...(before ? { before } : {}), requires_confirmation: true };
}
/** Dates, times and lines of a new record; the AI SDK has already checked its shape against the schema. */
export function recordProblem(args) {
  const due = args.due || "", when = args.when || "";
  if (!String(args.title || "").trim() || args.steps?.some(step => !step.trim()) || due && !validDay(due) || when && !validInstant(when) || args.kind === "appointment" && !when) return "Use a title, valid date and time, and nonempty steps. Appointments need an ISO date and time with timezone.";
  return "";
}
/** What a write would do, checked against the record as it is now. The approval review shows it; nothing is written. */
export async function preview(value, name, args, signal) {
  if (!WRITE_TOOLS.includes(name) || !permitted(value, name)) return failure("access_disabled", "Access to this record is off or this tool is unavailable.");
  if (name === "create_record") { const problem = recordProblem(args); return problem ? failure("invalid_arguments", problem) : { action: { tool: name, kind: args.kind, title: args.title.trim() } }; }
  if (name === "change_record") { const ready = changeProposal(value, args); return ready.error ? ready : { action: { tool: name, kind: args.change, title: ready.change.title || ready.before.title }, change: ready.change, before: ready.before }; }
  const ready = await corosProposal(args, signal);
  return ready.error ? ready : { action: { tool: name, kind: args.tool, title: ready.title }, ...(ready.before ? { before: ready.before } : {}) };
}
/** Runs only after the user approved the call. Stable ids keep a retried write from saving twice. */
async function write(value, name, args, signal, context) {
  const ready = await preview(value, name, args, signal); if (ready.error) return ready;
  if (!context.chat || !context.turn || !context.eventId) return failure("write_unavailable", "This conversation is unavailable.");
  try {
    const href = name === "create_record" ? await applyProposal(context.chat.uid, context.turn.uid, context.eventId, args)
      : name === "change_record" ? applyChange(ready.change)
      : await applyCoros(context.chat.uid, context.turn.uid, context.eventId, args.tool, args.arguments);
    return { kind: "action", action: { ...ready.action, status: "saved", href } };
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return failure("write_failed", String(error?.message || "The change could not be saved.").slice(0, 300));
  }
}
export async function execute(value, name, args = {}, signal, context = {}) {
  if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
  if (!permitted(value, name)) return failure("access_disabled", "Access to this source is off or this tool is unavailable.");
  if (WRITE_TOOLS.includes(name)) return write(value, name, args, signal, context);
  const cache = context.cache, entryKey = cacheKey(name, args), signature = grantSignature(value, name), reuse = !STATE_TOOLS.includes(name), saved = reuse && cache?.get(entryKey);
  if (saved && saved.permissions === signature) return bounded({ ...structuredClone(saved.result), cached: true });
  const query = args.query ?? "", limit = args.limit ?? (name === "search_pocket" ? 10 : 5), window = args.days ?? 7;
  let result;
  if (name === "read_chat_history") result = context.chat && context.turn ? readChatHistory(context.chat, context.turn, historyPolicy(value), args) : failure("history_unavailable", "This conversation's history is unavailable.");
  else if (name === "search_web" || name === "read_web_page") result = await web(value, name, args, signal, context);
  else if (name === "update_plan") result = args.steps.some(step => !step.text.trim()) ? failure("invalid_arguments", "Write nonempty plan steps.") : { kind: "plan", plan: args.steps.map(step => ({ text: step.text.trim(), status: step.status })) };
  else if (name === "coros_read") result = await corosRead(args, signal, context);
  else if (name === "coros_format") result = await corosFormat(args, signal);
  else if (name === "search_calendar") {
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
  if (!permitted(value, name) || signature !== grantSignature(value, name)) return failure("access_disabled", "Access to this source was switched off.");
  if (reuse && !result.error) result = { ...result, access_fingerprint: accessFingerprint(value), request_identity: checkpointIdentity(value) };
  result = bounded(result);
  if (reuse && !result.error) cache?.set(entryKey, { permissions: signature, result: structuredClone(result) });
  return result;
}
/** "querySleepHrv" → "sleep hrv" for activity labels. */
const corosName = tool => String(tool || "").replace(/^(query|get)/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().slice(0, 60) || "data";
export function label(name, input = {}) {
  const query = typeof input?.query === "string" ? input.query.slice(0, 200) : "";
  if (name === "read_chat_history") return "read chat history" + (query ? " · “" + query + "”" : "");
  if (name === "web_search" || name === "search_web") return "search web" + (query ? " · “" + query + "”" : "");
  if (name === "read_web_page") { try { return "read page · " + new URL(input.url).hostname; } catch { return "read page"; } }
  if (name === "search_pocket") return "search Pocket" + (query ? " · “" + query + "”" : "");
  if (name.startsWith("search_")) return "search " + name.slice(7) + (query ? " · “" + query + "”" : "");
  if (name === "read_note") return "read note";
  if (name === "read_task") return "read task";
  if (name === "update_plan") return "update plan";
  if (name === "create_record") return "save " + (input.kind || "record");
  if (name === "change_record") return changeName(input.change);
  if (name === "propose_action") return "prepare " + (input.kind || "action");
  if (name === "propose_change") return "prepare " + changeName(input.change);
  if (name === "coros_summary") return "read COROS cache · " + (input.days || 7) + " days";
  if (name === "coros_read") return "read COROS · " + corosName(input.tool);
  if (name === "coros_format") return "read COROS format · " + corosName(input.tool);
  if (name === "coros_write") return corosAction(input.tool);
  if (name === "propose_coros") return "prepare " + corosAction(input.tool);
  if (name === "gym_summary") return "read Gym · " + (input.days || 7) + " days";
  return name.replaceAll("_", " ");
}
function resultSummary(name, result) {
  if (result.error) return result.message || result.error;
  if (result.available === false) return result.message || "No cached data";
  if (name === "read_note" || name === "read_task") return result.title || "Record read";
  if (name === "update_plan") return result.plan.filter(step => step.status === "done").length + "/" + result.plan.length + " steps";
  if (result.kind === "action") return result.action.title + " · " + (result.action.status === "saved" ? "saved" : "declined");
  if (name === "propose_action") return result.proposal.title + " · ready to review";
  if (name === "propose_change") return result.before.title + " · ready to review";
  if (name === "search_web") return (result.results?.length || 0) + " results";
  if (name === "read_web_page") return result.title || "Page read";
  if (name === "coros_summary") return (result.stale ? "stale cache" : "cached readings") + (result.last_updated ? " · " + result.last_updated.slice(0, 10) : "");
  if (name === "coros_read" || name === "coros_format") return result.total_length + " characters" + (result.truncated ? " · more" : "");
  if (name === "propose_coros") return result.title + " · ready to review";
  const count = result.matched || 0; return count + (name === "gym_summary" ? " workouts" : " matches") + (result.truncated ? " · partial" : "");
}
export function summary(name, result) {
  const cached = result.cached ? 'cached · ' : '';
  if (result.kind === 'existing_proposal') return cached + 'Existing proposal · ' + result.status;
  if (name === 'read_chat_history' && !result.error) {
    if (result.event) return cached + 'Recorded event' + (result.next_result_offset != null ? ' · more' : '');
    for (const kind of ['answer', 'request']) if (result[kind + '_text'] !== undefined) return cached + 'Earlier ' + kind + (result['next_' + kind + '_offset'] != null ? ' · more' : '');
    return cached + (result.turns?.length || 0) + ' earlier replies' + (result.next_offset != null ? ' · more' : '');
  }
  return cached + resultSummary(name, result);
}
export function sources(name, result) {
  if (result.error || result.available === false) return [];
  if (name === "coros_summary") return [{ title: "Movement · COROS cache", href: "/movement" }];
  if (name === "coros_read") return [{ title: "COROS · " + corosName(result.tool), href: "/movement" }];
  if (name === "coros_format") return [];
  if (name === "read_note") return [{ title: result.title, href: "/notes/" + encodeURIComponent(result.id) }];
  if (name === "read_task") return [{ title: result.title, href: "/tasks/" + encodeURIComponent(result.id) }];
  if (name === "search_calendar") return (result.appointments || []).map(item => ({ title: item.title, href: item.href }));
  if (name === "search_pocket") return (result.results || []).map(item => ({ title: item.title, href: item.href }));
  if (STATE_TOOLS.includes(name)) return [];
  if (name === "search_web") return (result.results || []).map(item => ({ title: item.title, href: item.url }));
  if (name === "read_web_page") return [{ title: result.title, href: result.url }];
  const kind = name === "search_notes" ? "notes" : name === "search_thoughts" ? "thoughts" : name === "search_tasks" ? "tasks" : "gym";
  const items = result[kind] || result.workouts || [];
  return items.slice(0, 5).map(item => ({ title: item.title || item.text?.slice(0, 80) || new Date(item.started).toLocaleDateString(), href: "/" + kind + "/" + (kind === "gym" ? "w:" : "") + encodeURIComponent(item.id) }));
}
