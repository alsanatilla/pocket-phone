import type { APIRoute } from 'astro';
import { randomBytes } from 'node:crypto';
import { database, ensureSchema } from '../../../server/database.js';
import { failure, json, sameOrigin } from '../../../server/http.js';
import { signedIn } from '../../../server/auth.js';

// A file the person hands to Pip in the chat. It stays in their own Pocket; the sandbox pulls it with the shared
// pip-file token (src/pages/api/pip/file/[name].ts) and reads it there. Nothing is executed and nothing is shared.

const MAX = 10 * 1024 * 1024;
/** What Pip can usefully read with a shell: text, PDF, Office archives, and pictures it may forward. */
const TYPES: Record<string, string> = {
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', tsv: 'text/tab-separated-values',
  json: 'application/json', xml: 'application/xml', yml: 'text/yaml', yaml: 'text/yaml', log: 'text/plain',
  html: 'text/html', ics: 'text/calendar',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
};

/** A name the sandbox can print and a person can read: a short hash plus the original stem, nothing else. */
const stored = (original: string, extension: string) => {
  const stem = original.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'file';
  return 'pip-in-' + randomBytes(8).toString('hex') + '-' + stem + '.' + extension;
};

export const POST: APIRoute = async ({ request }) => {
  try {
    sameOrigin(request);
    const user = await signedIn(request);
    if (Number(request.headers.get('content-length') || 0) > MAX) return json({ error: 'Keep an attachment under 10 MB.' }, 413);
    const data = Buffer.from(await request.arrayBuffer());
    if (!data.length) return json({ error: 'That file is empty.' }, 400);
    if (data.length > MAX) return json({ error: 'Keep an attachment under 10 MB.' }, 413);

    const original = decodeURIComponent(String(request.headers.get('x-pocket-file-name') || '')).slice(0, 120);
    const extension = (original.split('.').pop() || '').toLowerCase();
    const contentType = TYPES[extension];
    if (!contentType) return json({ error: 'Pip can take PDF, text, CSV/TSV, JSON, XML, YAML, HTML, DOCX/XLSX/PPTX and pictures.' }, 415);

    await ensureSchema();
    const name = stored(original, extension);
    await database().execute({ sql: 'INSERT INTO pocket_files (user_id, name, content, content_type, updated_at) VALUES (?, ?, ?, ?, ?)',
      args: [user.id, name, data, contentType, Date.now()] });
    return json({ name, size: data.length, type: contentType });
  } catch (error) { return failure(error); }
};
