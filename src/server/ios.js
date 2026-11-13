import { createHash, randomBytes } from 'node:crypto';
import { ensureSchema, execute } from './database.js';
export async function iosSchema() {
  await ensureSchema();
  await execute(`CREATE TABLE IF NOT EXISTS pocket_ios_keys (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES pocket_user(id) ON DELETE CASCADE, expires INTEGER NOT NULL, last_send INTEGER NOT NULL DEFAULT 0)`);
}
export const keyHash = key => createHash('sha256').update(key).digest('hex');
export async function issueKey(userId) {
  await iosSchema();
  const key = 'pios_' + randomBytes(32).toString('base64url');
  await execute({sql:'DELETE FROM pocket_ios_keys WHERE user_id = ?',args:[userId]});
  await execute({sql:'INSERT INTO pocket_ios_keys(hash,user_id,expires) VALUES(?,?,?)',args:[keyHash(key),userId,Date.now()+90*86400000]});
  return key;
}
export async function iosUser(request, send = false) {
  await iosSchema();
  const key = request.headers.get('authorization')?.replace(/^Bearer /,'') || '';
  if (!/^pios_[A-Za-z0-9_-]{43}$/.test(key)) throw Object.assign(new Error('Invalid iPhone key.'),{status:401});
  const hash = keyHash(key), now = Date.now();
  const result = await execute({sql:'SELECT user_id FROM pocket_ios_keys WHERE hash = ? AND expires > ?',args:[hash,now]});
  if (!result.rows.length) throw Object.assign(new Error('iPhone key expired or revoked.'),{status:401});
  if(send) {
    const changed = await execute({sql:'UPDATE pocket_ios_keys SET last_send = ? WHERE hash = ? AND last_send < ?',args:[now,hash,now-10000]});
    if (!changed.rowsAffected) throw Object.assign(new Error('Wait ten seconds before sending again.'),{status:429});
  }
  return String(result.rows[0].user_id);
}
export function widgetTask(doc) {
  const tasks = (doc?.tasks || []).filter(t=>!t.deleted&&!t.done).sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999')||Number(b.important)-Number(a.important));
  return tasks.find(t=>t.uid===doc?.next?.uid)||tasks[0]||null;
}
