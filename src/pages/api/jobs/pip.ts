import type { APIRoute } from 'astro';
import { authorizedJob } from '../../../server/secrets.js';
import { ensureSchema } from '../../../server/database.js';
import { runPipJob, JOB_BUDGET } from '../../../server/pip-background.js';
import { sweepRuns } from '../../../server/pip-runs.js';
import { json, failure } from '../../../server/http.js';
export const GET: APIRoute = async ({ request }) => {
  try {
    if (!authorizedJob(request)) return json({ error: 'Unauthorized job.' }, 401);
    await ensureSchema();
    // Due routines first; shared chat runs then end, expire or continue in the time left.
    const started = Date.now(), routines = await runPipJob(), runs = await sweepRuns({ deadline: started + JOB_BUDGET });
    return json({ ...routines, runs, more: routines.more || runs.more });
  } catch (error) { return failure(error); }
};
