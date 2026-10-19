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
    // The follower is gone when the request aborts, the response body is cancelled or a frame cannot be written,
    // whichever this host reports. Until then it counts as watching the run, so its devices are not also notified.
    const gone = new AbortController(), leave = () => gone.abort();
    request.signal.addEventListener('abort', leave, { once: true });
    const body = new ReadableStream({
      async start(controller) {
        const send = text => { try { controller.enqueue(encoder.encode(text)); } catch { leave(); } };
        try {
          for await (const frame of runFrames(user.id, { runId, request: asked, chat, after, signal: gone.signal })) {
            send(frame ? 'data: ' + JSON.stringify(frame) + '\n\n' : ': keep-alive\n\n');
            if (gone.signal.aborted) break;
          }
        } catch { /* stop quietly: the tab will ask again, and the run keeps its own state */ }
        try { controller.close(); } catch { /* already closed */ }
      },
      cancel: leave
    });
    return new Response(body, { headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no'
    } });
  } catch (error) { return failure(error); }
};
