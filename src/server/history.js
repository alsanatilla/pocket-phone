import { execute, writeTransaction } from './database.js';
import { ensureSearch, reindexDocuments } from './search.js';
import { EMPTY, merge } from '../shared/workspace.js';

// Keep the original, editing checkpoints, and the current text. Restores always freeze the text they replace.
const SESSION = 10 * 60_000, KEEP = 60;

async function keep(tx, userId, uid, text, at, deleted = false, force = false) {
  const recent = (await tx.execute({ sql: 'SELECT id, text, created, deleted FROM pocket_note_versions WHERE user_id = ? AND note_uid = ? ORDER BY id DESC LIMIT 2', args: [userId, uid] })).rows;
  const latest = recent[0];
  if (latest && String(latest.text) === text) {
    if (deleted) await tx.execute({ sql: 'UPDATE pocket_note_versions SET deleted = 1, updated = ? WHERE id = ?', args: [at, latest.id] });
    return;
  }
  // A note's first text stays intact, even when its first edit follows seconds later.
  if (recent.length > 1 && !force && !deleted && !Number(latest.deleted) && at >= Number(latest.created) && at - Number(latest.created) < SESSION) {
    await tx.execute({ sql: 'UPDATE pocket_note_versions SET text = ?, updated = ? WHERE id = ?', args: [text, at, latest.id] }); return;
  }
  await tx.execute({ sql: 'INSERT INTO pocket_note_versions (user_id, note_uid, text, created, updated, deleted) VALUES (?, ?, ?, ?, ?, ?)', args: [userId, uid, text, at, at, deleted ? 1 : 0] });
  await tx.execute({ sql: 'DELETE FROM pocket_note_versions WHERE user_id = ? AND note_uid = ? AND id NOT IN (SELECT id FROM pocket_note_versions WHERE user_id = ? AND note_uid = ? ORDER BY id DESC LIMIT ?)', args: [userId, uid, userId, uid, KEEP] });
}
/** Runs inside the sync transaction, so history and the saved notes always agree. */
export async function recordNoteVersions(tx, userId, before, after) {
  const old = new Map((before?.notes || []).map(note => [note.uid, note]));
  for (const note of after?.notes || []) {
    const previous = old.get(note.uid);
    if (previous && previous.updated === note.updated && previous.deleted === note.deleted) continue;
    const priorText = previous && !previous.deleted ? String(previous.text || '') : '';
    if (note.deleted) { if (priorText) await keep(tx, userId, note.uid, priorText, Date.now(), true, true); continue; }
    const text = String(note.text || '');
    if (!text || text === priorText) continue;
    if (priorText) {
      const any = (await tx.execute({ sql: 'SELECT 1 FROM pocket_note_versions WHERE user_id = ? AND note_uid = ? LIMIT 1', args: [userId, note.uid] })).rows.length;
      if (!any) await keep(tx, userId, note.uid, priorText, Number(previous.updated) || 0);
    }
    await keep(tx, userId, note.uid, text, Number(note.updated) || Date.now());
  }
}
/** Restore and checkpoint atomically; a newer edit from another device requires reviewing history again. */
export async function restoreNoteVersion(userId, uid, versionId, current) {
  if (!Number.isSafeInteger(versionId) || versionId < 1 || current?.uid !== uid || current.deleted || typeof current.text !== 'string' || !current.text.trim() || current.text.length > 8000 || !Number.isSafeInteger(current.updated) || current.updated < 0 || current.updated > Date.now() + SESSION) {
    throw Object.assign(new Error('Invalid note version.'), { status: 400 });
  }
  await ensureSearch();
  return writeTransaction(async tx => {
    const row = (await tx.execute({ sql: "SELECT payload, revision FROM pocket_documents WHERE user_id = ? AND name = 'notes.json'", args: [userId] })).rows[0];
    const before = row ? JSON.parse(String(row.payload)) : EMPTY['notes.json']();
    const previous = before.notes.find(note => note.uid === uid);
    if (!previous || previous.deleted) throw Object.assign(new Error('This note was deleted. Restore it from Recently deleted.'), { status: 409 });
    const document = merge['notes.json'](before, { v: 1, notes: [{ ...current }] }, Date.now());
    const note = document.notes.find(note => note.uid === uid);
    if (note.text !== current.text || note.updated !== current.updated) throw Object.assign(new Error('This note changed on another device. Reload its history.'), { status: 409 });
    const version = (await tx.execute({ sql: 'SELECT text FROM pocket_note_versions WHERE user_id = ? AND note_uid = ? AND id = ?', args: [userId, uid, versionId] })).rows[0];
    if (!version || !String(version.text).trim() || String(version.text).length > 8000) throw Object.assign(new Error('This version is unavailable.'), { status: 404 });
    // Capture local edits that have not synced yet without changing an existing checkpoint.
    await keep(tx, userId, uid, note.text, current.updated, false, true);
    note.text = String(version.text); note.updated = Math.max(Date.now(), current.updated + 1);
    await keep(tx, userId, uid, note.text, note.updated, false, true);
    const revision = Number(row.revision) + 1;
    await tx.execute({ sql: "UPDATE pocket_documents SET payload = ?, revision = ?, updated_at = ? WHERE user_id = ? AND name = 'notes.json'", args: [JSON.stringify(document), revision, Date.now(), userId] });
    await reindexDocuments(tx, userId, { 'notes.json': document });
    return { value: document, revision };
  });
}
export async function noteVersions(userId, uid) {
  const result = await execute({ sql: 'SELECT id, text, created, updated, deleted FROM pocket_note_versions WHERE user_id = ? AND note_uid = ? ORDER BY id DESC', args: [userId, uid] });
  return result.rows.map(row => ({ id: Number(row.id), created: Number(row.created), updated: Number(row.updated), deleted: Boolean(Number(row.deleted)), length: String(row.text).length, text: String(row.text) }));
}
/** Notes deleted in the last 30 days, with the text they had. */
export async function deletedNotes(userId) {
  const since = Date.now() - 30 * 86_400_000;
  const result = await execute({ sql: `SELECT v.note_uid, v.text, v.updated FROM pocket_note_versions v WHERE v.user_id = ? AND v.deleted = 1 AND v.updated > ?
    AND v.id = (SELECT MAX(id) FROM pocket_note_versions WHERE user_id = v.user_id AND note_uid = v.note_uid) ORDER BY v.updated DESC LIMIT 50`, args: [userId, since] });
  return result.rows.map(row => ({ uid: String(row.note_uid), text: String(row.text), updated: Number(row.updated) }));
}
