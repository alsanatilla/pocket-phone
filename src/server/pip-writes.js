import { createHash } from 'node:crypto';
import { readDocuments, syncDocuments } from './workspace.js';
import { corosWrite } from './coros.js';
import { NOTE_LIMIT, noteTitle } from '../client/store.js';

// A write a user approved runs on the server against the account's synced records, exactly once. The id is
// derived from the conversation, turn and tool row, so a retried decision, an offline replay or the same
// approval on another device leaves one record — the browser derives the same id with crypto.subtle.
const fail = (error, message) => ({ error, message });
export function proposalId(chatId, turnId, eventId) {
  return 'pip-' + createHash('sha256').update([chatId, turnId, eventId].join('\n')).digest('hex').slice(0, 32);
}
const validDay = raw => /^\d{4}-\d{2}-\d{2}$/.test(raw || '') && Number.isFinite(Date.parse(raw + 'T12:00:00Z')) && new Date(raw + 'T12:00:00Z').toISOString().slice(0, 10) === raw;
const validInstant = raw => typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw) && Number.isFinite(Date.parse(raw)) && validDay(raw.slice(0, 10));
const events = async userId => (await readDocuments(userId))['agenda.json']?.value.events || [];
const items = async (userId, name, key) => (await readDocuments(userId))[name]?.value[key] || [];

/** A new note, task or appointment. Repeating it returns the record the first approval created. */
async function createRecord(userId, uid, proposal, now) {
  const title = String(proposal?.title || '').trim(), text = String(proposal?.text || '');
  if (!title || title.length > 200 || text.length > 6000) return fail('invalid_arguments', 'Check the title and text.');
  if (proposal.kind === 'appointment') {
    const minutes = proposal.minutes ?? 60;
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 480 || !validInstant(proposal.when)) return fail('invalid_arguments', 'Use 15 to 480 minutes and a date and time with a timezone.');
    const current = await events(userId), old = current.find(item => item.uid === uid);
    if (old?.deleted) return fail('existing_proposal', 'This appointment was already saved and removed.');
    if (old) return { href: '/calendar/' + uid, repeated: true };
    if (current.filter(item => !item.deleted).length >= 300) return fail('workspace_full', 'The calendar is full.');
    await syncDocuments(userId, { 'agenda.json': { v: 1, events: [{ uid, title, when: Date.parse(proposal.when), minutes, remindAt: 0, task_uid: '', created: now, updated: now, deleted: false }] } }, true);
    return { href: '/calendar/' + uid };
  }
  if (!['note', 'task'].includes(proposal.kind)) return fail('invalid_arguments', 'Choose a note, task or appointment.');
  const name = proposal.kind === 'note' ? 'notes.json' : 'tasks.json', key = proposal.kind === 'note' ? 'notes' : 'tasks';
  const current = await items(userId, name, key), old = current.find(item => item.uid === uid);
  if (old?.deleted) return fail('existing_proposal', 'This was already saved and removed.');
  if (old) return { href: '/' + key + '/' + uid, repeated: true };
  const notes = await items(userId, 'notes.json', 'notes'), tasks = await items(userId, 'tasks.json', 'tasks');
  if (notes.filter(item => !item.deleted).length + tasks.filter(item => !item.deleted).length >= 250) return fail('workspace_full', 'The workspace is full.');
  const record = { uid, created: now, updated: now, deleted: false };
  if (proposal.kind === 'note') Object.assign(record, { text: ('# ' + title + (text.trim() ? '\n\n' + text : '')).slice(0, NOTE_LIMIT), pinned: false });
  else {
    if (proposal.due !== undefined && proposal.due && !validDay(proposal.due)) return fail('invalid_arguments', 'Choose a valid due date.');
    const steps = Array.isArray(proposal.steps) ? proposal.steps.map(step => String(step).trim()) : [];
    if (steps.length > 12 || steps.some(step => !step || step.length > 160 || /[\r\n]/.test(step))) return fail('invalid_arguments', 'Use up to 12 steps, each on one line within 160 characters.');
    Object.assign(record, { text: title, done: false, due: proposal.due || '', important: false, steps: steps.map(step => ({ text: step, done: false })), source: { kind: 'shared', name: 'Pip', text, token: uid } });
  }
  await syncDocuments(userId, { [name]: { v: 1, [key]: [record] } }, true);
  return { href: '/' + key + '/' + uid };
}

