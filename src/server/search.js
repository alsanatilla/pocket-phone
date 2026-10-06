import { database, execute, writeTransaction } from './database.js';
import { SEARCH_KINDS, documentRows, chatRows, searchWords, excerpt } from '../shared/search.js';

// Search rows and saved records change in the same transaction.
let fts;
export function ensureSearch() {
  if (!fts) fts = (async () => {
    const exists = (await execute("SELECT 1 FROM sqlite_master WHERE name = 'pocket_search'")).rows.length;
    await database().batch([
      `CREATE VIRTUAL TABLE IF NOT EXISTS pocket_search USING fts5(title, body, content='pocket_search_rows', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2', prefix='2 3')`,
      `CREATE TRIGGER IF NOT EXISTS pocket_search_insert AFTER INSERT ON pocket_search_rows BEGIN INSERT INTO pocket_search(rowid, title, body) VALUES (new.rowid, new.title, new.body); END`,
      `CREATE TRIGGER IF NOT EXISTS pocket_search_delete AFTER DELETE ON pocket_search_rows BEGIN INSERT INTO pocket_search(pocket_search, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body); END`,
      `CREATE TRIGGER IF NOT EXISTS pocket_search_update AFTER UPDATE ON pocket_search_rows BEGIN INSERT INTO pocket_search(pocket_search, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body); INSERT INTO pocket_search(rowid, title, body) VALUES (new.rowid, new.title, new.body); END`,
      ...(!exists ? ["INSERT INTO pocket_search(pocket_search) VALUES ('rebuild')"] : []),
    ], 'write');
    return true;
  })().catch(error => {
    console.error('Pocket search index unavailable:', error.code || error.name);
    if (!/no such module/i.test(error.message || '')) fts = null;
    return false;
  });
  return fts;
}

async function reindex(tx, userId, kinds, rows, uid = null) {
  const marks = kinds.map(() => '?').join(',');
  const existing = await tx.execute({ sql: `SELECT kind, uid, updated, title, body FROM pocket_search_rows WHERE user_id = ? AND kind IN (${marks})${uid ? ' AND uid = ?' : ''}`, args: [userId, ...kinds, ...(uid ? [uid] : [])] });
  const known = new Map(existing.rows.map(row => [row.kind + ':' + row.uid, row])), wanted = new Set(rows.map(row => row.kind + ':' + row.uid));
  const statements = [];
  for (const key of known.keys()) if (!wanted.has(key)) {
    const at = key.indexOf(':'); statements.push({ sql: 'DELETE FROM pocket_search_rows WHERE user_id = ? AND kind = ? AND uid = ?', args: [userId, key.slice(0, at), key.slice(at + 1)] });
  }
  for (const row of rows) {
    const old = known.get(row.kind + ':' + row.uid);
    if (old && Number(old.updated) === row.updated && old.title === row.title && old.body === row.body) continue;
    statements.push({ sql: 'INSERT INTO pocket_search_rows (user_id, kind, uid, title, body, updated) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, kind, uid) DO UPDATE SET title = excluded.title, body = excluded.body, updated = excluded.updated', args: [userId, row.kind, row.uid, row.title, row.body, row.updated] });
  }
  for (let i = 0; i < statements.length; i += 200) await tx.batch(statements.slice(i, i + 200));
}
export async function reindexDocuments(tx, userId, documents) {
  for (const [name, value] of Object.entries(documents)) if (SEARCH_KINDS[name]) await reindex(tx, userId, SEARCH_KINDS[name], documentRows(name, value));
}
export const reindexChat = (tx, userId, chat) => reindex(tx, userId, ['chat'], chatRows(chat), String(chat.uid));

async function backfill(userId) {
  const done = await execute({ sql: "SELECT 1 FROM pocket_search_rows WHERE user_id = ? AND kind = '_index' AND uid = 'v1'", args: [userId] });
  if (done.rows.length) return;
  await writeTransaction(async tx => {
    const docs = await tx.execute({ sql: 'SELECT name, payload FROM pocket_documents WHERE user_id = ?', args: [userId] });
    await reindexDocuments(tx, userId, Object.fromEntries(docs.rows.map(row => [String(row.name), JSON.parse(String(row.payload))])));
    const chats = await tx.execute({ sql: "SELECT payload FROM pocket_objects WHERE user_id = ? AND collection = 'chats'", args: [userId] });
    await reindex(tx, userId, ['chat'], chats.rows.flatMap(row => chatRows(JSON.parse(String(row.payload)))));
    await tx.execute({ sql: "INSERT OR IGNORE INTO pocket_search_rows (user_id, kind, uid, title, body, updated) VALUES (?, '_index', 'v1', '', '', 1)", args: [userId] });
  });
}
export async function search(userId, query, limit = 30) {
  const words = searchWords(query); if (!words.length) return [];
  const fullText = await ensureSearch();
  await backfill(userId);
  if (fullText) {
    const match = words.map(word => '"' + word + '"*').join(' ');
    const result = await execute({ sql: `SELECT r.kind, r.uid, r.title, r.body, r.updated, snippet(pocket_search, 1, char(1), char(2), '…', 16) AS snippet FROM pocket_search JOIN pocket_search_rows r ON r.rowid = pocket_search.rowid WHERE pocket_search MATCH ? AND r.user_id = ? ORDER BY bm25(pocket_search, 5.0, 1.0), r.updated DESC LIMIT ?`, args: [match, userId, limit] });
    return result.rows.map(row => ({ kind: String(row.kind), uid: String(row.uid), title: String(row.title), updated: Number(row.updated), snippet: String(row.body) ? String(row.snippet || '') : '' }));
  }
  const like = await execute({ sql: `SELECT kind, uid, title, body, updated FROM pocket_search_rows WHERE user_id = ? AND kind <> '_index' AND ${words.map(() => "(lower(title) || ' ' || lower(body)) LIKE ?").join(' AND ')} ORDER BY updated DESC LIMIT ?`, args: [userId, ...words.map(word => '%' + word + '%'), limit] });
  return like.rows.map(row => ({ kind: String(row.kind), uid: String(row.uid), title: String(row.title), updated: Number(row.updated), snippet: excerpt(String(row.body), words) }));
}
