import { createHash } from 'node:crypto';
import { Agent, openClawAgentCoreRuntime } from 'openclaw/plugin-sdk/agent-core';
import { z } from 'zod';
import { SDK_RESEARCH_INSTRUCTIONS } from '../client/pip-core.js';
import { sdkTools, SCHEMAS } from '../client/pip-sdk-tools.js';
import { execute, preview, toolNames, WRITE_TOOLS, STATE_TOOLS, access, cacheKey, grantSignature, accessFingerprint, checkpointIdentity, label, summary, sources } from '../client/pip-tools.js';
import { activity, settle, source } from '../client/pip-activity.js';
import { RESEARCH_LIMITS } from '../client/pip-limits.js';
import { CARD_ARGUMENT_LIMIT, cardFence, cardIds, draftLines, replaceCard } from '../shared/pocket-card-tool.js';
import { cardsIn } from '../shared/pocket-card-edit.js';
import { normalizeAnswer } from '../shared/pip-reply.js';
import { answerPieces, joinPieces, steerText, takenSteers } from '../shared/pip-steer.js';
import { createTransport, toCore } from './pip-agent-transport.js';

/**
 * A reply makes at most this many model requests, counted across approval pauses. It only catches runaways: each
 * request has the person's reply limit as its output cap, and there is no per-reply token budget (thinking is never
 * counted). Browser chats keep the older budget in pip-stream.js.
 */
export const MAX_REQUESTS = 12;
/** A message cut off at the reply limit is written again at most this many times in a row. */
const LENGTH_RETRIES = 2;
const CEILING = `The reply reached its limit of ${MAX_REQUESTS} model requests. Continue when you’re ready.`;
const LENGTH = 'The reply limit per message was reached. Continue when you’re ready.';
/** What the "enough looked up" judge stops research with; only that stop is lifted by a message sent into the reply. */
const ENOUGH = 'Enough looked up for this message';
const CARD_TOOLS = ['show_card', 'update_card'];
export class RunPaused extends Error { constructor() { super('Waiting for a decision'); this.name = 'RunPaused'; } }
const stopped = () => new DOMException('Stopped', 'AbortError');
const approvalId = row => 'oc-' + createHash('sha256').update(row).digest('hex').slice(0, 40);
const packet = details => ({ content: [{ type: 'text', text: JSON.stringify(details) }], details });
/** A lookup is a tool call that is neither a write nor a state tool: only these are refused when research stops. */
const isLookup = name => !WRITE_TOOLS.includes(name) && !STATE_TOOLS.includes(name);
/** Arguments as the activity keeps them: a card's are in the answer already. */
const kept = (name, input) => CARD_TOOLS.includes(name) ? (name === 'update_card' ? JSON.stringify({ id: input?.id }) : '{}') : JSON.stringify(input);

/**
 * Server-owned OpenClaw agent. OpenClaw owns the model/tool loop, argument validation and transcript; Pocket supplies
 * tools, permissions, bounded research, the answer as it is drawn, and durable approval checkpoints.
 * A durable run passes `durable`: { checkpoint, settled, pause }; it stops at a decision point (RunPaused) and
 * continues in a later request with the clients' decisions in `settled` (Map toolCallId → { approved, input? } or
 * { answer } for a device). Without `durable`, `approve(requests, signal)` answers in place.
 * A chat reply passes `steering`: { take({ pos }) } marks the messages the person sent into this reply as taken, and
 * returns them ([{ uid, text, at, taken, pos }]); they reach the model before its next request ("Steering" in
 * docs/pip-agent-runtime.md). Scheduled jobs and assignments pass none.
 */
