import { activity, source, settle } from "./pip-activity.js?v=20261006-080";
import { execute, label, summary, sources } from "./pip-tools.js?v=20261006-080";

const httpError = code => code === 401 || code === 403 ? "The provider rejected your key or access. Check API settings."
  : code === 429 ? "The provider is busy or your quota is exhausted. Retry when you’re ready."
  : code >= 500 ? "The provider is temporarily unavailable. Retry when you’re ready."
  : "The provider could not accept this request (" + code + "). Check its model, tools and search settings.";

export async function streamChat(chat, turn, { value, body, readSse, key, signal, onUpdate = () => {}, fetcher = fetch, timeoutMs = 90000 } = {}) {
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) controller.abort();
  let timeout, timedOut = false, calls = 0, searches = 0, toolData = 0, tokens = value.maxTokens;
  const clock = () => { clearTimeout(timeout); timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs); };
  const result = { answer: "", reasoning: "", activity: [], sources: [], phase: "requesting", usage: {}, model: value.model };
  const offered = new Set((body.tools || []).map(t => t.name || t.function?.name));
  const check = () => { if (controller.signal.aborted) throw new DOMException("Stopped", "AbortError"); };
  const publish = () => { check(); if (result.answer.length > 64000 || result.reasoning.length > 24000) throw new Error("This reply is too large. Try a shorter request."); result.activity = activity(result.activity); onUpdate(structuredClone(result)); };
  const record = (id, fields) => {
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
  clock();
  try {
    for (let round = 0; round <= 2; round++) {
      check(); if (tokens < 1) throw new Error("The reply limit was reached. Increase it in API settings and retry.");
      result.phase = "requesting"; publish();
      for (const row of result.activity.filter(row => row.kind === "web" && row.state === "queued")) { record(row.id, { state: "running" }); result.phase = "searching web"; }
      const request = structuredClone(body), allowance = offered.size && round < 2 && calls < 4 ? Math.max(1, Math.floor(tokens / (3 - round))) : tokens;
      request.max_tokens = allowance;
      if (value.provider === "compatible" && new URL(value.baseUrl).hostname === "api.openai.com") { request.max_completion_tokens = allowance; delete request.max_tokens; request.stream_options = { include_usage: true }; }
      if (round && JSON.stringify(request.messages).length > 131072) throw new Error("The tool continuation is too large. Ask a narrower question.");
      // A final round produces the answer, with no more client reads or server searches.
      if (round === 2 && request.tools?.length) request.tool_choice = value.provider === "anthropic" ? { type: "none" } : "none";
      const headers = { "content-type": "application/json" };
      if (value.provider === "anthropic") Object.assign(headers, { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" });
      else headers.authorization = "Bearer " + key;
      const response = await fetcher(value.baseUrl + (value.provider === "anthropic" ? "/messages" : "/chat/completions"), {
        method: "POST", headers, body: JSON.stringify(request), signal: controller.signal, redirect: "error", credentials: "omit", referrerPolicy: "no-referrer"
      });
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
              if (web) { if (!value.webSearch || block.name !== "web_search" || ++searches > 3) throw new Error("This search is unavailable or its limit was reached."); result.phase = "searching web"; }
            }
            if (block.type === "web_search_tool_result") {
              if (!result.activity.some(row => row.id === block.tool_use_id && row.kind === "web")) throw new Error("The provider returned an unmatched search result.");
              const error = !Array.isArray(block.content) && block.content?.type === "web_search_tool_result_error";
              const found = (Array.isArray(block.content) ? block.content : []).map(source).filter(Boolean);
              record(block.tool_use_id, { state: error ? "failed" : "done", summary: error ? "Search failed · " + (block.content.error_code || "unavailable") : found.length + " results", sources: found, ended: Date.now() });
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
              partial.args += delta.partial_json || ""; if (partial.args.length > 4096) throw new Error("The tool request is too large.");
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
            if (partial.args.length > 4096 || partial.name.length > 80 || !partials.has(index) && partials.size >= 4) throw new Error("The tool request is too large.");
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
      if (["max_tokens", "length"].includes(stop)) throw new Error("The reply limit was reached. Increase it in API settings and retry.");
      if (["refusal", "content_filter"].includes(stop)) throw new Error("The provider declined this reply.");
      if (value.provider === "compatible") for (const [index, partial] of partials) {
        if (typeof partial.id !== "string" || !partial.id || partial.id.length > 200 || typeof partial.name !== "string" || !partial.name) throw new Error("The provider returned an incomplete tool request.");
        let input; try { input = JSON.parse(partial.args || "{}"); } catch { throw new Error("The provider returned invalid tool arguments."); }
        reads.set(index, { ...partial, input });
      }
      if (stop === "pause_turn" && value.provider === "anthropic" && value.webSearch && round < 2) {
        body.messages.push({ role: "assistant", content: blocks.filter(Boolean) }); continue;
      }
      if (stop === "tool_use" || stop === "tool_calls") {
        if (round >= 2 || !reads.size || calls + reads.size > 4) throw new Error("The Pocket lookup limit was reached. Ask a narrower question.");
        if (new Set([...reads.values()].map(read => read.id)).size !== reads.size) throw new Error("The provider returned duplicate tool identifiers.");
        for (const row of result.activity.filter(row => row.kind === "web" && row.state === "running")) record(row.id, { state: "queued" });
        for (const read of reads.values()) if (!offered.has(read.name) || read.name === "web_search") {
          record(read.id, { state: "failed", summary: "This tool is not available", ended: Date.now() }); throw new Error("The provider requested an unavailable tool: " + read.name);
        }
        // Keep the provider's original blocks/IDs/signatures for the continuation. Remarks are not later answer history.
        if (value.provider === "anthropic") body.messages.push({ role: "assistant", content: blocks.filter(Boolean) });
        else body.messages.push({ role: "assistant", content: text || null, ...reasoning, ...(details.size ? { reasoning_details: [...details.values()] } : {}), tool_calls: [...reads.values()].map(read => ({ id: read.id, type: "function", function: { name: read.name, arguments: read.args || "{}" } })) });
        if (result.answer.trim()) { result.reasoning += (result.reasoning ? "\n\n" : "") + result.answer.trim() + "\n\n"; result.answer = ""; result.sources = []; }
        const replies = [];
        for (const read of reads.values()) {
          check(); calls++; result.phase = label(read.name, read.input);
          record(read.id, { state: "running", title: label(read.name, read.input), input: JSON.stringify(read.input) });
          let answer; try { answer = await execute(value, read.name, read.input, controller.signal); } catch (error) { check(); answer = { error: "data_unavailable", message: "The saved data could not be read." }; }
          check(); let content = JSON.stringify(answer);
          if (toolData + content.length > 16000) { answer = { error: "lookup_budget_reached", message: "The Pocket data limit was reached. Ask a narrower question." }; content = JSON.stringify(answer); }
          toolData += content.length;
          record(read.id, { state: answer.error || answer.available === false ? "failed" : "done", summary: summary(read.name, answer), sources: sources(read.name, answer), ended: Date.now() });
          if (value.provider === "anthropic") replies.push({ type: "tool_result", tool_use_id: read.id, content, is_error: Boolean(answer.error) });
          else body.messages.push({ role: "tool", tool_call_id: read.id, content });
        }
        if (value.provider === "anthropic") body.messages.push({ role: "user", content: replies });
        publish(); continue;
      }
      if (reads.size || !["end_turn", "stop_sequence", "stop", ""].includes(stop)) throw new Error("The provider did not finish a normal reply.");
      if (!result.answer.trim()) throw new Error("The provider returned no answer. Check its model and reply limit.");
      result.activity = settle(result.activity, "failed"); result.phase = "done"; publish(); return result;
    }
    throw new Error("The search continuation limit was reached. Ask a narrower question.");
  } catch (error) {
    if (!signal?.aborted) { result.activity = settle(result.activity, "failed", timedOut ? "Timed out" : error.message); result.phase = "failed"; onUpdate(structuredClone(result)); }
    if (timedOut) throw new Error("The provider took too long to respond. Retry when you’re ready.");
    if (controller.signal.aborted) throw new DOMException("Stopped", "AbortError");
    if (error instanceof TypeError) throw new Error("The provider could not be reached. Check your connection and browser support (CORS).");
    throw error;
  } finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); controller.abort(); }
}
