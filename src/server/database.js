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
  // Every scheduled run and what it did: the routine row keeps only the latest outcome, this keeps the recent
  // history a person can check after a failure instead of hunting through chats.
  `CREATE TABLE IF NOT EXISTS pocket_pip_routine_runs (seq INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES pocket_user(id) ON DELETE CASCADE, routine_id TEXT NOT NULL, at INTEGER NOT NULL, status TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', chat TEXT NOT NULL DEFAULT '', turn TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS pocket_pip_routine_runs_owner ON pocket_pip_routine_runs(user_id, at)`,
  `CREATE TABLE IF NOT EXISTS pocket_coros_writes (user_id TEXT NOT NULL REFERENCES pocket_user(id) ON DELETE CASCADE, key TEXT NOT NULL, tool TEXT NOT NULL, state TEXT NOT NULL, result TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL, PRIMARY KEY(user_id, key))`,
  // A shared Pip run: one conversation turn executing on the server, its provider messages, its live state and the
  // decisions it waits for. `request_id` comes from the client, so a retried submit reuses the same run. A running run
  // belongs to the one request holding `lease_id`, which renews it while it works; a paused run holds no lease.
  `CREATE TABLE IF NOT EXISTS pocket_pip_runs (user_id TEXT NOT NULL REFERENCES pocket_user(id) ON DELETE CASCADE, run_id TEXT NOT NULL, chat_uid TEXT NOT NULL, request_id TEXT NOT NULL, turn_uid TEXT NOT NULL, device TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, turn TEXT NOT NULL, checkpoint TEXT, config TEXT NOT NULL, device_tools TEXT NOT NULL DEFAULT '[]', lease_id TEXT NOT NULL DEFAULT '', lease_until INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(user_id, run_id))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS pocket_pip_runs_request ON pocket_pip_runs(user_id, request_id)`,
  // One unfinished reply per conversation: another device attaches to it instead of starting a second one.
  `CREATE UNIQUE INDEX IF NOT EXISTS pocket_pip_runs_active ON pocket_pip_runs(user_id, chat_uid) WHERE status IN ('running', 'awaiting', 'stopping')`,
  `CREATE INDEX IF NOT EXISTS pocket_pip_runs_chat ON pocket_pip_runs(user_id, chat_uid, created)`,
  `CREATE INDEX IF NOT EXISTS pocket_pip_runs_open ON pocket_pip_runs(status, lease_until, expires_at)`,
  `CREATE TABLE IF NOT EXISTS pocket_pip_run_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES pocket_user(id) ON DELETE CASCADE, run_id TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, created INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS pocket_pip_run_events_run ON pocket_pip_run_events(user_id, run_id, seq)`,
  // One row per decision the run waits for: an approval of a write, or the result of a device-owned tool. A
  // conditional UPDATE settles it, so two clients deciding at once settle it once.
  `CREATE TABLE IF NOT EXISTS pocket_pip_run_requests (user_id TEXT NOT NULL REFERENCES pocket_user(id) ON DELETE CASCADE, run_id TEXT NOT NULL, request_id TEXT NOT NULL, kind TEXT NOT NULL, tool TEXT NOT NULL, call_id TEXT NOT NULL, row_id TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT 'pending', response TEXT NOT NULL DEFAULT '', decided_by TEXT NOT NULL DEFAULT '', decided_at INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, PRIMARY KEY(user_id, run_id, request_id))`,
  `CREATE INDEX IF NOT EXISTS pocket_pip_run_requests_open ON pocket_pip_run_requests(user_id, run_id, state)`,
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
