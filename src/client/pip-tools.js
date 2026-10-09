import { storage as localStorage, tabStorage as sessionStorage, activeAccount } from './workspace-storage.js';
import { corosAction, corosProblem, corosTitle } from '../shared/coros-course.js';
import { notes, tasks, parking, gym, noteTitle, NOTE_LIMIT } from "./store.js";
import { agenda } from './planner.js';
import { readChatHistory } from './pip-memory.js';

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
const text = description => ({ type: "string", description, maxLength: 200 });
const integer = (description, min, max, fallback) => ({ type: "integer", description, minimum: min, maximum: max, default: fallback });
const search = { query: text("Words to match; empty lists recent records."), limit: integer("Maximum results.", 1, 5, 5) };
const days = { days: integer("Calendar days ending today.", 1, 30, 7) };
const paging = { offset: integer("Character offset; use next_offset to continue.", 0, 200000, 0), length: integer("Characters to read.", 200, 6000, 6000) };
const recordId = { type: "string", description: "The id returned by a Pocket search.", maxLength: 80, minLength: 1, pattern: "^[A-Za-z0-9_-]+$" };
const tool = (category, name, description, properties, required = []) => ({ category, name, description, input_schema: { type: "object", properties, required, additionalProperties: false } });
// Live COROS (MCP through the Pocket account). Training plans stay read-only: a plan is larger than a whole reply budget.
const COROS_READS = ["querySportRecords", "getActivityDetail", "analyzeActivityDetail", "queryActivityLapData", "queryCustomActivityLapData", "queryActivityFitFileDownloadUrls", "queryDailyHealthData", "querySleepOverview", "querySleepHrv", "queryRestingHeartRate", "queryAvgHeartRate", "queryStressLevel", "queryStressTimeSeries", "queryHealthCheckTimeSeries", "queryRecoveryStatus", "queryTrainingLoadAssessment", "queryFitnessAssessmentOverview", "queryMenstruationCycles", "queryTrainingSchedule", "queryScheduledWorkoutDetails", "queryWorkoutLibrary", "queryWorkoutDetails", "queryTrainingPlanLibrary", "queryTrainingPlanDetails", "queryUserInfo", "queryDevices"];
const COROS_WRITES = ["createScheduledWorkout", "scheduleWorkout", "createSingleWorkout", "updateScheduledWorkout", "updateWorkoutDetails"];
const COROS_INDEX = [
  "querySportRecords(startDate, endDate, sportTypeCodes, minDistanceKm, maxDistanceKm, minDurationMinutes, maxDurationMinutes, maxAveragePace, locationKeyword, limit): activities with filters",
  "getActivityDetail / analyzeActivityDetail(labelId, sportType[, focus]) · queryActivityLapData(labelId, sportType) · queryCustomActivityLapData(labelId, sportType, startTimestamp, endTimestamp): one activity",
  "queryDailyHealthData(days) · querySleepOverview / querySleepHrv / queryAvgHeartRate / queryHealthCheckTimeSeries / queryStressTimeSeries(startDate, endDate, days) · queryRestingHeartRate / queryStressLevel(days): health",
  "queryRecoveryStatus() · queryTrainingLoadAssessment(days) · queryFitnessAssessmentOverview(): recovery, load, VO2max and race predictions",
  "queryTrainingSchedule(startDate, endDate) · queryScheduledWorkoutDetails(date, idInPlan) · queryWorkoutLibrary(sportType, courseType) · queryWorkoutDetails(workoutId): planned and saved workouts",
  "queryTrainingPlanLibrary(statusList, planType, weeks, cursor) · queryTrainingPlanDetails(planId, startDay, endDay) · queryMenstruationCycles(startDay, endDay) · queryUserInfo() · queryDevices() · queryActivityFitFileDownloadUrls(startDate, endDate, sportType, labelId, limit)"
].join("\n");
const COROS_ARGUMENTS = { coros_read: 4000, propose_coros: 6000 };
const TOOLS = [
  tool("notes", "search_notes", "Search saved Pocket notes. All query words must match. Read a result by id for its text; drafts are excluded.", search),
  tool("notes", "read_note", "Read a saved Pocket note in pages. Use next_offset for more text. No drafts or writes.", { id: recordId, ...paging }, ["id"]),
  tool("thoughts", "search_thoughts", "Search undecided, parked Thoughts. Thoughts are separate from Tasks. Read only; never turns an idea into an action.", search),
  tool("tasks", "search_tasks", "Search chosen Pocket tasks, including completion and due date. Read only; never edits or completes a task.", search),
  tool("tasks", "read_task", "Read a chosen Pocket task, its steps, source, due date and completion. Never edits a task.", { id: recordId }, ["id"]),
  tool("calendar", "search_calendar", "Search saved Calendar appointments from today through the next 1–30 days. Read only.", { ...search, days: integer("Calendar days beginning today.", 1, 30, 7) }),
  tool("pocket", "search_pocket", "Search Notes, Tasks, parked Thoughts and Calendar together, using only granted categories. Returns links and excerpts.", { query: search.query, limit: integer("Maximum results.", 1, 10, 10), days: integer("Calendar days beginning today.", 1, 30, 7) }),
  tool("universal", "read_chat_history", "Read this conversation's earlier requests, final answers, actual tool outcomes and user-applied actions. Historical results are not current facts. No other chats or provider reasoning. Source results respect current access. Use next_offset for older matches, turn_id for one reply, or event_id for serialized recorded result pages using next_result_offset. Listings contain excerpts; query searches full requests and completed answers. With turn_id, use answer_offset or request_offset to read exact text in bounded pages, including explicitly attached request snapshots; follow next_answer_offset or next_request_offset. Match offsets locate search hits beyond excerpts.", {
    query: search.query, turn_id: recordId, event_id: text("An event_id returned by conversation memory or this tool."),
    offset: integer("Matching reply offset, newest first.", 0, 200000, 0), limit: integer("Maximum matching replies.", 1, 5, 3),
    result_offset: integer("Recorded result character offset; use next_result_offset.", 0, 8000, 0), result_length: integer("Recorded result characters to read.", 200, 6000, 2000),
    answer_offset: { type: "integer", description: "Completed answer offset with turn_id; use next_answer_offset or answer_match_offset.", minimum: 0, maximum: 200000 },
    request_offset: { type: "integer", description: "Original request and attached snapshot offset with turn_id; use next_request_offset or request_match_offset.", minimum: 0, maximum: 200000 }
  }),
  tool("universal", "update_plan", "Show or update a short plan for this reply. Changes only the displayed plan; never saves Pocket records.", { steps: { type: "array", minItems: 1, maxItems: 6, items: { type: "object", properties: { text: { type: "string", minLength: 1, maxLength: 160 }, status: { type: "string", enum: ["pending", "in_progress", "done"] } }, required: ["text", "status"], additionalProperties: false } } }, ["steps"]),
  tool("universal", "propose_action", "Prepare a note, task or appointment for the user to review and save with a tap. Never saves or changes data. Appointment proposals need when; task due is YYYY-MM-DD.", { kind: { type: "string", enum: ["note", "task", "appointment"] }, title: { type: "string", minLength: 1, maxLength: 200 }, text: { type: "string", maxLength: 6000 }, due: { type: "string", maxLength: 10 }, steps: { type: "array", maxItems: 12, items: { type: "string", minLength: 1, maxLength: 160, pattern: "^[^\\r\\n]+$" } }, when: { type: "string", maxLength: 40 }, minutes: integer("Appointment duration in minutes.", 15, 480, 60) }, ["kind", "title", "text"]),
  tool("changes", "propose_change", "Prepare a change to an existing record for the user to review and apply with a tap: complete_task, update_task (title, due YYYY-MM-DD or empty to clear, add_steps), append_note (text) or move_appointment (when, minutes). Use ids from Pocket searches or reads. Never applies the change.", { change: { type: "string", enum: ["complete_task", "update_task", "append_note", "move_appointment"] }, id: recordId, title: { type: "string", minLength: 1, maxLength: 200 }, due: { type: "string", maxLength: 10 }, add_steps: { type: "array", maxItems: 6, items: { type: "string", minLength: 1, maxLength: 160, pattern: "^[^\\r\\n]+$" } }, text: { type: "string", minLength: 1, maxLength: 4000 }, when: { type: "string", maxLength: 40, description: "An ISO 8601 timestamp with UTC or an offset." }, minutes: integer("Appointment duration in minutes.", 15, 480, 60), reason: { type: "string", maxLength: 300, description: "One short line on why, shown in the review." } }, ["change", "id"]),
  tool("gym", "gym_summary", "Read locally saved workouts and their exercise sets from the last 1–30 days. Never edits a workout.", days),
  tool("coros", "coros_summary", "Read COROS readings already cached in Movement. Never refreshes or calls COROS. Check last_updated and stale; missing data is not a zero reading.", days),
  tool("coros", "coros_read", "Read live data from the user's COROS account, in pages. Tools and arguments (dates yyyyMMdd; sport codes 1 run, 2 ride, 5 trail run):\n" + COROS_INDEX + "\nIf COROS refuses a request, read coros_format for that tool.", { tool: { type: "string", enum: COROS_READS }, arguments: { type: "object", description: "The COROS tool's arguments as an object; {} when it takes none." }, ...paging }, ["tool"]),
  tool("coros", "coros_format", "Read COROS's exact rules and arguments for one COROS tool, in pages. Read every page for a change tool before propose_coros.", { tool: { type: "string", enum: [...COROS_READS, ...COROS_WRITES] }, ...paging }, ["tool"]),
  tool("coros", "propose_coros", "Prepare a COROS workout change for the user to review and apply with a tap: createScheduledWorkout (new workout on a date), scheduleWorkout (a library workout on a date), createSingleWorkout (new library workout), updateScheduledWorkout or updateWorkoutDetails. arguments must follow coros_format for that tool exactly. Never applies anything. COROS cannot remove a workout through Pocket, so check the date and sections.", { tool: { type: "string", enum: COROS_WRITES }, arguments: { type: "object", description: "Exactly the arguments coros_format describes for this tool." }, summary: { type: "string", minLength: 1, maxLength: 300, description: "One line for the review: what changes and why." } }, ["tool", "arguments", "summary"])
];
const WEB = [
  { name: "search_web", description: "Search current web information. Optionally limit to five domains, a time range, and the source or category: news for current events, research or pdf for papers and documents, github for code. Cite the urls you use.", input_schema: { type: "object", properties: { query: { type: "string", minLength: 1, description: "What to search for.", maxLength: 300 }, limit: integer("Maximum results.", 1, 5, 5), domains: { type: "array", maxItems: 5, items: { type: "string", maxLength: 253 } }, time_range: { type: "string", enum: ["any", "day", "week", "month", "year"], default: "any" }, sources: { type: "array", maxItems: 3, items: { type: "string", enum: ["web", "news", "images"] } }, categories: { type: "array", maxItems: 3, items: { type: "string", enum: ["research", "pdf", "github"] } } }, required: ["query"], additionalProperties: false } },
  { name: "read_web_page", description: "Read a public page in 200–6000 character pages. Use next_offset to continue. Optional query finds relevant passages at or after offset; pages are cached for this reply.", input_schema: { type: "object", properties: { url: { type: "string", description: "The page's public https URL.", maxLength: 2048 }, ...paging, query: search.query }, required: ["url"], additionalProperties: false } },
];
const pocketCategories = ["notes", "tasks", "thoughts", "calendar"];
/** Tools that show or prepare something instead of reading: never cached, run one at a time, never replayed as observations. */
export const STATE_TOOLS = ["update_plan", "propose_action", "propose_change", "propose_coros"];
const CHANGE_CATEGORY = { complete_task: "tasks", update_task: "tasks", append_note: "notes", move_appointment: "calendar" };
const CHANGE_NAMES = { complete_task: "complete task", update_task: "update task", append_note: "add to note", move_appointment: "move appointment" };
export const changeName = change => CHANGE_NAMES[change] || "change";
export const changeTarget = change => ({ tasks: "task", notes: "note", calendar: "appointment" })[CHANGE_CATEGORY[change]] || "record";
const permitted = (value, definition) => definition.category === "changes" ? access(value).some(c => ["tasks", "notes", "calendar"].includes(c)) : definition.category === "universal" || definition.category === "pocket" ? definition.category === "universal" || access(value).some(c => pocketCategories.includes(c)) : definition.category ? access(value).includes(definition.category) : webTools(value);
export const definitions = value => [...TOOLS.filter(t => permitted(value, t)).map(({ category, ...definition }) => structuredClone(definition)), ...(webTools(value) ? structuredClone(WEB) : [])];
export const checkpointIdentity = value => [value.provider, value.baseUrl, value.model].join("|");
export const accessFingerprint = value => { const granted = access(value); return CATEGORIES.map(([category]) => granted.includes(category) ? "1" : "0").join(""); };
export const historyPolicy = value => ({ offered: definitions(value).map(tool => tool.name), stateTools: STATE_TOOLS, identity: checkpointIdentity(value), fingerprint: accessFingerprint(value), grants: access(value), webSearch: webTools(value) });
export const cacheKey = (name, args) => name + ":" + JSON.stringify(canonical(args));
function canonical(value) { return Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value; }
function valid(value, schema) {
  // An object schema without properties is a free-form argument object (COROS requests); its size is checked per tool.
  if (schema.type === "object" && !schema.properties) return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
export async function execute(value, name, args = {}, signal, context = {}) {
  if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
  const definition = TOOLS.find(t => t.name === name) || WEB.find(t => t.name === name);
  if (!definition || !permitted(value, definition)) return failure("access_disabled", "Access to this source is off or this tool is unavailable.");
  if (!valid(args, definition.input_schema)) return { ...failure("invalid_arguments", "Correct the arguments to match this tool's schema; unknown fields are not accepted."), required_fields: definition.input_schema.required || [], allowed_fields: Object.keys(definition.input_schema.properties || {}) };
  if (COROS_ARGUMENTS[name] && JSON.stringify(args.arguments ?? {}).length > COROS_ARGUMENTS[name]) return failure("invalid_arguments", "Keep the COROS arguments under " + COROS_ARGUMENTS[name] + " characters.");
  const cache = context.cache, entryKey = cacheKey(name, args), signature = grantSignature(value, name), reuse = !STATE_TOOLS.includes(name), saved = reuse && cache?.get(entryKey);
  if (saved && saved.permissions === signature) return bounded({ ...structuredClone(saved.result), cached: true });
  const query = args.query ?? "", limit = args.limit ?? (name === "search_pocket" ? 10 : 5), window = args.days ?? 7;
  let result;
  if (name === "read_chat_history") result = context.chat && context.turn ? readChatHistory(context.chat, context.turn, historyPolicy(value), args) : failure("history_unavailable", "This conversation's history is unavailable.");
  else if (name === "search_web" || name === "read_web_page") result = await web(value, name, args, signal, context);
  else if (name === "update_plan") result = args.steps.some(step => !step.text.trim()) ? failure("invalid_arguments", "Write nonempty plan steps.") : { kind: "plan", plan: args.steps.map(step => ({ text: step.text.trim(), status: step.status })) };
  else if (name === "propose_action") {
    const due = args.due || "", when = args.when || "";
    if (!args.title.trim() || args.steps?.some(step => !step.trim()) || due && !validDay(due) || when && !validInstant(when) || args.kind === "appointment" && !when) return failure("invalid_arguments", "Use a title, valid date and time, and nonempty steps. Appointments need an ISO date and time with timezone.");
    result = { kind: "proposal", proposal: { kind: args.kind, title: args.title.trim(), text: args.text, due, steps: (args.steps || []).map(step => step.trim()), when, minutes: args.minutes ?? 60 }, requires_confirmation: true };
  } else if (name === "propose_change") result = changeProposal(value, args);
  else if (name === "coros_read") result = await corosRead(args, signal, context);
  else if (name === "coros_format") result = await corosFormat(args, signal);
  else if (name === "propose_coros") result = await corosProposal(args, signal);
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
  if (!permitted(value, definition) || signature !== grantSignature(value, name)) return failure("access_disabled", "Access to this source was switched off.");
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
  if (name === "propose_action") return "prepare " + (input.kind || "action");
  if (name === "propose_change") return "prepare " + changeName(input.change);
  if (name === "coros_summary") return "read COROS cache · " + (input.days || 7) + " days";
  if (name === "coros_read") return "read COROS · " + corosName(input.tool);
  if (name === "coros_format") return "read COROS format · " + corosName(input.tool);
  if (name === "propose_coros") return "prepare " + corosAction(input.tool);
  if (name === "gym_summary") return "read Gym · " + (input.days || 7) + " days";
  return name.replaceAll("_", " ");
}
function resultSummary(name, result) {
  if (result.error) return result.message || result.error;
  if (result.available === false) return result.message || "No cached data";
  if (name === "read_note" || name === "read_task") return result.title || "Record read";
  if (name === "update_plan") return result.plan.filter(step => step.status === "done").length + "/" + result.plan.length + " steps";
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
