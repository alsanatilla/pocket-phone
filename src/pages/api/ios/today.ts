import type { APIRoute } from 'astro';
import { iosUser, widgetTask } from '../../../server/ios.js';
import { readDocuments } from '../../../server/workspace.js';
import { json, failure } from '../../../server/http.js';
export const GET: APIRoute = async ({request}) => {
  try { const user = await iosUser(request); const docs = await readDocuments(user); const task = widgetTask(docs['tasks.json']?.value); return json({text:task?.text || 'Nothing lined up.',due:task?.due || '',updatedAt:Date.now()}); } catch(e) { return failure(e); }
};
