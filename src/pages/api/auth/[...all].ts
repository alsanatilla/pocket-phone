import type { APIRoute } from 'astro';
import { authFor } from '../../../server/auth.js';
import { failure } from '../../../server/http.js';

export const ALL: APIRoute = async ({ request }) => {
  try { return await (await authFor(request)).handler(request); }
  catch (error) { return failure(error); }
};
