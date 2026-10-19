import type { APIRoute } from 'astro';
import { signedIn } from '../../../server/auth.js';
import { ensureSchema } from '../../../server/database.js';
import { failure, sameOrigin } from '../../../server/http.js';
import { publicTarget, readKey, upstream } from '../../../server/pip-keys.js';

// The browser runs the agent; this hop only replaces the provider credential.
// The key is decrypted per request and never leaves the server.
const MAX_BODY = 8 * 1024 * 1024;
const text = (message: string, status: number) => new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const POST: APIRoute = async ({ request }) => {
  try {
    sameOrigin(request);
    const user = await signedIn(request);
    const provider = request.headers.get('x-pocket-provider') || '';
    let baseUrl = '';
    try { baseUrl = decodeURIComponent(request.headers.get('x-pocket-endpoint') || ''); }
    catch { return text('Choose a provider endpoint.', 400); }
    if (provider !== 'anthropic' && provider !== 'compatible') return text('Choose a supported provider.', 400);

    const raw = await request.text();
    if (Buffer.byteLength(raw) > MAX_BODY) return text('This request is too large to relay.', 413);
    let body: any;
    try { body = JSON.parse(raw); } catch { return text('Use a JSON provider request.', 400); }
    if (!body || typeof body.model !== 'string' || !body.model || body.model.length > 120) return text('Choose a provider model ID.', 400);

    await ensureSchema();
    await publicTarget(provider, baseUrl);
    const key = await readKey(user.id, { provider, baseUrl });

    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'text/event-stream' };
    if (provider === 'anthropic') {
      headers['x-api-key'] = key;
      headers['anthropic-version'] = request.headers.get('anthropic-version') || '2023-06-01';
      const beta = request.headers.get('anthropic-beta');
      if (beta && /^[\x20-\x7e]{0,512}$/.test(beta)) headers['anthropic-beta'] = beta;
    } else {
      headers.authorization = 'Bearer ' + key;
      for (const name of ['http-referer', 'x-title']) {
        const value = request.headers.get(name);
        if (value) headers[name] = value;
      }
    }

    let response: Response;
    try {
      response = await fetch(upstream(provider, baseUrl), {
        method: 'POST', headers, body: raw, redirect: 'error', signal: request.signal,
      });
    } catch (error) {
      if (request.signal.aborted) throw error;
      return text('The provider could not be reached from Pocket.', 502);
    }

    const out = new Headers({
      'Content-Type': response.headers.get('content-type') || 'text/event-stream',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    });
    for (const name of ['retry-after', 'retry-after-ms']) {
      const value = response.headers.get(name);
      if (value) out.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers: out });
  } catch (error) { return failure(error); }
};
