import type { APIRoute } from 'astro';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { database, ensureSchema } from '../../../server/database.js';
import { failure, json } from '../../../server/http.js';
import { sandboxAccount } from '../../../../services/gateway/sandbox.mjs';

// The sandbox puts a picture here for the person whose account it serves; that person's chat reads it back through
// /api/media/<name>, which is signed in like every other Pocket read. The sandbox holds no session, so it proves
// itself with a shared token and the account hash it runs as — and Pocket works out the owner from the hash.

const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' };
const MAX = 4 * 1024 * 1024;
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const POST: APIRoute = async ({ request }) => {
  try {
    const token = process.env.PIP_IMAGE_TOKEN || '';
    if (!token) return json({ error: 'Pictures are not configured on this server.' }, 503);
    if (!same(String(request.headers.get('x-pocket-image-token') || ''), token)) return json({ error: 'Not allowed.' }, 403);

    const account = String(request.headers.get('x-pocket-account') || '');
    if (!/^p[0-9a-f]{24}$/.test(account)) return json({ error: 'Unknown account.' }, 400);
    const type = String(request.headers.get('x-pocket-image-type') || ''), extension = TYPES[type];
    if (!extension) return json({ error: 'Send a JPEG or PNG picture.' }, 415);
    if (Number(request.headers.get('content-length') || 0) > MAX) return json({ error: 'Keep a picture under 4 MB.' }, 413);
    const data = Buffer.from(await request.arrayBuffer());
    if (!data.length || data.length > MAX) return json({ error: 'Keep a picture under 4 MB.' }, 413);

    await ensureSchema();
    const users = await database().execute('SELECT id FROM pocket_user');
    const owner = users.rows.map(row => String(row.id)).find(id => sandboxAccount(id) === account);
    if (!owner) return json({ error: 'No Pocket account belongs to this sandbox.' }, 404);

    const name = 'pip-' + randomBytes(16).toString('hex') + '.' + extension;
    await database().execute({ sql: 'INSERT INTO pocket_media (user_id, name, entity_uid, content, content_type, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: [owner, name, 'pip', data, type, Date.now()] });
    return json({ name, url: '/api/media/' + name });
  } catch (error) { return failure(error); }
};
