import { activity, source, settle } from "./pip-activity.js";
import { execute, access, accessFingerprint, checkpointIdentity, cacheKey, definitions, label, summary, sources } from "./pip-tools.js";

export const RESEARCH_LIMITS = Object.freeze({ continuations: 8, calls: 20, webCalls: 8, toolData: 48000, result: 8000, parallel: 3, deadlineMs: 300000 });

const httpError = code => code === 401 || code === 403 ? "The provider rejected your key or access. Check API settings."
  : code === 429 ? "The provider is busy or your quota is exhausted. Retry when you’re ready."
  : code >= 500 ? "The provider is temporarily unavailable. Retry when you’re ready."
  : "The provider could not accept this request (" + code + "). Check its model, tools and search settings.";

const FREE_CHAIN = ["nvidia/nemotron-3-super-120b-a12b:free", "inclusionai/ling-3.0-flash-sante:free", "openrouter/free"];
/** OpenRouter tries these in order when a free model is rate-limited; the free router alone sometimes picks a model that cannot chat. */
export function freeFallbacks(value) {
  let host = ""; try { host = new URL(value.baseUrl).hostname; } catch {}
  if (value.provider !== "compatible" || host !== "openrouter.ai" || !(value.model.endsWith(":free") || value.model === "openrouter/free")) return null;
  const chain = value.model === "openrouter/free" ? FREE_CHAIN : [value.model, ...FREE_CHAIN.filter(m => m !== value.model)];
  return chain.slice(0, 3);
}
const pause = (ms, signal) => new Promise((resolve, reject) => { const abort = () => { clearTimeout(t); reject(new DOMException("Stopped", "AbortError")); }, t = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms); signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort(); });

