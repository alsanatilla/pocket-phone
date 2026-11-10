// A reply as blocks, and the changes between two states of it.
//
// A reply is a list of blocks: prose, and cards where Pip drew them. The server cuts the answer into blocks once
// (segmentAnswer) and sends each follower only what changed since the last event: a block added, text appended to
// one, a card's lines grown or replaced. The browser applies those changes to the blocks it holds and draws them; it
// never parses the answer while it streams. Both ends use this module, so they cannot disagree about a change.

import { segmentAnswer } from './pip-reply.js';

/** The empty reply both ends start from. */
export const emptyReply = () => ({ blocks: [], reasoning: '', activity: [], sources: [], phase: '', model: '', usage: {} });

/**
 * The blocks of an answer: { kind: 'prose' | 'card', body, closed }. Prose is always closed; a card while it is
 * written is not. Prose ends without its trailing blank space, so a card starting after it does not change it.
 */
export const blocksOf = answer => segmentAnswer(String(answer || '')).map(segment => segment.kind === 'prose'
  ? { kind: 'prose', body: segment.text.replace(/\s+$/, ''), closed: true }
  : { kind: 'card', body: segment.source, closed: segment.closed });

/** A turn (as a run keeps it) as the reply state followers hold. */
export const replyOf = turn => ({ blocks: blocksOf(turn?.answer), reasoning: String(turn?.reasoning || ''), activity: turn?.activity || [], sources: turn?.sources || [],
  phase: String(turn?.phase || ''), model: String(turn?.model || ''), usage: turn?.usage || {} });

const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** The changes that turn `before` into `after`, smallest first choice: append over replace, nothing when equal. */
export function diffReply(before, after) {
  const ops = [];
  for (let index = 0; index < after.blocks.length; index++) {
    const old = before.blocks[index], block = after.blocks[index];
    if (!old) { ops.push({ o: 'add', kind: block.kind, body: block.body, closed: block.closed }); continue; }
    if (old.kind === block.kind && block.body.length >= old.body.length && block.body.startsWith(old.body)) {
      if (block.body.length > old.body.length) ops.push({ o: 'append', i: index, s: block.body.slice(old.body.length) });
      if (old.closed !== block.closed) ops.push({ o: 'close', i: index, closed: block.closed });
    } else ops.push({ o: 'set', i: index, kind: block.kind, body: block.body, closed: block.closed });
  }
  if (after.blocks.length < before.blocks.length) ops.push({ o: 'cut', n: after.blocks.length });
  if (after.reasoning !== before.reasoning) {
    ops.push(after.reasoning.length > before.reasoning.length && after.reasoning.startsWith(before.reasoning)
      ? { o: 'think', s: after.reasoning.slice(before.reasoning.length) } : { o: 'thought', v: after.reasoning });
  }
  const meta = {};
  for (const field of ['activity', 'sources', 'usage']) if (!same(before[field], after[field])) meta[field] = after[field];
  for (const field of ['phase', 'model']) if (before[field] !== after[field]) meta[field] = after[field];
  if (Object.keys(meta).length) ops.push({ o: 'meta', ...meta });
  return ops;
}

/** The one change that sets a follower to `state`, whatever it held. */
export const resetOp = state => ({ o: 'reset', state: structuredClone(state) });

/** Applies changes to a reply state in place. Returns false when a change does not fit what is held (a missed event). */
export function applyOps(state, ops) {
  for (const op of ops) {
    if (op.o === 'reset') { Object.assign(state, emptyReply(), structuredClone(op.state)); continue; }
    if (op.o === 'add') { state.blocks.push({ kind: op.kind, body: op.body, closed: op.closed }); continue; }
    if (op.o === 'cut') { state.blocks.length = Math.min(state.blocks.length, op.n); continue; }
    if (op.o === 'think') { state.reasoning += op.s; continue; }
    if (op.o === 'thought') { state.reasoning = op.v; continue; }
    if (op.o === 'meta') { const { o: _o, ...fields } = op; Object.assign(state, fields); continue; }
    const block = state.blocks[op.i];
    if (!block) return false;
    if (op.o === 'append') block.body += op.s;
    else if (op.o === 'close') block.closed = op.closed;
    else if (op.o === 'set') state.blocks[op.i] = { kind: op.kind, body: op.body, closed: op.closed };
    else return false;
  }
  return true;
}

/** The blocks as the chat draws them: the same shape and keys segmentAnswer gives a finished answer. */
export const segmentsOf = blocks => blocks.map((block, index) => block.kind === 'prose'
  ? { kind: 'prose', key: 'p' + index, text: block.body }
  : { kind: 'card', key: 'c' + index, source: block.body, closed: block.closed });

/** The answer text the blocks stand for (what the record holds), for whatever still reads text. */
export const answerOf = blocks => blocks.map(block => block.kind === 'prose' ? block.body
  : '```pocket\n' + block.body + (block.closed ? '\n```' : '')).join('\n\n');
