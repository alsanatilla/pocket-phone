import { storage } from './workspace-storage.js';
import * as trips from './travel-store.js';
import * as sharing from './travel-sharing.js';
import { withTravel } from './pip.js';
import { mapsSearchUrl, mapsDirectionsUrl } from './travel-links.js';
import { stayCoverage, stayTotals, tripCosts, reorderTrip, currentStop } from '../shared/travel-planning.js';
import './travel-workspace.css';

const path = trip => `/travel/${trip.uid}`;
const clone = value => JSON.parse(JSON.stringify(value));
const statuses = { idea: 'saved', shortlist: 'saved', chosen: 'chosen', booked: 'booked', included: 'included' };
const connections = { idea: 'connection needed', shortlist: 'option saved', booked: 'booked', included: 'included' };
const notesOpen = new Map();
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat(Infinity).filter(child => child != null && child !== false));
  return node;
}
const meta = text => el('p', { class: 'travel-meta', text });
const btn = (text, action, props = {}) => el('button', { type: 'button', onclick: action, ...props }, text);
const day = value => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T12:00:00').toLocaleDateString([], { day: 'numeric', month: 'short' }) : 'dates open';
const dates = (from, to) => from && to ? `${day(from)} – ${day(to)}` : from ? `from ${day(from)}` : to ? `until ${day(to)}` : 'dates open';
const money = (value, currency) => value == null || value === '' ? 'price unknown' : new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'EUR', maximumFractionDigits: 2 }).format(value);
const link = (text, url) => {
  try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol)) return null; }
  catch { return null; }
  return el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text });
};
const localDay = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; };
const initials = name => String(name || '?').trim().split(/\s+/u).slice(0, 2).map(part => [...part][0]).join('').toUpperCase();
const overlap = (left, right) => !left.checkIn || !left.checkOut || !right.checkIn || !right.checkOut || left.checkIn < right.checkOut && right.checkIn < left.checkOut;

function coverageText(stop) {
  const cover = stayCoverage(stop);
  if (cover.status === 'unknown') return 'booking dates needed';
  if (!cover.required) return 'no overnight stay';
  if (cover.status === 'overlap') return `${cover.covered}/${cover.required} nights booked · overlapping bookings`;
  if (cover.status === 'covered') return `${cover.covered}/${cover.required} nights booked`;
  return `${cover.covered}/${cover.required} nights booked${cover.unknown ? ' · dates missing' : ''}`;
}
function rememberedDetails(key, label, ...children) {
  return el('details', { class: 'travel-disclosure', open: notesOpen.get(key), ontoggle: event => notesOpen.set(key, event.target.open) }, el('summary', { text: label }), children);
}

