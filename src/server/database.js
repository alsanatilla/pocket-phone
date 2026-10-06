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
