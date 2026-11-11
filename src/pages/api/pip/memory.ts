import type { APIRoute } from 'astro';
import { signedIn } from '../../../server/auth.js';
import { json, failure, sameOrigin, readJson } from '../../../server/http.js';
import { listMemory, remember, forget } from '../../../server/pip-memory-store.js';
export const GET: APIRoute = async ({ request }) => {
  try { const user = await signedIn(request); return json({ accountId: user.id, entries: await listMemory(user.id) }); }
  catch (error) { return failure(error); }
};
export const POST: APIRoute = async ({ request }) => {
  try {
    sameOrigin(request); const user = await signedIn(request), body = await readJson(request, 64 * 1024);
    if (body.accountId !== user.id) return json({ error: 'Account changed. Reload Pocket.' }, 409);
    const id = String(body.id || '');
    if (body.action === 'add') await remember(user.id, body.text);
    else if (body.action === 'edit') await remember(user.id, body.text, { replaces: id });
    else if (body.action === 'forget') await forget(user.id, id);
    else return json({ error: 'Unknown memory action.' }, 400);
    return json({ accountId: user.id, entries: await listMemory(user.id) });
  } catch (error) { return failure(error); }
};
