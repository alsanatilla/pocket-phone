import type { APIRoute } from 'astro';
import { signedIn } from '../../../server/auth.js';
import { json, failure, sameOrigin, readJson } from '../../../server/http.js';
import { corosState, beginCoros, claimCoros, refreshCoros, disconnectCoros, importCoros, corosTool, corosCatalog, corosWrite } from '../../../server/coros.js';
export const GET: APIRoute = async ({ request, params }) => {
  try { const user = await signedIn(request); if (params.action !== 'state') return json({ error: 'Unknown COROS request.' }, 404); return json({ accountId: user.id, ...await corosState(user.id) }); }
  catch (error) { return failure(error); }
};
export const POST: APIRoute = async ({ request, params, url }) => {
  try {
    sameOrigin(request); const user = await signedIn(request), body = await readJson(request);
    if (body.accountId !== user.id) return json({ error: 'Account changed. Reload Pocket.' }, 409);
    let value;
    if (params.action === 'connect') value = await beginCoros(user.id, url.origin, body.zone, false);
    else if (params.action === 'start') value = await beginCoros(user.id, url.origin, body.zone, true);
    else if (params.action === 'claim') value = await claimCoros(user.id);
    else if (params.action === 'refresh') value = await refreshCoros(user.id, Boolean(body.force));
    else if (params.action === 'disconnect') value = await disconnectCoros(user.id);
    else if (params.action === 'import') value = await importCoros(user.id, body);
    else if (params.action === 'tool') value = await corosTool(user.id, body.name, body.arguments);
    else if (params.action === 'catalog') value = await corosCatalog(user.id, body.names);
    else if (params.action === 'write') value = await corosWrite(user.id, body.key, body.name, body.arguments);
    else return json({ error: 'Unknown COROS request.' }, 404);
    return json({ accountId: user.id, ...value });
  } catch (error) { return failure(error); }
};
