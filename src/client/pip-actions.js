import { load, importDocument, NOTE_LIMIT, tasks, notes, receipt, KIND } from './store.js';
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

const validDay = raw => /^\d{4}-\d{2}-\d{2}$/.test(raw) && Number.isFinite(Date.parse(raw + 'T12:00:00Z')) && new Date(raw + 'T12:00:00Z').toISOString().slice(0, 10) === raw;
const validInstant = raw => typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw) && Number.isFinite(Date.parse(raw)) && validDay(raw.slice(0, 10));
/**
 * Applies a reviewed change to an existing record. Each change is idempotent, so applying it again on this or
 * another device leaves the same result: a task stays done, steps are added once, text is appended once.
 */
export function applyChange(change) {
  if (!change || typeof change.change !== 'string' || typeof change.id !== 'string') throw new Error('This change is incomplete.');
  const owner = activeAccount();
  if (change.change === 'complete_task' || change.change === 'update_task') {
    const task = tasks.get(change.id); if (!task) throw new Error('That task is no longer available.');
    if (change.change === 'complete_task') { if (!task.done) { tasks.edit(task.uid, t => { t.done = true; }); receipt.log(KIND.DONE, task.text); } return '/tasks/' + task.uid; }
    const title = change.title === undefined ? undefined : String(change.title).trim(), due = change.due === undefined ? undefined : String(change.due);
    const add = (Array.isArray(change.add_steps) ? change.add_steps : []).map(step => String(step).trim());
    if (title !== undefined && (!title || title.length > 500) || due && !validDay(due) || add.some(step => !step || step.length > 160 || /[\r\n]/.test(step))) throw new Error('Check the title, due date and steps.');
    if (owner !== activeAccount()) throw new Error('The account changed. Open the change again.');
    tasks.edit(task.uid, t => {
      if (title !== undefined) t.text = title;
      if (due !== undefined) t.due = due;
      t.steps ||= [];
      for (const step of add) if (!t.steps.some(old => old.text === step)) t.steps.push({ text: step, done: false });
      if (t.steps.length > 12) throw new Error('A task keeps at most 12 steps.');
    });
    return '/tasks/' + task.uid;
  }
  if (change.change === 'append_note') {
    const note = notes.get(change.id), text = String(change.text || '').trim();
    if (!note) throw new Error('That saved note is no longer available.');
    if (!text) throw new Error('Write the text to add.');
    const current = note.text.trimEnd();
    if (!current.endsWith(text)) {
      if (current.length + text.length + 2 > NOTE_LIMIT) throw new Error('The note would exceed its length limit.');
      notes.update(note.uid, current + '\n\n' + text);
    }
    return '/notes/' + note.uid;
  }
  if (change.change === 'move_appointment') {
    const item = agenda.get(change.id), minutes = change.minutes ?? item?.minutes;
    if (!item) throw new Error('That appointment is no longer available.');
    if (!validInstant(change.when)) throw new Error('Choose a date and time.');
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 480) throw new Error('Use 15 to 480 minutes.');
    const when = Date.parse(change.when);
    // A reminder keeps its distance from the appointment.
    agenda.save({ ...item, when: change.when, minutes, remindAt: item.remindAt ? item.remindAt + (when - item.when) : 0 });
    return '/calendar/' + item.uid;
  }
  throw new Error('Choose a supported change.');
}

/**
 * Sends an approved workout change to COROS through the Pocket account. The proposal id makes it idempotent on the
 * server: applying again, here or on the phone, returns the first result instead of adding a second workout.
 */
export async function applyCoros(chatId, turnId, eventId, tool, args) {
  if (!activeAccount()) throw new Error('Sign in to Pocket to save to COROS.');
  const key = await proposalId(chatId, turnId, eventId);
  const response = await fetch('/api/coros/write', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: activeAccount(), key, name: tool, arguments: args }) });
  let value = {}; try { value = await response.json(); } catch { /* reported below */ }
  if (!response.ok) throw new Error(String(value.error || 'COROS did not answer. Try again.'));
  return '/movement';
}
