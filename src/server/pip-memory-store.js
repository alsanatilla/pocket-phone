import { database, execute } from './database.js';
import { publish } from './pocket-events.js';

// Pip's memory of the person: a short list of lasting facts it adds to while it talks, reads in every reply and job,
// and the person can change or remove. The whole list goes into the request, so there is no search index, no
// embedding and no second model call; each entry keeps the chat it was learned in and the id the model uses to
// correct or forget it. Kept apart from the chats, in the account's own table.
export const MEMORY_MAX = 100, MEMORY_TEXT = 300;
/** What every reply and job with a memory is told about it, whether or not anything is remembered yet. */
export const MEMORY_INSTRUCTIONS = 'When you learn something lasting about the person that will matter in later conversations, call remember with one short sentence. Do it without asking and without mentioning it in your answer; Pocket shows them what you remembered. Remember sparingly: at most one or two things from a message, and nothing you already remember.';

const tidy = text => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MEMORY_TEXT);
const refusal = (message, status, code) => Object.assign(new Error(message), { status, code });
/** A new memory's id: 'm' and six letters or digits, made at random like a card's, and never one this list has. */
function newMemoryId(used) {
  let id;
  do id = 'm' + Array.from(crypto.getRandomValues(new Uint8Array(6)), byte => (byte % 36).toString(36)).join('');
  while (used.has(id));
  return id;
}

/** The account's memory, oldest first. */
export async function listMemory(userId) {
  const rows = (await execute({ sql: 'SELECT id, text, chat_uid, created, updated FROM pocket_pip_memory WHERE user_id = ? ORDER BY created, rowid', args: [userId] })).rows;
  return rows.map(row => ({ id: String(row.id), text: String(row.text), chat: String(row.chat_uid), created: Number(row.created), updated: Number(row.updated) }));
}

/**
 * Keeps one fact, or corrects the entry `replaces`: the same text in any case keeps the entry it matches, and the
 * count and the write share one transaction, so a request sent twice adds one entry. `added` and `replaced` say
 * whether anything was written.
 */
export function remember(userId, text, options = {}) {
  const kept = tidy(text);
  if (!kept) return Promise.reject(refusal('Write what to remember.', 400, 'memory_empty'));
  // A model often remembers two things in one round: its writes take turns, and one the database was too busy for
  // is tried again, as a chat's write is (objects.js).
  const next = (writing.get(userId) || Promise.resolve()).then(async () => {
    for (let attempt = 0; ; attempt++) {
      try { return await write(userId, kept, options); }
      catch (error) {
        if (attempt === 3 || !/SQLITE_BUSY|TRANSACTION_CLOSED|TRANSACTION_ACTIVE/.test(error.code || '')) throw error;
        await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1)));
      }
    }
  });
  const settled = next.catch(() => {});
  writing.set(userId, settled);
  settled.then(() => { if (writing.get(userId) === settled) writing.delete(userId); });
  return next;
}
/** The write an account's memory is waiting on, so two of them never hold a transaction at once in this process. */
const writing = new Map();
async function write(userId, kept, { chat = '', replaces = '' } = {}) {
  let entry;
  const tx = await database().transaction('write');
  try {
    const rows = (await tx.execute({ sql: 'SELECT id, text, created, updated FROM pocket_pip_memory WHERE user_id = ?', args: [userId] })).rows;
    const target = replaces ? rows.find(row => String(row.id) === replaces) : null;
    if (replaces && !target) throw refusal('That memory is no longer there. Reload the list.', 404, 'memory_missing');
    const same = rows.find(row => String(row.text).toLowerCase() === kept.toLowerCase()), now = Date.now();
    if (same) entry = { id: String(same.id), text: String(same.text), replaced: false, added: false };
    else if (target) {
      await tx.execute({ sql: 'UPDATE pocket_pip_memory SET text = ?, updated = ? WHERE user_id = ? AND id = ?', args: [kept, now, userId, String(target.id)] });
      entry = { id: String(target.id), text: kept, replaced: true, added: false };
    } else {
      if (rows.length >= MEMORY_MAX) throw refusal('Your memory is full. Replace or forget something first.', 409, 'memory_full');
      const id = newMemoryId(new Set(rows.map(row => String(row.id))));
      await tx.execute({ sql: 'INSERT INTO pocket_pip_memory (user_id, id, text, chat_uid, created, updated) VALUES (?, ?, ?, ?, ?, ?)', args: [userId, id, kept, String(chat || ''), now, now] });
      entry = { id, text: kept, replaced: false, added: true };
    }
    await tx.commit();
  } catch (error) { await tx.rollback().catch(() => {}); throw error; }
  finally { tx.close(); }
  if (entry.added || entry.replaced) publish(userId, { type: 'memory' });
  return entry;
}

/** Removes one entry of this account's memory; whether there was one. */
export async function forget(userId, id) {
  const gone = (await execute({ sql: 'DELETE FROM pocket_pip_memory WHERE user_id = ? AND id = ?', args: [userId, String(id || '')] })).rowsAffected > 0;
  if (gone) publish(userId, { type: 'memory' });
  return gone;
}

/** The memory as the model reads it: one line per entry with the id it needs, empty when nothing is remembered. */
export function memoryNote(entries) {
  if (!entries?.length) return '';
  return 'What you remember about the person (your memory, newest last; the id in brackets is for replacing or forgetting):\n'
    + entries.map(entry => '- [' + entry.id + '] ' + entry.text).join('\n');
}

/** remember and forget as the server paths run them: the store's answer, or a refusal the model can act on. */
export async function memoryTool(userId, chat, name, input = {}) {
  if (name === 'forget') {
    // What was forgotten is said back, so the person reads the sentence, not an id.
    const entry = (await listMemory(userId)).find(item => item.id === input.id);
    return { kind: 'memory', forgotten: await forget(userId, input.id), id: String(input.id || ''), ...(entry ? { text: entry.text } : {}) };
  }
  try { return { kind: 'memory', saved: true, ...await remember(userId, input.text, { chat: String(chat || ''), replaces: input.replaces || '' }) }; }
  catch (error) { return { error: error.code || 'memory_not_saved', message: error.message }; }
}
