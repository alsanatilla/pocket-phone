import type { APIRoute } from 'astro';
import { signedIn } from '../../../server/auth.js';
import { json, failure } from '../../../server/http.js';
import { gatewayModels } from '../../../../services/gateway/config.mjs';

// Which models this Pocket's server can run. When the native gateway owns the reply, switching a chat's model is a
// per-session override on the gateway, not a key held in the browser, so the picker lists exactly these.
export const GET: APIRoute = async ({ request }) => {
  try {
    await signedIn(request);
    const models = process.env.PIP_GATEWAY_TOKEN ? gatewayModels() : [];
    return json({ native: models.length > 0, models });
  } catch (error) { return failure(error); }
};
