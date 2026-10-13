import { agenda } from './planner.js';
import { activeAccount } from './workspace-storage.js';
import { SPORTS } from '../shared/movement.js';

/** Calendar's portable records are also the training plan. Drafts stay local to this dialog. */
export function editSession(existing, date, changed) {
  const owner = activeAccount(), dialog = document.createElement('dialog');
  dialog.className = 'movement-plan-dialog'; dialog.setAttribute('aria-label', existing ? 'Edit session' : 'Plan session');
  const form = document.createElement('form');
  const heading = document.createElement('h2'); heading.textContent = existing ? 'edit session' : 'plan session'; form.append(heading);
  function field(label, type, value, options) {
    const wrap = document.createElement('label'); wrap.textContent = label;
    const input = document.createElement(options ? 'select' : type === 'textarea' ? 'textarea' : 'input');
    input.setAttribute('aria-label',label);
    if (options) for (const name of options) { const option = document.createElement('option'); option.value = name; option.textContent = name; input.append(option); }
    else if (type !== 'textarea') input.type = type;
    input.value = value; wrap.append(input); form.append(wrap); return input;
  }
  const title = field('session', 'text', existing?.title || ''); title.required = true; title.maxLength = 500;
  const sport = field('sport', '', existing?.training.sport || 'gym', SPORTS);
  let when = new Date(existing?.when || date+'T18:00:00');
  if(!existing && when.toDateString()===new Date().toDateString() && when.getTime()<Date.now()) { when=new Date(Date.now()+3600000);when.setMinutes(0,0,0); }
  const local = new Date(when.getTime()-when.getTimezoneOffset()*60000).toISOString().slice(0,16);
  const start = field('when', 'datetime-local', local); start.required = true;
  const duration = field('minutes', 'number', existing?.minutes || 60); duration.required = true; duration.min = '1'; duration.max = '1440'; duration.step = '1';
  const exercises = field('exercises · one per line', 'textarea', existing?.training.exercises.join('\n') || ''); exercises.rows = 4; exercises.maxLength = 1829;
  const chooseSport = () => { exercises.parentElement.hidden = sport.value !== 'gym'; }; sport.onchange = chooseSport; chooseSport();
  const error = document.createElement('p'); error.className = 'movement-form-error'; error.setAttribute('role','alert'); form.append(error);
  const controls = document.createElement('div'); controls.className = 'keys'; form.append(controls);
  const done = () => { dialog.close(); dialog.remove(); };
  const button = (text, run) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.onclick = run; controls.append(b); return b; };
  button('cancel', done);
  if (existing) button('remove', () => {
    if (owner !== activeAccount()) { done(); return; }
    if (!confirm('Remove this planned session?')) return;
    try { agenda.remove(existing.uid); done(); changed(); } catch (e) { error.textContent = e.message; }
  });
  const save = button('save', () => form.requestSubmit()); save.className = 'accent';
  form.onsubmit = event => {
    event.preventDefault();
    if (owner !== activeAccount()) { done(); return; }
    try {
      if (existing && !agenda.get(existing.uid)) throw new Error('This session was removed on another device.');
      if (existing && agenda.get(existing.uid).updated !== existing.updated) throw new Error('This session changed on another device. Close and reopen it.');
      const names = [...new Map(exercises.value.split('\n').map(x=>x.trim()).filter(Boolean).map(x=>[x.toLowerCase(),x])).values()];
      if (names.length > 30 || names.some(x=>x.length>60)) throw new Error('Use up to 30 exercises, 60 characters each.');
      const at = new Date(start.value).getTime();
      agenda.save({ ...existing, title:title.value, when:at, minutes:Number(duration.value),
        remindAt:existing?.remindAt ? Math.max(0,existing.remindAt + at-existing.when) : 0,
        training:{...existing?.training,sport:sport.value,exercises:sport.value === 'gym' ? names : []} });
      done(); changed();
    } catch (e) { error.textContent = e.message; }
  };
  dialog.addEventListener('close', ()=>dialog.remove()); dialog.append(form); document.body.append(dialog); dialog.showModal(); title.focus();
  return done;
}
