import type { APIRoute } from 'astro';
import { signedIn } from '../../../server/auth.js';
import { ensureSchema } from '../../../server/database.js';
import { failure, json, sameOrigin, readJson } from '../../../server/http.js';
import { keyStatus, saveKey, forgetKey } from '../../../server/pip-keys.js';

const params = (request: Request) => {
  const url = new URL(request.url);
  return { provider: url.searchParams.get('provider') || '', baseUrl: url.searchParams.get('baseUrl') || '' };
};

export const GET: APIRoute = async ({ request }) => {
  try { const user = await signedIn(request); await ensureSchema(); return json(await keyStatus(user.id, params(request))); }
  catch (error) { return failure(error); }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    sameOrigin(request);
    const user = await signedIn(request), body = await readJson(request, 16 * 1024);
    await ensureSchema();
    return json(await saveKey(user.id, body));
  } catch (error) { return failure(error); }
};

export const DELETE: APIRoute = async ({ request }) => {
  try {
    sameOrigin(request);
    const user = await signedIn(request);
    await ensureSchema();
    return json(await forgetKey(user.id, params(request)));
  } catch (error) { return failure(error); }
};
