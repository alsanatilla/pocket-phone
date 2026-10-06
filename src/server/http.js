export const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
export function failure(error) {
  const status = error.status || 500;
  if (status >= 500) console.error('Pocket API failed:', error.code || error.name);
  return json({ error: status >= 500 ? 'Pocket storage is unavailable. Try again.' : error.message }, status);
}
export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  const expected = process.env.BETTER_AUTH_URL || new URL(request.url).origin;
  if (origin && origin !== expected) throw Object.assign(new Error('Request origin is not allowed.'), { status: 403 });
  // Native clients use a bearer session rather than a browser cookie.
  if (!origin && request.headers.get('cookie') && !request.headers.get('authorization')) throw Object.assign(new Error('Request origin is required.'), { status: 403 });
}
export async function readJson(request, limit = 3 * 1024 * 1024) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw Object.assign(new Error('Use a JSON request.'), { status: 415 });
  if (Number(request.headers.get('content-length') || 0) > limit) throw Object.assign(new Error('The workspace is too large for one sync.'), { status: 413 });
  const text = await request.text();
  if (Buffer.byteLength(text) > limit) throw Object.assign(new Error('The workspace is too large for one sync.'), { status: 413 });
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
}
