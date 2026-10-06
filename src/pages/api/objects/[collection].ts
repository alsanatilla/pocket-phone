import type { APIRoute } from 'astro';
import { signedIn } from '../../../server/auth.js';
import { json, failure, sameOrigin, readJson } from '../../../server/http.js';
import { collectionName, readObjects, writeObject } from '../../../server/objects.js';
export const GET: APIRoute = async ({ request, params, url }) => {
  try { const user = await signedIn(request); return json({ accountId: user.id, ...await readObjects(user.id, collectionName(params.collection), Number(url.searchParams.get('after') || 0)) }); }
  catch (error) { return failure(error); }
};
export const POST: APIRoute = async ({ request, params }) => {
  try { sameOrigin(request); const user = await signedIn(request), body = await readJson(request);
    if (body.accountId !== user.id) return json({ error: 'Account changed. Reload Pocket.' }, 409);
    return json({ accountId: user.id, ...await writeObject(user.id, collectionName(params.collection), body.value) });
  } catch (error) { return failure(error); }
};
