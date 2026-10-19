import type { APIRoute } from 'astro';
import { signedIn } from '../../../server/auth.js';
import { ensureSchema } from '../../../server/database.js';
import { failure, json, sameOrigin, readJson } from '../../../server/http.js';
import { readKey, FIRECRAWL } from '../../../server/pip-keys.js';

const PATHS = new Set(['/search', '/scrape']);

/** Web search for a signed-in browser: Firecrawl's key is added here, never in the page. */
export const POST: APIRoute = async ({ request }) => {
  try {
    sameOrigin(request);
    const user = await signedIn(request), body = await readJson(request, 256 * 1024);
    if (!PATHS.has(body?.path)) return json({ error: 'Unsupported web search request.' }, 400);
    await ensureSchema();
    const key = await readKey(user.id, { provider: 'firecrawl', baseUrl: FIRECRAWL });
    const response = await fetch(FIRECRAWL + body.path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify(body.body ?? {}),
      redirect: 'error',
      signal: request.signal,
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { 'Content-Type': response.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (error) { return failure(error); }
};