export async function streamChat(chat, turn, { value, body, key, signal, onUpdate = () => {}, fetcher = fetch,
  executeTool = execute, previewTool = preview, approve, deviceTools = [], durable, saveTurn, resume, coverage,
  deadlineMs = RESEARCH_LIMITS.deadlineMs, timeoutMs = 90000, research, streamFn, transport = createTransport, steering } = {}) {
  const saved = durable?.checkpoint;
  if (saved && saved.runtime !== 'openclaw') throw new Error('This pending reply uses the previous runtime. Stop it and send the request again.');
  const model = { id: value.model, name: value.model, api: 'pocket-transport', provider: value.provider, baseUrl: value.baseUrl, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: value.maxTokens };
  const result = saved?.result || { answer: '', reasoning: resume?.reasoning || '', activity: activity(resume?.activity || turn.activity || []), sources: [], phase: 'requesting', model: value.model };
  // Usage is this request's segment only: pip-runs adds it to what earlier segments of the reply spent.
  result.usage = { runtime: 'openclaw', agent_runtime: 'openclaw', request_identity: checkpointIdentity(value), read_access: access(value).join('|'), web_access: value.webSearch, notes_restricted: resume?.notes_restricted || false, ...(coverage ? { history_replay: coverage } : {}) };
  const counters = { requests: 0, calls: 0, lookups: 0, searches: 0, toolData: 0, enoughAsked: 0, enoughLookups: 0, enoughStopped: false, finalReason: '', lengthRetries: 0, cardEnd: 0, researchLeft: RESEARCH_LIMITS.deadlineMs, ...saved?.counters };
  const previews = saved?.previews || {}, rows = saved?.rows || {}, decisions = durable?.settled || new Map();
  // The turn is the record of what was taken (it is written in the same step that marks a message taken), so it wins
  // over a checkpoint written before a later take. A message stands at most at the end of the answer it is resumed with.
  const steered = takenSteers(turn.steers).map(item => ({ ...item, pos: Math.min(Number(item.pos) || 0, result.answer.length) }));
  if (steered.length || steering) result.steers = steered;
  let agent, fatal, ending = '', finished = false;

  // Timers. The research deadline is shared by every request of a reply (the checkpoint carries what is left); the
  // idle limit is provider silence: the transport resets it on bytes (clock) and every agent event resets it too.
  // Neither runs while the person decides on an approval, and the idle limit does not run while a tool works.
  const controller = new AbortController(), abort = () => { controller.abort(); agent?.abort(); };
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  let idle, absolute, timedOut = false, deadlineReached = false, deadlineFrom = 0, busy = 0;
  let deadlineLeft = Math.max(1, Math.min(deadlineMs, RESEARCH_LIMITS.deadlineMs, counters.researchLeft));
  const requestBudget = deadlineLeft;
  const deadline = () => { clearTimeout(absolute); deadlineFrom = Date.now(); absolute = setTimeout(() => { deadlineReached = true; abort(); }, deadlineLeft); };
  const clock = () => { clearTimeout(idle); if (!busy) idle = setTimeout(() => { timedOut = true; abort(); }, Math.min(timeoutMs, 90000)); };
  const holdTimers = () => { clearTimeout(idle); clearTimeout(absolute); deadlineLeft = Math.max(1, deadlineLeft - (Date.now() - deadlineFrom)); };
  const restartTimers = () => { deadline(); clock(); };
  const check = () => { if (controller.signal.aborted) throw stopped(); };
  // Thinking is kept to 24,000 characters; past that it drops to its last 16,000, so the live stream replaces it
  // once in a while rather than with every token.
  const publish = () => {
    check(); if (result.answer.length > 64000) throw new Error('This reply is too large. Try a shorter request.');
    if (result.reasoning.length > 24000) result.reasoning = result.reasoning.slice(-16000);
    result.activity = activity(result.activity); onUpdate(structuredClone(result));
  };

  // Rows. A call's row id includes the request it came from, so a provider reusing a call id later gets a new row
  // and a new approval; a write that runs after a decision keeps the row its call created (rows, in the checkpoint).
  const prefix = (turn.attempt || turn.uid) + ':', activityId = id => prefix + Math.max(0, counters.requests - 1) + ':' + String(id).slice(0, 145);
  const rowId = callId => rows[callId] || activityId(callId);
  const record = (id, fields) => {
    const old = result.activity.find(row => row.id === id), now = Date.now();
    const row = { id, kind: 'tool', name: '', title: '', input: '', summary: '', sources: [], state: 'queued', started: now, ended: 0, ...old, ...fields };
    if (old) Object.assign(old, row); else result.activity.push(row); publish();
  };

  // Cards live in the answer where they were drawn. While show_card is written, its complete elements stand there as
  // an open fence (`draft`), so it builds up on screen; the checked card replaces it, or it is dropped. `cardEnd`
  // is the end of the last drawn card: the answer up to there stays even when a later step is only working notes.
  let draft = null;
  const dropDraft = id => { if (draft && (!id || draft.id === id)) { result.answer = result.answer.slice(0, draft.at); draft = null; } };
  const placeCard = fence => { const before = result.answer.replace(/\s+$/, ''); result.answer = before + (before ? '\n\n' : '') + fence + '\n\n'; counters.cardEnd = result.answer.length; };
  /** Text after the last card leaves the answer for the thinking: working notes before a lookup, or a cut-off message. */
  const moveNotes = () => {
    const notes = result.answer.slice(counters.cardEnd).trim();
    if (notes) { result.reasoning += (result.reasoning ? '\n\n' : '') + notes + '\n\n'; result.answer = result.answer.slice(0, counters.cardEnd); }
  };
  /** update_card: the checked card replaces the one with its id in this reply or, newest first, an earlier one. */
  const reviseCard = async ({ id, spec, shows }) => {
    const change = text => { const old = cardsIn(text).find(card => card.id === id); return old ? replaceCard(text, id, cardFence(spec, { id, updated: Date.now(), pinned: old.pinned, alert: old.alert })) : null; };
    const here = change(result.answer);
    if (here !== null) {
      // A message sent into the reply after the card keeps its place behind it.
      let from = 0; while (from < here.length && here[from] === result.answer[from]) from++;
      for (const item of result.steers || []) if (item.pos > from) item.pos += here.length - result.answer.length;
      counters.cardEnd += here.length - result.answer.length; result.answer = here; return { kind: 'card', updated: true, id, shows };
    }
    const earlier = (chat.turns || []).filter(item => item.uid !== turn.uid && typeof item.answer === 'string');
    for (const item of earlier.toReversed()) {
      const changed = change(item.answer);
      if (changed === null) continue;
      const next = { ...item, answer: changed, updated: Math.max(Date.now(), (item.updated || 0) + 1) };
      try { if (!saveTurn) throw new Error('unavailable'); await saveTurn(next); } catch { return { error: 'card_not_saved', message: 'The card could not be saved. Say so, and draw a new one with show_card if it matters.' }; }
      Object.assign(item, next); return { kind: 'card', updated: true, id, shows, where: 'an earlier reply' };
    }
    const known = [...cardIds(result.answer), ...earlier.flatMap(item => cardIds(item.answer))];
    return { error: 'card_not_found', message: `No card with id "${id}" is in this chat. ` + (known.length ? 'Cards here: ' + [...new Set(known)].slice(0, 12).join(', ') + '.' : 'There are no cards to change; draw one with show_card.') };
  };

  const offered = (body.tools || []).filter(name => toolNames(value).includes(name) && SCHEMAS[name]);
  const allowed = name => offered.includes(name) && toolNames(value).includes(name);
  const definitions = sdkTools(offered, () => {});
  // Lookups already made in this reply (a restarted run's observations) answer again from cache, while the provider,
  // model and access are the same; failures, saved writes and lookups running now are matched too.
  const cache = new Map(), failures = new Map(), inFlight = new Map(), savedWrites = new Map(), completed = [];
  for (const row of resume?.observations || []) {
    if (!offered.includes(row.name) || !isLookup(row.name)) continue;
    try {
      const answer = JSON.parse(row.result);
      if (answer.request_identity !== checkpointIdentity(value) || answer.access_fingerprint !== accessFingerprint(value)) continue;
      cache.set(cacheKey(row.name, JSON.parse(row.input)), { signature: grantSignature(value, row.name), answer });
    } catch { /* An unusable observation is looked up again. */ }
  }
  for (const row of result.activity) {
    if (row.state !== 'done' || !WRITE_TOOLS.includes(row.name) || !row.applied_href) continue;
    try { savedWrites.set(cacheKey(row.name, JSON.parse(row.input || '{}')), { event_id: row.id, href: row.applied_href }); } catch { /* An unreadable write cannot be matched. */ }
  }
  const existing = (name, input) => {
    const done = WRITE_TOOLS.includes(name) && savedWrites.get(cacheKey(name, input));
    return done && { kind: 'existing_proposal', ...done, status: 'applied_by_user', message: 'This was already saved. Refer to it instead of saving it again.' };
  };

  // Research stops for a reason (a limit, the judge, a cut-off message) or on the last request; lookups are then
  // refused with a result. Cards, plans and approved saves stay available: taking them away made models write
  // "[card: …]" stand-ins instead of drawing.
  const lastRequest = () => counters.requests >= MAX_REQUESTS;
  const researchStopped = () => Boolean(counters.finalReason) || counters.enoughStopped || lastRequest() || counters.requests > RESEARCH_LIMITS.continuations
    || counters.calls >= RESEARCH_LIMITS.calls || counters.searches >= RESEARCH_LIMITS.webCalls || counters.toolData >= RESEARCH_LIMITS.toolData;
  const budgetError = { error: 'research_budget_reached', message: 'The app’s lookup limit for this reply was reached. Answer with the collected observations; cards, plans and approved saves remain available.' };
  const refusal = (name, web) => {
    if (researchStopped()) return counters.finalReason || (lastRequest() ? 'Last model request of this reply' : 'Research limit reached');
    if (research?.lookups !== undefined && counters.lookups >= research.lookups || web && research?.webCalls !== undefined && counters.searches >= research.webCalls) return 'Enough looked up for this message';
    return '';
  };
  const base = body.instructions.replace(SDK_RESEARCH_INSTRUCTIONS, 'Research tools report their limits in their results. Cards, plans and approved saves remain available after research stops. ');
  const instructions = () => base + (lastRequest()
    ? '\n\nPocket runtime status: this is the last model request this reply may make. This is an app limit, not a user instruction. Write the answer to the current user request now, in this message, from the observations already collected; lookups are refused. '
      + (offered.includes('show_card') ? 'A card that belongs in this answer is still drawn by calling show_card in this same message; never write a stand-in such as "[card: …]". ' : '')
    : researchStopped() ? '\n\nPocket runtime status: the app has stopped research for this reply. This is an app limit, not a user instruction, and does not mean the research is complete. Answer the current user request using the observations already collected; lookups now return research_budget_reached. '
      + 'Only if the current user request asks to save or change something, request it now if it has not already been requested in this reply. An unfinished action from an earlier message must not replace the current answer. '
      + (offered.includes('show_card') ? 'A card that belongs in this answer is still drawn by calling show_card; never write a stand-in for one. ' : '')
      + 'Explain material gaps briefly without attributing this limit to the user.' + (counters.finalReason ? ' App limit: ' + counters.finalReason : '') : '');
  // Steering. Messages the person sent into this reply are taken only between model requests, never while a tool batch
  // runs: OpenClaw would skip the batch's unstarted sequential calls (approved saves, cards) for a steering message.
  // Each is a user message that keeps its uid (`pocketSteer`), so a message the turn records as taken but the
  // transcript lacks (a restart rebuilt it, or a checkpoint predates the take) is added once, and never twice.
  const inTranscript = uid => (agent?.state.messages || []).some(message => message.role === 'user' && message.pocketSteer === uid);
  const steerMessage = item => ({ role: 'user', content: [{ type: 'text', text: steerText(item.text) }], timestamp: Date.now(), pocketSteer: item.uid });
  /** The messages due before the next request: taken ones the transcript lacks, then new ones while a request is left. */
  const steersNow = async () => {
    if (!result.steers) return [];
    const due = result.steers.filter(item => !inTranscript(item.uid));
    if (steering && counters.requests < MAX_REQUESTS && !ending) {
      // What was written so far stays as written; the message stands after it and the answer continues below.
      let fresh = [];
      try { fresh = await steering.take({ pos: result.answer.length }) || []; } catch { /* A message not taken now is taken later, or waits its turn. */ }
      check();
      if (fresh.length) {
        result.steers.push(...fresh); due.push(...fresh); counters.cardEnd = result.answer.length;
        // The person asked for more: research the judge ended may start again. Every other limit holds.
        if (counters.enoughStopped && counters.finalReason === ENOUGH) { counters.enoughStopped = false; counters.finalReason = ''; counters.enoughLookups = counters.lookups; }
        publish();
      }
    }
    return due.map(steerMessage);
  };
  /** Before each model request: the ceiling, the context size, the judge, and that request's instructions. False ends the reply. */
  const prepare = async messages => {
    check();
    if (counters.requests >= MAX_REQUESTS) { ending ||= CEILING; return false; }
    if (counters.requests && JSON.stringify(messages).length > 190000) { ending ||= 'The research context limit was reached. Continue when you’re ready.'; return false; }
    // Between rounds, JEV says whether what was found is enough; a yes ends research the way a limit does.
    if (!researchStopped() && typeof research?.enough === 'function' && counters.lookups > counters.enoughLookups && counters.enoughAsked < 6) {
      counters.enoughAsked++; counters.enoughLookups = counters.lookups;
      try { if (await research.enough({ lookups: counters.lookups, rounds: counters.requests })) { counters.enoughStopped = true; counters.finalReason ||= ENOUGH; } }
      catch { /* A judge that fails must never fail the reply. */ }
      check();
    }
    counters.requests++;
    result.phase = researchStopped() ? 'synthesizing' : 'requesting'; publish();
    return instructions();
  };

  // Lookups run at most RESEARCH_LIMITS.parallel at a time; everything else runs alone (see executionMode below).
  let running = 0; const waiting = [];
  const slot = async () => { while (running >= RESEARCH_LIMITS.parallel) await new Promise(resolve => waiting.push(resolve)); running++; };
  const free = () => { running--; waiting.shift()?.(); };

  /** One tool call, as the model sees its outcome. Every failure is a result, never a crashed reply. */
  const call = async (name, callId, raw) => {
    check();
    const id = rowId(callId), write = WRITE_TOOLS.includes(name), device = deviceTools.includes(name), lookup = isLookup(name), web = ['search_web', 'read_web_page'].includes(name);
    const fail = (answer, input = raw) => { record(id, { name, title: label(name, input || {}), input: kept(name, input || {}), state: 'failed', summary: answer.message || summary(name, answer), result: JSON.stringify(answer), ended: Date.now() }); return answer; };
    if (!allowed(name)) { counters.finalReason ||= 'Unavailable tool requested'; return fail({ error: 'tool_unavailable', message: 'This tool is not offered or its access was switched off.' }); }
    const invalid = () => fail({ error: 'invalid_arguments', message: 'Correct the arguments or use an available tool.' });
    let input; try { input = SCHEMAS[name].parse(raw); } catch { return invalid(); }
    let decision;
    if (write || device) {
      const done = existing(name, input);
      if (done) { record(id, { name, title: label(name, input), input: JSON.stringify(input), state: 'done', summary: summary(name, done), result: JSON.stringify(done), ended: Date.now() }); return done; }
      const ready = previews[callId] ||= device ? { action: { kind: 'device', tool: name, title: label(name, input) }, device: { tool: name, input } } : await safePreview(name, input);
      if (ready.error) return fail(ready, input);
      decision = decisions.get(callId);
      if (!decision) {
        // A durable run asked at the message boundary; a call that reaches here unasked cannot be approved now.
        if (durable || !approve) return fail({ error: 'approval_unavailable', message: 'Pip needs your approval for this, but approval is unavailable here.' }, input);
        const request = { approvalId: approvalId(id), toolCallId: callId, toolName: name, input, rowId: id };
        record(id, { name, title: label(name, input), input: JSON.stringify(input), state: 'awaiting', summary: 'waiting for your approval', result: JSON.stringify({ kind: 'approval', ...ready }) });
        result.phase = device ? 'waiting for your device' : 'waiting for your approval'; publish();
        holdTimers();
        try { decision = (await approve([request], controller.signal)).get(callId); } finally { restartTimers(); }
        check();
      }
      decisions.delete(callId);
      if (device ? decision?.answer === undefined : !decision?.approved) {
        const declined = device ? { error: 'device_unavailable', message: 'The device did not answer.' } : { message: 'The user declined this change.', kind: 'action', action: { ...ready.action, status: 'declined' } };
        record(id, { name, title: label(name, input), input: JSON.stringify(input), state: device ? 'failed' : 'done', summary: device ? declined.message : 'declined', result: JSON.stringify(declined), ended: Date.now() });
        return declined;
      }
      if (decision.input) { try { input = SCHEMAS[name].parse(decision.input); } catch { return invalid(); } }
    }
    let answer;
    const refused = lookup && refusal(name, web);
    if (refused) { counters.finalReason ||= refused; answer = budgetError; }
    else {
      if (lookup) { counters.calls++; counters.lookups++; if (web) counters.searches++; }
      record(id, { name, state: 'running', title: label(name, input), input: kept(name, input) }); result.phase = label(name, input); publish();
      const signature = grantSignature(value, name), lookupKey = cacheKey(name, input), failed = failures.get(lookupKey), cached = lookup && cache.get(lookupKey);
      if (failed?.signature === signature) { answer = { ...structuredClone(failed.answer), repeated: true, message: 'This identical call already failed. Correct its arguments or use the available observations.' }; counters.finalReason ||= 'An identical failed tool call was repeated'; }
      else if (cached?.signature === signature) answer = { ...structuredClone(cached.answer), cached: true };
      else {
        let pending = lookup && inFlight.get(lookupKey); const duplicate = Boolean(pending);
        if (!pending) {
          pending = device ? Promise.resolve(structuredClone(decision.answer)) : (async () => {
            if (lookup) await slot();
            try { return await executeTool(value, name, input, controller.signal, { cache, chat, turn, eventId: id }); } finally { if (lookup) free(); }
          })();
          if (lookup) inFlight.set(lookupKey, pending);
        }
        try { answer = await pending; }
        catch { check(); answer = { error: 'data_unavailable', message: web ? 'The web source could not be read.' : write ? 'The change could not be saved.' : 'The saved data could not be read.' }; }
        finally { if (lookup) inFlight.delete(lookupKey); }
        if (duplicate && answer && !answer.error) answer = { ...answer, cached: true };
        if (lookup && answer && !answer.error) cache.set(lookupKey, { signature, answer: structuredClone(answer) });
      }
      // A grant switched off while the call ran withholds what it returned.
      if (!toolNames(value).includes(name) || signature !== grantSignature(value, name)) answer = { error: 'access_disabled', message: 'Access to this source was switched off.' };
    }
    check();
    if (!answer || typeof answer !== 'object') answer = { error: 'data_unavailable', message: 'The tool returned nothing.' };
    if (answer.error && !answer.repeated && !write && answer !== budgetError) failures.set(cacheKey(name, input), { signature: grantSignature(value, name), answer: structuredClone(answer) });
    if (lookup && !answer.error) answer = { access_fingerprint: accessFingerprint(value), request_identity: checkpointIdentity(value), ...answer };
    if (name === 'update_card' && answer.revise) answer = await reviseCard(answer);
    if (name === 'show_card') { dropDraft(callId); if (answer.card) { placeCard(answer.card); answer = { kind: 'card', drawn: true, id: answer.id, shows: answer.shows }; } }
    let content = JSON.stringify(answer);
    if (content.length > RESEARCH_LIMITS.result) { answer = { error: 'result_too_large', message: 'Use a narrower request.' }; content = JSON.stringify(answer); }
    if (lookup && counters.toolData + content.length > RESEARCH_LIMITS.toolData) { answer = budgetError; content = JSON.stringify(answer); counters.finalReason ||= 'Research data exhausted'; }
    if (lookup) counters.toolData += content.length;
    const href = answer.kind === 'action' && answer.action?.status === 'saved' ? answer.action.href : '';
    if (href) savedWrites.set(cacheKey(name, input), { event_id: id, href });
    const found = sources(name, answer);
    for (const item of found) if (!result.sources.some(s => s.href === item.href) && result.sources.length < 24) result.sources.push(item);
    completed.push({ name, answer });
    record(id, { name, title: label(name, input), input: kept(name, input), state: answer.error || answer.available === false ? 'failed' : 'done', summary: summary(name, answer), result: content, sources: found, ended: Date.now(), ...(href ? { applied_href: href, applied: Date.now() } : {}) });
    return answer;
  };
  const safePreview = async (name, input) => {
    try { return await previewTool(value, name, input, controller.signal); }
    catch { check(); return { error: 'data_unavailable', message: 'The current record could not be read.' }; }
  };
  // The idle limit waits while a tool works: a slow lookup is not a silent provider.
  const run = async (name, callId, raw) => {
    busy++; clearTimeout(idle);
    try { return packet(await call(name, callId, raw)); } finally { busy--; clock(); }
  };
  const tools = offered.map(name => ({ name, label: name, description: definitions[name].description, parameters: z.toJSONSchema(SCHEMAS[name], { unrepresentable: 'any' }),
    executionMode: isLookup(name) && !deviceTools.includes(name) ? 'parallel' : 'sequential', execute: (id, input) => run(name, id, input) }));

  // The reply as it streams: text, thinking, and a card while it is written.
  const inputs = new Map();
  const onPart = part => {
    if (part.type === 'text_delta') { dropDraft(); result.answer += part.delta; result.phase = 'writing'; }
    else if (part.type === 'thinking_delta') { result.reasoning += part.delta; result.phase = 'thinking'; }
    else if (part.type === 'toolcall_start') {
      const started = part.partial?.content?.[part.contentIndex];
      if (!started?.id || !started.name) return;
      inputs.set(part.contentIndex, { id: started.id, name: started.name, text: '' });
      record(activityId(started.id), { name: started.name, title: label(started.name), state: 'queued' });
      if (started.name === 'show_card' && !draft) {
        const before = result.answer.replace(/\s+$/, '');
        result.answer = before + (before ? '\n\n' : ''); draft = { id: started.id, at: result.answer.length }; result.answer += '```pocket\n'; result.phase = 'drawing';
      }
    } else if (part.type === 'toolcall_delta') {
      const partial = inputs.get(part.contentIndex); if (!partial) return;
      partial.text += part.delta;
      if (partial.text.length > (CARD_TOOLS.includes(partial.name) ? CARD_ARGUMENT_LIMIT : 8000)) throw new Error('The tool request is too large.');
      if (!CARD_TOOLS.includes(partial.name)) { record(activityId(partial.id), { input: partial.text }); return; }
      if (draft?.id === partial.id) { const lines = draftLines(partial.text); result.answer = result.answer.slice(0, draft.at) + '```pocket\n' + (lines ? lines + '\n' : ''); }
    } else if (part.type === 'toolcall_end' && part.toolCall?.id) {
      record(activityId(part.toolCall.id), { name: part.toolCall.name, title: label(part.toolCall.name, part.toolCall.arguments || {}), input: kept(part.toolCall.name, part.toolCall.arguments || {}) });
      return;
    } else return;
    publish();
  };
  const ended = new WeakSet();
  /** After a message's tools ran: a leftover draft goes; text before a lookup is working notes. */
  const endStep = message => {
    if (ended.has(message)) return; ended.add(message);
    dropDraft();
    if ((message.content || []).some(p => p.type === 'toolCall' && !CARD_TOOLS.includes(p.name))) moveNotes();
    if (message.stopReason === 'length') result.activity = settle(result.activity, 'failed', 'The tool request did not finish within the reply limit per message');
    publish();
  };
  const checkpoint = pending => {
    holdTimers();
    return structuredClone({ runtime: 'openclaw', messages: agent.state.messages, result, counters: { ...counters, researchLeft: Math.max(1, counters.researchLeft - (requestBudget - deadlineLeft)) }, pending, previews, rows });
  };
  const onMessage = async message => {
    if (!['stop', 'length', 'toolUse'].includes(message.stopReason)) return;
    const usage = message.usage || {}, whole = usage.pocket?.inputTokens ?? (usage.input || 0) + (usage.cacheRead || 0) + (usage.cacheWrite || 0);
    // As the old loop counted: Anthropic's input_tokens is the uncached input (OpenClaw's `input`); elsewhere it is
    // the whole prompt, which the transport keeps in usage.pocket. The last request's prompt is always the whole one.
    for (const [name, count] of Object.entries({ input_tokens: value.provider === 'anthropic' ? usage.input : whole, output_tokens: usage.output, cache_read_input_tokens: usage.cacheRead, cache_creation_input_tokens: usage.cacheWrite }))
      if (typeof count === 'number' && Number.isFinite(count)) result.usage[name] = (result.usage[name] || 0) + count;
    result.usage.last_input_tokens = whole;
    result.usage.last_output_tokens = usage.output || 0;
    result.model = message.responseModel || result.model;
    if (message.stopReason !== 'length') counters.lengthRetries = 0;
    const calls = (message.content || []).filter(p => p.type === 'toolCall');
    for (const item of calls) {
      rows[item.id] = activityId(item.id); delete previews[item.id]; decisions.delete(item.id);
      record(rows[item.id], { name: item.name, title: label(item.name, item.arguments || {}), input: kept(item.name, item.arguments || {}) });
    }
    if (!durable) return;
    // A durable run asks for every write and device call of the message at once, before any of its tools run.
    const pending = [];
    for (const item of calls) {
      if (!allowed(item.name) || !(WRITE_TOOLS.includes(item.name) || deviceTools.includes(item.name))) continue;
      const parsed = SCHEMAS[item.name].safeParse(item.arguments);
      if (!parsed.success || existing(item.name, parsed.data)) continue;
      const device = deviceTools.includes(item.name);
      const ready = previews[item.id] = device ? { action: { kind: 'device', tool: item.name, title: label(item.name, parsed.data) }, device: { tool: item.name, input: parsed.data } } : await safePreview(item.name, parsed.data);
      if (ready.error) continue;
      pending.push({ approvalId: approvalId(rows[item.id]), toolCallId: item.id, toolName: item.name, input: parsed.data, rowId: rows[item.id] });
      record(rows[item.id], { name: item.name, input: JSON.stringify(parsed.data), state: 'awaiting', summary: 'waiting for your approval', result: JSON.stringify({ kind: 'approval', ...ready }) });
    }
    if (!pending.length) return;
    endStep(message);
    result.phase = pending.every(item => deviceTools.includes(item.toolName)) ? 'waiting for your device' : 'waiting for your approval'; publish();
    await durable.pause(checkpoint(pending));
    throw new RunPaused();
  };

  /** The answer in its stored form, cleaned piece by piece around the person's messages so each keeps its place. */
  const clean = (tail = '') => {
    if (!result.steers?.length) { result.answer = normalizeAnswer(result.answer + tail); return; }
    const pieces = answerPieces(result.answer, result.steers); pieces[pieces.length - 1] += tail;
    Object.assign(result, joinPieces(pieces, result.steers, normalizeAnswer));
  };
  /** The reply ends with what it has, a plain notice, and phase 'failed', so Continue resumes it. */
  const finishFromObservations = reason => {
    dropDraft();
    if (!result.answer.trim()) {
      const observations = completed.length ? completed : (resume?.observations || []).flatMap(row => { try { return [{ answer: JSON.parse(row.result) }]; } catch { return []; } });
      const excerpts = observations.flatMap(({ answer }) => answer.error ? [] : answer.kind === 'action' ? [(answer.action.status === 'saved' ? 'Saved: ' : 'Declined: ') + answer.action.title] : answer.kind === 'plan' || answer.kind === 'card' ? [] : answer.text ? [String(answer.title || 'Source') + ': ' + answer.text.slice(0, 600)] : (answer.results || answer.notes || answer.tasks || answer.appointments || []).slice(0, 3).map(item => (item.title || item.text || 'Source') + (item.description || item.excerpt || item.title && item.text ? ': ' + (item.description || item.excerpt || item.text).slice(0, 300) : '')));
      result.answer = excerpts.length ? 'Collected observations:\n\n' + excerpts.slice(0, 8).map(item => '- ' + item).join('\n') : 'Research stopped before a final answer was available.';
    }
    clean('\n\n' + reason + ' Completed lookups remain in the activity.');
    result.activity = settle(result.activity, 'failed', reason); result.phase = 'failed'; onUpdate(structuredClone(result));
    finished = true; throw new Error(reason);
  };

  // Errors Pocket throws from its listener and hooks leave Agent.continue() as they are, instead of becoming a
  // synthetic failed assistant message.
  const locals = new WeakSet();
  const guard = fn => async (...args) => { try { return await fn(...args); } catch (error) { if (error && typeof error === 'object') locals.add(error); fatal ||= error; throw error; } };
  restartTimers();
  try {
    const stream = streamFn || await transport(value, key, { fetcher, signal: controller.signal, clock, maxOutputTokens: value.maxTokens,
      onRetry: () => { try { result.phase = 'provider busy · retrying'; publish(); } catch { /* A stop ends the request anyway. */ } },
      onSource: part => {
        const found = part?.sourceType === 'url' && source({ href: part.url, title: part.title });
        if (!found || found.href.startsWith('/')) return;
        let index = result.sources.findIndex(item => item.href === found.href);
        if (index < 0 && result.sources.length < 24) { index = result.sources.length; result.sources.push(found); }
        if (index >= 0) result.answer += ` [${index + 1}](${found.href.replace(/[()]/g, char => encodeURIComponent(char))})`;
      } });
    agent = new Agent({ initialState: { systemPrompt: base, messages: saved?.messages || toCore(body.messages, model), model, tools }, streamFn: stream, toolExecution: 'parallel', steeringMode: 'all',
      runtime: { ...openClawAgentCoreRuntime, isLocalError: error => locals.has(error) || error?.name === 'RunPaused' || openClawAgentCoreRuntime.isLocalError(error) },
      // Runs after every turn; only a turn whose tools ran leads to another request.
      prepareNextTurnWithContext: guard(async ({ message, toolResults, context }) => {
        if (message.stopReason !== 'toolUse' || !toolResults.length) return undefined;
        // The loop's steering checkpoint follows this hook: what is queued here goes before the next request.
        for (const steer of await steersNow()) agent.steer(steer);
        const prompt = await prepare(context.messages);
        return prompt === false ? { stop: true } : { context: { ...context, systemPrompt: prompt } };
      }) });
    agent.subscribe(guard(async event => {
      clock();
      if (event.type === 'message_start' && event.message.role === 'assistant') inputs.clear();
      else if (event.type === 'message_update') onPart(event.assistantMessageEvent || {});
      else if (event.type === 'message_end' && event.message.role === 'assistant') { check(); await onMessage(event.message); }
      else if (event.type === 'turn_end' && event.message.role === 'assistant') endStep(event.message);
      else if (event.type === 'tool_execution_end' && event.isError) {
        // OpenClaw refused the call before it ran (invalid arguments, unknown tool), or a stop interrupted it.
        record(rowId(event.toolCallId), { name: event.toolName, state: 'failed', summary: 'Invalid tool request', ended: Date.now(), result: JSON.stringify({ error: 'invalid_arguments', message: 'Correct the arguments or use an available tool.' }) });
      }
    }));
    check();
    // A paused message's tool batch is answered once, with its original call ids. Until every request it paused for
    // is settled it pauses again as it was; a request settled alone does not run ahead of the others.
    if (saved) {
      if ((saved.pending || []).some(item => !decisions.has(item.toolCallId))) { await durable.pause(checkpoint(saved.pending)); throw new RunPaused(); }
      const messages = agent.state.messages, at = messages.findLastIndex(m => m.role === 'assistant');
      const done = new Set(messages.slice(at + 1).filter(m => m.role === 'toolResult').map(m => m.toolCallId));
      for (const item of messages[at]?.content || []) if (item.type === 'toolCall' && !done.has(item.id)) {
        const output = await run(item.name, item.id, item.arguments);
        agent.state.messages = [...agent.state.messages, { role: 'toolResult', toolCallId: item.id, toolName: item.name, ...output, isError: Boolean(output.details?.error), timestamp: Date.now() }];
      }
      endStep(messages[at] || {});
    }
    for (;;) {
      // Before every request this loop makes (the first, after an approval, after a finished message): messages sent
      // into the reply go after the transcript, as the person's own.
      const steers = await steersNow();
      if (steers.length) agent.state.messages = [...agent.state.messages, ...steers];
      const prompt = await prepare(agent.state.messages);
      if (prompt === false) return finishFromObservations(ending);
      agent.state.systemPrompt = prompt;
      await agent.continue(); check();
      if (fatal) throw fatal;
      if (ending) return finishFromObservations(ending);
      const last = agent.state.messages.at(-1);
      if (last?.role === 'assistant' && last.stopReason === 'error') throw new Error(last.errorMessage || 'The connection ended before the reply was complete. Retry when you’re ready.');
      if (last?.role !== 'assistant' || last.stopReason === 'aborted') throw new Error('The connection ended before the reply was complete. Retry when you’re ready.');
      // A finished message with a message sent meanwhile is not the end: the reply carries on after it, while a
      // request is left. The check sees the message (and takes it) only once; the top of the loop delivers it.
      if (last.stopReason !== 'length') {
        if (!steering || counters.requests >= MAX_REQUESTS) break;
        const more = await steersNow();
        if (!more.length) break;
        agent.state.messages = [...agent.state.messages, ...more];
        continue;
      }
      // A message cut off at the reply limit, text or a tool call, has nothing to continue from: it is dropped and
      // written again, twice in a row at most; after that the reply ends with what it has.
      if (++counters.lengthRetries > LENGTH_RETRIES || lastRequest()) return finishFromObservations(LENGTH);
      moveNotes(); counters.finalReason ||= 'Finish within the reply limit per message';
      agent.state.messages = agent.state.messages.slice(0, -1);
    }
    // The one place a finished reply leaves the model: it is stored in its clean form.
    dropDraft(); clean();
    if (!result.answer.trim()) throw new Error('The provider returned no answer. Check its model and reply limit.');
    result.activity = settle(result.activity, 'failed'); result.phase = 'done'; publish(); return result;
  } catch (error) {
    if (error?.name === 'RunPaused' || finished) throw error;
    if (!signal?.aborted && (timedOut || deadlineReached)) return finishFromObservations(deadlineReached ? 'The five-minute research deadline was reached. Continue when you’re ready.' : 'The provider stopped responding for 90 seconds. Continue when you’re ready.');
    if (signal?.aborted || controller.signal.aborted) throw stopped();
    // A failed reply is published settled, so the stored turn has no row left running.
    dropDraft(); clean();
    result.activity = settle(result.activity, 'failed', error?.message); result.phase = 'failed'; onUpdate(structuredClone(result)); throw error;
  } finally { clearTimeout(idle); clearTimeout(absolute); signal?.removeEventListener('abort', abort); controller.abort(); }
}
