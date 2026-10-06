import { database } from './database.js';
import { ensureSearch, reindexChat } from './search.js';
import { validObject, mergeObject, sanitizeObject } from '../shared/objects.js';

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
export async function writeObject(userId, collection, incoming) {
  if (!validObject(collection, incoming)) throw Object.assign(new Error('Invalid ' + collection + ' record.'), { status: 400 });
  incoming = sanitizeObject(collection, incoming);
  const uid = collection === 'chats' ? incoming.uid : incoming.id;
  if (collection === 'chats') await ensureSearch();
  for (let attempt = 0; attempt < 4; attempt++) {
  let tx;
  try {
    tx = await database().transaction('write');
    const rows = await tx.execute({ sql: 'SELECT payload, revision FROM pocket_objects WHERE user_id = ? AND collection = ? AND uid = ?', args: [userId, collection, uid] });
    const previous = rows.rows[0], value = mergeObject(collection, previous ? JSON.parse(String(previous.payload)) : null, incoming);
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
      if (collection === 'zines') {
        const keep = new Set((value.deleted ? [] : value.photos).flatMap(photo => ['zine-source-' + photo.id + '.jpg', 'zine-thumb-' + photo.id + '.jpg']));
        const files = await tx.execute({ sql: 'SELECT name FROM pocket_media WHERE user_id = ? AND entity_uid = ?', args: [userId, uid] });
        for (const file of files.rows) if (!keep.has(String(file.name))) await tx.execute({ sql: 'DELETE FROM pocket_media WHERE user_id = ? AND name = ?', args: [userId, String(file.name)] });
      }
    }
    if (collection === 'chats' && revision !== Number(previous?.revision || 0)) await reindexChat(tx, userId, value);
    await tx.commit();
    return { value, revision };
  } catch (error) {
    await tx?.rollback().catch(() => {});
    if (attempt === 3 || !/SQLITE_BUSY|TRANSACTION_CLOSED|TRANSACTION_ACTIVE/.test(error.code || '')) throw error;
    await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
  }
  finally { tx?.close(); }
  }
}
export const validMedia = value => typeof value === 'string' && /^zine-(?:source|thumb)-[a-zA-Z0-9_-]{1,100}\.jpg$/.test(value);
