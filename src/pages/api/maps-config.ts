import type { APIRoute } from 'astro';
import { json } from '../../server/http.js';

// Maps JavaScript uses a public browser key. Its website/API restrictions belong
// in Google Cloud; server credentials and unrelated settings are never returned.
export const GET: APIRoute = () => {
  const key = (process.env.GOOGLE_MAPS_BROWSER_KEY || '').trim();
  const enabled = /^AIza[A-Za-z0-9_-]{35}$/.test(key);
  return json({ enabled, key: enabled ? key : '' });
};
