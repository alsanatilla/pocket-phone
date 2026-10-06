import type { APIRoute } from 'astro';
import { signedIn } from '../../../server/auth.js';
import { database } from '../../../server/database.js';
import { json, failure, sameOrigin } from '../../../server/http.js';
import { validMedia } from '../../../server/objects.js';
import { objectId } from '../../../shared/objects.js';
export const GET: APIRoute = async ({ request, params }) => {
  try {
    const user = await signedIn(request); if (!validMedia(params.name)) return json({ error: 'Unknown photo.' }, 400);
    const rows = await database().execute({ sql: 'SELECT content FROM pocket_media WHERE user_id = ? AND name = ?', args: [user.id, params.name] });
    if (!rows.rows.length) return json({ error: 'Photo not found.' }, 404);
    return new Response(rows.rows[0].content as ArrayBuffer, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return failure(error); }
};
export const PUT: APIRoute = async ({ request, params }) => {
  try {
    sameOrigin(request); const user = await signedIn(request), book = request.headers.get('x-pocket-book');
    if (request.headers.get('x-pocket-account') !== user.id) return json({ error: 'Account changed. Reload Pocket.' }, 409);
    if (!validMedia(params.name) || !objectId(book)) return json({ error: 'Invalid photo.' }, 400);
    if (Number(request.headers.get('content-length') || 0) > 4 * 1024 * 1024) return json({ error: 'Keep a zine photo under 4 MB.' }, 413);
    const data = Buffer.from(await request.arrayBuffer());
    if (data.length > 4 * 1024 * 1024) return json({ error: 'Keep a zine photo under 4 MB.' }, 413);
    if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) return json({ error: 'Use a JPEG photo.' }, 415);
    const tx = await database().transaction('write');
    try {
      const parent = await tx.execute({ sql: "SELECT payload FROM pocket_objects WHERE user_id = ? AND collection = 'zines' AND uid = ?", args: [user.id, book] });
      if (parent.rows[0] && JSON.parse(String(parent.rows[0].payload)).deleted) { await tx.rollback(); return json({ error: 'This zine was removed.' }, 409); }
      const existing = await tx.execute({ sql: 'SELECT entity_uid FROM pocket_media WHERE user_id = ? AND name = ?', args: [user.id, params.name] });
      if (existing.rows[0] && existing.rows[0].entity_uid !== book) { await tx.rollback(); return json({ error: 'This photo belongs to another zine.' }, 409); }
      await tx.execute({ sql: 'INSERT INTO pocket_media (user_id, name, entity_uid, content, content_type, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, name) DO NOTHING', args: [user.id, params.name, book, data, 'image/jpeg', Date.now()] });
      await tx.commit();
    } catch (error) { await tx.rollback().catch(() => {}); throw error; } finally { tx.close(); }
    return json({ saved: true });
  } catch (error) { return failure(error); }
};
