// Pip's travel life: daily rhythm, bubble facts and the backpack. Pure rules only, no DOM or Google APIs.
import { addDays } from '../shared/travel-planning.js';

const BOOKED = ['booked', 'included'];
const COLORS = ['var(--accent)', '#a5bfdc', '#c1aed5', '#adbf9c'];
// 12x12 pixel rows, '#' is ink. Drawn as runs of rects so the SVG holds nothing else.
const GLYPHS = {
  shell: ['....####....', '..########..', '.##.####.##.', '.##########.', '..########..', '...######...', '....####....'],
  leaf: ['.........##.', '........###.', '.......###..', '......###...', '.....###....', '....###.....', '...###......', '..###.......', '.###........', '###.........'],
  mountain: ['.....#......', '....###.....', '...#####....', '..#######...', '.#########..', '###########.'],
  ticket: ['############', '#.#.#.#.#.#.', '############'],
  postcard: ['############', '#.........##', '#..........#', '#.########.#', '#..........#', '############'],
  star: ['.....##.....', '....####....', '############', '.##########.', '..########..', '..#.####.#..', '.##......##.'],
  cup: ['##########..', '##########.#', '##########.#', '##########..', '.########...'],
  key: ['..####......', '.#....######', '.#....#....#', '..####.....#'],
};
const GLYPH_NAMES = Object.keys(GLYPHS);

const pad = value => String(value).padStart(2, '0');
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
// In the reader's own date style, as elsewhere in Travel ("7. Feb.", "Feb 7").
const shortDate = (day, locale) => new Date(day + 'T12:00:00Z').toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const nightCount = stop => Math.max(0, Math.trunc(Number(stop?.nights) || 0));

/** Today on the device's calendar as 'YYYY-MM-DD'. */
export function localToday(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Pip's part of the day at a place, from its longitude and the local solar hour. */
export function pipPhase(lng, nowMs) {
  const hour = ((nowMs / 3600000 + lng / 15) % 24 + 24) % 24;
  if (hour >= 22 || hour < 6) return 'night';
  if (hour < 11) return 'morning';
  if (hour < 18) return 'day';
  return 'evening';
}

// The last day of a stop: its departure, or arrival plus nights when no departure is set.
function lastDay(stop) {
  const departure = validDate(stop?.departure);
  if (departure) return departure;
  const arrival = validDate(stop?.arrival);
  return arrival ? addDays(arrival, nightCount(stop)) : '';
}

function visited(stop, today) {
  const end = lastDay(stop);
  return Boolean(end) && end < today;
}

/** Stops whose last day is before today. Stops without dates never count. */
export function visitedStops(trip, today) {
  const stops = Array.isArray(trip?.stops) ? trip.stops : [];
  return stops.filter(stop => stop?.uid && visited(stop, today));
}

/** Short facts about the stop Pip is at, in the order the bubble rotates through them. */
export function stopFacts(trip, stopUID, today, locale = undefined) {
  const stops = Array.isArray(trip?.stops) ? trip.stops : [];
  const index = stops.findIndex(stop => String(stop?.uid) === String(stopUID));
  const stop = stops[index];
  if (!stop) return [];
  const place = stop.place || 'Destination', facts = [];
  const start = validDate(stop.arrival), end = lastDay(stop), nights = nightCount(stop);
  const dates = !start || !end ? 'dates open' : start === end ? shortDate(start, locale) : `${shortDate(start, locale)} – ${shortDate(end, locale)}`;
  facts.push([place, nights ? `${nights} ${nights === 1 ? 'night' : 'nights'}` : '', dates].filter(Boolean).join(' · '));

  const stays = Array.isArray(stop.stays) ? stop.stays.filter(Boolean) : [];
  const booked = stays.find(stay => BOOKED.includes(stay.status)), chosen = stays.find(stay => stay.status === 'chosen');
  if (booked) facts.push(`booked · ${booked.name || 'stay'}`);
  else if (chosen) facts.push(`chosen · ${chosen.name || 'stay'}`);
  else facts.push(stays.length ? `${stays.length} ${stays.length === 1 ? 'stay' : 'stays'} saved · none booked` : 'no stay yet');

  const next = stops[index + 1];
  if (next) {
    const mode = next.connection?.mode;
    facts.push(`next · ${next.place || 'next stop'}${mode ? ' · ' + mode : ''} · ${BOOKED.includes(next.connection?.status) ? 'booked' : 'connection needed'}`);
  } else facts.push(`last stop · then ${trip.homeCity || 'home'}`);

  const activities = Array.isArray(stop.activities) ? stop.activities.filter(Boolean) : [];
  if (activities.length) facts.push(`${activities.filter(item => item.done).length} of ${activities.length} ideas done`);
  if (visited(stop, today)) facts.push(`souvenir · from ${place}`);
  return facts;
}

// FNV-1a, so a stop keeps its souvenir across reloads and devices.
function hash(value) {
  let h = 0x811c9dc5;
  for (const char of String(value)) { h ^= char.codePointAt(0); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function glyphSVG(rows) {
  const rects = [];
  const top = Math.floor((12 - rows.length) / 2);   // short glyphs sit in the middle of the box
  rows.forEach((row, y) => { for (const run of row.matchAll(/#+/g)) rects.push(`<rect x="${run.index}" y="${y + top}" width="${run[0].length}" height="1"/>`); });
  return `<svg viewBox="0 0 12 12" width="16" height="16" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${rects.join('')}</svg>`;
}

/** The souvenir a visited stop leaves in the backpack: a glyph and colour chosen by its uid. */
export function souvenirFor(stop) {
  const h = hash(stop?.uid);
  const glyph = GLYPH_NAMES[h % GLYPH_NAMES.length];
  return { glyph, color: COLORS[(h >>> 3) % COLORS.length], svg: glyphSVG(GLYPHS[glyph]) };
}
