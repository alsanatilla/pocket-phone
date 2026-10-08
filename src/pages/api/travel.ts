import type { APIRoute } from 'astro';
import { signedIn } from '../../server/auth.js';
import { failure, json, sameOrigin, readJson } from '../../server/http.js';
import { mutateTravel, previewTravelInvite, readTravel } from '../../server/travel.js';

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    if (url.searchParams.has('invite')) {
      let user = null;
      try { user = await signedIn(request); } catch (error) { if (error.status !== 401) throw error; }
      return json(await previewTravelInvite(user, url.searchParams.get('invite')));
    }
    const user = await signedIn(request);
    return json({ accountId: user.id, records: await readTravel(user.id) });
  } catch (error) { return failure(error); }
};
export const POST: APIRoute = async ({ request }) => {
  try {
    sameOrigin(request);
    const user = await signedIn(request), body = await readJson(request, 1024 * 1024 + 4096);
    return json({ accountId: user.id, ...await mutateTravel(user, body) });
  } catch (error) {
    if (error.status === 409) return json({ error: error.message, ...(error.record ? { record: error.record } : {}), ...(error.conflicts ? { conflicts: error.conflicts } : {}) }, 409);
    return failure(error);
  }
};
