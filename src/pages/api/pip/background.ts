import type { APIRoute } from 'astro';
import { signedIn } from '../../../server/auth.js';
import { ensureSchema } from '../../../server/database.js';
import { json, failure, sameOrigin, readJson } from '../../../server/http.js';
import { backgroundState, saveBackground, forgetBackgroundKey, saveRoutine, removeRoutine, runClaimed, openTrainingChat, trainingMessage } from '../../../server/pip-background.js';
import { trainingChatRoutine } from '../../../shared/pip-training-chat.js';
export const GET: APIRoute = async ({ request }) => {
  try { const user = await signedIn(request); await ensureSchema(); return json({ accountId: user.id, ...await backgroundState(user.id) }); }
  catch (error) { return failure(error); }
};
export const POST: APIRoute = async ({ request }) => {
  try {
    sameOrigin(request); const user = await signedIn(request), body = await readJson(request, 64 * 1024);
    if (body.accountId !== user.id) return json({ error: 'Account changed. Reload Pocket.' }, 409);
    await ensureSchema();
    let value;
    if (body.action === 'settings') value = await saveBackground(user.id, body.settings || {}, typeof body.key === 'string' ? body.key.trim() : '');
    else if (body.action === 'forget-key') value = await forgetBackgroundKey(user.id);
    else if (body.action === 'routine') value = await saveRoutine(user.id, body.routine || {});
    else if (body.action === 'delete-routine') value = await removeRoutine(user.id, body.id);
    else if (body.action === 'run') value = { run: await runClaimed(user.id, String(body.id || ''), { force: true }), ...await backgroundState(user.id) };
    else if (body.action === 'training-chat') value = await openTrainingChat(user.id);
    else if (body.action === 'chat') {
      const message = trainingMessage(body.message);
      value = { run: await runClaimed(user.id, trainingChatRoutine(message.chat), { force: true, message, signal: request.signal }) };
    }
    else return json({ error: 'Unknown Pip request.' }, 404);
    return json({ accountId: user.id, ...value });
  } catch (error) { return failure(error); }
};
