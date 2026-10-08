import type { APIRoute } from 'astro';
import { MARKDOWN_BODY_LIMIT, MarkdownError, renderMarkdown } from '../../server/markdown.js';

export const prerender = false;
const reply = (value: object, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});
const fail = (message: string, status: number) => new MarkdownError(message, status);

/** Public rendering needs no account, and never persists or logs its source. */
export const POST: APIRoute = async ({ request }) => {
  try {
    const expected = new URL(request.url).origin;
    const origin = request.headers.get('origin');
    const site = request.headers.get('sec-fetch-site');
    if ((origin && origin !== expected) || (site && site !== 'same-origin' && site !== 'none') || (!origin && request.headers.get('cookie'))) throw fail('Request origin is not allowed.', 403);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw fail('Use a JSON request.', 415);
    const length = request.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > MARKDOWN_BODY_LIMIT)) throw fail('Markdown request is too large.', 413);
    const reader = request.body?.getReader();
    if (!reader) throw fail('Invalid Markdown request.', 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        size += result.value.byteLength;
        if (size > MARKDOWN_BODY_LIMIT) { await reader.cancel(); throw fail('Markdown request is too large.', 413); }
        chunks.push(result.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let body: unknown;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw fail('Invalid JSON.', 400); }
    return reply({ html: renderMarkdown(body) });
  } catch (error) {
    const status = error instanceof MarkdownError ? error.status : 500;
    return reply({ error: error instanceof MarkdownError ? error.message : 'Markdown is unavailable. Try again.' }, status);
  }
};
