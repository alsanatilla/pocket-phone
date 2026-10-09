import type { APIRoute } from 'astro';
import { authorizedJob } from '../../../server/secrets.js';
import { ensureSchema } from '../../../server/database.js';
import { runPipJob } from '../../../server/pip-background.js';
import { json, failure } from '../../../server/http.js';
export const GET: APIRoute = async ({ request }) => {
  try { if (!authorizedJob(request)) return json({ error: 'Unauthorized job.' }, 401); await ensureSchema(); return json(await runPipJob()); } catch (error) { return failure(error); }
};
