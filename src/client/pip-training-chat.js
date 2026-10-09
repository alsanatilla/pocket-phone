import { request } from './cloud.js';
import { activeAccount } from './workspace-storage.js';
export { trainingChatRoutine } from '../shared/pip-training-chat.js';

/** Training conversations use the stored routine key; the browser never receives it. */
export async function trainingReply(chat, turn, { signal, onUpdate = () => {} } = {}) {
  const accountId = activeAccount();
  if (!accountId) throw new Error('Sign in to Pocket to talk about your training.');
  onUpdate({ phase: 'talking with Pip', answer: '' });
  const result = await request('/api/pip/background', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'chat', accountId, message: { chat: chat.uid, uid: turn.uid, attempt: turn.attempt, text: turn.text, context: turn.context } }) });
  if (accountId !== activeAccount()) throw new Error('Account changed. Open the training chat again.');
  const run = result.run;
  if (!run?.reply) throw new Error(run?.error || 'Check your dedicated key in “on its own”.');
  onUpdate(run.reply);
  if (run.status !== 'done') throw new Error(run.error || 'Pip could not finish this reply.');
  return run.reply;
}
