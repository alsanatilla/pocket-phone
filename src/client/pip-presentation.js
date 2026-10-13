/** Display names never change the provider's actual model ID. */
export function modelName(id) {
  const raw = String(id || '').split('/').at(-1).replace(/:free$/, '');
  if (id === 'openrouter/free') return 'Free router';
  const claude = raw.match(/(?:claude-)?(sonnet|opus|haiku)(?:-([\d.-]+))?/i);
  if (claude) return claude[1][0].toUpperCase() + claude[1].slice(1).toLowerCase() + (claude[2] ? ' ' + claude[2].replace(/-\d{8}$/, '').replaceAll('-', '.') : '');
  return raw.replace(/^gpt-/i, 'GPT ').replace(/^gemini-/i, 'Gemini ').replace(/[-_]/g, ' ').slice(0, 48) || 'Choose model';
}

/** Suggested questions follow the sources the user actually enabled. None runs before a tap. */
export function starters({ enabled = [], overdue = 0, thoughts = 0, training = false } = {}) {
  if (training) return [
    { label: 'plan my training', prompt: 'Help me plan my training. Ask about my goals and schedule before suggesting a plan.' },
    { label: 'adjust my next workout', prompt: 'Help me adjust my next workout based on my recovery and recent training. Ask what you need to know.' },
  ];
  const result = [];
  if (enabled.includes('tasks') && overdue) result.push({ label: "what’s overdue?", prompt: 'Look at my overdue tasks and help me choose what to do first. Leave the tasks unchanged.' });
  if (enabled.includes('tasks') || enabled.includes('calendar')) result.push({ label: 'plan my day', prompt: 'Help me plan today using the tasks and calendar you can access. Suggest a realistic order; leave my records unchanged.' });
  if (enabled.includes('thoughts') && thoughts) result.push({ label: 'sort my thoughts', prompt: 'Help me think through my parked thoughts. Keep them separate from tasks until I choose an action.' });
  if (enabled.includes('coros')) result.push({ label: 'how’s my recovery?', prompt: 'Look at my latest COROS recovery and training. What should I take into account today?' });
  if (enabled.includes('notes')) result.push({ label: 'pick up a note', prompt: 'Look at my recent notes and help me pick up one useful thread.' });
  if (!result.length) result.push({ label: 'think something through', prompt: 'Help me think through a decision. Start by asking what is on my mind.' });
  return result.slice(0, 3);
}
