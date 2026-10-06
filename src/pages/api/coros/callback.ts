import type { APIRoute } from 'astro';
import { signedIn } from '../../../server/auth.js';
import { finishCoros } from '../../../server/coros.js';
export const GET: APIRoute = async ({ request, url }) => {
  try { const user = await signedIn(request); if (url.searchParams.has('error')) throw new Error('Cancelled'); await finishCoros(user.id, url.searchParams.get('state'), url.searchParams.get('code')); return new Response(null, { status: 303, headers: { Location: '/?coros=connected#/movement', 'Cache-Control': 'no-store' } }); }
  catch { return new Response(null, { status: 303, headers: { Location: '/?coros=error#/movement', 'Cache-Control': 'no-store' } }); }
};
