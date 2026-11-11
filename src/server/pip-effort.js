// Asking JEV, before and during a server reply, how much looking-up its message deserves and whether what has
// been found is enough. JEV is the decisions API the Girder game already uses; its answers are read with the
// account's OpenRouter key, which never leaves the server. A missing key, a slow or refused request, or an answer
// Pocket cannot use leaves the reply on its usual path instead of failing it.

import { readKey } from './pip-keys.js';
import { effortFromAnswers, effortQuestions, effortState, enoughFromAnswers, enoughQuestions, enoughState } from '../shared/pip-effort.js';
import { JEV_ENDPOINT, JEV_MODEL } from '../shared/girder-jev.js';

const OPENROUTER = 'https://openrouter.ai/api/v1';

/** JEV's answers for one state and its questions, or null when there is no key or no usable response. */
async function askJev(userId, state, questions, { fetcher = fetch, timeoutMs = 1200 } = {}) {
  try {
    const key = await readKey(userId, { provider: 'compatible', baseUrl: OPENROUTER });
    const response = await fetcher(JEV_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key, 'X-Title': 'Pocket' },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    return (await response.json())?.answers ?? null;
  } catch { return null; }
}

/** JEV's effort level for one message with how long it took, or null when it gave no usable answer. */
export async function judgeEffort(userId, turn, earlier, { fetcher = fetch, timeoutMs = 1200 } = {}) {
  const started = Date.now();
  const level = effortFromAnswers(await askJev(userId, effortState(turn, earlier), effortQuestions(), { fetcher, timeoutMs }));
  return level ? { level, ms: Date.now() - started } : null;
}

/** Whether JEV says the lookups so far are enough, with how long it took, or null when it gave no usable answer. */
export async function judgeEnough(userId, turn, { fetcher = fetch, timeoutMs = 1200 } = {}) {
  const started = Date.now();
  const enough = enoughFromAnswers(await askJev(userId, enoughState(turn, turn?.activity), enoughQuestions(), { fetcher, timeoutMs }));
  return enough === null ? null : { enough, ms: Date.now() - started };
}
