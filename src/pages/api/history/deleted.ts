import type { APIRoute } from 'astro';
import { signedIn } from '../../../server/auth.js';
import { json, failure } from '../../../server/http.js';
import { deletedNotes } from '../../../server/history.js';
export const GET: APIRoute = async ({ request }) => {
  try { const user = await signedIn(request); return json({ accountId: user.id, notes: await deletedNotes(user.id) }); }
  catch (error) { return failure(error); }
};
