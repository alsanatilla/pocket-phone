import { database } from './database.js';
import { recordNoteVersions } from './history.js';
import { ensureSearch, reindexDocuments } from './search.js';
import { FILES, EMPTY, merge, validDocument } from '../shared/workspace.js';
export async function readDocuments(userId) {
  const result = await database().execute({ sql: 'SELECT name, payload, revision FROM pocket_documents WHERE user_id = ?', args: [userId] });
  return Object.fromEntries(result.rows.filter(row => FILES.includes(row.name)).map(row => [row.name, { value: JSON.parse(String(row.payload)), revision: Number(row.revision) }]));
}
export async function syncDocuments(userId, documents, onlyRequested = false) {
  if (!documents || typeof documents !== 'object' || Array.isArray(documents) || Object.keys(documents).some(name => !FILES.includes(name))) throw Object.assign(new Error('Unknown workspace collection.'), { status: 400 });
  for (const [name, value] of Object.entries(documents)) if (!validDocument(name, value)) throw Object.assign(new Error('Invalid workspace collection: ' + name), { status: 400 });
  await ensureSearch();
  for (let attempt = 0; attempt < 4; attempt++) {
    let tx;
    try {
      tx = await database().transaction('write');
      const result = await tx.execute({ sql: 'SELECT name, payload, revision FROM pocket_documents WHERE user_id = ?', args: [userId] });
      const current = new Map(result.rows.map(row => [String(row.name), row]));
      const output = {}, indexed = {}, now = Date.now();
      for (const name of onlyRequested ? Object.keys(documents) : FILES) {
        const previous = current.get(name);
        const stored = previous ? JSON.parse(String(previous.payload)) : EMPTY[name]();
        // Merge inside one write transaction: another device cannot overwrite this read.
        // Existing server records win exact timestamp ties; deletions remain tombstones.
        const value = documents[name] ? merge[name](stored, documents[name], now) : stored;
        const payload = JSON.stringify(value), changed = payload !== previous?.payload;
        const revision = Number(previous?.revision || 0) + (changed ? 1 : 0);
        if (changed) await tx.execute({
          sql: 'INSERT INTO pocket_documents (user_id, name, payload, revision, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, name) DO UPDATE SET payload = excluded.payload, revision = excluded.revision, updated_at = excluded.updated_at',
          args: [userId, name, payload, revision, now],
        });
        if (changed && name === 'notes.json') await recordNoteVersions(tx, userId, stored, value);
        if (changed && name === 'journal.json') for (const page of value.pages) {
          if (page?.deleted && typeof page.uid === 'string') await tx.execute({ sql: 'DELETE FROM pocket_files WHERE user_id = ? AND name = ?', args: [userId, 'page-' + page.uid + '.jpg'] });
        }
        output[name] = { value, revision };
        if (changed) indexed[name] = value;
      }
      await reindexDocuments(tx, userId, indexed);
      await tx.commit();
      return output;
    } catch (error) {
      await tx?.rollback().catch(() => {});
      if (attempt === 3 || !/SQLITE_BUSY|TRANSACTION_CLOSED|TRANSACTION_ACTIVE/.test(error.code || '')) throw error;
      await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
    } finally { tx?.close(); }
  }
}
