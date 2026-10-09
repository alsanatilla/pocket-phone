import { ToolLoopAgent, isStepCount, jsonSchema, tool } from 'ai';
import { activity, source, settle } from './pip-activity.js';
import { execute, access, accessFingerprint, checkpointIdentity, cacheKey, definitions, grantSignature, label, summary, sources, STATE_TOOLS } from './pip-tools.js';
import { providerModel, providerOptions, providerError } from './pip-provider.js';
import { RESEARCH_LIMITS } from './pip-limits.js';
export { RESEARCH_LIMITS, CONTEXT_OVERFLOW } from './pip-limits.js';
export { freeFallbacks } from './pip-provider.js';
const TOOL_ROUND_TOKENS = 2048;
const stopped = () => new DOMException('Stopped', 'AbortError');

// AI SDK owns provider parsing, tool-call IDs and model continuation. Pocket owns
// user permissions, bounded research, recorded outcomes and proposal review.
export async function streamChat(chat, turn, { value, body, key, signal, onUpdate = () => {}, fetcher = fetch, executeTool = execute, timeoutMs = 90000, deadlineMs = RESEARCH_LIMITS.deadlineMs, resume = null, coverage = null } = {}) {
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  let timeout, timedOut = false, deadlineReached = false, calls = 0, searches = 0, toolData = 0, tokens = value.maxTokens;
  let finalReason = '', finalRounds = 0, finalCalls = 0, round = 0, currentRound = 0, allowance = 0, final = false, canPrepare = false, lastFinish = '', fatal = null;
  const absolute = setTimeout(() => { deadlineReached = true; controller.abort(); }, Math.min(deadlineMs, RESEARCH_LIMITS.deadlineMs));
  const clock = () => { clearTimeout(timeout); timeout = setTimeout(() => { timedOut = true; controller.abort(); }, Math.min(timeoutMs, 90000)); };
  const result = { answer: '', reasoning: resume?.reasoning || '', activity: activity(resume?.activity || turn.activity || []), sources: [], phase: 'requesting', usage: { runtime: 'ai-sdk', request_identity: checkpointIdentity(value), read_access: access(value).join('|'), web_access: value.webSearch, notes_restricted: resume?.notes_restricted || false, ...(coverage ? { history_replay: coverage } : {}) }, model: value.model };
  const offered = new Set((body.tools || []).map(definition => definition.name));
  const cache = new Map(), inFlight = new Map(), failures = new Map(), preparations = new Map(), inputs = new Map(), executed = new Set();
  const context = { cache, chat, turn }, completed = [], responses = [];
  const check = () => { if (controller.signal.aborted) throw stopped(); if (fatal) throw fatal; };
  const publish = () => { check(); if (result.answer.length > 64000 || result.reasoning.length > 24000) throw new Error('This reply is too large. Try a shorter request.'); result.activity = activity(result.activity); onUpdate(structuredClone(result)); };
  const prefix = (turn.attempt || crypto.randomUUID()) + ':', activityId = id => prefix + currentRound + ':' + String(id).slice(0, 145);
  const record = (id, fields) => {
    id = activityId(id); const old = result.activity.find(row => row.id === id), now = Date.now();
    const row = { id, kind: 'tool', name: '', title: '', input: '', summary: '', sources: [], state: 'queued', started: now, ended: 0, ...old, ...fields };
    if (old) Object.assign(old, row); else result.activity.push(row); publish();
  };
  for (const row of result.activity) {
    if (row.state !== 'done' || !STATE_TOOLS.includes(row.name) || row.name === 'update_plan') continue;
    try {
      const data = JSON.parse(row.result), input = JSON.parse(row.input || '{}');
      if (['proposal', 'change', 'coros'].includes(data.kind)) preparations.set(cacheKey(row.name, input), { event_id: row.id, title: data.proposal?.title || data.before?.title || data.title || 'Proposal', status: row.applied_href ? 'applied_by_user' : 'prepared_awaiting_user', ...(row.applied_href ? { href: row.applied_href } : {}) });
    } catch { /* An incomplete preparation cannot be reused. */ }
  }
  for (const row of resume?.observations || []) {
    if (!offered.has(row.name) || STATE_TOOLS.includes(row.name)) continue;
    try { cache.set(cacheKey(row.name, JSON.parse(row.input || '{}')), { permissions: grantSignature(value, row.name), result: JSON.parse(row.result) }); } catch { /* Unusable checkpoint. */ }
  }
  const finishFromObservations = reason => {
    const observations = completed.length ? completed : (resume?.observations || []).flatMap(row => { try { return [{ answer: JSON.parse(row.result) }]; } catch { return []; } });
    if (!result.answer.trim()) {
      const excerpts = observations.flatMap(({ answer }) => answer.error ? [] : answer.kind === 'proposal' ? ['Prepared for review: ' + answer.proposal.title] : answer.kind === 'plan' ? [] : answer.text ? [String(answer.title || 'Source') + ': ' + answer.text.slice(0, 600)] : (answer.results || answer.notes || answer.tasks || answer.appointments || []).slice(0, 3).map(item => (item.title || item.text || 'Source') + (item.description || item.excerpt ? ': ' + (item.description || item.excerpt).slice(0, 300) : '')));
      result.answer = excerpts.length ? 'Collected observations:\n\n' + excerpts.slice(0, 8).map(item => '- ' + item).join('\n') : 'Research stopped before a final answer was available.';
    }
    result.answer += '\n\n' + reason + ' Completed lookups remain in the activity.';
    result.activity = settle(result.activity, 'failed', reason); result.phase = 'failed'; onUpdate(structuredClone(result));
    throw new Error(reason);
  };

  // SDK tools can run concurrently. Bound reads and put preparations behind the
  // preceding reads/preparations so dependent Pocket operations retain order.
  let barrier = Promise.resolve(), readers = [], slots = 0; const waiting = [];
  const withSlot = async work => {
    if (slots >= RESEARCH_LIMITS.parallel) await new Promise(resolve => waiting.push(resolve)); else slots++;
    try { check(); return await work(); } finally { const next = waiting.shift(); if (next) next(); else slots--; }
  };
  const schedule = (name, work) => {
    if (STATE_TOOLS.includes(name)) {
      const preceding = [barrier, ...readers]; readers = [];
      const pending = Promise.allSettled(preceding).then(() => { check(); return work(); }); barrier = pending; return pending;
    }
    const pending = barrier.catch(() => {}).then(() => withSlot(work)); readers.push(pending); return pending;
  };
  const budgetError = { error: 'research_budget_reached', message: 'The app’s call or data limit was reached; use completed observations.' };
  const runTool = async (name, input, { toolCallId }) => {
    check(); const id = currentRound + ':' + toolCallId;
    if (!input || typeof input !== 'object' || Array.isArray(input) || JSON.stringify(input).length > 8000) { fatal = new Error('The provider returned invalid or oversized tool arguments.'); throw fatal; }
    if ([...executed].filter(id => id.startsWith(currentRound + ':')).length >= RESEARCH_LIMITS.calls + RESEARCH_LIMITS.finalCalls) { fatal = new Error('The tool request is too large.'); throw fatal; }
    if (executed.has(id)) { fatal = new Error('The provider returned duplicate tool identifiers.'); throw fatal; }
    executed.add(id);
    return schedule(name, async () => {
      check(); let answer;
      const stateTool = STATE_TOOLS.includes(name), web = ['search_web', 'read_web_page'].includes(name);
      const allowed = offered.has(name) && definitions(value).some(definition => definition.name === name);
      if (!allowed) { answer = { error: 'tool_unavailable', message: 'This tool is not offered or its access was switched off.' }; finalReason ||= 'Unavailable tool requested'; }
      else if (final && (!canPrepare || !stateTool)) { fatal = new Error(stateTool ? 'The provider requested tools instead of a final answer. Continue when you’re ready.' : 'The provider requested more tools after the research limit.'); throw fatal; }
      else if (stateTool && (final ? finalCalls >= RESEARCH_LIMITS.finalCalls : calls >= RESEARCH_LIMITS.calls) || !stateTool && (calls >= RESEARCH_LIMITS.calls || web && searches >= RESEARCH_LIMITS.webCalls || toolData >= RESEARCH_LIMITS.toolData || finalReason === 'Research data exhausted')) { answer = budgetError; finalReason ||= 'Research calls or data exhausted'; }
      else {
        calls++; if (final) finalCalls++; if (web) searches++;
        record(toolCallId, { name, state: 'running', title: label(name, input), input: JSON.stringify(input) }); result.phase = label(name, input);
        const signature = grantSignature(value, name), lookup = cacheKey(name, input), reuse = !stateTool;
        try {
          const saved = reuse && cache.get(lookup), failed = failures.get(lookup), prepared = preparations.get(lookup);
          if (prepared) answer = { kind: 'existing_proposal', ...prepared, message: 'Use the existing proposal. No new proposal was prepared or applied.' };
          else if (failed?.permissions === signature) { answer = { ...structuredClone(failed.result), repeated: true, message: 'This identical call already failed. Correct its arguments or use the available observations.' }; finalReason ||= 'An identical failed tool call was repeated'; }
          else if (saved?.permissions === signature && saved.result) answer = { ...structuredClone(saved.result), cached: true };
          else {
            let pending = reuse && inFlight.get(lookup), duplicate = Boolean(pending);
            if (!pending) { pending = executeTool(value, name, input, controller.signal, context); if (reuse) inFlight.set(lookup, pending); }
            try { answer = await pending; } finally { if (reuse) inFlight.delete(lookup); }
            if (duplicate && answer && !answer.error) answer = { ...answer, cached: true };
            if (reuse && answer && !answer.error) cache.set(lookup, { permissions: signature, result: structuredClone(answer) });
          }
          if (!definitions(value).some(definition => definition.name === name) || signature !== grantSignature(value, name)) answer = { error: 'access_disabled', message: 'Access to this source was switched off.' };
        } catch { check(); answer = { error: 'data_unavailable', message: web ? 'The web source could not be read.' : 'The saved data could not be read.' }; }
      }
      check();
      if (answer?.error && !answer.repeated) failures.set(cacheKey(name, input), { permissions: grantSignature(value, name), result: structuredClone(answer) });
      if (answer && !answer.error && !stateTool) answer = { access_fingerprint: accessFingerprint(value), request_identity: checkpointIdentity(value), ...answer };
      let content = JSON.stringify(answer);
      if (!content || content.length > RESEARCH_LIMITS.result) { answer = { error: 'result_too_large', message: 'Use a narrower request.' }; content = JSON.stringify(answer); }
      if (!stateTool && toolData + content.length > RESEARCH_LIMITS.toolData) { answer = budgetError; content = JSON.stringify(answer); finalReason ||= 'Research data exhausted'; }
      if (toolData + content.length <= RESEARCH_LIMITS.toolData) toolData += content.length;
      if (stateTool && ['proposal', 'change', 'coros'].includes(answer.kind)) preparations.set(cacheKey(name, input), { event_id: activityId(toolCallId), title: answer.proposal?.title || answer.before?.title || answer.title || 'Proposal', status: 'prepared_awaiting_user' });
      completed.push({ name, answer });
      record(toolCallId, { name, input: JSON.stringify(input), state: answer.error || answer.available === false ? 'failed' : 'done', summary: summary(name, answer), result: content, sources: sources(name, answer), ended: Date.now() }); clock();
      return answer;
    });
  };
  const tools = Object.fromEntries((body.tools || []).map(definition => [definition.name, tool({ description: definition.description, inputSchema: jsonSchema(definition.input_schema), strict: false, execute: (input, options) => runTool(definition.name, input, options) })]));
  const instructions = body.instructions;
  const prepareStep = ({ messages }) => {
    check(); if (tokens < 1) return finishFromObservations('The configured reply token limit was reached. Continue when you’re ready.');
    if (round > RESEARCH_LIMITS.continuations + 2) return finishFromObservations('The research continuation limit was reached.');
    currentRound = round++; inputs.clear();
    if (currentRound && JSON.stringify(messages).length > 190000) return finishFromObservations('The research context limit was reached.');
    delete result.usage.last_input_tokens; delete result.usage.last_output_tokens;
    const reserve = Math.min(1024, Math.max(1, Math.floor(value.maxTokens / 3)));
    final = finalRounds > 0 || Boolean(finalReason) || currentRound >= RESEARCH_LIMITS.continuations || calls >= RESEARCH_LIMITS.calls || searches >= RESEARCH_LIMITS.webCalls || toolData >= RESEARCH_LIMITS.toolData || tokens <= reserve;
    canPrepare = final && finalRounds < 2 && finalCalls < RESEARCH_LIMITS.finalCalls && tokens > reserve && [...offered].some(name => STATE_TOOLS.includes(name));
    if (final) finalRounds++;
    const fair = Math.floor((tokens - reserve) / Math.max(1, RESEARCH_LIMITS.continuations - currentRound));
    allowance = canPrepare ? tokens - reserve : offered.size && !final ? Math.max(1, Math.min(tokens - reserve, Math.max(fair, TOOL_ROUND_TOKENS))) : tokens;
    const activeTools = [...offered].filter(name => definitions(value).some(definition => definition.name === name) && (!final || STATE_TOOLS.includes(name)));
    result.phase = final ? 'synthesizing' : 'requesting'; publish();
    const instruction = final ? '\n\nPocket runtime status: the app has stopped research for this reply. This is an app limit, not a user instruction, and does not mean the research is complete. Answer the current user request using the observations already collected. Do not start more research or read more sources. '
      + (canPrepare ? 'Only if the current user request asks to save or change something, prepare it now if it has not already been prepared in this reply. An unfinished action from an earlier message must not replace the current answer. ' : 'Make no more tool calls; write the answer now. ')
      + 'Explain material gaps briefly without attributing this limit to the user.' + (finalReason ? ' App limit: ' + finalReason : '') : '';
    return { maxOutputTokens: allowance, instructions: instructions + instruction, activeTools, toolChoice: final && !canPrepare ? 'none' : 'auto' };
  };
  const onStepEnd = step => {
    check(); lastFinish = step.finishReason;
    const usage = step.usage, raw = usage.raw || {}, anthropic = value.provider === 'anthropic';
    const input = anthropic ? raw.input_tokens ?? usage.inputTokenDetails.noCacheTokens : usage.inputTokens;
    for (const [name, count] of Object.entries({ input_tokens: input, output_tokens: usage.outputTokens, cache_read_input_tokens: usage.inputTokenDetails.cacheReadTokens, cache_creation_input_tokens: usage.inputTokenDetails.cacheWriteTokens })) if (typeof count === 'number' && Number.isFinite(count)) result.usage[name] = (result.usage[name] || 0) + count;
    if (typeof usage.inputTokens === 'number') result.usage.last_input_tokens = usage.inputTokens;
    if (typeof usage.outputTokens === 'number') result.usage.last_output_tokens = usage.outputTokens;
    tokens -= usage.outputTokens || allowance;
    result.model = step.response.modelId || result.model;
    if (step.finishReason === 'length') { finalReason ||= 'Finish within the remaining reply token budget'; if (final) finalRounds = 2; result.activity = settle(result.activity, 'failed', 'Tool request did not finish within this round’s token allowance'); }
    if (step.toolCalls.length || step.finishReason === 'length') {
      if (result.answer.trim()) { result.reasoning += (result.reasoning ? '\n\n' : '') + result.answer.trim() + '\n\n'; result.answer = ''; result.sources = []; }
    }
    if (step.finishReason !== 'length' || step.toolResults.length) responses.push(...step.response.messages);
    if (['content-filter', 'refusal'].includes(step.finishReason)) { fatal = new Error('The provider declined this reply.'); throw fatal; }
    publish();
  };
  const onChunk = ({ chunk }) => {
    check(); clock();
    if (chunk.type === 'text-delta') { result.answer += chunk.text; result.phase = 'writing'; }
    else if (chunk.type === 'reasoning-delta') { result.reasoning += chunk.text; result.phase = 'thinking'; }
    else if (chunk.type === 'source' && chunk.sourceType === 'url') {
      const found = source({ href: chunk.url, title: chunk.title });
      if (found && !found.href.startsWith('/')) { let index = result.sources.findIndex(item => item.href === found.href); if (index < 0 && result.sources.length < 24) { index = result.sources.length; result.sources.push(found); } if (index >= 0) result.answer += ` [${index + 1}](${found.href.replace(/[()]/g, char => encodeURIComponent(char))})`; }
    } else if (chunk.type === 'tool-input-start') {
      if (!chunk.id || chunk.id.length > 200 || !chunk.toolName || chunk.toolName.length > 80) throw new Error('The provider returned an incomplete tool request.');
      inputs.set(chunk.id, { name: chunk.toolName, text: '' }); record(chunk.id, { name: chunk.toolName, title: label(chunk.toolName), state: 'queued' });
    } else if (chunk.type === 'tool-input-delta') {
      const partial = inputs.get(chunk.id); if (!partial) throw new Error('The provider returned tool arguments without a tool.');
      partial.text += chunk.delta; if (partial.text.length > 8000) throw new Error('The tool request is too large.');
      record(chunk.id, { input: partial.text });
    } else if (chunk.type === 'tool-call') {
      if (final && (!canPrepare || !STATE_TOOLS.includes(chunk.toolName))) { fatal = new Error(STATE_TOOLS.includes(chunk.toolName) ? 'The provider requested tools instead of a final answer. Continue when you’re ready.' : 'The provider requested more tools after the research limit.'); throw fatal; }
      if (JSON.stringify(chunk.input || {}).length > 8000) throw new Error('The tool request is too large.');
      record(chunk.toolCallId, { name: chunk.toolName, title: label(chunk.toolName, chunk.input || {}), input: JSON.stringify(chunk.input || {}), ...(chunk.invalid ? { state: 'failed', summary: 'Invalid tool request', ended: Date.now(), result: JSON.stringify({ error: 'invalid_arguments', message: 'Correct the arguments or use an available tool.' }) } : {}) });
    } else if (chunk.type === 'tool-error') {
      record(chunk.toolCallId, { name: chunk.toolName, state: 'failed', summary: 'Tool failed', ended: Date.now(), result: JSON.stringify({ error: 'tool_failed', message: 'Correct the arguments or use the recorded observations.' }) });
    }
    publish();
  };
  clock();
  try {
    const model = await providerModel(value, key, { fetcher, signal: controller.signal, clock, onRetry: () => { result.phase = 'provider busy · retrying'; publish(); } });
    const guarded = callback => args => { try { return callback(args); } catch (error) { fatal = error; throw error; } };
    const agent = new ToolLoopAgent({ model, instructions, tools, providerOptions: providerOptions(value), maxRetries: 2, streamRetries: 0, stopWhen: [isStepCount(RESEARCH_LIMITS.continuations + 3), () => round >= RESEARCH_LIMITS.continuations + 3 || tokens <= 0], prepareStep: guarded(prepareStep), onStepEnd: guarded(onStepEnd), onChunk: guarded(onChunk), onError: () => {} });
    // A truncated text-only step has no tool result for SDK continuation. Synthesize
    // from the original question and committed tool messages, within the same budget.
    while (round <= RESEARCH_LIMITS.continuations + 2) {
      const stream = await agent.stream({ messages: [...body.messages, ...responses], abortSignal: controller.signal });
      let finished = false;
      for await (const part of stream.stream) {
        check();
        if (part.type === 'error') { if (fatal) throw fatal; throw providerError(part.error); }
        if (part.type === 'abort') throw stopped();
        if (part.type === 'finish') { finished = true; lastFinish = part.finishReason; }
      }
      check();
      if (!finished || lastFinish === 'other' || lastFinish === 'error') throw new Error('The connection ended before the reply was complete. Retry when you’re ready.');
      if (lastFinish === 'length' && tokens > 0 && round <= RESEARCH_LIMITS.continuations + 2) continue;
      if (lastFinish === 'length') return finishFromObservations('The configured reply token limit was reached. Continue when you’re ready.');
      if (lastFinish === 'tool-calls') return finishFromObservations('The research continuation limit was reached.');
      if (!result.answer.trim()) throw new Error('The provider returned no answer. Check its model and reply limit.');
      result.activity = settle(result.activity, 'failed'); result.phase = 'done'; publish(); return result;
    }
    return finishFromObservations('The research continuation limit was reached.');
  } catch (error) {
    if (!signal?.aborted && (timedOut || deadlineReached)) return finishFromObservations(deadlineReached ? 'The five-minute research deadline was reached. Continue when you’re ready.' : 'The provider stopped responding for 90 seconds. Continue when you’re ready.');
    if (signal?.aborted || controller.signal.aborted) throw stopped();
    result.activity = settle(result.activity, 'failed', error.message); result.phase = 'failed'; onUpdate(structuredClone(result)); throw error;
  } finally { clearTimeout(timeout); clearTimeout(absolute); signal?.removeEventListener('abort', abort); controller.abort(); }
}
