import type { APIRoute } from 'astro';
import { configured } from '../../server/database.js';
import { json } from '../../server/http.js';
export const GET: APIRoute = () => json({ configured: configured() });