export function mountWorkspace(host, trip, route, api, helpers) {
  let alive = true; helpers.cleanup.push(() => { alive = false; });
  const record = trips.getRecord(trip.uid), viewer = record?.role === 'viewer';
  const go = value => helpers.go(api, value);
  const save = value => { try { helpers.saveTrip(value); go(location.hash.slice(1)); } catch (error) { api.say(error.message); } };
  const modeKey = `pocket:travel-view:${trip.uid}`;
  let travelling = route.sub === 'now' || storage.getItem(modeKey) === 'travelling';
  const stays = route.sub === 'stays';
  const today = localDay();
  const active = currentStop(trip, today);
  const automatic = active || trip.stops.find(stop => stop.arrival >= today) || trip.stops.at(-1);
  const selected = trip.stops.find(stop => stop.uid === route.leaf) || (travelling ? automatic : trip.stops[0]);
  const selectedPath = (stop, view = stays ? 'stays' : travelling ? 'now' : 'stop') => `${path(trip)}/${view}/${stop.uid}`;
  const pick = uid => { const stop = trip.stops.find(item => item.uid === uid); if (stop) go(selectedPath(stop)); };
  const ask = action => {
    try { go('/pip/' + withTravel(trip, selected, action)); } catch (error) { api.say(error.message); }
  };
  const key = `${trip.uid}:${selected?.uid || ''}`;
  host.classList.add('travel-workspace');

  const picker = el('select', { 'aria-label': 'Switch trip', onchange: event => go(`/travel/${event.target.value}`) }, trips.readTrips().map(item => el('option', { value: item.uid, text: item.title })));
  picker.value = trip.uid;
  const state = el('span', { class: 'travel-live-state', 'data-travel-state': trip.uid, role: 'status', text: sharing.syncLabel(trip.uid) });
  host.append(el('div', { class: 'travel-crumb' }, btn('‹ trips', () => go('/travel')), picker, state));
  const people = record?.members || [];
  const crew = btn('', () => go(path(trip) + '/share'), { class: 'travel-crew', 'aria-label': 'Share trip' });
  people.slice(0, 3).forEach((person, index) => crew.append(el('span', { class: 'travel-avatar person-' + index, title: person.name, 'aria-hidden': 'true', text: initials(person.name) })));
  crew.append(el('span', { text: people.length > 1 ? people.slice(0, 2).map(person => person.name).join(' · ') + (people.length > 2 ? ` +${people.length - 2}` : '') : 'share trip' }));
  host.append(el('header', { class: 'travel-heading' }, el('div', {}, el('h1', { text: trip.title }), meta(`${dates(trip.departure, trip.returnDate)} · ${trip.stops.length} stops${viewer ? ' · view only' : ''}`)), crew));
  if (record?.conflict) host.append(btn('review changes', () => go(path(trip) + '/conflict'), { class: 'warn travel-conflict-action' }));
  const panelID = stays ? 'travel-stays-panel' : 'travel-route-panel';
  const tabs = el('div', { class: 'travel-view-tabs', role: 'tablist', 'aria-label': 'Trip view' });
  for (const [label, value] of [['Route', 'route'], ['Stays', 'stays']]) {
    const current = stays === (value === 'stays');
    const action = () => go(selected ? selectedPath(selected, value === 'stays' ? 'stays' : travelling ? 'now' : 'stop') : path(trip));
    tabs.append(btn(label, action, { role: 'tab', id: `travel-tab-${value}`, 'aria-selected': String(current), 'aria-controls': current ? panelID : `travel-${value}-panel`, tabindex: current ? 0 : -1,
      onkeydown: event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const target = event.key === 'Home' ? 'route' : event.key === 'End' ? 'stays' : value === 'route' ? 'stays' : 'route'; go(selected ? selectedPath(selected, target === 'stays' ? 'stays' : travelling ? 'now' : 'stop') : path(trip)); setTimeout(() => document.getElementById(`travel-tab-${target}`)?.focus(), 0); } } }));
  }
  const mode = el('select', { 'aria-label': 'Travel view mode', onchange: event => {
    travelling = event.target.value === 'travelling'; storage.setItem(modeKey, event.target.value);
    const stop = travelling ? automatic : selected;
    go(stop ? selectedPath(stop, stays ? 'stays' : travelling ? 'now' : 'stop') : path(trip));
  } }, el('option', { value: 'planning', text: 'Planning' }), el('option', { value: 'travelling', text: 'Travelling' }));
  mode.value = travelling ? 'travelling' : 'planning';
  host.append(el('div', { class: 'travel-view-controls' }, tabs, mode));
  const panel = el('section', { id: panelID, role: 'tabpanel', 'aria-labelledby': stays ? 'travel-tab-stays' : 'travel-tab-route' });
  host.append(panel);
  host.append(el('section', { id: stays ? 'travel-route-panel' : 'travel-stays-panel', role: 'tabpanel', 'aria-labelledby': stays ? 'travel-tab-route' : 'travel-tab-stays', hidden: true }));
  const addStop = () => { if (trip.stops.length >= 80) { api.say('A trip holds up to 80 stops.'); return; } go(path(trip) + '/stop/new'); };
  if (!selected) {
    panel.append(meta('No stops yet.')); if (!viewer) panel.append(btn('+ add stop', addStop));
    if (!viewer) panel.append(btn('trip details', () => go(path(trip) + '/edit')));
    return;
  }
  const destinations = el('nav', { class: 'travel-destinations', 'aria-label': 'Destinations' });
  trip.stops.forEach((stop, index) => {
    const node = btn('', () => pick(stop.uid), { class: 'travel-destination' + (stop.uid === selected.uid ? ' selected' : ''), 'aria-current': stop.uid === selected.uid ? 'location' : 'false', 'aria-label': `Select ${stop.place}` });
    node.append(el('strong', { text: `${index + 1}. ${stop.place}` }), el('span', { text: `${dates(stop.arrival, stop.departure)} · ${stop.nights} nights` })); destinations.append(node);
  });
  const index = trip.stops.findIndex(item => item.uid === selected.uid), next = trip.stops[index + 1];
  const connection = next?.connection || trip.returnJourney;
  const connectionPath = next ? `${path(trip)}/connection/${next.uid}/${selected.uid}` : `${path(trip)}/connection/home/${selected.uid}`;
  const addStay = () => { if (selected.stays.length >= 20) { api.say('A stop holds up to 20 stays.'); return; } go(`${path(trip)}/stay/${selected.uid}`); };
  const stayPath = stay => `${path(trip)}/stay/${selected.uid}/${stay.uid}`;

  function nextBlock() {
    const title = next?.place || trip.homeCity || 'Home';
    const detail = el('div', { class: 'travel-next' }, meta(next ? 'NEXT STOP' : 'HOME'), el('h3', { text: title }), meta(next ? dates(next.arrival, next.departure) : day(connection.date || trip.returnDate)));
    detail.append(el('span', { class: connection.needsReview ? 'warn' : 'travel-connection-state', text: connection.needsReview ? 'connection needs review' : connections[connection.status] }));
    const body = el('div', { class: 'travel-connection-details' }, meta(connection.label || `${selected.place} → ${title}`), meta(`${day(connection.date)}${connection.mode ? ' · ' + connection.mode : ''}`));
    if (connection.reference) body.append(meta('Reference · ' + connection.reference));
    if (connection.cost !== '') body.append(meta(money(connection.cost, connection.currency)));
    body.append(link('booking ↗', connection.url), link('Google Maps ↗', mapsDirectionsUrl(selected, next || { place: trip.homeCity })));
    if (!viewer) body.append(btn('edit connection', () => go(connectionPath)));
    detail.append(rememberedDetails(key + ':connection', 'Connection', body));
    return detail;
  }
  function statusChange(stay, status) {
    const apply = async () => {
      if (status === 'booked' && !await api.confirm(`Mark ${stay.name} as booked?`, 'mark booked')) return;
      const value = clone(trip), stop = value.stops.find(item => item.uid === selected.uid);
      stop.stays = stop.stays.map(item => item.uid === stay.uid ? { ...item, status } : status === 'chosen' && item.status === 'chosen' && overlap(item, stay) ? { ...item, status: 'shortlist' } : item);
      save(value);
    };
    apply().catch(error => api.say(error.message));
  }
  function stayRow(stay) {
    const details = el('div', { class: 'travel-booking-details' }, meta(`${dates(stay.checkIn, stay.checkOut)} · ${stay.kind}`));
    if (stay.address) details.append(meta(stay.address), link('Google Maps ↗', mapsSearchUrl({ place: stay.address, country: selected.country })));
    if (stay.bookingRef) details.append(meta('Reference · ' + stay.bookingRef));
    if (stay.note) details.append(meta(stay.note));
    if (stay.rating) details.append(meta(`Your rating · ${stay.rating}/5`));
    details.append(link('property / booking ↗', stay.url));
    const actions = el('div', { class: 'travel-stay-actions' });
    if (!viewer) {
      if (['idea', 'shortlist'].includes(stay.status)) actions.append(btn('choose', () => statusChange(stay, 'chosen')));
      if (stay.status === 'chosen') actions.append(btn('mark booked', () => statusChange(stay, 'booked')), btn('unchoose', () => statusChange(stay, 'shortlist')));
      actions.append(btn('edit', () => go(stayPath(stay))));
    }
    return el('article', { class: 'travel-option' },
      el('div', { class: 'travel-option-top' }, el('h3', { text: stay.name }), el('strong', { class: 'travel-price', text: money(stayTotals(stay, selected), stay.currency) })),
      el('div', { class: 'travel-option-meta' }, el('span', { class: ['chosen', 'booked', 'included'].includes(stay.status) ? 'travel-stay-confirmed' : '', text: statuses[stay.status] }),
        el('span', { text: stay.address || 'location unknown' }), el('span', { text: stay.cancelBy ? 'cancel by ' + day(stay.cancelBy) : 'cancellation unknown' })),
      actions, rememberedDetails(key + ':' + stay.uid, 'Details', details));
  }

  if (stays) {
    panel.append(destinations, el('div', { class: 'travel-stays-heading' }, el('div', {}, el('h2', { text: selected.place }), meta(coverageText(selected))), !viewer ? btn('+ stay', addStay) : null));
    if (selected.stays.length) selected.stays.forEach(stay => panel.append(stayRow(stay)));
    else panel.append(meta('No stays saved.'));
    const actions = el('div', { class: 'travel-secondary-actions' }, btn('find stays with Pip', () => ask('find')));
    if (selected.stays.length > 1) {
      const columns = ['Stay', 'Total', 'Location', 'Cancellation', 'Status'];
      const table = el('table', {}, el('caption', { class: 'sr-only', text: 'Stay comparison for ' + selected.place }), el('thead', {}, el('tr', {}, columns.map(text => el('th', { scope: 'col', text })))), el('tbody', {}, selected.stays.map(stay => el('tr', {}, [stay.name, money(stayTotals(stay, selected), stay.currency), stay.address || 'unknown', stay.cancelBy ? day(stay.cancelBy) : 'unknown', statuses[stay.status]].map(text => el('td', { text }))))));
      panel.append(rememberedDetails(key + ':compare', 'Compare stays', el('div', { class: 'travel-comparison', tabindex: 0, role: 'region', 'aria-label': 'Stay comparison' }, table)));
      actions.append(btn('compare with Pip', () => ask('compare')));
    }
    panel.append(actions);
  } else {
    if (!travelling) {
      const map = el('div', { class: 'travel-route-map', 'aria-busy': 'true' }); panel.append(map);
      import('./travel-map.js').then(({ mountRouteMap }) => {
        if (!alive || !map.isConnected) return;
        helpers.cleanup.push(mountRouteMap(map, trip, selected.uid, pick)); map.setAttribute('aria-busy', 'false');
      }).catch(() => { if (alive && map.isConnected) { map.setAttribute('aria-busy', 'false'); map.append(meta('Map unavailable.')); } });
    }
    panel.append(destinations);
    const confirmed = selected.stays.filter(stay => ['booked', 'included'].includes(stay.status));
    const chosen = selected.stays.filter(stay => stay.status === 'chosen');
    const coversToday = stay => stay.checkIn && stay.checkOut && stay.checkIn <= today && stay.checkOut > today;
    const here = travelling && active?.uid === selected.uid;
    const accommodation = confirmed.find(coversToday) || (here ? confirmed.find(stay => !stay.checkIn || !stay.checkOut) || chosen.find(coversToday) : confirmed[0] || chosen[0]);
    const summary = el('div', { class: 'travel-selected-stop' },
      meta(travelling ? active?.uid === selected.uid ? 'HERE NOW' : selected.arrival > today ? 'UPCOMING' : 'STOP' : selected.country), el('h2', { text: selected.place }), meta(`${dates(selected.arrival, selected.departure)} · ${selected.nights} nights`),
      accommodation ? el('h3', { class: 'travel-bed-name', text: accommodation.name }) : meta(here ? 'No booking for tonight' : selected.stays.length ? `${selected.stays.length} stays saved` : 'No stay yet'),
      el('p', { class: 'travel-coverage' + (stayCoverage(selected).status === 'covered' ? ' covered' : ''), text: coverageText(selected) }));
    if (travelling && accommodation) {
      summary.append(meta(statuses[accommodation.status]));
      if (accommodation.address) summary.append(meta(accommodation.address), link('Google Maps ↗', mapsSearchUrl({ place: accommodation.address, country: selected.country })));
      if (accommodation.bookingRef) summary.append(meta('Reference · ' + accommodation.bookingRef));
      summary.append(link('booking ↗', accommodation.url));
    }
    summary.append(btn('stays', () => go(selectedPath(selected, 'stays'))), link('Google Maps ↗', mapsSearchUrl(selected)));
    if (!viewer) summary.append(btn('edit stop', () => go(`${path(trip)}/stop/${selected.uid}/edit`)));
    const arrival = selected.connection;
    if (arrival.needsReview || arrival.reference || arrival.url || ['booked', 'included'].includes(arrival.status)) {
      const body = el('div', { class: 'travel-connection-details' }, meta(arrival.label || 'Arrival'), meta(day(arrival.date)));
      if (arrival.reference) body.append(meta('Reference · ' + arrival.reference));
      body.append(link('booking ↗', arrival.url));
      if (!viewer) body.append(btn('edit connection', () => go(`${path(trip)}/connection/${selected.uid}/${selected.uid}`)));
      const detail = rememberedDetails(key + ':arrival', arrival.needsReview ? 'Arrival connection · needs review' : 'Arrival connection', body);
      if (arrival.needsReview) detail.classList.add('needs-review');
      summary.append(detail);
    }
    panel.append(el('div', { class: 'travel-stop-panel' }, summary, nextBlock()));
    if (!viewer) {
      const reorder = el('div', { class: 'travel-order-editor' });
      for (const [to, label] of [[index - 1, 'move earlier'], [index + 1, 'move later']]) reorder.append(btn(label, async () => {
        try {
          const preview = reorderTrip(trip, selected.uid, to);
          const changed = preview.affected.map(uid => trip.stops.find(stop => stop.uid === uid)?.place).filter(Boolean);
          const summary = [changed.length ? 'Connections to review: ' + changed.join(', ') : '', ...preview.issues.map(issue => issue.message)].filter(Boolean).join('\n');
          if (!await api.confirm(`Move ${selected.place}?${summary ? '\n\n' + summary : ''}`, 'move stop')) return;
          save(preview.trip);
        } catch (error) { api.say(error.message); }
      }, { disabled: to < 0 || to >= trip.stops.length }));
      panel.append(el('div', { class: 'travel-secondary-actions' }, btn('+ add stop', addStop), btn('next stop with Pip', () => ask('next')), rememberedDetails(key + ':order', 'Edit route', reorder)));
    }
  }
  const costs = tripCosts(trip);
  const details = el('div', { class: 'travel-trip-details' });
  if (costs.currencies.length) for (const total of costs.currencies) details.append(meta(`${money(total.total, total.currency)}${total.unknownStays + total.unknownConnections ? ' · some prices unknown' : ''}`));
  else details.append(meta('No selected costs yet.'));
  if (trip.budget !== '') details.append(meta('Budget · ' + money(trip.budget, trip.currency)));
  if (trip.intention) details.append(meta(trip.intention));
  if (trip.returnPlan) details.append(meta(trip.returnPlan));
  if (!viewer) details.append(btn('edit trip details', () => go(path(trip) + '/edit')));
  panel.append(rememberedDetails(trip.uid + ':details', 'Trip details', details));
  const extras = el('div', { class: 'travel-extra-content' });
  if (selected.guidance) extras.append(meta(selected.guidance));
  for (const activity of selected.activities) extras.append(el('label', { class: 'travel-idea' }, el('input', { type: 'checkbox', checked: activity.done, disabled: viewer, onchange: event => {
    const value = clone(trip); value.stops.find(item => item.uid === selected.uid).activities.find(item => item.uid === activity.uid).done = event.target.checked; save(value);
  } }), el('span', { text: activity.text })));
  for (const moment of selected.moments) extras.append(el('article', { class: 'travel-moment-note' }, el('h3', { text: moment.title }), meta(moment.detail), meta(day(moment.day))));
  if (!viewer) extras.append(btn('+ moment', () => go(`${path(trip)}/moment/${selected.uid}`)));
  if (selected.guidance || selected.activities.length || selected.moments.length || !viewer) panel.append(rememberedDetails(key + ':notes', 'Ideas & notes', extras));
}
