import type { APIRoute } from 'astro';
import { signedIn } from '../../../server/auth.js';
import { ensureSchema } from '../../../server/database.js';
import { failure, sameOrigin, readJson } from '../../../server/http.js';
import { readKey } from '../../../server/pip-keys.js';
import { RELICS, RELIC_CAPS, THROW_STYLES, readLoadout } from '../../../client/girder-engine.js';
import { JEV_ENDPOINT, JEV_GAME, JEV_MODEL, jevDecisionFromResponse, jevQuestions } from '../../../shared/girder-jev.js';

// JEV's hosted half. The player's own OpenRouter key is read from Pip settings,
// decrypted for this one request, and never reaches the browser. If this route
// is unavailable, the game keeps using its local System-One model.
const KEY_ENDPOINT = 'https://openrouter.ai/api/v1';
const model = () => process.env.OPENROUTER_JEV_MODEL || JEV_MODEL;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const fail = (message: string, status = 400) => json({ error: message }, status);
const finite = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const integer = (value: unknown, low: number, high: number, fallback: number) => {
  const number = Number(value);
  return Number.isInteger(number) ? clamp(number, low, high) : fallback;
};
const windowHits = new Map<string, number[]>();
function limited(userId: string) {
  const now = Date.now(), recent = (windowHits.get(userId) || []).filter(at => now - at < 5 * 60_000);
  if (recent.length >= 240) return true;
  recent.push(now); windowHits.set(userId, recent);
  return false;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    sameOrigin(request);
    const mocked = import.meta.env.DEV && process.env.JEV_MOCK === '1';
    const user = mocked ? { id: 'jev-mock' } : await signedIn(request);
    if (limited(user.id)) return fail('JEV is throwing too fast. Wait a moment.', 429);
    const body = await readJson(request, 32 * 1024) as any;
    const style = THROW_STYLES.find(item => item.id === body?.style) || THROW_STYLES[0];
    const relics = [...new Set((Array.isArray(body?.relics) ? body.relics : [])
      .filter((id: unknown) => typeof id === 'string' && RELICS.some(item => item.id === id)))].slice(0, 20) as string[];
    const flags = {
      hardHatUsed: Boolean(body?.flags?.hardHatUsed),
      featherUsed: Boolean(body?.flags?.featherUsed),
      softFallUsed: Boolean(body?.flags?.softFallUsed),
      secondWindUsed: Boolean(body?.flags?.secondWindUsed),
    };
    const loadout = readLoadout({ relics, secondWindUsed: flags.secondWindUsed }, {
      hardHatUsed: flags.hardHatUsed, featherUsed: flags.featherUsed, softFallUsed: flags.softFallUsed,
    });
    const ladders = (Array.isArray(body?.ladders) ? body.ladders : [])
      .filter((item: any) => item && typeof item === 'object')
      .map((item: any) => ({ col: integer(item.col, 0, 19, 10), topRow: integer(item.topRow, 0, 14, 2) }))
      .slice(0, 24);
    const player = {
      x: clamp(finite(body?.player?.x, 24), 0, 320),
      y: clamp(finite(body?.player?.y, 210), 0, 240),
      w: 10,
      h: 14,
      vx: clamp(finite(body?.player?.vx, 0), -200, 200),
      vy: clamp(finite(body?.player?.vy, 0), -300, 300),
      grounded: Boolean(body?.player?.grounded),
      climbing: Boolean(body?.player?.climbing),
      climbCol: body?.player?.climbCol == null ? null : integer(body.player.climbCol, 0, 19, 10),
      hearts: integer(body?.hearts, 0, 20, 4),
      maxHearts: integer(body?.maxHearts, 1, 20, 4),
      coins: integer(body?.coins, 0, 9999, 0),
      hammer: clamp(finite(body?.hammer, 0), 0, 20),
      invulnerable: Boolean(body?.player?.invulnerable),
      barrels: integer(body?.barrels, 0, 30, 0),
    };
    const gaps: Record<string, number[]> = {};
    if (body?.gaps && typeof body.gaps === 'object') {
      for (const [row, cols] of Object.entries(body.gaps)) {
        const index = Number(row);
        if (!Number.isInteger(index) || index < 0 || index > 14 || !Array.isArray(cols)) continue;
        gaps[index] = cols.filter((col: unknown) => Number.isInteger(Number(col)) && Number(col) >= 0 && Number(col) < 20).slice(0, 20).map(Number);
      }
    }
    const context = {
      game: JEV_GAME,
      screen: { width: 320, height: 240 },
      floor: {
        depth: integer(body?.depth, 1, 8, 1),
        name: typeof body?.name === 'string' ? body.name.slice(0, 40) : 'tower',
        style: style.id,
        styleDescription: style.desc,
        barrelInterval: clamp(finite(body?.barrelInterval, 2.2), 0.8, 8),
        ladders,
        exitCol: integer(body?.exitCol, 0, 19, 10),
        gaps,
      },
      player,
      capabilities: loadout,
      relics: relics.map(id => {
        const item = RELICS.find(relic => relic.id === id)!;
        return { id, name: item.name, effect: item.desc, capabilities: (RELIC_CAPS as Record<string, unknown>)[id] };
      }),
    };

    if (mocked) {
      const { jevDecide, mulberry32 } = await import('../../../client/girder-engine.js');
      const decision = jevDecide({
        run: { hearts: player.hearts, secondWindUsed: flags.secondWindUsed, relics },
        floor: {
          throws: style,
          coins: [],
          ladders,
          barrel: { interval: clamp(finite(context.floor.barrelInterval, 2.2), .8, 8) },
        },
        player: { ...player, w: 10, h: 14 },
        loadout,
        barrelCount: player.barrels,
        hammerTimer: player.hammer,
        random: mulberry32(Date.now() & 0xffffffff),
      });
      return json({
        decision: { ...decision, delay: clamp(finite(decision.delay, 2.2), 1, 3.8), intent: String(decision.intent || 'mock throw').slice(0, 64) },
        source: 'mock',
        model: 'jev-mock',
      });
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
          'X-Title': 'Pocket Girder Run',
        },
        body: JSON.stringify({
          model: model(),
          state: context,
          questions: jevQuestions(ladders),
        }),
        signal: AbortSignal.timeout(7000),
      });
    } catch {
      return fail('JEV could not be reached. Using the local model.', 502);
    }
    if (!response.ok) {
      return fail([401, 403].includes(response.status)
        ? 'OpenRouter rejected the saved key. Save a valid key in Pip settings.'
        : 'JEV could not answer. Using the local model.', response.status === 401 || response.status === 403 ? 401 : 502);
    }
    const completion = await response.json() as any;
    const decision = jevDecisionFromResponse(completion, ladders, context.floor.barrelInterval);
    if (!decision) return fail('JEV sent no readable decision.', 502);
    return json({ decision, source: 'openrouter', model: completion?.model || model() });
  } catch (error) { return failure(error); }
};
