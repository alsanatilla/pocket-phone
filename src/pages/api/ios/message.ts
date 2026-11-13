import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { iosUser } from '../../../server/ios.js';
import { submitRun } from '../../../server/pip-runs.js';
import { json, failure, readJson } from '../../../server/http.js';
export const POST: APIRoute = async ({request}) => {
  try {
    const user = await iosUser(request,true), body = await readJson(request,20000);
    const result = await submitRun(user,{text:body.text,requestId:body.requestId || randomUUID(),chatUid:'ios-shortcuts',device:'ios-shortcuts',grants:[],timezone:body.timezone});
    return json({accepted:true,result},202);
  } catch(e) { return failure(e); }
};
