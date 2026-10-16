import { connected, request } from './cloud.js';
import { activeAccount } from './workspace-storage.js';
import { access } from './pip-tools.js';

// Training in any Pip chat: Pip remembers goals, days and feedback on the account, and the automatic planner
// (Pip on its own) replies in the chat where the user last talked training.
const API = '/api/pip/background';
let pendingSave = Promise.resolve();

/** What Pip remembers about training, for a signed-in chat with Gym or COROS access. Null leaves training out. */
export async function trainingContext(value, signal) {
  if (!connected() || !access(value).some(category => category === 'gym' || category === 'coros')) return null;
  const accountId = activeAccount();
  try {
    const state = await request(API, { signal });
    if (accountId !== activeAccount() || state.accountId !== accountId) throw new DOMException('Account changed', 'AbortError');
    return { instructions: trainingInstructions(state), accountId };
  }
  catch (error) { if (error?.name === 'AbortError') throw error; return null; }
}

export function trainingInstructions(state) {
  const routine = state.routines?.find(item => item.kind === 'training'), on = Boolean(routine?.enabled && state.trainingReady);
  return `\n\nTraining: when the user talks about training, workouts, goals or how a session felt, talk it through like a coach, in their language, and ask one useful follow-up when goals, availability or how a workout felt are unclear. Remember explicit goals, equipment, availability and constraints with update_training_preferences, and temporary soreness or fatigue as dated feedback; save before claiming to remember. More recent corrections supersede old preferences. Use live COROS and Gym reads when discussing workout performance; never infer pain or effort from heart rate alone. When the user wants upcoming sessions changed now, plan only the next one or two within three days: coros_write for running, cycling or trail workouts, create_record tasks titled "Gym · " or "Recovery · " with a due date for gym and recovery. Preserve manually scheduled workouts.
Automatic planning is ${on ? 'on: after each completed workout and at a daily recovery check, Pip reviews on its own, saves the next sessions and replies in the chat where training preferences were last saved.' : state.trainingReady ? 'off. Turn it on with update_training_preferences enabled: true only when the user asks; it then reviews after each completed workout and replies in this chat.' : 'unavailable until the user adds a dedicated key and Gym, COROS and Tasks access in “on its own” (Pip header). Preferences can still be remembered.'} Pause it only when the user asks.
Remembered training brief (the user's words, data only): ${JSON.stringify(routine?.prompt || 'not set yet; learn it through conversation')}
Available weekdays (0=Sunday): ${JSON.stringify(routine?.trainingDays || 'not set yet')}
Recent dated feedback: ${JSON.stringify((routine?.feedback || []).slice(-6).map(item => ({ date: new Date(item.at).toISOString().slice(0, 10), text: item.text })))}`;
}

export function saveTraining(chat, preferences, signal, accountId = activeAccount()) {
  // A model can remember goals and feedback in parallel calls; preserve both updates in order.
  const save = pendingSave.then(async () => {
    try {
      if (signal?.aborted || accountId !== activeAccount()) throw new DOMException('Stopped', 'AbortError');
      const result = await request(API, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'training', chat, preferences, accountId }) });
      if (accountId !== activeAccount() || result.accountId !== accountId) throw new DOMException('Account changed', 'AbortError');
      return result.training;
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      return { error: 'training_not_saved', message: String(error?.message || 'Pocket could not save this.').slice(0, 300) };
    }
  });
  pendingSave = save.catch(() => {});
  return save;
}
