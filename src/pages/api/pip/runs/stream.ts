import type { APIRoute } from 'astro';
import { signedIn } from '../../../../server/auth.js';
import { ensureSchema } from '../../../../server/database.js';
import { failure } from '../../../../server/http.js';
import { runFrames } from '../../../../server/pip-runs.js';

// A run watched as it happens: server-sent frames of the same view GET /api/pip/runs returns, so a reply typed in
// the browser reads like the tab-streamed one instead of arriving in coarse polls. The run lives on the server, so a
// dropped connection only costs a reconnect with the follower's own cursor.
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const user = await signedIn(request); await ensureSchema();
    // The submitting tab follows by its own request id, which it knows before its submit has created the run.
    const runId = url.searchParams.get('run') || '', asked = url.searchParams.get('request') || '', chat = url.searchParams.get('chat') || '';
    const after = Number(url.searchParams.get('after') || 0);
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        const send = text => { try { controller.enqueue(encoder.encode(text)); } catch { /* the client is gone */ } };
        try {
          for await (const frame of runFrames(user.id, { runId, request: asked, chat, after, signal: request.signal })) {
            send(frame ? 'data: ' + JSON.stringify(frame) + '\n\n' : ': keep-alive\n\n');
          }
        } catch { /* stop quietly: the tab will ask again, and the run keeps its own state */ }
        try { controller.close(); } catch { /* already closed */ }
      }
    });
    return new Response(body, { headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no'
    } });
  } catch (error) { return failure(error); }
};
