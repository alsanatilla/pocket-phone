import type { APIRoute } from 'astro';
import { signedIn } from '../../server/auth.js';
import { failure, json, sameOrigin, readJson } from '../../server/http.js';
import { readDocuments, syncDocuments } from '../../server/workspace.js';

export const GET: APIRoute = async ({ request }) => {
  try { const user = await signedIn(request); return json({ accountId: user.id, documents: await readDocuments(user.id) }); }
  catch (error) { return failure(error); }
};
export const POST: APIRoute = async ({ request }) => {
  try {
    sameOrigin(request);
    const user = await signedIn(request), body = await readJson(request);
    if (body.accountId !== user.id) return json({ error: 'Account changed. Reload Pocket.' }, 409);
    return json({ accountId: user.id, documents: await syncDocuments(user.id, body.documents) });
  } catch (error) { return failure(error); }
};
