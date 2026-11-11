// Asking JEV, before a server reply, how much looking-up its message deserves. JEV is the decisions API the
// Girder game already uses; its answer is read with the account's OpenRouter key, which never leaves the server.
// A missing key, a slow or refused request, or an answer that is not one of Pocket's levels leaves the reply on
// its usual limits instead of failing it.

import { readKey } from './pip-keys.js';
import { effortFromAnswers, effortQuestions, effortState } from '../shared/pip-effort.js';
import { JEV_ENDPOINT, JEV_MODEL } from '../shared/girder-jev.js';

const OPENROUTER = 'https://openrouter.ai/api/v1';

/** JEV's effort level for one message with how long it took, or null when it gave no usable answer. */
export async function judgeEffort(userId, turn, earlier, { fetcher = fetch, timeoutMs = 1200 } = {}) {
  const started = Date.now();
  try {
    const key = await readKey(userId, { provider: 'compatible', baseUrl: OPENROUTER });
    const response = await fetcher(JEV_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key, 'X-Title': 'Pocket' },
      body: JSON.stringify({ model: JEV_MODEL, state: effortState(turn, earlier), questions: effortQuestions() }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const level = effortFromAnswers((await response.json())?.answers);
    return level ? { level, ms: Date.now() - started } : null;
  } catch { return null; }
}
