import type { APIRoute } from 'astro';
import { signedIn } from '../../../server/auth.js';
import { json, failure, sameOrigin, readJson } from '../../../server/http.js';
import { readChatEvents } from '../../../server/chat-log.js';
import { objectId } from '../../../shared/objects.js';
export const POST: APIRoute = async ({ request }) => {
  try { sameOrigin(request); const user = await signedIn(request), body = await readJson(request);
    if (body.accountId !== user.id) return json({ error: 'Account changed. Reload Pocket.' }, 409);
    if (!objectId(body.chat)) throw Object.assign(new Error('Invalid chat.'), { status: 400 });
    return json({ accountId: user.id, chat: body.chat, ...await readChatEvents(user.id, body.chat, body.after) });
  } catch (error) { return failure(error); }
};
