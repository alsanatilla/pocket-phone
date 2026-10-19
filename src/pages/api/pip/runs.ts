import type { APIRoute } from 'astro';
import { signedIn } from '../../../server/auth.js';
import { ensureSchema } from '../../../server/database.js';
import { json, failure, sameOrigin, readJson } from '../../../server/http.js';
import { serverRunState, submitRun, decideRun, continueRun, stopRun, runView } from '../../../server/pip-runs.js';

// Pip's shared conversations: any device linked to the account submits, watches, decides and stops the same
// run. GET watches (with an event cursor); POST changes it. Nothing here trusts a device's own history. continue
// resumes a run whose decisions are all settled but whose continuing request ended before it ran.
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const user = await signedIn(request); await ensureSchema();
    const run = url.searchParams.get('run') || '', chat = url.searchParams.get('chat') || '';
    if (run) return json({ accountId: user.id, ...await runView(user.id, { runId: run, after: Number(url.searchParams.get('after') || 0) }) });
    const provider = url.searchParams.get('provider') || '', baseUrl = url.searchParams.get('baseUrl') || '';
    const asked = provider ? { provider, baseUrl, webSearch: url.searchParams.get('webSearch') === '1' } : null;
    return json({ accountId: user.id, ...await serverRunState(user.id, chat, asked) });
  } catch (error) { return failure(error); }
};
export const POST: APIRoute = async ({ request }) => {
  try {
    sameOrigin(request); const user = await signedIn(request), body = await readJson(request, 256 * 1024);
    if (body.accountId !== user.id) return json({ error: 'Account changed. Reload Pocket.' }, 409);
    await ensureSchema();
    if (body.action === 'submit') return json({ accountId: user.id, ...await submitRun(user.id, body) });
    if (body.action === 'decide') return json({ accountId: user.id, ...await decideRun(user.id, body) });
    if (body.action === 'continue') { await continueRun(user.id, String(body.runId || '')); return json({ accountId: user.id, ...await runView(user.id, { runId: String(body.runId || '') }) }); }
    if (body.action === 'stop') return json({ accountId: user.id, ...await stopRun(user.id, body) });
    return json({ error: 'Unknown Pip run request.' }, 404);
  } catch (error) { return failure(error); }
};
