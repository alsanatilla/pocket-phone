import { lookup } from 'node:dns/promises';
import { execute as sql } from './database.js';
import { seal, open } from './secrets.js';

const ANTHROPIC = 'https://api.anthropic.com/v1';
export const FIRECRAWL = 'https://api.firecrawl.dev/v2';
const invalid = (message, status = 400) => Object.assign(new Error(message), { status });

/** Local and private endpoints are never a place to send a stored provider key. */
function privateHost(host) {
  const name = String(host || '').toLowerCase();
  if (!name || name === 'localhost' || name.startsWith('[') || name.endsWith('.local') || name.endsWith('.internal')) return true;
  const v4 = name.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

const blocked = address => {
  const value = String(address || '').toLowerCase();
  if (value.startsWith('::ffff:')) return blocked(value.slice(7));
  if (value === '::1' || value === '::' || value.startsWith('fe80:') || /^f[cd][0-9a-f]{2}:/.test(value)) return true;
  return privateHost(value);
};

/** Resolves the host when a key is saved and before each relay, so a public name cannot point inward. */
export async function publicTarget(provider, baseUrl) {
  const target = endpoint(provider, baseUrl);
  if (provider !== 'compatible') return target;
  let addresses;
  try { addresses = await lookup(new URL(target).hostname, { all: true, verbatim: true }); }
  catch { throw invalid('The API endpoint could not be resolved.'); }
  if (!addresses.length || addresses.some(item => blocked(item.address))) throw invalid('Keys can only be stored for a public HTTPS endpoint.');
  return target;
}

/** The endpoint a key is stored for. Anthropic's is fixed; compatible endpoints must be public HTTPS. */
export function endpoint(provider, baseUrl) {
  if (provider !== 'anthropic' && provider !== 'compatible' && provider !== 'firecrawl') throw invalid('Choose a supported provider.');
  if (provider === 'anthropic') return ANTHROPIC;
  if (provider === 'firecrawl') return FIRECRAWL;
  let url;
  try { url = new URL(String(baseUrl || '').trim()); }
  catch { throw invalid('Enter an HTTPS API base URL, including /v1 if your provider needs it.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw invalid('Use an HTTPS API base URL without credentials, a query or a fragment.');
  if (privateHost(url.hostname)) throw invalid('Keys can only be stored for a public HTTPS endpoint.');
  return url.toString().replace(/\/+$/, '');
}

export async function saveKey(userId, { provider, baseUrl, key }) {
  const target = await publicTarget(provider, baseUrl);
  const value = String(key || '').trim();
  if (!/^[\x21-\x7e]{8,512}$/.test(value)) throw invalid('Enter a valid API key for this provider.');
  if (provider === 'anthropic' && (!value.startsWith('sk-ant-') || value.length < 30)) throw invalid('Enter a valid API key for this provider.');
  if (provider === 'firecrawl' && value.length > 200) throw invalid('Enter a valid Firecrawl key.');
  const sealed = seal(userId, { provider, endpoint: target, key: value });
  await sql({ sql: `INSERT INTO pocket_pip_keys (user_id, endpoint, provider, sealed, hint, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, endpoint) DO UPDATE SET provider = excluded.provider, sealed = excluded.sealed, hint = excluded.hint, updated_at = excluded.updated_at`,
    args: [userId, target, provider, sealed, value.slice(-4), Date.now()] });
  return { saved: true, hint: '…' + value.slice(-4), endpoint: target };
}

export async function keyStatus(userId, { provider, baseUrl }) {
  let target;
  try { target = endpoint(provider, baseUrl); } catch { return { saved: false }; }
  const rows = (await sql({ sql: 'SELECT hint FROM pocket_pip_keys WHERE user_id = ? AND endpoint = ?', args: [userId, target] })).rows;
  return rows.length ? { saved: true, hint: '…' + rows[0].hint, endpoint: target } : { saved: false, endpoint: target };
}

/** Decrypts one stored key. The sealed payload must still name the same user, provider and endpoint. */
export async function readKey(userId, { provider, baseUrl }) {
  const target = endpoint(provider, baseUrl);
  const rows = (await sql({ sql: 'SELECT sealed FROM pocket_pip_keys WHERE user_id = ? AND endpoint = ? AND provider = ?', args: [userId, target, provider] })).rows;
  if (!rows.length) throw invalid('Add an API key for this endpoint in Pip settings.', 401);
  let value;
  try { value = open(userId, rows[0].sealed); } catch { throw invalid('The stored key could not be read. Save it again in Pip settings.', 409); }
  if (value.provider !== provider || value.endpoint !== target || typeof value.key !== 'string') throw invalid('The stored key does not match this endpoint.', 409);
  return value.key;
}

export async function forgetKey(userId, { provider, baseUrl }) {
  let target;
  try { target = endpoint(provider, baseUrl); } catch { return { removed: false }; }
  const result = await sql({ sql: 'DELETE FROM pocket_pip_keys WHERE user_id = ? AND endpoint = ?', args: [userId, target] });
  return { removed: Number(result.rowsAffected || 0) > 0 };
}

/** Where a stored key may send requests. The path is fixed by the provider, never supplied by the browser. */
export function upstream(provider, baseUrl) {
  const target = endpoint(provider, baseUrl);
  return target + (provider === 'anthropic' ? '/messages' : '/chat/completions');
}