/** A change to an existing record. Each change is idempotent, so applying it twice leaves the same result. */
async function changeRecord(userId, change, now) {
  if (!change || typeof change.id !== 'string') return fail('invalid_arguments', 'This change is incomplete.');
  const stamp = old => Math.max(now, (old?.updated || 0) + 1);
  if (change.change === 'complete_task' || change.change === 'update_task') {
    const task = (await items(userId, 'tasks.json', 'tasks')).find(item => item.uid === change.id);
    if (!task || task.deleted) return fail('task_not_found', 'That task is no longer available.');
    if (change.change === 'complete_task') {
      if (!task.done) await syncDocuments(userId, { 'tasks.json': { v: 1, tasks: [{ ...task, done: true, updated: stamp(task) }] } }, true);
      return { href: '/tasks/' + task.uid, title: task.text };
    }
    const title = change.title === undefined ? undefined : String(change.title).trim(), due = change.due === undefined ? undefined : String(change.due);
    const add = (Array.isArray(change.add_steps) ? change.add_steps : []).map(step => String(step).trim());
    if (title !== undefined && (!title || title.length > 500) || due && !validDay(due) || add.some(step => !step || step.length > 160 || /[\r\n]/.test(step))) return fail('invalid_arguments', 'Check the title, due date and steps.');
    const steps = [...(task.steps || [])];
    for (const step of add) if (!steps.some(old => old.text === step)) steps.push({ text: step, done: false });
    if (steps.length > 12) return fail('too_many_steps', 'A task keeps at most 12 steps.');
    await syncDocuments(userId, { 'tasks.json': { v: 1, tasks: [{ ...task, ...(title !== undefined ? { text: title } : {}), ...(due !== undefined ? { due } : {}), steps, updated: stamp(task) }] } }, true);
    return { href: '/tasks/' + task.uid, title: title ?? task.text };
  }
  if (change.change === 'append_note') {
    const note = (await items(userId, 'notes.json', 'notes')).find(item => item.uid === change.id), text = String(change.text || '').trim();
    if (!note || note.deleted) return fail('note_not_found', 'That saved note is no longer available.');
    if (!text) return fail('invalid_arguments', 'Write the text to add.');
    const current = String(note.text || '').trimEnd();
    if (!current.endsWith(text)) {
      if (current.length + text.length + 2 > NOTE_LIMIT) return fail('note_full', 'The note would exceed its length limit.');
      await syncDocuments(userId, { 'notes.json': { v: 1, notes: [{ ...note, text: current + '\n\n' + text, updated: stamp(note) }] } }, true);
    }
    return { href: '/notes/' + note.uid, title: noteTitle(note) };
  }
  if (change.change === 'move_appointment') {
    const item = (await events(userId)).find(event => event.uid === change.id), minutes = change.minutes ?? item?.minutes;
    if (!item || item.deleted) return fail('appointment_not_found', 'That appointment is no longer available.');
    if (!validInstant(change.when) || !Number.isInteger(minutes) || minutes < 15 || minutes > 480) return fail('invalid_arguments', 'Choose a date, time and 15 to 480 minutes.');
    const when = Date.parse(change.when);
    // A reminder keeps its distance from the appointment.
    await syncDocuments(userId, { 'agenda.json': { v: 1, events: [{ ...item, when, minutes, remindAt: item.remindAt ? item.remindAt + (when - item.when) : 0, updated: stamp(item) }] } }, true);
    return { href: '/calendar/' + item.uid, title: item.title };
  }
  return fail('invalid_arguments', 'Choose a supported change.');
}

/**
 * Runs one approved write. Returns the tool answer the AI SDK records: a saved action with its link, or a
 * refusal the model can act on. Nothing here runs before the user approved the call.
 */
export async function applyApprovedWrite(userId, { chatId, turnId, eventId, name, input }, now = Date.now()) {
  if (!chatId || !turnId || !eventId) return fail('write_unavailable', 'This conversation is unavailable.');
  const uid = proposalId(chatId, turnId, eventId);
  try {
    if (name === 'create_record') {
      const ready = await createRecord(userId, uid, input, now);
      if (ready.error) return ready;
      return { kind: 'action', action: { tool: name, kind: input.kind, title: String(input.title || '').trim(), status: 'saved', href: ready.href } };
    }
    if (name === 'change_record') {
      const ready = await changeRecord(userId, input, now);
      if (ready.error) return ready;
      return { kind: 'action', action: { tool: name, kind: input.change, title: ready.title, status: 'saved', href: ready.href } };
    }
    if (name === 'coros_write') {
      if (typeof input?.tool !== 'string' || typeof input?.summary !== 'string') return fail('invalid_arguments', 'This COROS change is incomplete.');
      const sent = await corosWrite(userId, 'pip-run-' + uid.slice(4), input.tool, input.arguments || {});
      return { kind: 'action', action: { tool: name, kind: input.tool, title: input.summary.trim().slice(0, 200) || input.tool, status: 'saved', href: '/movement' }, ...(sent.repeated ? { repeated: true } : {}) };
    }
    return fail('write_unavailable', 'This change cannot be saved here.');
  } catch (error) {
    return fail('write_failed', String(error?.message || 'The change could not be saved.').slice(0, 300));
  }
}
export const writeHref = answer => answer?.kind === 'action' && answer.action.status === 'saved' ? answer.action.href : '';
