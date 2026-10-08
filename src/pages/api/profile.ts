import type { APIRoute } from 'astro';
import { authFor, signedIn } from '../../server/auth.js';
import { failure, json, readJson, sameOrigin } from '../../server/http.js';
import { chosenName } from '../../shared/profile-name.js';

export const POST: APIRoute = async ({ request }) => {
  try {
    sameOrigin(request);
    const user = await signedIn(request), body = await readJson(request, 1024);
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !['accountId', 'name'].includes(key))
      || typeof body.accountId !== 'string' || !Object.prototype.hasOwnProperty.call(body, 'name')) {
      throw Object.assign(new Error('Send an account ID and a name.'), { status: 400 });
    }
    if (body.accountId !== user.id) throw Object.assign(new Error('The active account changed. Reload Pocket.'), { status: 409 });
    let name;
    try { name = chosenName(body.name); }
    catch (error) { throw Object.assign(new Error(error.message || 'Choose a valid name.'), { status: 400 }); }
    await (await authFor(request)).api.updateUser({ headers: request.headers, body: { name } });
    const fresh = await signedIn(request);
    return json({ accountId: fresh.id, user: fresh });
  } catch (error) {
    // Better Auth APIError uses a named `status` plus numeric `statusCode`.
    return failure(error.statusCode ? Object.assign(new Error(error.message), { status: error.statusCode }) : error);
  }
};
