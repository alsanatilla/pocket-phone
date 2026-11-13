import type { APIRoute } from 'astro';
import { signedIn } from '../../../server/auth.js';
import { sameOrigin, json, failure } from '../../../server/http.js';
import { issueKey, iosSchema } from '../../../server/ios.js';
import { execute } from '../../../server/database.js';
export const POST: APIRoute = async ({request}) => {
  try { sameOrigin(request); const user = await signedIn(request); return json({key:await issueKey(user.id)}); } catch(e) { return failure(e); }
};
export const DELETE: APIRoute = async ({request}) => {
  try { sameOrigin(request); const user = await signedIn(request); await iosSchema(); await execute({sql:'DELETE FROM pocket_ios_keys WHERE user_id = ?',args:[user.id]}); return json({revoked:true}); } catch(e) { return failure(e); }
};
