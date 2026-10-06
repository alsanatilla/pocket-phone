import type { APIRoute } from 'astro';
import { signedIn } from '../../server/auth.js';
import { json, failure } from '../../server/http.js';
import { search } from '../../server/search.js';
export const GET: APIRoute = async ({ request, url }) => {
  try { const user = await signedIn(request), q = (url.searchParams.get('q') || '').slice(0, 200); return json({ accountId: user.id, results: await search(user.id, q) }); }
  catch (error) { return failure(error); }
};
