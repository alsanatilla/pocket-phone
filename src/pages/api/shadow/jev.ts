import type { APIRoute } from 'astro';
import { signedIn } from '../../../server/auth.js';
import { ensureSchema } from '../../../server/database.js';
import { failure, sameOrigin, readJson } from '../../../server/http.js';
import { readKey } from '../../../server/pip-keys.js';
import { ZONE_BY_ID, POST_BY_ID, PORTALS, HIDING_CLUSTERS, SECTORS } from '../../../client/shadow-level.js';
import { jevState, localAnswers } from '../../../client/shadow-commander.js';
import { DECISION_KINDS, JEV_ENDPOINT, JEV_MODEL, readAnswers, shadowQuestions } from '../../../shared/shadow-jev.js';

// Jev as the security commander, relayed for signed-in players. The player's
// own OpenRouter key is read from Pip settings and never reaches the browser.
// Questions are rebuilt here from level ids, so this route cannot be used to
// ask Jev anything other than Shadow Protocol's commander questions.
const KEY_ENDPOINT = 'https://openrouter.ai/api/v1';
const model = () => process.env.OPENROUTER_JEV_MODEL || JEV_MODEL;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const fail = (message: string, status = 400) => json({ error: message }, status);
const windowHits = new Map<string, number[]>();
function limited(userId: string) {
  const now = Date.now();
  for (const [id, hits] of windowHits) if (now - hits[hits.length - 1] >= 5 * 60_000) windowHits.delete(id);
  const recent = (windowHits.get(userId) || []).filter(at => now - at < 5 * 60_000);
  if (recent.length >= 300) return true;
  recent.push(now); windowHits.set(userId, recent);
  return false;
}

const PORTAL_IDS = new Set(PORTALS.map(portal => portal.id));
const CLUSTER_IDS = new Set(HIDING_CLUSTERS.map(cluster => cluster.id));

/** Copies plain data with size limits: short strings, finite numbers, shallow arrays. */
function plain(value: unknown, depth = 0): unknown {
  if (depth > 6) return null;
  if (typeof value === 'string') return value.slice(0, 140);
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
  if (typeof value === 'boolean' || value == null) return value ?? null;
  if (Array.isArray(value)) return value.slice(0, 16).map(item => plain(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 48)) {
      if (!/^[\w:~.-]{1,48}$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) continue;
      out[key] = plain(item, depth + 1);
    }
    return out;
  }
  return null;
}

/** Keeps only candidates that name real places in the facility. */
function checked(situation: any, kind: string) {
  const object = (value: any) => value && typeof value === 'object' && !Array.isArray(value);
  if (!object(situation) || !['intruder', 'objective', 'force', 'rules', 'tendencies', 'candidates'].every(key => object(situation[key]))) return null;
  const td = situation.tendencies;
  if (!['afterDetect', 'escapes', 'found', 'vanish'].every(key => object(td[key])) || !Array.isArray(situation.evidence)) return null;
  if (![situation.force.free, situation.force.failures, situation.rules.coordination, situation.rules.search, situation.rules.influence, td.afterDetect.hid, td.afterDetect.fled].every(Number.isFinite)) return null;
  const lkp = situation.intruder.lastSeen;
  if (lkp != null && (!object(lkp) || !Object.hasOwn(ZONE_BY_ID, lkp.zone) || ![lkp.x, lkp.y, lkp.ago].every(Number.isFinite))) return null;
  if (['contact', 'lost', 'sweep'].includes(kind) && !lkp) return null;
  if (kind === 'anomaly' && (!object(situation.event) || ![situation.event.x, situation.event.y].every(Number.isFinite))) return null;
  situation.kind = kind;
  const c = situation.candidates;
  const keep = (list: unknown, valid: (id: string) => boolean, limit = 8) => (Array.isArray(list) ? list : [])
    .filter((item: any) => item && typeof item.id === 'string' && valid(item.id))
    .filter((item: any, index: number, items: any[]) => items.findIndex(other => other.id === item.id) === index)
    .slice(0, limit)
    .map((item: any) => {
      for (const key of ['weight', 'tendency', 'found', 'hide', 'spots']) if (!Number.isFinite(item[key])) item[key] = 0;
      return item;
    });
  situation.candidates = {
    zones: keep(c.zones, id => Object.hasOwn(ZONE_BY_ID, id)),
    exits: keep(c.exits, id => PORTAL_IDS.has(id)),
    clusters: keep(c.clusters, id => CLUSTER_IDS.has(id)),
    posts: keep(c.posts, id => Object.hasOwn(POST_BY_ID, id)),
    sectors: keep(c.sectors, id => Object.hasOwn(SECTORS, id)),
  };
  return situation;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    sameOrigin(request);
    const mocked = import.meta.env.DEV && process.env.JEV_MOCK === '1';
    const user = mocked ? { id: 'jev-mock' } : await signedIn(request);
    if (limited(user.id)) return fail('Jev is being asked too often. The local model covers for now.', 429);
    const body = await readJson(request, 48 * 1024) as any;
    const kind = String(body?.kind || '');
    if (!DECISION_KINDS.includes(kind)) return fail('Unknown decision.');
    const situation = checked(plain(body?.situation) as any, kind);
    if (!situation) return fail('The commander situation is incomplete.');
    const questions = shadowQuestions(kind, situation);
    if (!questions) return fail('No questions for this decision.');
    for (const question of Object.values(questions) as any[]) {
      if (question.type === 'choice' && !Object.keys(question.criteria).length) return fail('The situation has no options to choose from.');
    }

    if (mocked) {
      // Development: the same local model, behind the same contract, with some latency.
      await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 600));
      return json({ answers: localAnswers(kind, situation, Math.random), source: 'mock', model: 'jev-mock' });
    }

    await ensureSchema();
    const key = await readKey(user.id, { provider: 'compatible', baseUrl: KEY_ENDPOINT });
    let response: Response;
    try {
      response = await fetch(JEV_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + key,
          'HTTP-Referer': new URL(request.url).origin,
          'X-Title': 'Pocket Shadow Protocol',
        },
        body: JSON.stringify({ model: model(), state: jevState(situation), questions }),
        signal: AbortSignal.timeout(7000),
      });
    } catch {
      return fail('Jev could not be reached. The local model covers.', 502);
    }
    if (!response.ok) {
      const rejected = response.status === 401 || response.status === 403;
      return fail(rejected ? 'OpenRouter rejected the saved key. Save a valid key in Pip settings.' : 'Jev could not answer. The local model covers.', rejected ? 401 : [402, 429].includes(response.status) ? response.status : 502);
    }
    let completion: any;
    try { completion = await response.json(); } catch { return fail('Jev sent an unreadable reply.', 502); }
    const answers = readAnswers(kind, completion?.answers, situation);
    if (!answers) return fail('Jev sent no usable answers.', 502);
    return json({ answers, source: 'openrouter', model: typeof completion.model === 'string' ? completion.model.slice(0, 120) : model(), cost: Number.isFinite(completion?.usage?.cost) ? completion.usage.cost : null });
  } catch (error) { return failure(error); }
};
