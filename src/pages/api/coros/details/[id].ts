import type { APIRoute } from 'astro';
import { signedIn } from '../../../../server/auth.js';
import { json, failure, sameOrigin, readJson } from '../../../../server/http.js';
import { corosDetail, saveCorosDetail } from '../../../../server/coros.js';
import { objectId } from '../../../../shared/objects.js';
export const GET: APIRoute = async ({ request, params, url }) => {
  try { const user = await signedIn(request), sport = Number(url.searchParams.get('sport')); if (!objectId(params.id) || !Number.isInteger(sport) || sport < 0 || sport > 10000) return json({ error: 'Invalid activity.' }, 400); return json(await corosDetail(user.id, params.id, sport)); } catch (error) { return failure(error); }
};
export const PUT: APIRoute = async ({ request, params }) => {
  try { sameOrigin(request); const user = await signedIn(request), body = await readJson(request); if (body.accountId !== user.id || !objectId(params.id)) return json({ error: 'Invalid activity.' }, 400); await saveCorosDetail(user.id, params.id, body.value); return json({ saved: true }); } catch (error) { return failure(error); }
};
