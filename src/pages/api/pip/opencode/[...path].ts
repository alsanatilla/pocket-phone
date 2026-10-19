import type { APIRoute } from 'astro';
import { json, failure } from '../../../../server/http.js';
import { opencodeSession, opencodeTarget } from '../../../../shared/pip-opencode.js';

// OpenCode Go answers no CORS preflight, so a browser cannot reach it from a tab. This route is the same-origin
// door Pip uses instead: it forwards the caller's own key (never stored here) to the one chat endpoint and adds
// the session header the API routes by. A request carries its own key, so the proxy holds no credential of its own.
const BODY_LIMIT = 1024 * 1024, KEY = /^Bearer [\x21-\x7e]{8,512}$/;
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const target = opencodeTarget(params.path);
    if (!target) return json({ error: 'Unknown Pip provider route.' }, 404);
    const authorization = request.headers.get('authorization') || '';
    if (!KEY.test(authorization)) return json({ error: 'Add your OpenCode key in API settings.' }, 401);
    const body = await request.text();
    if (Buffer.byteLength(body) > BODY_LIMIT) return json({ error: 'This request is too large.' }, 413);
    const upstream = await fetch(target, {
      method: 'POST', body, redirect: 'error', signal: request.signal,
      headers: { authorization, 'content-type': 'application/json', accept: 'text/event-stream',
        'x-opencode-session': opencodeSession(authorization.slice(7)) }
    });
    return new Response(upstream.body, { status: upstream.status, headers: {
      'content-type': upstream.headers.get('content-type') || 'application/json', 'cache-control': 'no-store'
    } });
  } catch (error) { return failure(error); }
};
