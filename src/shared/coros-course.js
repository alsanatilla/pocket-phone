// Reads COROS MCP workout payloads for Pip's review: what the change is, when, and each section in plain words.
// CorosCourse.java follows the same rules; change both together.
export const COROS_ACTIONS = { createScheduledWorkout: 'plan workout', scheduleWorkout: 'schedule workout', createSingleWorkout: 'save workout', updateScheduledWorkout: 'update planned workout', updateWorkoutDetails: 'update saved workout' };
export const corosAction = tool => COROS_ACTIONS[tool] || 'COROS change';
const DATED = new Set(['createScheduledWorkout', 'scheduleWorkout', 'updateScheduledWorkout']), COURSE = new Set(['createScheduledWorkout', 'createSingleWorkout', 'updateScheduledWorkout', 'updateWorkoutDetails']);
export const corosDated = tool => DATED.has(tool);
export const corosCourse = tool => COURSE.has(tool);
const SECTION = { 1: 'warm-up', 2: 'work', 3: 'recovery', 4: 'cool-down' }, SPORT = { 1: 'run', 2: 'ride', 4: 'rest', 5: 'trail run' };
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const pad = value => String(value).padStart(2, '0');
export function clock(seconds) {
  const total = Math.max(0, Math.round(seconds)), h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
  return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
}
const meters = value => value >= 1000 ? +(value / 1000).toFixed(2) + ' km' : value + ' m';
const range = (a, b, format, unit = '') => (a === b ? format(a) : format(Math.min(a, b)) + '–' + format(Math.max(a, b))) + unit;
function target(section) {
  if (section.targetType === 1) return meters(section.targetValue);
  if (section.targetType === 2) return clock(section.targetValue);
  if (section.targetType === 3) return '↑' + section.targetValue + ' m climb';
  if (section.targetType === 4) return 'until lap';
  return '';
}
function intensity(section, sport) {
  const type = section.intensityType;
  if (![1, 2, 3, 4].includes(type)) return '';
  const metric = type === 1 ? 'HR' : type === 2 ? 'pace' : type === 3 ? 'effort pace' : sport === 2 ? 'FTP' : 'power';
  if (Number.isInteger(section.sectionIntensity)) return metric + ' zone ' + section.sectionIntensity;
  if (Number.isInteger(section.intensityPercentStart) && Number.isInteger(section.intensityPercentEnd))
    return section.intensityPercentStart + '–' + section.intensityPercentEnd + '% ' + (type === 1 ? 'LTHR' : type === 2 ? 'threshold pace' : 'effort threshold pace');
  const a = section.intensityValueStart, b = section.intensityValueEnd;
  if (!Number.isInteger(a) || !Number.isInteger(b)) return '';
  return type === 1 ? range(a, b, String, ' bpm') : type === 2 ? range(a, b, clock, '/km') : range(a, b, String, ' W');
}
const sectionText = (section, sport) => [SECTION[section.sectionType] || 'section', target(section), intensity(section, sport)].filter(Boolean).join(' · ');
/** One line per section; interval groups give a "6 ×" line with their sets indented below. */
export function courseLines(course) {
  if (!plain(course) || !Array.isArray(course.sections)) return [];
  const lines = [];
  for (const section of course.sections.slice(0, 40)) {
    if (!plain(section)) continue;
    if (section.intervalGroup) {
      lines.push({ text: (section.repeats || 1) + ' ×', nested: false });
      for (const member of (Array.isArray(section.sets) ? section.sets : []).slice(0, 20)) if (plain(member)) lines.push({ text: sectionText(member, course.sportType), nested: true });
    } else lines.push({ text: sectionText(section, course.sportType), nested: false });
  }
  return lines;
}
export const sportName = course => SPORT[course?.sportType] || 'workout';
/** yyyyMMdd as a local date, or null. */
export function corosDay(value) {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return null;
  const date = new Date(+value.slice(0, 4), +value.slice(4, 6) - 1, +value.slice(6, 8));
  return date.getFullYear() === +value.slice(0, 4) && date.getMonth() === +value.slice(4, 6) - 1 && date.getDate() === +value.slice(6, 8) ? date : null;
}
export const corosDate = value => corosDay(value)?.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) || '';
export const corosTitle = (tool, args) => String(args?.course?.courseName || '').trim() || (tool === 'scheduleWorkout' ? 'Saved workout' : 'Workout');
/** A light shape check before review; COROS validates the details when the user applies. Returns a reason or ''. */
export function corosProblem(tool, args, now = new Date()) {
  if (!COROS_ACTIONS[tool] || !plain(args)) return 'Use one of the COROS changes with its arguments.';
  if (DATED.has(tool)) {
    const day = corosDay(args.date), today = new Date(now.getFullYear(), now.getMonth(), now.getDate()), last = new Date(today); last.setDate(last.getDate() + 90);
    if (!day || day < today || day > last) return 'Use a date from today to 90 days ahead as yyyyMMdd.';
  }
  if (tool === 'scheduleWorkout' || tool === 'updateWorkoutDetails') { if (typeof args.workoutId !== 'string' || !/^\d{1,20}$/.test(args.workoutId)) return 'Use the workout ID from the workout library.'; }
  if (tool === 'updateScheduledWorkout' && !(typeof args.idInPlan === 'string' && args.idInPlan.trim() || Number.isInteger(args.idInPlan))) return 'Use the idInPlan from the training schedule.';
  if (COURSE.has(tool)) {
    const course = args.course;
    if (!plain(course) || typeof course.courseName !== 'string' || !course.courseName.trim() || course.courseName.length > 100) return 'Give the workout a short name.';
    if (![1, 2, 5].includes(course.sportType)) return 'COROS creates running, cycling and trail running workouts.';
    if (!Array.isArray(course.sections) || !course.sections.length || course.sections.length > 40) return 'Add the workout sections.';
    for (const section of course.sections) {
      if (!plain(section)) return 'Check the workout sections.';
      if (section.intervalGroup) { if (!Number.isInteger(section.repeats) || section.repeats < 1 || section.repeats > 20 || !Array.isArray(section.sets) || !section.sets.length || section.sets.some(member => !plain(member) || member.intervalGroup || ![2, 3].includes(member.sectionType))) return 'Interval groups repeat 1–20 times over work and recovery sections.'; }
      else if (![1, 2, 3, 4].includes(section.sectionType) || ![1, 2, 3, 4].includes(section.targetType)) return 'Each section needs a type and a target.';
    }
  }
  return '';
}
