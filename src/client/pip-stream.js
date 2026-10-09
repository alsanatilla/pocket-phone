import { ToolLoopAgent, isStepCount } from 'ai';
import { activity, source, settle } from './pip-activity.js';
import { execute, access, accessFingerprint, checkpointIdentity, cacheKey, grantSignature, label, preview, summary, sources, toolNames, STATE_TOOLS, WRITE_TOOLS } from './pip-tools.js';
import { sdkTools } from './pip-sdk-tools.js';
import { providerModel, providerOptions, providerError } from './pip-provider.js';
import { RESEARCH_LIMITS } from './pip-limits.js';
export { RESEARCH_LIMITS, CONTEXT_OVERFLOW } from './pip-limits.js';
export { freeFallbacks } from './pip-provider.js';
const TOOL_ROUND_TOKENS = 2048;
const stopped = () => new DOMException('Stopped', 'AbortError');

// The AI SDK owns provider parsing, tool definitions and input validation, tool execution, the user's
// approval of writes and model continuation. Pocket owns user permissions, bounded research and the
// recorded outcomes. approve(requests, signal) resolves to Map(toolCallId → { approved, input? }).
export async function streamChat(chat, turn, { value, body, key, signal, onUpdate = () => {}, fetcher = fetch, executeTool = execute, approve = null, timeoutMs = 90000, deadlineMs = RESEARCH_LIMITS.deadlineMs, resume = null, coverage = null } = {}) {
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  let timeout, absolute, timedOut = false, deadlineReached = false, deadlineLeft = Math.min(deadlineMs, RESEARCH_LIMITS.deadlineMs), deadlineFrom = 0;
  let calls = 0, searches = 0, toolData = 0, tokens = value.maxTokens;
  let finalReason = '', finalRounds = 0, finalCalls = 0, round = 0, currentRound = 0, allowance = 0, final = false, canPrepare = false, lastFinish = '', fatal = null;
  const deadline = () => { deadlineFrom = Date.now(); absolute = setTimeout(() => { deadlineReached = true; controller.abort(); }, deadlineLeft); };
  const clock = () => { clearTimeout(timeout); timeout = setTimeout(() => { timedOut = true; controller.abort(); }, Math.min(timeoutMs, 90000)); };
  // Time spent waiting for the user's approval counts against neither the idle limit nor the research deadline.
  const pause = () => { clearTimeout(timeout); clearTimeout(absolute); deadlineLeft = Math.max(1, deadlineLeft - (Date.now() - deadlineFrom)); };
  deadline();
  const result = { answer: '', reasoning: resume?.reasoning || '', activity: activity(resume?.activity || turn.activity || []), sources: [], phase: 'requesting', usage: { runtime: 'ai-sdk', request_identity: checkpointIdentity(value), read_access: access(value).join('|'), web_access: value.webSearch, notes_restricted: resume?.notes_restricted || false, ...(coverage ? { history_replay: coverage } : {}) }, model: value.model };
  const offered = new Set(body.tools || []);
  const cache = new Map(), inFlight = new Map(), failures = new Map(), saved = new Map(), inputs = new Map(), executed = new Set();
  const previews = new Map(), refusals = new Map(), rows = new Map(), declined = new Set(), pending = [];
  const context = { cache, chat, turn }, completed = [], responses = [];
  const check = () => { if (controller.signal.aborted) throw stopped(); if (fatal) throw fatal; };
  const publish = () => { check(); if (result.answer.length > 64000 || result.reasoning.length > 24000) throw new Error('This reply is too large. Try a shorter request.'); result.activity = activity(result.activity); onUpdate(structuredClone(result)); };
  const prefix = (turn.attempt || crypto.randomUUID()) + ':', activityId = id => prefix + currentRound + ':' + String(id).slice(0, 145);
  // A write runs after the user's decision, in a later round: it keeps the row its call created.
  const rowId = toolCallId => rows.get(toolCallId) || activityId(toolCallId);
  const record = (id, fields) => {
    const old = result.activity.find(row => row.id === id), now = Date.now();
    const row = { id, kind: 'tool', name: '', title: '', input: '', summary: '', sources: [], state: 'queued', started: now, ended: 0, ...old, ...fields };
    if (old) Object.assign(old, row); else result.activity.push(row); publish();
  };
  for (const row of result.activity) {
    if (row.state !== 'done' || !WRITE_TOOLS.includes(row.name) || !row.applied_href) continue;
    try { saved.set(cacheKey(row.name, JSON.parse(row.input || '{}')), { event_id: row.id, href: row.applied_href }); } catch { /* An unreadable write cannot be matched. */ }
  }
  for (const row of resume?.observations || []) {
    if (!offered.has(row.name) || STATE_TOOLS.includes(row.name)) continue;
    try { cache.set(cacheKey(row.name, JSON.parse(row.input || '{}')), { permissions: grantSignature(value, row.name), result: JSON.parse(row.result) }); } catch { /* Unusable checkpoint. */ }
  }
  const finishFromObservations = reason => {
    const observations = completed.length ? completed : (resume?.observations || []).flatMap(row => { try { return [{ answer: JSON.parse(row.result) }]; } catch { return []; } });
    if (!result.answer.trim()) {
      const excerpts = observations.flatMap(({ answer }) => answer.error ? [] : answer.kind === 'action' ? [(answer.action.status === 'saved' ? 'Saved: ' : 'Declined: ') + answer.action.title] : answer.kind === 'plan' ? [] : answer.text ? [String(answer.title || 'Source') + ': ' + answer.text.slice(0, 600)] : (answer.results || answer.notes || answer.tasks || answer.appointments || []).slice(0, 3).map(item => (item.title || item.text || 'Source') + (item.description || item.excerpt ? ': ' + (item.description || item.excerpt).slice(0, 300) : '')));
      result.answer = excerpts.length ? 'Collected observations:\n\n' + excerpts.slice(0, 8).map(item => '- ' + item).join('\n') : 'Research stopped before a final answer was available.';
    }
    result.answer += '\n\n' + reason + ' Completed lookups remain in the activity.';
    result.activity = settle(result.activity, 'failed', reason); result.phase = 'failed'; onUpdate(structuredClone(result));
    throw new Error(reason);
  };
  const toolsAfterLimit = name => new Error(STATE_TOOLS.includes(name) ? 'The provider requested tools instead of a final answer. Continue when you’re ready.' : 'The provider requested more tools after the research limit.');
  const allowed = name => offered.has(name) && toolNames(value).includes(name);
  const budgetError = { error: 'research_budget_reached', message: 'The app’s call or data limit was reached; use completed observations.' };

  // Every tool's SDK execute. Writes reach it only after the user approved them.
  const runTool = async (name, input, { toolCallId }) => {
    check();
    const write = WRITE_TOOLS.includes(name), id = rowId(toolCallId), stateTool = STATE_TOOLS.includes(name), web = ['search_web', 'read_web_page'].includes(name);
    if (!write) {
      const ran = currentRound + ':' + toolCallId;
      if ([...executed].filter(item => item.startsWith(currentRound + ':')).length >= RESEARCH_LIMITS.calls + RESEARCH_LIMITS.finalCalls) { fatal = new Error('The tool request is too large.'); throw fatal; }
      if (executed.has(ran)) { fatal = new Error('The provider returned duplicate tool identifiers.'); throw fatal; }
      executed.add(ran);
      if (final && allowed(name) && (!canPrepare || !stateTool)) { fatal = toolsAfterLimit(name); throw fatal; }
    }
    let answer;
    if (!allowed(name)) { answer = { error: 'tool_unavailable', message: 'This tool is not offered or its access was switched off.' }; finalReason ||= 'Unavailable tool requested'; }
    else if (!write && (stateTool ? (final ? finalCalls >= RESEARCH_LIMITS.finalCalls : calls >= RESEARCH_LIMITS.calls) : calls >= RESEARCH_LIMITS.calls || web && searches >= RESEARCH_LIMITS.webCalls || toolData >= RESEARCH_LIMITS.toolData || finalReason === 'Research data exhausted')) { answer = budgetError; finalReason ||= 'Research calls or data exhausted'; }
    else {
      if (!write) { calls++; if (final) finalCalls++; if (web) searches++; }
      record(id, { name, state: 'running', title: label(name, input), input: JSON.stringify(input) }); result.phase = label(name, input);
      const signature = grantSignature(value, name), lookup = cacheKey(name, input), reuse = !stateTool;
      try {
        const cached = reuse && cache.get(lookup), failed = failures.get(lookup);
        if (failed?.permissions === signature) { answer = { ...structuredClone(failed.result), repeated: true, message: 'This identical call already failed. Correct its arguments or use the available observations.' }; finalReason ||= 'An identical failed tool call was repeated'; }
        else if (cached?.permissions === signature && cached.result) answer = { ...structuredClone(cached.result), cached: true };
        else {
          let running = reuse && inFlight.get(lookup), duplicate = Boolean(running);
          if (!running) { running = executeTool(value, name, input, controller.signal, { ...context, eventId: id }); if (reuse) inFlight.set(lookup, running); }
          try { answer = await running; } finally { if (reuse) inFlight.delete(lookup); }
          if (duplicate && answer && !answer.error) answer = { ...answer, cached: true };
          if (reuse && answer && !answer.error) cache.set(lookup, { permissions: signature, result: structuredClone(answer) });
        }
        if (!toolNames(value).includes(name) || signature !== grantSignature(value, name)) answer = { error: 'access_disabled', message: 'Access to this source was switched off.' };
      } catch { check(); answer = { error: 'data_unavailable', message: web ? 'The web source could not be read.' : write ? 'The change could not be saved.' : 'The saved data could not be read.' }; }
    }
    check();
    if (answer?.error && !answer.repeated && !write) failures.set(cacheKey(name, input), { permissions: grantSignature(value, name), result: structuredClone(answer) });
    if (answer && !answer.error && !stateTool) answer = { access_fingerprint: accessFingerprint(value), request_identity: checkpointIdentity(value), ...answer };
    let content = JSON.stringify(answer);
    if (!content || content.length > RESEARCH_LIMITS.result) { answer = { error: 'result_too_large', message: 'Use a narrower request.' }; content = JSON.stringify(answer); }
    if (!stateTool && toolData + content.length > RESEARCH_LIMITS.toolData) { answer = budgetError; content = JSON.stringify(answer); finalReason ||= 'Research data exhausted'; }
    if (toolData + content.length <= RESEARCH_LIMITS.toolData) toolData += content.length;
    const href = answer.kind === 'action' && answer.action.status === 'saved' ? answer.action.href : '';
    if (href) saved.set(cacheKey(name, input), { event_id: id, href });
    completed.push({ name, answer });
    record(id, { name, input: JSON.stringify(input), state: answer.error || answer.available === false ? 'failed' : 'done', summary: summary(name, answer), result: content, sources: sources(name, answer), ended: Date.now(), ...(href ? { applied_href: href, applied: Date.now() } : {}) }); clock();
    return answer;
  };

  // SDK tool approval for writes: refuse what cannot run, otherwise ask the user with a preview of the change.
  const approval = name => async (input, { toolCallId }) => {
    check();
    const id = activityId(toolCallId); rows.set(toolCallId, id);
    const refuse = (error, message, extra = {}) => { refusals.set(toolCallId, { error, message, ...extra }); return { type: 'denied', reason: message }; };
    if (!allowed(name)) { finalReason ||= 'Unavailable tool requested'; return refuse('tool_unavailable', 'This tool is not offered or its access was switched off.'); }
    if (final && !canPrepare) { fatal = toolsAfterLimit(name); throw fatal; }
    if (final ? finalCalls >= RESEARCH_LIMITS.finalCalls : calls >= RESEARCH_LIMITS.calls) { finalReason ||= 'Preparation call limit reached'; return refuse(budgetError.error, budgetError.message); }
    const done = saved.get(cacheKey(name, input));
    if (done) return refuse('existing_proposal', 'This was already saved. Refer to it instead of saving it again.', { existing: { kind: 'existing_proposal', ...done, status: 'applied_by_user', message: 'This was already saved. Refer to it instead of saving it again.' } });
    calls++; if (final) finalCalls++;
    let ready;
    try { ready = await preview(value, name, input, controller.signal); } catch { check(); ready = { error: 'data_unavailable', message: 'The current record could not be read.' }; }
    check();
    if (ready.error) return refuse(ready.error, ready.message);
    previews.set(toolCallId, ready);
    return 'user-approval';
  };
  const tools = sdkTools([...offered], runTool);
  const toolApproval = Object.fromEntries(WRITE_TOOLS.filter(name => tools[name]).map(name => [name, approval(name)]));
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
    const activeTools = [...offered].filter(name => allowed(name) && (!final || STATE_TOOLS.includes(name)));
    result.phase = final ? 'synthesizing' : 'requesting'; publish();
    const instruction = final ? '\n\nPocket runtime status: the app has stopped research for this reply. This is an app limit, not a user instruction, and does not mean the research is complete. Answer the current user request using the observations already collected. Do not start more research or read more sources. '
      + (canPrepare ? 'Only if the current user request asks to save or change something, request it now if it has not already been requested in this reply. An unfinished action from an earlier message must not replace the current answer. ' : 'Make no more tool calls; write the answer now. ')
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
    if (['content-filter', 'refusal'].includes(step.finishReason)) { fatal = new Error('The provider declined this reply.'); throw fatal; }
    publish();
  };
  const onPart = part => {
    if (part.type === 'text-delta') { result.answer += part.text; result.phase = 'writing'; }
    else if (part.type === 'reasoning-delta') { result.reasoning += part.text; result.phase = 'thinking'; }
    else if (part.type === 'source' && part.sourceType === 'url') {
      const found = source({ href: part.url, title: part.title });
      if (found && !found.href.startsWith('/')) { let index = result.sources.findIndex(item => item.href === found.href); if (index < 0 && result.sources.length < 24) { index = result.sources.length; result.sources.push(found); } if (index >= 0) result.answer += ` [${index + 1}](${found.href.replace(/[()]/g, char => encodeURIComponent(char))})`; }
    } else if (part.type === 'tool-input-start') {
      if (!part.id || part.id.length > 200 || !part.toolName || part.toolName.length > 80) throw new Error('The provider returned an incomplete tool request.');
      inputs.set(part.id, { name: part.toolName, text: '' }); record(activityId(part.id), { name: part.toolName, title: label(part.toolName), state: 'queued' });
    } else if (part.type === 'tool-input-delta') {
      const partial = inputs.get(part.id); if (!partial) throw new Error('The provider returned tool arguments without a tool.');
      partial.text += part.delta; if (partial.text.length > 8000) throw new Error('The tool request is too large.');
      record(activityId(part.id), { input: partial.text });
    } else if (part.type === 'tool-call') {
      if (final && (!canPrepare || !STATE_TOOLS.includes(part.toolName))) { fatal = toolsAfterLimit(part.toolName); throw fatal; }
      if (JSON.stringify(part.input || {}).length > 8000) throw new Error('The tool request is too large.');
      record(activityId(part.toolCallId), { name: part.toolName, title: label(part.toolName, part.input || {}), input: JSON.stringify(part.input || {}), ...(part.invalid ? { state: 'failed', summary: 'Invalid tool request', ended: Date.now(), result: JSON.stringify({ error: 'invalid_arguments', message: 'Correct the arguments or use an available tool.' }) } : {}) });
    } else if (part.type === 'tool-error') {
      record(rowId(part.toolCallId), { name: part.toolName, state: 'failed', summary: 'Tool failed', ended: Date.now(), result: JSON.stringify({ error: 'tool_failed', message: 'Correct the arguments or use the recorded observations.' }) });
    } else if (part.type === 'tool-approval-request' && !part.isAutomatic) {
      const call = part.toolCall, ready = previews.get(call.toolCallId);
      pending.push({ approvalId: part.approvalId, toolCallId: call.toolCallId, toolName: call.toolName, input: call.input, rowId: rowId(call.toolCallId) });
      record(rowId(call.toolCallId), { name: call.toolName, title: label(call.toolName, call.input), input: JSON.stringify(call.input), state: 'awaiting', summary: 'waiting for your approval', result: JSON.stringify({ kind: 'approval', ...ready }) });
    } else if (part.type === 'tool-output-denied' && !declined.has(part.toolCallId)) {
      const refusal = refusals.get(part.toolCallId) || { error: 'denied', message: 'This change was not approved.' }, { existing, ...failure } = refusal;
      record(rowId(part.toolCallId), { name: part.toolName, state: existing ? 'done' : 'failed', summary: existing ? summary(part.toolName, existing) : failure.message, ended: Date.now(), result: JSON.stringify(existing || failure) });
    }
    publish();
  };
  // The user's decisions go back to the SDK as tool-approval-response messages. An edit replaces the
  // call's input, which the SDK validates again before it runs the approved tool.
  const decide = async () => {
    if (!approve) throw new Error('Pip needs your approval to save this, but approval is unavailable here.');
    result.phase = 'waiting for your approval'; publish(); pause();
    const decisions = await approve(pending.map(item => ({ ...item })), controller.signal);
    check(); deadline(); clock();
    for (const message of responses) for (const part of Array.isArray(message.content) ? message.content : []) {
      const edited = part.type === 'tool-call' && decisions.get(part.toolCallId)?.input;
      if (edited) part.input = structuredClone(edited);
    }
    responses.push({ role: 'tool', content: pending.map(item => {
      const approved = decisions.get(item.toolCallId)?.approved === true;
      if (!approved) {
        declined.add(item.toolCallId);
        const ready = previews.get(item.toolCallId);
        record(item.rowId, { state: 'done', summary: 'declined', ended: Date.now(), result: JSON.stringify({ kind: 'action', action: { ...ready?.action, status: 'declined' } }) });
      } else record(item.rowId, { state: 'queued', summary: 'approved', input: JSON.stringify(decisions.get(item.toolCallId).input || item.input) });
      return { type: 'tool-approval-response', approvalId: item.approvalId, approved, ...(approved ? {} : { reason: 'The user declined this change.' }) };
    }) });
    pending.length = 0;
  };
  clock();
  try {
    const model = await providerModel(value, key, { fetcher, signal: controller.signal, clock, onRetry: () => { result.phase = 'provider busy · retrying'; publish(); } });
    const guarded = callback => args => { try { return callback(args); } catch (error) { fatal = error; throw error; } };
    const agent = new ToolLoopAgent({ model, instructions, tools, toolApproval, providerOptions: providerOptions(value), maxRetries: 2, streamRetries: 0, stopWhen: [isStepCount(RESEARCH_LIMITS.continuations + 3), () => round >= RESEARCH_LIMITS.continuations + 3 || tokens <= 0], prepareStep: guarded(prepareStep), onStepEnd: guarded(onStepEnd), onError: () => {} });
    // Each SDK call continues from the committed messages: after the user's approval decisions, or after a
    // truncated text-only step, which has no tool result to continue from and is synthesized again.
    for (;;) {
      const stream = await agent.stream({ messages: [...body.messages, ...responses], abortSignal: controller.signal });
      let finished = false;
      for await (const part of stream.stream) {
        check(); clock();
        if (part.type === 'error') { if (fatal) throw fatal; throw providerError(part.error); }
        if (part.type === 'abort') throw stopped();
        if (part.type === 'finish') { finished = true; lastFinish = part.finishReason; }
        else onPart(part);
      }
      check();
      if (!finished || lastFinish === 'other' || lastFinish === 'error') throw new Error('The connection ended before the reply was complete. Retry when you’re ready.');
      const steps = await stream.steps, truncated = new Set(steps.filter(step => step.finishReason === 'length' && !step.toolResults.length).flatMap(step => step.response.messages));
      responses.push(...(await stream.responseMessages).filter(message => !truncated.has(message)));
      if (pending.length) { await decide(); continue; }
      if (lastFinish === 'length' && tokens > 0 && round <= RESEARCH_LIMITS.continuations + 2) continue;
      if (lastFinish === 'length') return finishFromObservations('The configured reply token limit was reached. Continue when you’re ready.');
      if (lastFinish === 'tool-calls') return finishFromObservations('The research continuation limit was reached.');
      if (!result.answer.trim()) throw new Error('The provider returned no answer. Check its model and reply limit.');
      result.activity = settle(result.activity, 'failed'); result.phase = 'done'; publish(); return result;
    }
  } catch (error) {
    if (!signal?.aborted && (timedOut || deadlineReached)) return finishFromObservations(deadlineReached ? 'The five-minute research deadline was reached. Continue when you’re ready.' : 'The provider stopped responding for 90 seconds. Continue when you’re ready.');
    if (signal?.aborted || controller.signal.aborted) throw stopped();
    result.activity = settle(result.activity, 'failed', error.message); result.phase = 'failed'; onUpdate(structuredClone(result)); throw error;
  } finally { clearTimeout(timeout); clearTimeout(absolute); signal?.removeEventListener('abort', abort); controller.abort(); }
}
