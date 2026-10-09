import { createClient } from '@libsql/client';

let client, initializing;
export const configured = () => Boolean(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);
export function database() {
  if (!client) {
    if (!process.env.TURSO_DATABASE_URL) throw new Error('Pocket storage is not configured.');
    client = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN,
      ...(process.env.TURSO_DATABASE_URL.startsWith('file:') ? { concurrency: 1 } : {}) });
  }
  return client;
}
export const TABLES = [
  `CREATE TABLE IF NOT EXISTS pocket_user (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, emailVerified INTEGER NOT NULL DEFAULT 0, image TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pocket_session (id TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, ipAddress TEXT, userAgent TEXT, userId TEXT NOT NULL REFERENCES pocket_user(id) ON DELETE CASCADE)`,
  `CREATE INDEX IF NOT EXISTS pocket_session_user ON pocket_session(userId)`,
  `CREATE TABLE IF NOT EXISTS pocket_account (id TEXT PRIMARY KEY, accountId TEXT NOT NULL, providerId TEXT NOT NULL, userId TEXT NOT NULL REFERENCES pocket_user(id) ON DELETE CASCADE, accessToken TEXT, refreshToken TEXT, idToken TEXT, accessTokenExpiresAt INTEGER, refreshTokenExpiresAt INTEGER, scope TEXT, password TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS pocket_account_user ON pocket_account(userId)`,
  `CREATE TABLE IF NOT EXISTS pocket_verification (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, expiresAt INTEGER NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS pocket_verification_identifier ON pocket_verification(identifier)`,
  `CREATE TABLE IF NOT EXISTS pocket_passkey (id TEXT PRIMARY KEY, name TEXT, publicKey TEXT NOT NULL, userId TEXT NOT NULL REFERENCES pocket_user(id) ON DELETE CASCADE, credentialID TEXT NOT NULL, counter INTEGER NOT NULL, deviceType TEXT NOT NULL, backedUp INTEGER NOT NULL, transports TEXT, createdAt INTEGER, aaguid TEXT)`,
  `CREATE INDEX IF NOT EXISTS pocket_passkey_user ON pocket_passkey(userId)`,
  `CREATE INDEX IF NOT EXISTS pocket_passkey_credential ON pocket_passkey(credentialID)`,
  `CREATE TABLE IF NOT EXISTS pocket_device_code (id TEXT PRIMARY KEY, deviceCode TEXT NOT NULL UNIQUE, userCode TEXT NOT NULL UNIQUE, userId TEXT, expiresAt INTEGER NOT NULL, status TEXT NOT NULL, lastPolledAt INTEGER, pollingInterval INTEGER, clientId TEXT, scope TEXT, createdAt INTEGER, updatedAt INTEGER)`,
  `CREATE TABLE IF NOT EXISTS pocket_note_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES pocket_user(id) ON DELETE CASCADE, note_uid TEXT NOT NULL, text TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS pocket_note_versions_note ON pocket_note_versions(user_id, note_uid, id)`,
  `CREATE TABLE IF NOT EXISTS pocket_search_rows (user_id TEXT NOT NULL REFERENCES pocket_user(id) ON DELETE CASCADE, kind TEXT NOT NULL, uid TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(user_id, kind, uid))`,
  `CREATE TABLE IF NOT EXISTS pocket_rate_limit (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, count INTEGER NOT NULL, lastRequest INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pocket_documents (user_id TEXT NOT NULL REFERENCES pocket_user(id) ON DELETE CASCADE, name TEXT NOT NULL, payload TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL, PRIMARY KEY(user_id, name))`,
  `CREATE TABLE IF NOT EXISTS pocket_files (user_id TEXT NOT NULL REFERENCES pocket_user(id) ON DELETE CASCADE, name TEXT NOT NULL, content BLOB NOT NULL, content_type TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(user_id, name))`,
  `CREATE TABLE IF NOT EXISTS pocket_objects (user_id TEXT NOT NULL REFERENCES pocket_user(id) ON DELETE CASCADE, collection TEXT NOT NULL, uid TEXT NOT NULL, payload TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(user_id, collection, uid))`,
  `CREATE TABLE IF NOT EXISTS pocket_object_changes (revision INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, collection TEXT NOT NULL, uid TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS pocket_object_changes_owner ON pocket_object_changes(user_id, collection, revision)`,
  `CREATE TABLE IF NOT EXISTS pocket_media (user_id TEXT NOT NULL REFERENCES pocket_user(id) ON DELETE CASCADE, name TEXT NOT NULL, entity_uid TEXT NOT NULL, content BLOB NOT NULL, content_type TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(user_id, name))`,
  `CREATE INDEX IF NOT EXISTS pocket_media_entity ON pocket_media(user_id, entity_uid)`,
  `CREATE TABLE IF NOT EXISTS pocket_coros (user_id TEXT PRIMARY KEY REFERENCES pocket_user(id) ON DELETE CASCADE, credentials TEXT, pending TEXT, snapshot TEXT, generation TEXT NOT NULL, last_success INTEGER NOT NULL DEFAULT 0, last_attempt INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0, needs_auth INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', lock_owner TEXT, lock_until INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS pocket_coros_details (user_id TEXT NOT NULL REFERENCES pocket_user(id) ON DELETE CASCADE, activity_id TEXT NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(user_id, activity_id))`,
  `CREATE TABLE IF NOT EXISTS pocket_coros_history (user_id TEXT NOT NULL REFERENCES pocket_user(id) ON DELETE CASCADE, date TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(user_id, date))`,
  `CREATE TABLE IF NOT EXISTS pocket_pip_background (user_id TEXT PRIMARY KEY REFERENCES pocket_user(id) ON DELETE CASCADE, settings TEXT NOT NULL, credentials TEXT, used_day TEXT NOT NULL DEFAULT '', used_tokens INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pocket_pip_routines (user_id TEXT NOT NULL REFERENCES pocket_user(id) ON DELETE CASCADE, id TEXT NOT NULL, payload TEXT NOT NULL, next_run INTEGER NOT NULL, lock_until INTEGER NOT NULL DEFAULT 0, last_run INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '', last_chat TEXT NOT NULL DEFAULT '', PRIMARY KEY(user_id, id))`,
  `CREATE INDEX IF NOT EXISTS pocket_pip_routines_due ON pocket_pip_routines(next_run)`,
  `CREATE TABLE IF NOT EXISTS pocket_pip_training_state (user_id TEXT NOT NULL, routine_id TEXT NOT NULL, workouts TEXT NOT NULL DEFAULT '{}', review_day TEXT NOT NULL DEFAULT '', PRIMARY KEY(user_id, routine_id), FOREIGN KEY(user_id, routine_id) REFERENCES pocket_pip_routines(user_id, id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS pocket_pip_training_slots (user_id TEXT NOT NULL REFERENCES pocket_user(id) ON DELETE CASCADE, routine_id TEXT NOT NULL, slot TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY(user_id, routine_id, slot))`,
  `CREATE TABLE IF NOT EXISTS pocket_coros_writes (user_id TEXT NOT NULL REFERENCES pocket_user(id) ON DELETE CASCADE, key TEXT NOT NULL, tool TEXT NOT NULL, state TEXT NOT NULL, result TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL, PRIMARY KEY(user_id, key))`,
];
export function ensureSchema() {
  if (!initializing) initializing = database().batch(TABLES, 'write').catch(error => { initializing = null; throw error; });
  return initializing;
}
export async function execute(statement) {
  for (let attempt = 0; ; attempt++) {
    try { return await database().execute(statement); }
    catch (error) {
      if (attempt >= 3 || !/SQLITE_BUSY|TRANSACTION_CLOSED|TRANSACTION_ACTIVE/.test(error.code || '')) throw error;
      await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
}
export async function writeTransaction(operation) {
  for (let attempt = 0; ; attempt++) {
    let tx;
    try {
      tx = await database().transaction('write');
      const result = await operation(tx);
      await tx.commit();
      return result;
    } catch (error) {
      await tx?.rollback().catch(() => {});
      if (attempt >= 3 || !/SQLITE_BUSY|TRANSACTION_CLOSED|TRANSACTION_ACTIVE/.test(error.code || '')) throw error;
      await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
    } finally { tx?.close(); }
  }
}
