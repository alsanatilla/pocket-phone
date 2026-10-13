// Portable Movement rules. Keep MovementData.java in step with these civil-day and link rules.
export const SPORTS = ['gym', 'run', 'ride', 'swim', 'walk', 'other'];
export const dayKey = value => { const d = new Date(value); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
export function weekDays(value = Date.now(), offset = 0) {
  const d = new Date(value); d.setHours(12,0,0,0); d.setDate(d.getDate() - (d.getDay()+6)%7 + offset*7);
  return Array.from({length:7}, (_,i) => { const next = new Date(d); next.setDate(d.getDate()+i); return dayKey(next); });
}
export function validTraining(value) {
  return value == null || typeof value === 'object' && !Array.isArray(value) && SPORTS.includes(value.sport)
    && Array.isArray(value.exercises) && value.exercises.length <= 30 && value.exercises.every(x => typeof x === 'string' && x.trim().length > 0 && x.length <= 60)
    && (value.completedAt === undefined || Number.isSafeInteger(value.completedAt) && value.completedAt >= 0);
}
export function sportOf(item) {
  if (item.sport === 402 || /strength|gym/i.test(item.type || '')) return 'gym';
  const type = String(item.type || '').toLowerCase();
  return SPORTS.includes(type) ? type : 'other';
}
export const duration = workout => Math.max(0, (Number(workout.ended || 0) - Number(workout.started || 0))/1000);
export const setCount = workout => (workout.entries || []).reduce((n,e) => n + (e.sets || []).length,0);
export const volume = workout => (workout.entries || []).reduce((n,e) => n + (e.sets || []).reduce((s,x) => s + x.kg*x.reps,0),0);
/** Only explicit, one-to-one links deduplicate a watch recording and a Gym log. */
export function activityFeed(records = [], workouts = []) {
  const available = new Map(records.map(x => [String(x.id),x])), used = new Set();
  const feed = workouts.filter(w => !w.deleted && w.ended && setCount(w)).sort((a,b) => a.started-b.started || String(a.id).localeCompare(String(b.id))).map(w => {
    const id = String(w.coros_id || ''), candidate = available.get(id);
    const coros = candidate && sportOf(candidate) === 'gym' && !used.has(id) ? candidate : null;
    if (coros) used.add(id);
    return { id:'gym:'+w.id, name:w.name || 'Gym', start:w.started, seconds:duration(w), sport:'gym', km:0, source:coros ? 'Gym + COROS' : 'Gym', workout:w, coros };
  });
  for (const a of records) if (!used.has(String(a.id))) feed.push({ id:'coros:'+a.id, name:a.name || a.type, start:a.start, seconds:Math.max(0,a.seconds || 0), km:a.km || 0, sport:sportOf(a), source:'COROS', coros:a });
  return feed.sort((a,b) => b.start-a.start || a.id.localeCompare(b.id));
}
export function trainingPlans(events = [], workouts = []) {
  return events.filter(e => !e.deleted && e.training && validTraining(e.training)).map(e => {
    const workout = workouts.find(w => !w.deleted && w.plan_uid === e.uid);
    return { ...e, workout, done:Boolean(e.training.completedAt || workout?.ended && setCount(workout)), active:Boolean(workout && !workout.ended) };
  }).sort((a,b) => a.when-b.when || a.uid.localeCompare(b.uid));
}
export function pipTrainingTasks(tasks=[],events=[]) {
  return tasks.filter(t=>!t.deleted && t.source?.name==='Pip training' && /^\d{4}-\d{2}-\d{2}$/.test(t.due||'') && !events.some(e=>!e.deleted&&e.training&&e.task_uid===t.uid)).sort((a,b)=>a.due.localeCompare(b.due));
}
/** Proposed links are choices, never silent matches. */
export function recordingChoices(workout, records, workouts) {
  const taken = new Set(workouts.filter(w => !w.deleted && w.id !== workout.id).map(w => String(w.coros_id || '')));
  return records.filter(a => sportOf(a) === 'gym' && !taken.has(String(a.id)) && dayKey(a.start) === dayKey(workout.started));
}
export function trainingText({deck = {}, result, feed = [], plans = [], tasks = [], now = Date.now()}) {
  const days = weekDays(now), recent = feed.filter(a => days.includes(dayKey(a.start)));
  const day=dayKey(now), dailyKnown=deck.daily?.days?.some(d=>d.date===day)||feed.some(a=>a.coros&&dayKey(a.start)===day), historyKnown=feed.some(a=>a.coros);
  const rest = deck.resting?.at(-1), hrv = deck.hrv?.at(-1), night = deck.daily?.days?.filter(d=>d.sleep).at(-1);
  return [
    `Help me plan my training. Use these saved readings, check their dates, and propose changes for me to review.`,
    `Movement snapshot: ${new Date(now).toISOString()}. COROS saved: ${deck.at ? new Date(deck.at).toISOString() : 'unavailable'}.`,
    `Pocket estimates from COROS: recovery ${result?.recovery?.score ?? 'unavailable'}; strain ${dailyKnown ? result?.strain?.strain ?? 'unavailable' : 'unavailable'}; condition ${historyKnown ? result?.conditioning?.score ?? 'unavailable' : 'unavailable'}.`,
    `HRV: ${hrv ? `${hrv.avg} ms (${hrv.date})` : 'unavailable'}. Resting HR: ${rest ? `${rest.bpm} bpm (${rest.date})` : 'unavailable'}. Sleep: ${night ? `${night.sleep.total} min (${night.date})` : 'unavailable'}.`,
    'This week: ' + (recent.slice(0,20).map(a=>`${a.name}, ${dayKey(a.start)}, ${Math.round(a.seconds/60)} min, ${a.source}`).join('; ') || 'no saved sessions'),
    'Planned: ' + (plans.filter(p=>!p.done && p.when>=new Date(days[0]+'T00:00:00').getTime()).slice(0,14).map(p=>`${p.title}, ${new Date(p.when).toLocaleString()}, ${p.minutes} min, ${p.training.sport}${p.training.exercises.length ? ', '+p.training.exercises.join(', ') : ''}`).join('; ') || 'none'),
    'Pip training tasks: '+(tasks.filter(t=>!t.done&&t.due>=days[0]).slice(0,14).map(t=>`${t.due}: ${t.text}`).join('; ')||'none')
  ].join('\n\n').slice(0,8000);
}
