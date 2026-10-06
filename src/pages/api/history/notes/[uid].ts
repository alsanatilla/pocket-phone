import type { APIRoute } from 'astro';
import { signedIn } from '../../../../server/auth.js';
import { json, failure } from '../../../../server/http.js';
import { noteVersions } from '../../../../server/history.js';
export const GET: APIRoute = async ({ request, params }) => {
  try {
    const user = await signedIn(request), uid = String(params.uid || '');
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(uid)) return json({ error: 'Unknown note.' }, 400);
    return json({ accountId: user.id, versions: await noteVersions(user.id, uid) });
  } catch (error) { return failure(error); }
};
