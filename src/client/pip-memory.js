import { activity } from './pip-activity.js';

export const MEMORY_LIMIT = 12000;
const parse = raw => { try { const value = JSON.parse(raw || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } };
const clip = (value, limit) => String(value || '').slice(0, limit);
export const requestText = turn => String(turn.text || '') + (turn.context?.length ? '\n\nAttached Pocket context:\n' + turn.context.map(item => '--- ' + item.kind + ': ' + item.title + ' ---\n' + item.text).join('\n\n') : '');

/** Stored observations are evidence only while their recipient and source grants still match. */
export function observationAllowed(policy, turn, row, data = parse(row.result)) {
  if (!policy.offered.includes(row.name) || policy.stateTools.includes(row.name)) return false;
  if ((data.request_identity || turn.usage?.request_identity) !== policy.identity) return false;
  if (row.name === 'read_chat_history' && Boolean(data.history_web_access ?? turn.usage?.web_access) !== policy.webSearch) return false;
  if (['search_pocket', 'read_task', 'read_chat_history'].includes(row.name)) {
    if (data.access_fingerprint) return data.access_fingerprint === policy.fingerprint;
    return String(turn.usage?.read_access || '').split('|').every(category => !category || policy.grants.includes(category));
  }
  return true;
}

function actionFact(turn, row, data) {
  if (row.state !== 'done') return null;
  let kind, title;
  if (data.kind === 'proposal') { kind = data.proposal?.kind; title = data.proposal?.title; }
  else if (data.kind === 'change') { kind = data.change?.change; title = row.applied_href && data.change?.title || data.before?.title; }
  else if (data.kind === 'coros') { kind = data.coros?.tool; title = data.title; }
  else if (data.kind === 'kept_record' && data.actor === 'user') { kind = data.record?.kind; title = data.record?.title; }
  if (!kind) return null;
  return { turn_id: turn.uid, event_id: row.id, kind, title: clip(title, 160), status: row.applied_href ? 'applied_by_user' : 'prepared_awaiting_user', ...(row.applied_href ? { href: row.applied_href, applied_at: row.applied || 0 } : {}) };
}

function excerpt(data, stringLimit = 1000, arrayLimit = 3) {
  let truncated = false;
  const visit = (value, depth = 0, key = '') => {
    if (typeof value === 'string') {
      const limit = ['url', 'href', 'source'].includes(key) ? 2048 : stringLimit;
      if (value.length > limit) truncated = true;
      return value.slice(0, limit);
    }
    if (!value || typeof value !== 'object') return value;
    if (depth > 5) { truncated = true; return '[omitted from memory]'; }
    if (Array.isArray(value)) { if (value.length > arrayLimit) truncated = true; return value.slice(0, arrayLimit).map(item => visit(item, depth + 1)); }
    return Object.fromEntries(Object.entries(value).filter(([name]) => !['request_identity', 'access_fingerprint'].includes(name)).map(([name, item]) => [name, visit(item, depth + 1, name)]));
  };
  const result = visit(data);
  return { ...result, ...(truncated ? { memory_excerpt: true } : {}) };
}

function eventFact(policy, turn, row) {
  const data = parse(row.result), action = actionFact(turn, row, data);
  const fact = { event_id: row.id, name: row.name, state: row.state, observed_at: row.ended || row.started || turn.created || 0 };
  if (action) fact.action = action;
  if (data.kind === 'existing_proposal') fact.existing_action = { event_id: data.event_id, status: data.status, ...(data.href ? { href: data.href } : {}) };
  if (row.name === 'update_plan' && row.state === 'done' && Array.isArray(data.plan)) fact.plan = data.plan.slice(0, 6).map(step => ({ text: clip(step.text, 160), status: step.status }));
  if (data.error) fact.error = clip(data.error, 100);
  if (observationAllowed(policy, turn, row, data) && row.result) {
    fact.input = parse(row.input);
    fact.result = excerpt(data);
    if (JSON.stringify(fact).length > 3500) fact.result = excerpt(data, 300, 2);
    if (JSON.stringify(fact).length > 3500) { delete fact.input; delete fact.result; fact.result_omitted = 'memory_size'; }
  } else if (!action && !fact.plan && !fact.existing_action && row.result) fact.result_omitted = 'source_access_or_recipient';
  return fact;
}

function priorTurns(chat, turn) {
  const index = chat.turns.findIndex(prior => prior.uid === turn.uid);
  return index < 0 ? chat.turns : chat.turns.slice(0, index);
}

/** Deterministic projection of the durable activity log, not a model-written recollection. */
export function conversationMemory(chat, turn, policy) {
  const prior = priorTurns(chat, turn), memory = { source: 'pocket:conversation', historical: true, actions: [], recent_activity: [], omitted_actions: 0, omitted_activity_turns: 0 };
  // Actions survive the ordinary 20-pair replay window, including saved actions from a restarted turn.
  const actions = [...prior, turn].flatMap(item => activity(item.activity).map(row => actionFact(item, row, parse(row.result))).filter(Boolean));
  for (const action of actions.reverse()) {
    if (memory.actions.length >= 32 || JSON.stringify(memory.actions).length + JSON.stringify(action).length > 4500) memory.omitted_actions++;
    else memory.actions.unshift(action);
  }
  for (const item of [...prior].reverse()) {
    const rows = activity(item.activity); if (!rows.length) continue;
    const entry = { turn_id: item.uid, request: clip(item.text, 240), reply_status: item.status, events: rows.slice(-8).map(row => eventFact(policy, item, row)), omitted_events: Math.max(0, rows.length - 8) };
    memory.recent_activity.unshift(entry);
    if (JSON.stringify(memory).length > MEMORY_LIMIT) {
      // Retain outcome facts even when the full observation would use too much context.
      for (const event of entry.events) { if (event.result) { delete event.result; delete event.input; event.result_omitted = 'memory_size'; } }
      if (JSON.stringify(memory).length > MEMORY_LIMIT) { memory.recent_activity.shift(); memory.omitted_activity_turns++; }
    }
  }
  return memory.actions.length || memory.recent_activity.length ? memory : null;
}

const ANSWER_EXCERPT = 1200, ANSWER_PAGE = 6200;
/** Page boundaries keep both halves of a surrogate pair together. */
const boundary = (text, start, end) => end > start && end < text.length && /[\ud800-\udbff]/.test(text[end - 1]) && /[\udc00-\udfff]/.test(text[end]) ? end === start + 1 ? end + 1 : end - 1 : end;
const literal = query => new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
function textPage(envelope, turnId, kind, text, requestedOffset) {
  let offset = Math.min(requestedOffset, text.length);
  if (offset > 0 && /[\udc00-\udfff]/.test(text[offset]) && /[\ud800-\udbff]/.test(text[offset - 1])) offset--;
  const page = { ...envelope, turn_id: turnId, [kind + '_offset']: offset, [kind + '_total_length']: text.length, [kind + '_text']: '', ['next_' + kind + '_offset']: text.length };
  let end = boundary(text, offset, Math.min(text.length, offset + 6000));
  for (;;) {
    page[kind + '_text'] = text.slice(offset, end);
    page['next_' + kind + '_offset'] = end < text.length ? end : null;
    if (JSON.stringify(page).length <= ANSWER_PAGE || end <= offset) return page;
    // Halving makes progress even when every character expands to six JSON characters.
    end = boundary(text, offset, offset + Math.max(1, Math.floor((end - offset) / 2)));
  }
}

/** Older events and long answers remain readable; this never fetches another chat or re-executes a tool. */
export function readChatHistory(chat, turn, policy, args = {}) {
  const envelope = { source: 'pocket:conversation', historical: true, history_web_access: policy.webSearch };
  if (args.event_id) {
    for (const item of priorTurns(chat, turn)) {
      if (args.turn_id && item.uid !== args.turn_id) continue;
      const row = activity(item.activity).find(event => event.id === args.event_id); if (!row) continue;
      const result = { ...envelope, turn_id: item.uid, event: eventFact(policy, item, row), next_offset: null };
      if (row.result && observationAllowed(policy, item, row)) {
        const offset = args.result_offset || 0, length = args.result_length || 2000;
        result.result_text = row.result.slice(offset, offset + length);
        result.result_offset = offset; result.result_total_length = row.result.length;
        while (JSON.stringify(result).length > 6200 && result.result_text.length) result.result_text = result.result_text.slice(0, Math.floor(result.result_text.length / 2));
        const next = offset + result.result_text.length;
        result.next_result_offset = next < row.result.length ? next : null;
      }
      return result;
    }
    return { error: 'history_event_not_found', message: 'That recorded event is not in an earlier reply of this conversation.' };
  }
  if (args.answer_offset != null || args.request_offset != null) {
    // Only a completed answer was the reply; stopped or failed partial text stays unreadable here too.
    const item = args.turn_id && priorTurns(chat, turn).find(prior => prior.uid === args.turn_id), kind = args.request_offset != null ? 'request' : 'answer';
    const text = item && (kind === 'request' ? requestText(item) : item.status === 'done' ? String(item.answer || '') : '');
    if (!text) return { error: 'history_' + kind + '_not_found', message: kind === 'answer' ? 'Use answer_offset with the turn_id of a completed earlier reply in this conversation.' : 'Use request_offset with the turn_id of an earlier request in this conversation.' };
    return textPage(envelope, item.uid, kind, text, args[kind + '_offset']);
  }
  const query = String(args.query || '').trim(), pattern = query && literal(query), offset = args.offset || 0, limit = args.limit || 3, entries = [];
  for (const item of [...priorTurns(chat, turn)].reverse()) {
    if (args.turn_id && item.uid !== args.turn_id) continue;
    const answer = item.status === 'done' ? String(item.answer || '') : '', request = requestText(item), cut = boundary(answer, 0, Math.min(answer.length, ANSWER_EXCERPT)), requestCut = boundary(request, 0, Math.min(request.length, 2000)), events = activity(item.activity).map(row => eventFact(policy, item, row));
    // Match the full request and answer rather than their excerpts; a match past the excerpt says where to page.
    const at = pattern ? answer.search(pattern) : -1;
    const requestAt = pattern ? request.search(pattern) : -1;
    if (pattern && at < 0 && requestAt < 0 && !pattern.test(JSON.stringify(events))) continue;
    entries.push({
      turn_id: item.uid, request: request.slice(0, requestCut), request_excerpt: request.length > requestCut, request_total_length: request.length, ...(request.length > requestCut ? { next_request_offset: requestCut } : {}), reply_status: item.status,
      ...(item.status === 'done' ? { answer: answer.slice(0, cut), answer_excerpt: answer.length > cut, ...(answer.length > cut ? { answer_total_length: answer.length, next_answer_offset: cut } : {}) } : {}),
      ...(at >= 0 ? { answer_match_offset: at } : {}), ...(requestAt >= 0 ? { request_match_offset: requestAt } : {}), events
    });
  }
  const found = entries.slice(offset, offset + limit), response = { ...envelope, matched: entries.length, offset, next_offset: null, turns: [] };
  for (const entry of found) {
    entry.omitted_events = 0;
    response.turns.push(entry);
    if (JSON.stringify(response).length > 6500) {
      for (const event of entry.events) { if (event.result) { delete event.result; delete event.input; event.result_omitted = 'memory_size'; } }
      while (entry.events.length && JSON.stringify(response).length > 6500) { entry.events.pop(); entry.omitted_events++; }
      while (JSON.stringify(response).length > 6500 && (entry.request.length > 100 || (entry.answer || '').length > 100)) {
        const kind = JSON.stringify(entry.request).length >= JSON.stringify(entry.answer || '').length ? 'request' : 'answer', value = entry[kind];
        entry[kind + '_total_length'] ||= value.length;
        const end = boundary(value, 0, Math.floor(value.length / 2));
        entry[kind] = value.slice(0, end); entry[kind + '_excerpt'] = true; entry['next_' + kind + '_offset'] = end;
      }
      if (JSON.stringify(response).length > 6500) { response.turns.pop(); break; }
    }
  }
  const next = offset + response.turns.length;
  response.next_offset = next < entries.length ? next : null;
  return response;
}
