import type { APIRoute } from 'astro';
import { signedIn } from '../../../server/auth.js';
import { ensureSchema } from '../../../server/database.js';
import { json, failure, sameOrigin, readJson } from '../../../server/http.js';
import { publicKey, subscribe, unsubscribe, renew, devices, subscribed, notify } from '../../../server/pip-notify.js';

// Pip's notifications on this browser: the server key a subscription needs, and subscribing, leaving and a test
// message. The service worker renews a subscription the browser replaced, which it can do without an account id.
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const user = await signedIn(request); await ensureSchema();
    const here = await subscribed(user.id, url.searchParams.get('endpoint') || '');
    return json({ accountId: user.id, publicKey: publicKey(), devices: await devices(user.id), here });
  } catch (error) { return failure(error); }
};
export const POST: APIRoute = async ({ request }) => {
  try {
    sameOrigin(request); const user = await signedIn(request), body = await readJson(request, 16 * 1024);
    await ensureSchema();
    if (body.action === 'renew') return json({ renewed: await renew(user.id, body.old, body.subscription) });
    if (body.accountId !== user.id) return json({ error: 'Account changed. Reload Pocket.' }, 409);
    if (body.action === 'subscribe') return json({ accountId: user.id, devices: await subscribe(user.id, body.subscription, body.device) });
    if (body.action === 'unsubscribe') return json({ accountId: user.id, devices: await unsubscribe(user.id, body.endpoint) });
    if (body.action === 'test') {
      const result = await notify(user.id, { title: 'Pip', body: 'Notifications work on this device.', href: '/pip', tag: 'pip-test', ttl: 600 }, { endpoint: String(body.endpoint || '') });
      return json({ accountId: user.id, ...result });
    }
    return json({ error: 'Unknown notification request.' }, 404);
  } catch (error) { return failure(error); }
};
