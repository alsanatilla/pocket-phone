// The changes between two states of a chat, and replaying them.
//
// A chat is stored as one whole object (src/shared/objects.js), but a tab that was away only needs what changed.
// This module turns two states into a small list of events and applies such a list to a chat; the server keeps the
// same events in the chat's numbered log, so both ends cannot disagree about what a number means.

import { canonical } from './objects.js';

/** The order mergeObject keeps turns in: by created, then uid. */
const defaultOrder = (a, b) => a.created - b.created || a.uid.localeCompare(b.uid);
const same = (a, b) => canonical(a) === canonical(b);

/** The fields that changed and the names that are gone, or null when nothing did. */
function changed(before, after, skip) {
  const fields = {}, unset = [];
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (skip.includes(name) || same(before[name], after[name])) continue;
    if (after[name] === undefined) unset.push(name); else fields[name] = after[name];
  }
  return Object.keys(fields).length || unset.length ? { fields, ...(unset.length ? { unset } : {}) } : null;
}

/**
 * The events that turn `before` into `after`. A null or deleted `before` is a new chat; a deleted `after` is one
 * tombstone event. Nested values are replaced whole, never diffed.
 */
export function chatEvents(before, after) {
  if (!after || same(before, after)) return [];
  if (after.deleted) return [{ kind: 'chat.deleted', uid: after.uid, updated: after.updated }];
  const start = before && !before.deleted ? before : null;
  const earlier = start?.turns || [], turns = after.turns || [];
  const earlierUids = new Set(earlier.map(turn => turn.uid)), afterUids = new Set(turns.map(turn => turn.uid));
  const events = [];
  const chat = changed(start || {}, after, ['turns']);
  if (chat) events.push({ kind: 'chat.set', ...chat });
  for (const turn of earlier) if (!afterUids.has(turn.uid)) events.push({ kind: 'turn.cut', uid: turn.uid });
  for (const turn of turns) if (!earlierUids.has(turn.uid)) events.push({ kind: 'turn.put', turn });
  const previous = new Map(earlier.map(turn => [turn.uid, turn]));
  for (const turn of turns) {
    const old = previous.get(turn.uid);
    if (!old) continue;
    const fields = changed(old, turn, ['uid']);
    if (fields) events.push({ kind: 'turn.set', uid: turn.uid, ...fields });
  }
  const order = turns.map(turn => turn.uid), defaults = [...turns].sort(defaultOrder).map(turn => turn.uid);
  // Events keep the order applying them would leave (cuts and puts keep the old order), so a stored chat that was
  // out of default order and is now in it needs an explicit order event too.
  const natural = [...earlier.filter(turn => afterUids.has(turn.uid)).map(turn => turn.uid), ...turns.filter(turn => !earlierUids.has(turn.uid)).map(turn => turn.uid)];
  if (!same(order, defaults) || !same(natural, order)) events.push({ kind: 'turns.order', uids: order });
  return events;
}

/** A new chat with `events` applied; the chat, its turns array and every turn are copied, never changed. */
export function applyChatEvents(chat, events) {
  let next = chat ? { ...chat, ...(Array.isArray(chat.turns) ? { turns: chat.turns.map(turn => ({ ...turn })) } : {}) } : null;
  for (const event of events || []) {
    if (!event || typeof event !== 'object') continue;
    if (event.kind === 'chat.set') {
      if (!next || next.deleted) next = { turns: [] };
      Object.assign(next, event.fields || {});
      for (const name of event.unset || []) delete next[name];
    } else if (event.kind === 'turn.put') {
      if (!event.turn) continue;
      if (!next) next = { turns: [] };
      if (next.deleted) next = { turns: [] };
      if (!Array.isArray(next.turns)) next.turns = [];
      const index = next.turns.findIndex(turn => turn.uid === event.turn.uid);
      if (index < 0) next.turns.push({ ...event.turn }); else next.turns[index] = { ...event.turn };
    } else if (event.kind === 'turn.set') {
      const turn = next?.turns?.find(turn => turn.uid === event.uid);
      if (!turn) continue;
      Object.assign(turn, event.fields || {});
      for (const name of event.unset || []) delete turn[name];
    } else if (event.kind === 'turn.cut') {
      const index = next?.turns ? next.turns.findIndex(turn => turn.uid === event.uid) : -1;
      if (index >= 0) next.turns.splice(index, 1);
    } else if (event.kind === 'turns.order') {
      if (!next?.turns) continue;
      const byUid = new Map(next.turns.map(turn => [turn.uid, turn])), ordered = [];
      for (const uid of event.uids || []) {
        const turn = byUid.get(uid);
        if (turn) { ordered.push(turn); byUid.delete(uid); }
      }
      next.turns = [...ordered, ...[...byUid.values()].sort(defaultOrder)];
    } else if (event.kind === 'chat.deleted') {
      const uid = event.uid ?? next?.uid;
      next = { ...(uid === undefined ? {} : { uid }), updated: event.updated, deleted: true };
    }
  }
  return next;
}