export async function streamChat(chat, turn, { value, body, readSse, key, signal, onUpdate = () => {}, fetcher = fetch, executeTool = execute, timeoutMs = 90000, deadlineMs = RESEARCH_LIMITS.deadlineMs, resume = null } = {}) {
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) controller.abort();
  let timeout, timedOut = false, deadlineReached = false, calls = 0, searches = 0, toolData = 0, tokens = value.maxTokens, finalReason = "";
  const absolute = setTimeout(() => { deadlineReached = true; controller.abort(); }, Math.min(deadlineMs, RESEARCH_LIMITS.deadlineMs));
  const clock = () => { clearTimeout(timeout); timeout = setTimeout(() => { timedOut = true; controller.abort(); }, Math.min(timeoutMs, 90000)); };
  const result = { answer: "", reasoning: resume?.reasoning || "", activity: activity(resume?.activity || []), sources: [], phase: "requesting", usage: { request_identity: [value.provider, value.baseUrl, value.model].join("|"), read_access: access(value).join("|"), web_access: value.webSearch, notes_restricted: resume?.notes_restricted || false }, model: value.model };
  const offered = new Set((body.tools || []).map(t => t.name || t.function?.name));
  const cache = new Map(), inFlight = new Map(), context = { cache }, completed = [];
  for (const row of resume?.observations || []) {
    if (!offered.has(row.name) || ["update_plan", "propose_action", "web_search"].includes(row.name)) continue;
    try { const answer = JSON.parse(row.result), input = JSON.parse(row.input || "{}"); cache.set(cacheKey(row.name, input), { permissions: row.name === "search_pocket" ? resume.permissions : row.name === "read_task" && access(value).includes("notes") ? "notes" : "", result: answer }); } catch { /* unusable checkpoint */ }
  }
  const check = () => { if (controller.signal.aborted) throw new DOMException("Stopped", "AbortError"); };
  const publish = () => { check(); if (result.answer.length > 64000 || result.reasoning.length > 24000) throw new Error("This reply is too large. Try a shorter request."); result.activity = activity(result.activity); onUpdate(structuredClone(result)); };
  let currentRound = 0;
  const activityPrefix = (turn.attempt || crypto.randomUUID()) + ":", activityId = id => id.startsWith(activityPrefix) ? id : activityPrefix + currentRound + ":" + id.slice(0, 145);
  const record = (id, fields) => {
    id = activityId(id);
    const old = result.activity.find(a => a.id === id), now = Date.now();
    const entry = { id, kind: "tool", name: "", title: "", input: "", summary: "", sources: [], state: "running", started: now, ended: 0, ...old, ...fields };
    if (old) Object.assign(old, entry); else result.activity.push(entry); publish();
  };
  const cite = raw => {
    const found = source(raw); if (!found || found.href.startsWith("/")) return;
    let index = result.sources.findIndex(s => s.href === found.href);
    if (index < 0 && result.sources.length < 24) { index = result.sources.length; result.sources.push(found); }
    if (index >= 0) result.answer += ` [${index + 1}](${found.href.replace(/[()]/g, c => encodeURIComponent(c))})`;
  };
  const finishFromObservations = reason => {
    const observations = completed.length ? completed : (resume?.observations || []).map(row => { try { return { name: row.name, answer: JSON.parse(row.result) }; } catch { return null; } }).filter(Boolean);
    if (!result.answer.trim()) {
      const excerpts = observations.flatMap(({ answer }) => answer.error ? [] : answer.kind === "proposal" ? ["Prepared for review: " + answer.proposal.title] : answer.kind === "plan" ? [] : answer.text ? [String(answer.title || "Source") + ": " + answer.text.slice(0, 600)] : (answer.results || answer.notes || answer.tasks || answer.appointments || []).slice(0, 3).map(item => (item.title || item.text || "Source") + (item.description || item.excerpt ? ": " + (item.description || item.excerpt).slice(0, 300) : "")));
      result.answer = excerpts.length ? "Collected observations:\n\n" + excerpts.slice(0, 8).map(item => "- " + item).join("\n") : "Research stopped before a final answer was available.";
    }
    result.answer += "\n\n" + reason + " Completed lookups remain in the activity.";
    result.activity = settle(result.activity, "failed", reason); result.phase = "done";
    onUpdate(structuredClone(result)); return result;
  };
  clock();
  try {
    for (let round = 0; round <= RESEARCH_LIMITS.continuations; round++) {
      currentRound = round;
      check(); if (tokens < 1) return finishFromObservations("The configured reply token limit was reached.");
      const reserve = Math.min(1024, Math.max(1, Math.floor(value.maxTokens / 3))), final = Boolean(finalReason) || round === RESEARCH_LIMITS.continuations || calls >= RESEARCH_LIMITS.calls || searches >= RESEARCH_LIMITS.webCalls || toolData >= RESEARCH_LIMITS.toolData || tokens <= reserve;
      result.phase = final ? "synthesizing" : "requesting"; publish();
      for (const row of result.activity.filter(row => row.kind === "web" && row.state === "queued")) { record(row.id, { state: "running" }); result.phase = "searching web"; }
      const request = structuredClone(body), allowance = offered.size && !final ? Math.max(1, Math.floor((tokens - reserve) / (RESEARCH_LIMITS.continuations - round))) : tokens;
      request.max_tokens = allowance;
      const fallbacks = freeFallbacks(value); if (fallbacks) { request.model = fallbacks[0]; request.models = fallbacks; }
      if (value.provider === "compatible" && new URL(value.baseUrl).hostname === "api.openai.com") { request.max_completion_tokens = allowance; delete request.max_tokens; request.stream_options = { include_usage: true }; }
      if (round && JSON.stringify(request.messages).length > 190000) return finishFromObservations("The research context limit was reached.");
      // A final round produces the answer, with no more client reads or server searches.
      if (final && request.tools?.length) {
        request.tool_choice = value.provider === "anthropic" ? { type: "none" } : "none";
        request.messages.push({ role: "user", content: "Finish now using the observations already collected. Do not call more tools. Explain material gaps briefly." + (finalReason ? " Research limit: " + finalReason : "") });
      }
      else if (value.provider === "anthropic") for (const tool of request.tools || []) if (tool.name === "web_search") tool.max_uses = Math.max(1, RESEARCH_LIMITS.webCalls - searches);
      const headers = { "content-type": "application/json" };
      if (value.provider === "anthropic") Object.assign(headers, { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" });
      else headers.authorization = "Bearer " + key;
      let response;
      for (let attempt = 0; ; attempt++) {
        response = await fetcher(value.baseUrl + (value.provider === "anthropic" ? "/messages" : "/chat/completions"), {
          method: "POST", headers, body: JSON.stringify(request), signal: controller.signal, redirect: "error", credentials: "omit", referrerPolicy: "no-referrer"
        });
        // A busy provider often answers a moment later; try twice more before giving up.
        if (![429, 502, 503].includes(response.status) || attempt >= 2) break;
        result.phase = "provider busy · retrying"; publish(); await pause(1500 * (attempt + 1) ** 2, controller.signal); clock();
      }
      check(); if (!response.ok) throw new Error(httpError(response.status));
      if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) throw new Error("This endpoint did not return a chat stream. Check its browser and streaming support.");
      let terminal = false, stop = "", text = "", output = 0;
      const blocks = [], partials = new Map(), reads = new Map(), reasoning = {}, details = new Map();
      for await (const data of readSse(response.body, controller.signal)) {
        clock(); check();
        if (data === "[DONE]") { if (value.provider === "compatible") terminal = true; break; }
        let event; try { event = JSON.parse(data); } catch { throw new Error("The provider sent an unreadable reply. Retry when you’re ready."); }
        if (event.error || event.type === "error") throw new Error("The provider interrupted this reply. Check its settings or retry.");
        if (value.provider === "anthropic") {
          if (event.type === "message_start") { result.model = event.message?.model || result.model; output = event.message?.usage?.output_tokens || 0; for (const [name, count] of Object.entries(event.message?.usage || {})) if (name !== "output_tokens" && typeof count === "number") result.usage[name] = (result.usage[name] || 0) + count; }
          if (event.type === "content_block_start") {
            const block = structuredClone(event.content_block || {}); blocks[event.index] = block;
            if (block.type === "text") { text += block.text || ""; result.answer += block.text || ""; if (block.text) result.phase = "writing"; for (const citation of block.citations || []) cite(citation); }
            if (block.type === "thinking") { result.reasoning += block.thinking || ""; result.phase = "thinking"; }
            if (block.type === "tool_use" || block.type === "server_tool_use") {
              if (typeof block.id !== "string" || !block.id || block.id.length > 200 || typeof block.name !== "string" || !block.name || block.name.length > 80) throw new Error("The provider returned an incomplete tool request.");
              const web = block.type === "server_tool_use";
              partials.set(event.index, { id: block.id, name: block.name, args: "", initial: block.input || {}, web });
              record(block.id, { kind: web ? "web" : "tool", name: block.name, title: label(block.name, block.input), state: web ? "running" : "queued" });
              if (web) { if (!offered.has(block.name) || !value.webSearch || block.name !== "web_search") throw new Error("The provider requested an unavailable search."); if (final || ++searches > RESEARCH_LIMITS.webCalls) return finishFromObservations("The web research limit was reached."); result.phase = "searching web"; }
            }
            if (block.type === "web_search_tool_result") {
              if (!result.activity.some(row => row.id === activityId(block.tool_use_id) && row.kind === "web")) throw new Error("The provider returned an unmatched search result.");
              const error = !Array.isArray(block.content) && block.content?.type === "web_search_tool_result_error";
              const found = (Array.isArray(block.content) ? block.content : []).map(source).filter(Boolean);
              const observation = { source: "web:anthropic", results: found.slice(0, 3), matched: found.length, truncated: found.length > 3, request_identity: checkpointIdentity(value), access_fingerprint: accessFingerprint(value), ...(error ? { error: block.content.error_code || "web_unavailable", message: "Search failed" } : {}) }, content = JSON.stringify(observation);
              if (toolData + content.length > RESEARCH_LIMITS.toolData) return finishFromObservations("The research data limit was reached.");
              toolData += content.length; completed.push({ name: "web_search", answer: observation });
              record(block.tool_use_id, { state: error ? "failed" : "done", summary: error ? "Search failed · " + (block.content.error_code || "unavailable") : found.length + " results", result: content, sources: found, ended: Date.now() });
              result.phase = "preparing reply";
            }
          }
          if (event.type === "content_block_delta") {
            const delta = event.delta || {}, block = blocks[event.index];
            if (delta.type === "text_delta") { text += delta.text || ""; result.answer += delta.text || ""; if (block) block.text = (block.text || "") + (delta.text || ""); result.phase = "writing"; }
            if (delta.type === "thinking_delta") { result.reasoning += delta.thinking || ""; if (block) block.thinking = (block.thinking || "") + (delta.thinking || ""); result.phase = "thinking"; }
            if (delta.type === "signature_delta" && block) block.signature = (block.signature || "") + (delta.signature || "");
            if (delta.type === "input_json_delta") {
              const partial = partials.get(event.index); if (!partial) throw new Error("The provider returned tool arguments without a tool.");
              partial.args += delta.partial_json || ""; if (partial.args.length > 8000) throw new Error("The tool request is too large.");
              try { const args = JSON.parse(partial.args); record(partial.id, { title: label(partial.name, args), input: partial.args }); } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
            }
            if (delta.type === "citations_delta") { if (block) (block.citations ||= []).push(delta.citation); cite(delta.citation); }
          }
          if (event.type === "content_block_stop" && partials.has(event.index)) {
            const partial = partials.get(event.index); let args;
            try { args = partial.args.trim() ? JSON.parse(partial.args) : partial.initial; } catch { throw new Error("The provider returned invalid tool arguments."); }
            if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("The tool arguments must be an object.");
            blocks[event.index].input = args; record(partial.id, { title: label(partial.name, args), input: JSON.stringify(args) });
            if (!partial.web) reads.set(event.index, { ...partial, input: args });
          }
          if (event.type === "message_delta") { stop = event.delta?.stop_reason || stop; output = event.usage?.output_tokens || output; }
          if (event.type === "message_stop") terminal = true;
        } else {
          const choice = event.choices?.find(c => c.index === 0) || event.choices?.[0], delta = choice?.delta || {};
          if (typeof delta.content === "string") { text += delta.content; result.answer += delta.content; result.phase = "writing"; }
          for (const field of ["reasoning_content", "reasoning"]) if (typeof delta[field] === "string") { reasoning[field] = (reasoning[field] || "") + delta[field]; }
          const thought = delta.reasoning_content || delta.reasoning; if (typeof thought === "string") { result.reasoning += thought; result.phase = "thinking"; }
          for (const detail of delta.reasoning_details || []) { const index = detail.index ?? detail.id ?? details.size, previous = details.get(index) || {}; details.set(index, { ...previous, ...detail, ...(typeof detail.text === "string" ? { text: (previous.text || "") + detail.text } : {}), ...(typeof detail.data === "string" ? { data: (previous.data || "") + detail.data } : {}) }); }
          for (const call of delta.tool_calls || []) {
            const index = call.index ?? 0, partial = partials.get(index) || { id: "", name: "", args: "" };
            partial.id ||= call.id || ""; partial.name += call.function?.name || ""; partial.args += call.function?.arguments || "";
            if (partial.args.length > 8000 || partial.name.length > 80 || !partials.has(index) && partials.size >= RESEARCH_LIMITS.calls) throw new Error("The tool request is too large.");
            partials.set(index, partial);
            if (partial.id && partial.name) { let args = {}; try { args = JSON.parse(partial.args || "{}"); } catch {} record(partial.id, { name: partial.name, title: label(partial.name, args), input: partial.args, state: "queued" }); }
          }
          for (const citation of delta.annotations || choice?.message?.annotations || []) cite(citation.url_citation || citation);
          if (delta.function_call) throw new Error("This endpoint uses legacy tool calls. Use a model with current function-tool support.");
          if (choice?.finish_reason) { stop = choice.finish_reason; terminal = true; }
          if (event.usage) { output = event.usage.completion_tokens || output; for (const [name, count] of Object.entries({ input_tokens: event.usage.prompt_tokens, cache_read_input_tokens: event.usage.prompt_tokens_details?.cached_tokens })) if (typeof count === "number") result.usage[name] = (result.usage[name] || 0) + count; }
          result.model = event.model || result.model;
        }
        publish(); if (value.provider === "anthropic" && terminal) break;
      }
      check(); if (!terminal) throw new Error("The connection ended before the reply was complete. Retry when you’re ready.");
      tokens -= output || allowance; result.usage.output_tokens = (result.usage.output_tokens || 0) + output;
      if (["max_tokens", "length"].includes(stop)) {
        if (!final && tokens > 0) {
          if (result.answer.trim()) { result.reasoning += (result.reasoning ? "\n\n" : "") + result.answer.trim(); result.answer = ""; result.sources = []; }
          result.activity = settle(result.activity, "failed", "Tool request did not finish within this round's token allowance");
          finalReason = "Finish within the remaining reply token budget"; continue;
        }
        return finishFromObservations("The configured reply token limit was reached.");
      }
      if (["refusal", "content_filter"].includes(stop)) throw new Error("The provider declined this reply.");
      if (value.provider === "compatible") for (const [index, partial] of [...partials].sort(([a], [b]) => a - b)) {
        if (typeof partial.id !== "string" || !partial.id || partial.id.length > 200 || typeof partial.name !== "string" || !partial.name) throw new Error("The provider returned an incomplete tool request.");
        let input; try { input = JSON.parse(partial.args || "{}"); } catch { throw new Error("The provider returned invalid tool arguments."); }
        if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("The tool arguments must be an object.");
        reads.set(index, { ...partial, input });
      }
      if (stop === "pause_turn" && value.provider === "anthropic" && value.webSearch) {
        body.messages.push({ role: "assistant", content: blocks.filter(Boolean) });
        if (final) return finishFromObservations("The provider paused during final synthesis.");
        if (searches >= RESEARCH_LIMITS.webCalls) finalReason = "Web calls exhausted";
        continue;
      }
      if (stop === "tool_use" || stop === "tool_calls") {
        if (!reads.size) throw new Error("The provider returned no complete tool request.");
        if (final) return finishFromObservations("The provider requested more tools after the research limit.");
        if (new Set([...reads.values()].map(read => read.id)).size !== reads.size) throw new Error("The provider returned duplicate tool identifiers.");
        for (const row of result.activity.filter(row => row.kind === "web" && row.state === "running")) record(row.id, { state: "queued" });
        // Keep the provider's original blocks/IDs/signatures for the continuation. Remarks are not later answer history.
        if (value.provider === "anthropic") body.messages.push({ role: "assistant", content: blocks.filter(Boolean) });
        else body.messages.push({ role: "assistant", content: text || null, ...reasoning, ...(details.size ? { reasoning_details: [...details.values()] } : {}), tool_calls: [...reads.values()].map(read => ({ id: read.id, type: "function", function: { name: read.name, arguments: read.args || "{}" } })) });
        if (result.answer.trim()) { result.reasoning += (result.reasoning ? "\n\n" : "") + result.answer.trim() + "\n\n"; result.answer = ""; result.sources = []; }
        const replies = [], ordered = [...reads.values()], outputs = new Array(ordered.length), budgetError = { error: "research_budget_reached", message: "Research data exhausted; use completed observations." }, budgetContent = JSON.stringify(budgetError);
        const run = async (read, index) => {
          check(); let answer;
          const allowed = offered.has(read.name) && definitions(value).some(tool => tool.name === read.name), web = ["search_web", "read_web_page"].includes(read.name);
          if (!allowed || read.name === "web_search") { answer = { error: "tool_unavailable", message: "This tool is not offered or its access was switched off." }; finalReason ||= "Unavailable tool requested"; }
          else if (calls >= RESEARCH_LIMITS.calls || web && searches >= RESEARCH_LIMITS.webCalls || toolData >= RESEARCH_LIMITS.toolData || finalReason === "Research data exhausted") { answer = budgetError; finalReason ||= "Research calls or data exhausted"; }
          else {
            calls++; if (web) searches++; result.phase = label(read.name, read.input);
            record(read.id, { state: "running", title: label(read.name, read.input), input: JSON.stringify(read.input) });
            try {
              const reuse = !["update_plan", "propose_action"].includes(read.name), signature = read.name === "search_pocket" ? access(value).filter(category => ["notes", "tasks", "thoughts", "calendar"].includes(category)).sort().join("|") : read.name === "read_task" && access(value).includes("notes") ? "notes" : "", lookup = cacheKey(read.name, read.input), saved = reuse && cache.get(lookup);
              if (saved?.permissions === signature && saved.result) answer = { ...structuredClone(saved.result), cached: true };
              else {
                let pending = reuse && inFlight.get(lookup), duplicate = Boolean(pending);
                if (!pending) { pending = executeTool(value, read.name, read.input, controller.signal, context); if (reuse) inFlight.set(lookup, pending); }
                try { answer = await pending; } finally { if (reuse) inFlight.delete(lookup); }
                if (duplicate && answer && !answer.error) answer = { ...answer, cached: true };
                if (reuse && answer && !answer.error) cache.set(lookup, { permissions: signature, result: structuredClone(answer) });
              }
              // Recheck grants even when a duplicate lookup was served by the run cache.
              const currentSignature = read.name === "search_pocket" ? access(value).filter(category => ["notes", "tasks", "thoughts", "calendar"].includes(category)).sort().join("|") : read.name === "read_task" && access(value).includes("notes") ? "notes" : "";
              if (!definitions(value).some(tool => tool.name === read.name) || signature !== currentSignature) answer = { error: "access_disabled", message: "Access to this source was switched off." };
            }
            catch (error) { check(); answer = { error: "data_unavailable", message: web ? "The web source could not be read." : "The saved data could not be read." }; }
          }
          check();
          if (answer && !answer.error && !["update_plan", "propose_action"].includes(read.name)) answer = { access_fingerprint: accessFingerprint(value), request_identity: checkpointIdentity(value), ...answer };
          let content = JSON.stringify(answer);
          if (!content || content.length > RESEARCH_LIMITS.result) { answer = { error: "result_too_large", message: "Use a narrower request." }; content = JSON.stringify(answer); }
          const unfinished = outputs.filter(Boolean).length;
          // Reserve enough space for a bounded error for every outstanding call in this batch.
          if (toolData + content.length + (ordered.length - unfinished - 1) * budgetContent.length > RESEARCH_LIMITS.toolData) { answer = budgetError; content = budgetContent; finalReason ||= "Research data exhausted"; }
          if (toolData + content.length <= RESEARCH_LIMITS.toolData) toolData += content.length;
          completed.push({ name: read.name, answer }); outputs[index] = { answer, content };
          record(read.id, { name: read.name, input: JSON.stringify(read.input), state: answer.error || answer.available === false ? "failed" : "done", summary: summary(read.name, answer), result: content, sources: sources(read.name, answer), ended: Date.now() }); clock();
        };
        // Read batches can finish in any order; continuations retain the provider's original order and IDs.
        for (let index = 0; index < ordered.length;) {
          const stateTool = read => ["update_plan", "propose_action"].includes(read.name);
          let end = index + 1;
          if (!stateTool(ordered[index])) while (end < ordered.length && end - index < RESEARCH_LIMITS.parallel && !stateTool(ordered[end])) end++;
          await Promise.all(ordered.slice(index, end).map((read, offset) => run(read, index + offset)));
          for (let at = index; at < end; at++) {
            const read = ordered[at], { answer, content } = outputs[at];
            if (value.provider === "anthropic") replies.push({ type: "tool_result", tool_use_id: read.id, content, is_error: Boolean(answer.error) });
            else body.messages.push({ role: "tool", tool_call_id: read.id, content });
          }
          index = end;
        }
        if (value.provider === "anthropic") body.messages.push({ role: "user", content: replies });
        publish(); continue;
      }
      if (reads.size || !["end_turn", "stop_sequence", "stop", ""].includes(stop)) throw new Error("The provider did not finish a normal reply.");
      if (!result.answer.trim()) throw new Error("The provider returned no answer. Check its model and reply limit.");
      result.activity = settle(result.activity, "failed"); result.phase = "done"; publish(); return result;
    }
    return finishFromObservations("The research continuation limit was reached.");
  } catch (error) {
    if (!signal?.aborted && (timedOut || deadlineReached)) return finishFromObservations(deadlineReached ? "The five-minute research deadline was reached." : "The provider stopped responding for 90 seconds.");
    if (!signal?.aborted) { result.activity = settle(result.activity, "failed", timedOut ? "Timed out" : error.message); result.phase = "failed"; onUpdate(structuredClone(result)); }
    if (timedOut) throw new Error("The provider took too long to respond. Retry when you’re ready.");
    if (controller.signal.aborted) throw new DOMException("Stopped", "AbortError");
    if (error instanceof TypeError) throw new Error("The provider could not be reached. Check your connection and browser support (CORS).");
    throw error;
  } finally { clearTimeout(timeout); clearTimeout(absolute); signal?.removeEventListener("abort", abort); controller.abort(); }
}
