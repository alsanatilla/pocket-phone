import type { APIRoute } from 'astro';
import { signedIn } from '../../../server/auth.js';
import { ensureSchema } from '../../../server/database.js';
import { json, failure, sameOrigin, readJson } from '../../../server/http.js';
import { publicTarget, readKey } from '../../../server/pip-keys.js';
import { startSurface, surfaceView } from '../../../server/surfaces.js';
import { config } from '../../../client/pip-core.js';
import { generateSurface } from '../../../app/surface/engine.ts';
const validKey = (key: unknown): key is string => typeof key === 'string' && key.length > 0 && key.length <= 1000;
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const user = await signedIn(request), key = url.searchParams.get('key');
    if (!validKey(key)) return json({ error: 'Invalid moment.' }, 400);
    await ensureSchema();
    return json({ accountId: user.id, surface: await surfaceView(user.id, key) });
  } catch (error) { return failure(error); }
};
export const POST: APIRoute = async ({ request }) => {
  try {
    sameOrigin(request);
    const user = await signedIn(request), body = await readJson(request, 64 * 1024);
    if (body.accountId !== user.id) return json({ error: 'Account changed. Reload Pocket.' }, 409);
    if (!validKey(body.key) || !body.moment?.now?.phase || !body.moment?.agenda || !body.moment?.tasks) return json({ error: 'Invalid moment.' }, 400);
    const value = config(body.config);
    await ensureSchema();
    await publicTarget(value.provider, value.baseUrl);
    const key = await readKey(user.id, value);
    const surface = await startSurface(user.id, body.key, body.force === true, signal => generateSurface(body.moment, value, { key }, { signal, onSpec: () => {} }));
    return json({ accountId: user.id, surface });
  } catch (error) { return failure(error); }
};
