import { database } from './database.js';
import { appendChatEvents, chatLogHead, trimChatEvents } from './chat-log.js';
import { ensureSearch, reindexChat } from './search.js';
import { publish } from './pocket-events.js';
import { validObject, mergeObject, sanitizeObject } from '../shared/objects.js';
import { chatEvents } from '../shared/chat-log.js';

export function collectionName(value) {
  if (!['chats', 'zines'].includes(value)) throw Object.assign(new Error('Unknown Pocket collection.'), { status: 400 });
  return value;
}
export async function readObjects(userId, collection, after = 0) {
  if (!Number.isSafeInteger(after) || after < 0) throw Object.assign(new Error('Invalid sync cursor.'), { status: 400 });
  const result = await database().execute({ sql: 'SELECT o.payload, MAX(c.revision) AS revision FROM pocket_object_changes c JOIN pocket_objects o ON o.user_id = c.user_id AND o.collection = c.collection AND o.uid = c.uid WHERE c.user_id = ? AND c.collection = ? AND c.revision > ? GROUP BY c.uid ORDER BY revision LIMIT 25', args: [userId, collection, after] });
  const selected = []; let size = 0;
  for (const row of result.rows) { const bytes = Buffer.byteLength(String(row.payload)); if (selected.length && size + bytes > 3 * 1024 * 1024) break; selected.push(row); size += bytes; }
  return { items: selected.map(row => JSON.parse(String(row.payload))), cursor: selected.length ? Number(selected.at(-1).revision) : after, more: selected.length < result.rows.length || result.rows.length === 25 };
}
export async function writeObject(userId, collection, incoming, { appendTurns = false } = {}) {
  if (appendTurns && collection !== 'chats') throw new Error('Only chats can append turns.');
  if (!validObject(collection, incoming)) throw Object.assign(new Error('Invalid ' + collection + ' record.'), { status: 400 });
  incoming = sanitizeObject(collection, incoming);
  const uid = collection === 'chats' ? incoming.uid : incoming.id;
  if (collection === 'chats') await ensureSearch();
  for (let attempt = 0; attempt < 4; attempt++) {
  let tx, head, logged = [];
  try {
    tx = await database().transaction('write');
    const rows = await tx.execute({ sql: 'SELECT payload, revision FROM pocket_objects WHERE user_id = ? AND collection = ? AND uid = ?', args: [userId, collection, uid] });
    const previous = rows.rows[0], stored = previous ? JSON.parse(String(previous.payload)) : null;
    // A background reply adds turns without replacing a concurrently edited title, model, draft or pin. It may pin a
    // chat whose pin was never set (a routine's own chat); once the user pins or unpins it, that choice stays.
    const change = appendTurns && stored && !stored.deleted ? { ...stored, turns: incoming.turns, ...(stored.pinned === undefined && incoming.pinned !== undefined ? { pinned: incoming.pinned } : {}),
      draftUpdated: stored.draftUpdated ?? stored.updated, updated: Math.max(stored.updated, incoming.updated) } : incoming;
    const value = mergeObject(collection, stored, change);
    const payload = JSON.stringify(value);
    if (Buffer.byteLength(payload) > 3 * 1024 * 1024) throw Object.assign(new Error('This conversation is too large for one sync.'), { status: 413 });
    let revision = Number(previous?.revision || 0);
    if (payload !== previous?.payload) {
      if (collection === 'zines' && !value.deleted) for (const photo of value.photos) {
        const files = await tx.execute({ sql: 'SELECT name FROM pocket_media WHERE user_id = ? AND entity_uid = ? AND name IN (?, ?)', args: [userId, uid, 'zine-source-' + photo.id + '.jpg', 'zine-thumb-' + photo.id + '.jpg'] });
        if (files.rows.length !== 2) throw Object.assign(new Error('Zine photos are still waiting to upload.'), { status: 409 });
      }
      const change = await tx.execute({ sql: 'INSERT INTO pocket_object_changes (user_id, collection, uid) VALUES (?, ?, ?)', args: [userId, collection, uid] });
      revision = Number(change.lastInsertRowid);
      await tx.execute({ sql: 'INSERT INTO pocket_objects (user_id, collection, uid, payload, revision) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, collection, uid) DO UPDATE SET payload = excluded.payload, revision = excluded.revision', args: [userId, collection, uid, payload, revision] });
      if (collection === 'chats') {
        // A chat written before it had a log starts its log with the whole chat, so replay from 0 still reaches it.
        head = await chatLogHead(tx, userId, uid);
        const events = head === 0 ? chatEvents(null, value) : chatEvents(stored, value);
        logged = await appendChatEvents(tx, userId, uid, events);
      }
      if (collection === 'zines') {
        const keep = new Set((value.deleted ? [] : value.photos).flatMap(photo => ['zine-source-' + photo.id + '.jpg', 'zine-thumb-' + photo.id + '.jpg']));
        const files = await tx.execute({ sql: 'SELECT name FROM pocket_media WHERE user_id = ? AND entity_uid = ?', args: [userId, uid] });
        for (const file of files.rows) if (!keep.has(String(file.name))) await tx.execute({ sql: 'DELETE FROM pocket_media WHERE user_id = ? AND name = ?', args: [userId, String(file.name)] });
      }
    }
    if (collection === 'chats' && head === undefined) head = await chatLogHead(tx, userId, uid);
    if (collection === 'chats' && revision !== Number(previous?.revision || 0)) await reindexChat(tx, userId, value);
    await tx.commit();
    const tail = logged.at(-1), seq = collection === 'chats' ? tail?.seq ?? head : undefined;
    // The account's other tabs and devices pull the change now instead of at their next sync. A chat's event also
    // carries its new number, with the changes themselves while they fit; otherwise the tab asks for them.
    if (revision !== Number(previous?.revision || 0)) publish(userId, { type: 'objects', collection, uid, revision,
      ...(tail ? { seq: tail.seq } : {}), ...(tail && JSON.stringify(logged).length <= 32_000 ? { events: logged } : {}) });
    // Whenever the log passes another 200 events, all but its newest 2,000 go; a reader behind that pulls the chat.
    if (tail && Math.floor(tail.seq / 200) > Math.floor((logged[0].seq - 1) / 200)) await trimChatEvents(userId, uid, 2000).catch(() => {});
    return { value, revision, ...(collection === 'chats' ? { seq } : {}) };
  } catch (error) {
    await tx?.rollback().catch(() => {});
    if (attempt === 3 || !/SQLITE_BUSY|TRANSACTION_CLOSED|TRANSACTION_ACTIVE/.test(error.code || '')) throw error;
    await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
  }
  finally { tx?.close(); }
  }
}
export const validMedia = value => typeof value === 'string' && /^zine-(?:source|thumb)-[a-zA-Z0-9_-]{1,100}\.jpg$/.test(value);
