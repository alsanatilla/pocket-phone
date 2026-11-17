import type { APIRoute } from 'astro';
import { database, ensureSchema } from '../../../../server/database.js';
import { failure, json } from '../../../../server/http.js';
import { sandboxAccount } from '../../../../../services/gateway/sandbox.mjs';

// The sandbox pulls one attachment the person sent in their chat. It has no session, so it proves itself with the
// shared token and the account hash it runs as; Pocket works out the owner from that hash.
const validName = (value: unknown): value is string => typeof value === 'string' && /^pip-in-[a-f0-9]{16}-[a-z0-9_-]{1,40}\.[a-z0-9]{1,5}$/.test(value);

export const GET: APIRoute = async ({ request, params }) => {
  try {
    const token = process.env.PIP_IMAGE_TOKEN || '';
    if (!token) return json({ error: 'Attachments are not configured on this server.' }, 503);
    const given = String(request.headers.get('x-pocket-image-token') || '');
    if (given.length !== token.length || given !== token) return json({ error: 'Not allowed.' }, 403);
    const account = String(request.headers.get('x-pocket-account') || '');
    if (!/^p[0-9a-f]{24}$/.test(account)) return json({ error: 'Unknown account.' }, 400);
    if (!validName(params.name)) return json({ error: 'Unknown file.' }, 400);

    await ensureSchema();
    const users = await database().execute('SELECT id FROM pocket_user');
    const owner = users.rows.map(row => String(row.id)).find(id => sandboxAccount(id) === account);
    if (!owner) return json({ error: 'No Pocket account belongs to this sandbox.' }, 404);

    const rows = await database().execute({ sql: 'SELECT content, content_type FROM pocket_files WHERE user_id = ? AND name = ?', args: [owner, params.name] });
    if (!rows.rows.length) return json({ error: 'File not found. Ask the person to send it again.' }, 404);
    return new Response(rows.rows[0].content as ArrayBuffer, { headers: {
      'Content-Type': String(rows.rows[0].content_type || 'application/octet-stream'),
      'Content-Disposition': 'attachment; filename="' + params.name + '"',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return failure(error); }
};
