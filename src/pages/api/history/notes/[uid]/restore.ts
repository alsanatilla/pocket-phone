import type { APIRoute } from 'astro';
import { signedIn } from '../../../../../server/auth.js';
import { json, failure, sameOrigin, readJson } from '../../../../../server/http.js';
import { restoreNoteVersion } from '../../../../../server/history.js';
export const POST: APIRoute = async ({ request, params }) => {
  try {
    sameOrigin(request);
    const user = await signedIn(request), body = await readJson(request, 64 * 1024), uid = String(params.uid || '');
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(uid)) return json({ error: 'Unknown note.' }, 400);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid note version.' }, 400);
    if (body.accountId !== user.id) return json({ error: 'Account changed. Reload Pocket.' }, 409);
    return json({ accountId: user.id, document: await restoreNoteVersion(user.id, uid, body.version, body.current) });
  } catch (error) { return failure(error); }
};
