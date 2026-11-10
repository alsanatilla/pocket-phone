// Keeping a tab's copy of a chat at its place in the chat's numbered log.
//
// A tab may apply the changes a chat's log describes only while its copy is clean and it knows the number that copy
// is at. The number is written when a whole chat comes from the server and moves as events are applied; a local edit,
// an unknown number or a gap in the log sends the tab back to the pull (src/client/object-sync.js).

import { storage } from './workspace-storage.js';
import { marker } from './persistence-events.js';
import { applyChatEvents } from '../shared/chat-log.js';

const CHAT = 'pocket:pip-chat:', SEQ = 'pocket:chat-seq:', ACK = 'pocket:chat-ack:';
const number = value => Number.isSafeInteger(value) && value >= 0;

/** Whether the tab's stored copy has no local edit waiting and came back from the server. */
const clean = uid => !storage.getItem(marker('chats', uid)) && storage.getItem(ACK + uid) !== null;

/** The number the tab's copy of the chat is at, or null when that is unknown. */
export function chatAt(uid) {
  if (!clean(uid)) return null;
  const raw = storage.getItem(SEQ + uid);
  if (raw === null) return null;
  const seq = Number(raw);
  return number(seq) ? seq : null;
}

/** Records the number of a whole chat taken from the server, or forgets it when the copies do not match. */
export function noteChat(uid, seq, matches) {
  if (matches && number(seq)) storage.setItem(SEQ + uid, String(seq)); else storage.removeItem(SEQ + uid);
}

/** Applies the log's events to the tab's copy when they continue exactly from its number; false otherwise. */
export function applyChat(uid, events, head) {
  const at = chatAt(uid);
  if (at === null || !number(head) || !Array.isArray(events) || !events.every(event => event && number(event.seq))) return false;
  let local;
  try { local = JSON.parse(storage.getItem(CHAT + uid)); } catch { return false; }
  if (!local || typeof local !== 'object' || Array.isArray(local)) return false;
  const later = events.filter(event => event.seq > at);
  if (!later.length) return at >= head;
  if (later[0].seq !== at + 1 || later.at(-1).seq !== head) return false;
  for (let i = 1; i < later.length; i++) if (later[i].seq !== later[i - 1].seq + 1) return false;
  const next = applyChatEvents(local, later.map(({ seq, at: _, ...event }) => event));
  storage.setItem(CHAT + uid, JSON.stringify(next));
  storage.setItem(SEQ + uid, String(head));
  if (typeof dispatchEvent === 'function') dispatchEvent(new Event('pocket-objects-synced'));
  return true;
}

/** The last follow for each chat, so two changes of one chat are applied in the order they arrived. */
const chains = new Map();

/** Follows an objects change of a chat to its number, asking for what is missing; true when the copy is there. */
export function followChat(change, ask) {
  if (!change || change.collection !== 'chats' || typeof change.uid !== 'string' || typeof change.seq !== 'number' || chatAt(change.uid) === null) return Promise.resolve(false);
  const uid = change.uid, previous = chains.get(uid) ?? Promise.resolve();
  const next = previous.then(() => follow(change, ask), () => follow(change, ask));
  chains.set(uid, next);
  const done = () => { if (chains.get(uid) === next) chains.delete(uid); };
  next.then(done, done);
  return next;
}

async function follow(change, ask) {
  try {
    if (Array.isArray(change.events) && applyChat(change.uid, change.events, change.seq)) return true;
    const { events, head, gap } = await ask(change.uid, chatAt(change.uid));
    if (gap) return false;
    return applyChat(change.uid, events, head);
  } catch { return false; }
}
