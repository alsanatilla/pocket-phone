import type { APIRoute } from 'astro';
import { signedIn } from '../../../server/auth.js';
import { database } from '../../../server/database.js';
import { failure, json, sameOrigin } from '../../../server/http.js';

function fileName(value: string | undefined) {
  if (!value || !/^page-[a-zA-Z0-9_-]{1,100}\.jpg$/.test(value)) throw Object.assign(new Error('Unknown Pocket file.'), { status: 400 });
  return value;
}
export const GET: APIRoute = async ({ request, params }) => {
  try {
    const user = await signedIn(request), name = fileName(params.name);
    const rows = await database().execute({ sql: 'SELECT content, content_type FROM pocket_files WHERE user_id = ? AND name = ?', args: [user.id, name] });
    if (!rows.rows.length) return json({ error: 'Photo not found.' }, 404);
    return new Response(rows.rows[0].content as ArrayBuffer, { headers: { 'Content-Type': String(rows.rows[0].content_type), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return failure(error); }
};
export const PUT: APIRoute = async ({ request, params }) => {
  try {
    sameOrigin(request);
    const user = await signedIn(request), name = fileName(params.name);
    if (request.headers.get('x-pocket-account') !== user.id) return json({ error: 'Account changed. Reload Pocket.' }, 409);
    if (Number(request.headers.get('content-length') || 0) > 2 * 1024 * 1024) return json({ error: 'Keep a photo under 2 MB.' }, 413);
    const data = Buffer.from(await request.arrayBuffer());
    if (data.length > 2 * 1024 * 1024) return json({ error: 'Keep a photo under 2 MB.' }, 413);
    if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) return json({ error: 'Use a JPEG photo.' }, 415);
    const tx = await database().transaction('write');
    try {
      const journal = await tx.execute({ sql: 'SELECT payload FROM pocket_documents WHERE user_id = ? AND name = ?', args: [user.id, 'journal.json'] });
      const uid = name.slice(5, -4);
      if (journal.rows.length && JSON.parse(String(journal.rows[0].payload)).pages?.some(page => page.uid === uid && page.deleted)) {
        await tx.rollback(); return json({ error: 'This Paper page was removed.' }, 409);
      }
      await tx.execute({ sql: 'INSERT INTO pocket_files (user_id, name, content, content_type, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, name) DO NOTHING', args: [user.id, name, data, 'image/jpeg', Date.now()] });
      await tx.commit();
    } catch (error) { await tx.rollback().catch(() => {}); throw error; }
    finally { tx.close(); }
    return json({ saved: true });
  } catch (error) { return failure(error); }
};
