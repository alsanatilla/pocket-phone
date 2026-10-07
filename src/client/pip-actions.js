import { load, importDocument, NOTE_LIMIT } from './store.js';
import { agenda } from './planner.js';
import { validDocument } from '../shared/workspace.js';
import { activeAccount } from './workspace-storage.js';

// Stable ids keep a proposal from creating duplicates after retries or on another device.
export async function proposalId(chatId, turnId, eventId) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode([chatId, turnId, eventId].join('\n')));
  return 'pip-' + [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
export async function applyProposal(chatId, turnId, eventId, proposal) {
  const owner = activeAccount(), uid = await proposalId(chatId, turnId, eventId), now = Date.now();
  if (owner !== activeAccount()) throw new Error('The account changed. Open the proposal again.');
  if (typeof proposal?.kind !== 'string' || typeof proposal.title !== 'string' || typeof proposal.text !== 'string') throw new Error('Check the title and text.');
  const title = proposal.title.trim(), text = proposal.text;
  if (!title || title.length > 200 || text.length > 6000) throw new Error('Check the title and text.');
  if (proposal.kind === 'appointment') {
    const minutes = proposal.minutes ?? 60;
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 480) throw new Error('Use 15 to 480 minutes.');
    const time = typeof proposal.when === 'string' && /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(proposal.when);
    if (!time || +time[2] > 23 || +time[3] > 59 || +(time[4] || 0) > 59 || +(time[6] || 0) > 18 || +(time[7] || 0) > 59 || +time[6] === 18 && +time[7] !== 0 || !Number.isFinite(Date.parse(proposal.when)) || new Date(time[1] + 'T12:00:00Z').toISOString().slice(0,10) !== time[1]) throw new Error('Choose a date and time.');
    const old = load('agenda.json').events.find(item => item.uid === uid);
    if (old?.deleted) throw new Error('This proposal was already saved and removed.');
    if (!old) agenda.save({uid, title, when: proposal.when, minutes});
    return '/calendar/' + uid;
  }
  const name = proposal.kind === 'note' ? 'notes.json' : proposal.kind === 'task' ? 'tasks.json' : null;
  if (!name) throw new Error('Choose a note, task or appointment.');
  const key = proposal.kind === 'note' ? 'notes' : 'tasks', doc = load(name), old = doc[key].find(item => item.uid === uid);
  if (old?.deleted) throw new Error('This proposal was already saved and removed.');
  if (old) return '/' + key + '/' + uid;
  if (load('notes.json').notes.filter(n => !n.deleted).length + load('tasks.json').tasks.filter(t => !t.deleted).length >= 250) throw new Error('The workspace is full.');
  const record = {uid, created: now, updated: now, deleted: false};
  if (proposal.kind === 'note') Object.assign(record, {text: ('# ' + title + (text.trim() ? '\n\n' + text : '')).slice(0, NOTE_LIMIT), pinned: false});
  else {
    if (proposal.due !== undefined && typeof proposal.due !== 'string') throw new Error('Choose a valid due date.');
    const due = proposal.due || '';
    if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !Number.isFinite(Date.parse(due + 'T12:00:00Z')) || new Date(due + 'T12:00:00Z').toISOString().slice(0,10) !== due)) throw new Error('Choose a valid due date.');
    if (proposal.steps !== undefined && !Array.isArray(proposal.steps)) throw new Error('Use up to 12 steps.');
    const steps = proposal.steps || [];
    if (steps.length > 12 || steps.some(step => typeof step !== 'string' || !step.trim() || step.trim().length > 160 || /[\r\n]/.test(step.trim()))) throw new Error('Use up to 12 steps, each on one line within 160 characters.');
    Object.assign(record, {text: title, done: false, due, important: false, steps: steps.map(step => ({text:step.trim(),done:false})), source:{kind:'shared',name:'Pip',text,token:uid}});
  }
  doc[key].push(record);
  if (!validDocument(name, doc)) throw new Error('Check the proposal details.');
  importDocument(name, doc);
  return '/' + key + '/' + uid;
}
