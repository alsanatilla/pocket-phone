// A chat's numbered log, stored beside the chat itself.
//
// A tab that was away asks for the events after its last number instead of pulling the whole chat. The events are
// the same ones src/shared/chat-log.js derives, so the stored chat stays the snapshot. Appending takes the caller's
// write transaction: the chat and its events are written together or not at all.

import { execute } from './database.js';

const LIMIT = 500;
const bad = message => Object.assign(new Error(message), { status: 400 });
const counter = value => Number.isSafeInteger(value) && value >= 0;

/** Writes `events` after the chat's last number, in the caller's transaction, and returns them with their `seq`. */
export async function appendChatEvents(tx, userId, chatUid, events, at = Date.now()) {
  if (!events.length) return [];
  const found = await tx.execute({ sql: 'SELECT MAX(seq) AS seq FROM pocket_chat_events WHERE user_id = ? AND chat_uid = ?', args: [userId, chatUid] });
  let seq = Number(found.rows[0]?.seq || 0);
  const written = [];
  for (const event of events) {
    seq += 1;
    await tx.execute({ sql: 'INSERT INTO pocket_chat_events (user_id, chat_uid, seq, event, at) VALUES (?, ?, ?, ?, ?)', args: [userId, chatUid, seq, JSON.stringify(event), at] });
    written.push({ ...event, seq });
  }
  return written;
}

/** The events after `after`, the log's highest number, and whether the numbers just after `after` were trimmed. */
export async function readChatEvents(userId, chatUid, after = 0, limit = LIMIT) {
  if (!counter(after)) throw bad('Invalid chat log position.');
  if (!counter(limit)) throw bad('Invalid chat log limit.');
  const bounds = await execute({ sql: 'SELECT MAX(seq) AS head, MIN(seq) AS lowest FROM pocket_chat_events WHERE user_id = ? AND chat_uid = ?', args: [userId, chatUid] });
  const head = Number(bounds.rows[0]?.head || 0), lowest = Number(bounds.rows[0]?.lowest || 0);
  const rows = await execute({ sql: 'SELECT seq, at, event FROM pocket_chat_events WHERE user_id = ? AND chat_uid = ? AND seq > ? ORDER BY seq LIMIT ?', args: [userId, chatUid, after, Math.min(limit, LIMIT)] });
  return { events: rows.rows.map(row => ({ seq: Number(row.seq), at: Number(row.at), ...JSON.parse(String(row.event)) })), head, gap: head > after && lowest > after + 1 };
}

/** Deletes all but the newest `keep` events of a chat, returning how many rows went. */
export async function trimChatEvents(userId, chatUid, keep = 2000) {
  if (!counter(keep)) throw bad('Invalid chat log trim.');
  const result = await execute({ sql: 'DELETE FROM pocket_chat_events WHERE user_id = ? AND chat_uid = ? AND seq <= (SELECT MAX(seq) - ? FROM pocket_chat_events WHERE user_id = ? AND chat_uid = ?)', args: [userId, chatUid, keep, userId, chatUid] });
  return Number(result.rowsAffected || 0);
}
