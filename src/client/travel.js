import { activeAccount } from './workspace-storage.js';
import * as travelStore from './travel-store.js';
import * as sharing from './travel-sharing.js';
import { mountWorkspace } from './travel-workspace.js';
import { daysBetween, addDays, removeStop } from '../shared/travel-planning.js';
import { locationPicker } from './travel-location-picker.js';

let cleanup = [], editBase = null, editRevision = null, epoch = 0;
export function leave() { epoch++; cleanup.forEach(stop => stop()); cleanup = []; editBase = null; editRevision = null; travelStore.stopLive(); }
const MAX_ACTIVITIES = 60;
const MAX_MOMENTS = 100;
const CURRENCIES = ['EUR', 'USD', 'PEN', 'BOB', 'CLP', 'BRL'];
const STOP_CURRENCY = { Peru: 'PEN', Bolivien: 'BOB', Chile: 'CLP', Brasilien: 'BRL' };
const STAY_STATUS = { idea: 'saved', shortlist: 'shortlist', chosen: 'chosen', booked: 'booked', included: 'included' };
const TRANSFER_STATUS = { idea: 'to figure out', shortlist: 'option saved', booked: 'booked', included: 'in the tour' };
const STAY_KIND = { hotel: 'hotel', guesthouse: 'guesthouse', apartment: 'apartment', hostel: 'hostel', tour: 'tour lodging', camp: 'camp', other: 'somewhere else' };
const MOMENTS = { detour: '↗', taste: '✳', sound: '♫', person: '⌂', tiny: '·', weather: '☼', other: '✷' };
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  if (tag === 'form') node.addEventListener('invalid', event => {
    let ancestor = event.target.parentElement;
    while (ancestor && ancestor !== node) { if (ancestor.tagName === 'DETAILS') ancestor.open = true; ancestor = ancestor.parentElement; }
  }, true);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat(Infinity).filter(child => child != null && child !== false));
  return node;
}
const button = (label, onclick, attrs = {}, ...children) => el('button', { onclick, ...attrs }, label, children);

const starter = {
  uid: 'south-america-2028', title: 'SÜDAMERIKA 2028', status: 'draft',
  departure: '2028-01-03', returnDate: '2028-01-29', homeArrival: '2028-01-30', homeCity: 'München',
  countries: 'Peru · Bolivien · Chile · Brasilien', travelers: '', currency: 'EUR', budget: '',
  intention: 'A varied loop for nature, a few cities, one or two bigger hikes at most, and four easy nights by the sea.',
  returnPlan: 'Ilha Grande → transfer to Rio de Janeiro airport → return flight to München. Leave a generous transfer buffer. If the Rio flight leaves early, sleep in Rio on the night of 28 January instead.',
  returnJourney: { label: 'Ilha Grande → Rio airport → return flight to München', date: '2028-01-29', url: '', cost: '', currency: 'BRL', status: 'idea', reference: '' },
  stops: [
    {
      uid: 'lima', place: 'Lima', country: 'Peru', arrival: '2028-01-04', departure: '2028-01-06', nights: 2, currency: 'PEN',
      guidance: 'A quiet landing after the long-haul flight. Start gently.', activities: [
        'Arrive and take it slow after the long-haul flight', 'Miraflores and the coastal promenade', 'Barranco · cafés and good food',
      ], stays: [], moments: [],
      connection: { mode: 'flight', label: 'Long-haul flight · München → Lima', date: '2028-01-03', url: '', cost: '', currency: 'EUR', status: 'idea', reference: '' },
    },
    {
      uid: 'cusco', place: 'Cusco', country: 'Peru', arrival: '2028-01-06', departure: '2028-01-11', nights: 5, currency: 'PEN',
      guidance: 'Altitude adjustment first. Keep the first days easy and protect one buffer day.', activities: [
        'First days slow · get used to the altitude', 'Old town and markets', 'Day trip into the Sacred Valley', 'One free buffer day',
        'OPTIONAL · choose just one bigger hike: Rainbow Mountain or Humantay Lake',
      ], stays: [], moments: [],
      connection: { mode: 'flight', label: 'Regional flight / onward connection', date: '2028-01-06', url: '', cost: '', currency: 'PEN', status: 'idea', reference: '' },
    },
    {
      uid: 'aguas-calientes', place: 'Aguas Calientes', country: 'Peru', arrival: '2028-01-11', departure: '2028-01-12', nights: 1, currency: 'PEN',
      guidance: 'Coordinate the train, Machu Picchu entry and this one-night stay as a single plan.', activities: [
        'Train to Aguas Calientes', 'Machu Picchu the next day', 'Continue onward toward Arequipa',
      ], stays: [], moments: [],
      connection: { mode: 'train', label: 'Train to Aguas Calientes', date: '2028-01-11', url: '', cost: '', currency: 'PEN', status: 'idea', reference: '' },
    },
    {
      uid: 'arequipa', place: 'Arequipa', country: 'Peru', arrival: '2028-01-12', departure: '2028-01-15', nights: 3, currency: 'PEN',
      guidance: 'An optional day trip or a deliberate rest day both fit.', activities: [
        'Old town and Santa Catalina monastery', 'Viewpoints and an unhurried city walk', 'Optional day trip · or a proper rest day',
      ], stays: [], moments: [],
      connection: { mode: 'transfer', label: 'Continue after Machu Picchu / Aguas Calientes', date: '2028-01-12', url: '', cost: '', currency: 'PEN', status: 'idea', reference: '' },
    },
    {
      uid: 'la-paz', place: 'La Paz', country: 'Bolivien', arrival: '2028-01-15', departure: '2028-01-17', nights: 2, currency: 'BOB',
      guidance: 'Another high-altitude stop. Keep the first day spacious.', activities: [
        'Cable-car network · see the city from above', 'Market area and a short city stroll', 'OPTIONAL · Valle de la Luna',
      ], stays: [], moments: [],
      connection: { mode: 'flight', label: 'Regional flight / border connection', date: '2028-01-15', url: '', cost: '', currency: 'BOB', status: 'idea', reference: '' },
    },
    {
      uid: 'uyuni-tour', place: 'Uyuni-Tour', country: 'Bolivien', arrival: '2028-01-17', departure: '2028-01-20', nights: 3, currency: 'BOB',
      guidance: 'The overnight stays are normally part of the multi-day tour. Don’t book separate hotels for these nights until the operator confirms otherwise.', activities: [
        'Three-day tour across the salt flats', 'Lagoons, flamingos and volcano landscapes', 'January may bring the famous mirror effect', 'Check which meals and overnight stays the tour includes',
      ],
      stays: [{ uid: 'uyuni-included-stay', name: 'Tour lodging · confirm with operator', kind: 'tour', url: '', rating: 0, status: 'included', nightlyCost: '', totalCost: '', currency: 'BOB', checkIn: '2028-01-17', checkOut: '2028-01-20', cancelBy: '', bookingRef: '', address: '', note: 'The tour normally includes these three nights; confirm the exact accommodation and what is included.' }],
      moments: [], connection: { mode: 'tour', label: 'Start the 3-night Uyuni tour', date: '2028-01-17', url: '', cost: '', currency: 'BOB', status: 'idea', reference: '' },
    },
    {
      uid: 'san-pedro', place: 'San Pedro de Atacama', country: 'Chile', arrival: '2028-01-20', departure: '2028-01-23', nights: 3, currency: 'CLP',
      guidance: 'Uyuni and Atacama mean early starts, long drives and high altitude. Pack warm layers; leave the daily order flexible.', activities: [
        'Valle de la Luna at sunset', 'Altiplano lagoons and flamingos', 'Geysers before sunrise', 'OPTIONAL · night-sky tour',
      ], stays: [], moments: [],
      connection: { mode: 'tour', label: 'Uyuni tour ends in San Pedro de Atacama', date: '2028-01-20', url: '', cost: '', currency: 'CLP', status: 'idea', reference: '' },
    },
    {
      uid: 'rio', place: 'Rio de Janeiro', country: 'Brasilien', arrival: '2028-01-23', departure: '2028-01-25', nights: 2, currency: 'BRL',
      guidance: 'Intentionally short: enough for the big views, without turning the city into a checklist.', activities: [
        'Christ the Redeemer and the viewpoints', 'Sugarloaf Mountain', 'Copacabana or Ipanema',
      ], stays: [], moments: [],
      connection: { mode: 'flight', label: 'Check Calama / Atacama → Rio connection', date: '2028-01-23', url: '', cost: '', currency: 'BRL', status: 'idea', reference: '' },
    },
    {
      uid: 'ilha-grande', place: 'Ilha Grande', country: 'Brasilien', arrival: '2028-01-25', departure: '2028-01-29', nights: 4, currency: 'BRL',
      guidance: 'Car-free island: keep luggage compact. Leave at least one full day without a plan.', activities: [
        'Arrive and properly slow down', 'Boat trip to coves and beaches', 'Snorkel or kayak, if you feel like it', 'One whole day with absolutely no fixed plan',
      ], stays: [], moments: [],
      connection: { mode: 'ferry', label: 'Transfer from Rio · road + boat', date: '2028-01-25', url: '', cost: '', currency: 'BRL', status: 'idea', reference: '' },
    },
  ],
  moments: [], created: Date.now(), updated: Date.now(),
};

const has = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const id = () => globalThis.crypto?.randomUUID?.() || `trip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
const isDay = value => !value || typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(value + 'T12:00:00').getTime());
const cleanCurrency = value => CURRENCIES.includes(value) ? value : 'EUR';
const plainClone = value => JSON.parse(JSON.stringify(value));

function readTrips() {
  return travelStore.readTrips(activeAccount() ? undefined : starter);
}
function saveTrip(value) {
  return travelStore.saveTrip(value, editBase?.uid === value.uid ? editBase : undefined);
}
function saveAndReturn(trip, api, path) {
  try { saveTrip(trip); go(api, path); }
  catch (error) { api.say(error.message); }
}
function go(api, path) {
  const next = '#' + path;
  if (location.hash === next) dispatchEvent(new Event('hashchange'));
  else api.go(path);
}
const routePath = uid => `/travel/${uid}`;
const stopPath = (trip, stop) => `${routePath(trip.uid)}/stop/${stop.uid}`;
const dateObject = value => {
  if (!value || !isDay(value)) return null;
  const [year, month, day] = value.split('-').map(Number); return new Date(year, month - 1, day);
};
const dateLabel = (value, options = { day: 'numeric', month: 'short' }) => dateObject(value)?.toLocaleDateString([], options) || 'date tbc';
const dateRange = (start, end) => {
  if (!start && !end) return 'date tbc';
  if (!end || start === end) return dateLabel(start || end, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${dateLabel(start)} — ${dateLabel(end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
};
const currencySelect = (label, value) => {
  const field = el('select', { 'aria-label': label }, ...CURRENCIES.map(code => el('option', { value: code, text: code })));
  field.value = cleanCurrency(value); return field;
};
const options = (labels, value, label) => {
  const control = el('select', { 'aria-label': label }, ...Object.entries(labels).map(([key, text]) => el('option', { value: key, text })));
  control.value = has(labels, value) ? value : Object.keys(labels)[0]; return control;
};
function field(labelText, control, hint = '') {
  return el('label', { class: 'travel-field' }, el('span', { text: labelText }), control);
}
function textInput(label, value, placeholder = '', attrs = {}) {
  const input = el('input', { type: 'text', 'aria-label': label, placeholder, ...attrs }); input.value = value ?? ''; return input;
}
function numberInput(label, value, attrs = {}) {
  const input = el('input', { type: 'number', min: 0, step: '0.01', 'aria-label': label, ...attrs }); input.value = value ?? ''; return input;
}
function textArea(label, value, placeholder = '', rows = 3, limit = 900) {
  const area = el('textarea', { 'aria-label': label, maxlength: limit, placeholder, rows }); area.value = value || ''; return area;
}
function formHeading(kicker, title, sub) {
  return el('div', { class: 'travel-form-heading' }, el('h2', { class: 'travel-editor-title', text: title }));
}
const moreFields = (label, ...children) => el('details', { class: 'travel-disclosure' }, el('summary', { text: label }), children);
function commitButton(label) { return el('button', { type: 'submit', class: 'travel-commit', text: label }); }
function tripEditor(host, trip, api) {
  const fresh = !trip;
  const current = trip ? plainClone(trip) : { uid: id(), title: '', departure: '', returnDate: '', homeArrival: '', homeCity: '', countries: '', travelers: '', currency: 'EUR', budget: '', intention: '', returnPlan: '', returnJourney: { label: '', date: '', url: '', cost: '', currency: 'EUR', status: 'idea', reference: '' }, stops: [], moments: [], created: Date.now() };
  const title = textInput('Trip name', current.title, 'Two weeks of taking the long way', { maxlength: 100, required: true });
  const departure = el('input', { type: 'date', 'aria-label': 'Leaving home' }); departure.value = current.departure || '';
  const returnDate = el('input', { type: 'date', 'aria-label': 'Leaving the last stop' }); returnDate.value = current.returnDate || '';
  const homeArrival = el('input', { type: 'date', 'aria-label': 'Arriving home' }); homeArrival.value = current.homeArrival || '';
  const homeCity = textInput('Starting from', current.homeCity, 'München', { maxlength: 100 });
  const countries = textInput('Countries', current.countries, 'Peru · Bolivia · Chile', { maxlength: 180 });
  const travelers = textInput('Travel crew', current.travelers, 'Just the two of us', { maxlength: 160 });
  const currency = currencySelect('Default currency', current.currency);
  const budget = numberInput('Budget target', current.budget);
  const intention = textArea('The feeling of this trip', current.intention, 'What are you hoping this trip feels like?', 3, 900);
  const returnPlan = textArea('The way home', current.returnPlan, 'Ferry, transfer, flight, buffer…', 3, 900);
  const returnJourney = current.returnJourney || {};
  const returnLabel = textInput('Return connection', returnJourney.label, 'Ilha Grande → Rio airport → München');
  const returnUrl = el('input', { type: 'url', 'aria-label': 'Return booking link', placeholder: 'https://…' }); returnUrl.value = returnJourney.url || '';
  const returnCost = numberInput('Return transfer cost', returnJourney.cost);
  const returnCurrency = currencySelect('Return currency', returnJourney.currency || 'BRL');
  const returnStatus = options(TRANSFER_STATUS, returnJourney.status || 'idea', 'Return booking status');
  const returnDateInput = el('input', { type: 'date', 'aria-label': 'Return travel date' }); returnDateInput.value = returnJourney.date || current.returnDate || '';
  const form = el('form', { class: 'travel-form', onsubmit: event => {
    event.preventDefault(); if (!form.reportValidity()) return;
    if (departure.value && returnDate.value && returnDate.value < departure.value) { returnDate.setCustomValidity('Choose a return date after you leave.'); returnDate.reportValidity(); returnDate.setCustomValidity(''); return; }
    try {
      const saved = saveTrip({ ...current, title: title.value, departure: departure.value, returnDate: returnDate.value, homeArrival: homeArrival.value,
        homeCity: homeCity.value, countries: countries.value, travelers: travelers.value, currency: currency.value, budget: budget.value,
        intention: intention.value, returnPlan: returnPlan.value,
        returnJourney: { ...returnJourney, label: returnLabel.value, date: returnDateInput.value, url: returnUrl.value, cost: returnCost.value, currency: returnCurrency.value, status: returnStatus.value, reference: returnJourney.reference || '' } });
      go(api, routePath(saved.uid));
    } catch (error) { api.say(error.message); }
  } },
    el('div', { class: 'travel-form-grid' }, field('TRIP NAME', title), field('FROM', homeCity), field('START', departure), field('END', returnDate)),
    moreFields('More details', el('div', { class: 'travel-form-grid' }, field('HOME ARRIVAL', homeArrival), field('COUNTRIES', countries), field('TRAVELERS', travelers), field('CURRENCY', currency), field('BUDGET', budget)),
      field('NOTES', intention), field('RETURN NOTES', returnPlan)),
    moreFields('Journey home', field('RETURN ROUTE', returnLabel), el('div', { class: 'travel-form-grid' }, field('DATE', returnDateInput), field('BOOKING LINK', returnUrl),
        field('COST', returnCost), field('CURRENCY', returnCurrency), field('STATUS', returnStatus))),
    el('div', { class: 'travel-form-actions' }, commitButton(fresh ? 'save this trip' : 'save trip changes')));
  host.append(button(fresh ? '‹ travel' : '‹ trip route', () => go(api, fresh ? '/travel' : routePath(current.uid)), { class: 'travel-back' }),
    formHeading('', fresh ? 'New trip' : current.title, ''), form);
  if (!fresh && travelStore.getRecord(current.uid)?.role === 'owner') host.append(el('button', { class: 'travel-delete', text: 'delete trip', onclick: async () => {
    if (!await api.confirm('Delete this trip for everyone sharing it?', 'delete')) return;
    try { travelStore.deleteTrip(current.uid, editRevision); go(api, '/travel'); } catch (error) { api.say(error.message); }
  } }));
}

function blankStop(trip, previous) {
  return { uid: id(), place: '', country: '', arrival: '', departure: '', nights: 1, currency: trip.currency || 'EUR', guidance: '', activities: [], stays: [], moments: [],
    connection: { mode: 'transfer', label: '', date: '', url: '', cost: '', currency: previous?.currency || trip.currency || 'EUR', status: 'idea', reference: '' } };
}
function stopEditor(host, trip, stop, api) {
  if (!stop && trip.stops.length >= 80) { api.say('A trip holds up to 80 stops.'); go(api, routePath(trip.uid)); return; }
  const index = stop ? trip.stops.findIndex(item => item.uid === stop.uid) : trip.stops.length;
  const previous = index > 0 ? trip.stops[index - 1] : null;
  const current = stop ? plainClone(stop) : blankStop(trip, previous);
  const place = textInput('Place', current.place, 'Cusco', { maxlength: 140, required: true });
  const country = textInput('Country', current.country, 'Peru', { maxlength: 80, required: true });
  const locateHost = el('div');
  const locate = locationPicker(locateHost, () => ({ place: place.value, country: country.value }), current.location, api, cleanup);
  place.addEventListener('input', locate.clear); country.addEventListener('input', locate.clear);
  const arrival = el('input', { type: 'date', 'aria-label': 'Arrival date' }); arrival.value = current.arrival || '';
  const departure = el('input', { type: 'date', 'aria-label': 'Departure date' }); departure.value = current.departure || '';
  const nights = el('input', { type: 'number', min: 0, max: 90, step: 1, 'aria-label': 'Nights' }); nights.value = String(current.nights ?? 1);
  const alignDates = () => { if (arrival.value && nights.value !== '') departure.value = addDays(arrival.value, Number(nights.value)); };
  arrival.addEventListener('change', alignDates); nights.addEventListener('change', alignDates);
  departure.addEventListener('change', () => { const count = daysBetween(arrival.value, departure.value); if (count != null && count >= 0) nights.value = count; });
  const currency = currencySelect('Local currency', current.currency || STOP_CURRENCY[current.country]);
  const guidance = textArea('Local note', current.guidance, 'A practical reminder for this stop…', 3, 700);
  const activities = textArea('Activity ideas', current.activities.map(item => item.text).join('\n'), 'One idea per line. Keep an empty afternoon if you want one.', 6, 4000);
  const connection = current.connection || {};
  const mode = options({ flight: 'flight', train: 'train', bus: 'bus', ferry: 'ferry / boat', transfer: 'road transfer', tour: 'tour transfer', other: 'other' }, connection.mode || 'transfer', 'Arrival transport kind');
  const connectionLabel = textInput('Arrival connection', connection.label, previous ? `${previous.place} → ${current.place}` : `${trip.homeCity || 'home'} → ${current.place}`, { maxlength: 160 });
  const connectionDate = el('input', { type: 'date', 'aria-label': 'Connection date' }); connectionDate.value = connection.date || arrival.value;
  const connectionUrl = el('input', { type: 'url', 'aria-label': 'Connection booking link', placeholder: 'https://…' }); connectionUrl.value = connection.url || '';
  const connectionCost = numberInput('Connection cost', connection.cost);
  const connectionCurrency = currencySelect('Connection currency', connection.currency || current.currency);
  const connectionStatus = options(TRANSFER_STATUS, connection.status || 'idea', 'Connection status');
  const reference = textInput('Connection booking code', connection.reference, 'Booking reference', { maxlength: 120 });
  const form = el('form', { class: 'travel-form', onsubmit: event => {
    event.preventDefault(); if (!form.reportValidity()) return;
    if (arrival.value && departure.value && departure.value < arrival.value) { departure.setCustomValidity('Departure needs to be on or after arrival.'); departure.reportValidity(); departure.setCustomValidity(''); return; }
    const datedNights = daysBetween(arrival.value, departure.value);
    if (datedNights != null && datedNights !== Number(nights.value)) { api.say('Check the dates and number of nights.'); return; }
    if (activities.value.split('\n').map(value => value.trim()).filter(Boolean).length > MAX_ACTIVITIES) { api.say('A stop holds up to 60 ideas.'); return; }
    const ideasByText = new Map(current.activities.map(item => [item.text, item]));
    const ideas = activities.value.split('\n').map(value => value.trim()).filter(Boolean).slice(0, MAX_ACTIVITIES).map(value => ({ ...(ideasByText.get(value) || { uid: id(), done: false }), text: value }));
    const updated = { ...current, place: place.value, country: country.value, location: locate.value(), arrival: arrival.value, departure: departure.value,
      nights: Number(nights.value), currency: currency.value, guidance: guidance.value, activities: ideas,
      connection: { ...connection, mode: mode.value, label: connectionLabel.value, date: connectionDate.value, url: connectionUrl.value,
        cost: connectionCost.value, currency: connectionCurrency.value, status: connectionStatus.value, reference: reference.value } };
    const stops = [...trip.stops]; if (stop) stops[index] = updated; else stops.push(updated);
    saveAndReturn({ ...trip, stops }, api, stopPath(trip, updated));
  } },
    el('div', { class: 'travel-form-grid' }, field('DESTINATION', place), field('COUNTRY', country), field('NIGHTS', nights), field('ARRIVAL', arrival), field('DEPARTURE', departure)),
    locateHost,
    moreFields('Ideas & notes', field('CURRENCY', currency), field('NOTES', guidance), field('IDEAS', activities)),
    moreFields('Arrival connection',
      el('div', { class: 'travel-form-grid' }, field('TYPE OF CONNECTION', mode), field('ROUTE / OPERATOR', connectionLabel), field('TRAVEL DATE', connectionDate), field('BOOKING LINK', connectionUrl), field('COST', connectionCost), field('CURRENCY', connectionCurrency), field('STATUS', connectionStatus), field('BOOKING REFERENCE', reference))),
    el('div', { class: 'travel-form-actions' }, commitButton(stop ? 'save stop' : 'add stop')));
  host.append(button(stop ? '‹ waypoint' : '‹ trip route', () => go(api, stop ? stopPath(trip, stop) : routePath(trip.uid)), { class: 'travel-back' }),
    formHeading('', stop ? current.place : 'Add stop', ''), form);
  if (stop) host.append(el('button', { class: 'travel-delete', text: 'remove this waypoint', onclick: async () => {
    if (!await api.confirm(`Remove ${current.place} and its hotel options from this trip?`, 'remove')) return;
    saveAndReturn(removeStop(trip, stop.uid).trip, api, routePath(trip.uid));
  } }));
}

function stayEditor(host, trip, stop, stay, api) {
  if (!stay && stop.stays.length >= 20) { api.say('A stop holds up to 20 stays.'); go(api, `${routePath(trip.uid)}/stays/${stop.uid}`); return; }
  const fresh = !stay;
  const current = stay ? plainClone(stay) : { uid: id(), name: '', kind: 'hotel', url: '', rating: 0, status: 'idea', nightlyCost: '', totalCost: '', currency: stop.currency, checkIn: stop.arrival, checkOut: stop.departure, cancelBy: '', bookingRef: '', address: '', note: '' };
  const name = textInput('Property name', current.name, 'The tiny hotel with the rooftop plants', { maxlength: 140, required: true });
  const kind = options(STAY_KIND, current.kind, 'Accommodation type');
  const url = el('input', { type: 'url', 'aria-label': 'Booking link', placeholder: 'https://…' }); url.value = current.url || '';
  const rating = options({ 0: 'not rated yet', 1: '★☆☆☆☆ · one out of five', 2: '★★☆☆☆ · two out of five', 3: '★★★☆☆ · three out of five', 4: '★★★★☆ · four out of five', 5: '★★★★★ · five out of five' }, String(current.rating || 0), 'Your rating');
  const status = options(STAY_STATUS, current.status, 'Stay booking status');
  const nightly = numberInput('Price per night', current.nightlyCost);
  const total = numberInput('Whole stay total', current.totalCost);
  const currency = currencySelect('Price currency', current.currency || stop.currency);
  const checkIn = el('input', { type: 'date', 'aria-label': 'Check in' }); checkIn.value = current.checkIn || '';
  const checkOut = el('input', { type: 'date', 'aria-label': 'Check out' }); checkOut.value = current.checkOut || '';
  const cancelBy = el('input', { type: 'date', 'aria-label': 'Free cancellation date' }); cancelBy.value = current.cancelBy || '';
  const reference = textInput('Booking reference', current.bookingRef, 'Reservation code', { maxlength: 120 });
  const address = textInput('Address', current.address, 'Street, neighborhood, pin for the taxi', { maxlength: 240 });
  const locateHost = el('div');
  const locate = locationPicker(locateHost, () => ({ place: address.value, country: stop.country }), current.location, api, cleanup);
  address.addEventListener('input', locate.clear);
  const note = textArea('Stay note', current.note, 'Room request, cancellation terms, who owes whom…', 3, 800);
  const form = el('form', { class: 'travel-form', onsubmit: event => {
    event.preventDefault(); if (!form.reportValidity()) return;
    if (checkIn.value && checkOut.value && checkOut.value < checkIn.value) { checkOut.setCustomValidity('Check-out needs to be on or after check-in.'); checkOut.reportValidity(); checkOut.setCustomValidity(''); return; }
    const updated = { ...current, name: name.value, kind: kind.value, url: url.value, rating: Number(rating.value), status: status.value,
      nightlyCost: nightly.value, totalCost: total.value, currency: currency.value, checkIn: checkIn.value, checkOut: checkOut.value,
      cancelBy: cancelBy.value, bookingRef: reference.value, address: address.value, note: note.value, location: locate.value() };
    const stops = trip.stops.map(item => item.uid !== stop.uid ? item : { ...item, stays: fresh ? [...item.stays, updated] : item.stays.map(old => old.uid === stay.uid ? updated : old) });
    saveAndReturn({ ...trip, stops }, api, `${routePath(trip.uid)}/stays/${stop.uid}`);
  } },
    el('div', { class: 'travel-form-grid' }, field('NAME', name), field('LINK', url), field('TOTAL PRICE', total), field('CURRENCY', currency), field('STATUS', status), field('CHECK-IN', checkIn), field('CHECK-OUT', checkOut)),
    moreFields('Booking details', el('div', { class: 'travel-form-grid' }, field('PRICE PER NIGHT', nightly), field('TYPE', kind), field('CANCEL BY', cancelBy), field('REFERENCE', reference)), field('ADDRESS', address), locateHost, field('NOTES', note), field('YOUR RATING', rating)),
    el('div', { class: 'travel-form-actions' }, commitButton('save stay')));
  host.append(button('‹ stays', () => go(api, `${routePath(trip.uid)}/stays/${stop.uid}`), { class: 'travel-back' }),
    formHeading('', fresh ? 'Add stay · ' + stop.place : current.name, ''), form);
  if (!fresh) host.append(el('button', { class: 'travel-delete', text: 'remove this stay', onclick: async () => {
    if (!await api.confirm(`Remove ${current.name} from ${stop.place}?`, 'remove')) return;
    const stops = trip.stops.map(item => item.uid === stop.uid ? { ...item, stays: item.stays.filter(old => old.uid !== stay.uid) } : item);
    saveAndReturn({ ...trip, stops }, api, `${routePath(trip.uid)}/stays/${stop.uid}`);
  } }));
}

function connectionEditor(host, trip, stop, returnStop, api) {
  const returning = !stop, connection = stop?.connection || trip.returnJourney;
  const index = stop ? trip.stops.findIndex(item => item.uid === stop.uid) : trip.stops.length;
  const previous = trip.stops[index - 1];
  const destination = stop?.place || trip.homeCity || 'Home';
  const label = textInput('Connection', connection.label, `${previous?.place || trip.homeCity || 'Home'} → ${destination}`, { maxlength: returning ? 240 : 160 });
  const mode = returning ? null : options({ flight: 'flight', train: 'train', bus: 'bus', ferry: 'ferry', transfer: 'transfer', tour: 'tour', other: 'other' }, connection.mode, 'Transport');
  const date = el('input', { type: 'date', 'aria-label': 'Travel date' }); date.value = connection.date || '';
  const status = options(TRANSFER_STATUS, connection.status, 'Connection status');
  const url = el('input', { type: 'url', 'aria-label': 'Connection booking link', placeholder: 'https://…' }); url.value = connection.url || '';
  const reference = textInput('Booking reference', connection.reference, '', { maxlength: 120 });
  const cost = numberInput('Connection cost', connection.cost), currency = currencySelect('Connection currency', connection.currency);
  const reviewed = el('input', { type: 'checkbox', 'aria-label': 'Connection reviewed' });
  const back = returnStop ? stopPath(trip, returnStop) : routePath(trip.uid);
  const form = el('form', { class: 'travel-form', onsubmit: event => {
    event.preventDefault(); if (!form.reportValidity()) return;
    const updated = { ...connection, label: label.value, date: date.value, status: status.value, url: url.value, reference: reference.value, cost: cost.value, currency: currency.value, needsReview: Boolean(connection.needsReview && !reviewed.checked) };
    if (mode) updated.mode = mode.value;
    saveAndReturn(returning ? { ...trip, returnJourney: updated } : { ...trip, stops: trip.stops.map(item => item.uid === stop.uid ? { ...item, connection: updated } : item) }, api, back);
  } }, field('CONNECTION', label), el('div', { class: 'travel-form-grid' }, mode ? field('TRANSPORT', mode) : null, field('DATE', date), field('STATUS', status)),
    moreFields('Booking details', el('div', { class: 'travel-form-grid' }, field('LINK', url), field('REFERENCE', reference), field('COST', cost), field('CURRENCY', currency))),
    connection.needsReview ? el('label', { class: 'check-label' }, reviewed, 'connection reviewed') : null,
    el('div', { class: 'travel-form-actions' }, commitButton('save connection')));
  host.append(button('‹ route', () => go(api, back), { class: 'travel-back' }), formHeading('', `${previous?.place || trip.homeCity || 'Home'} → ${destination}`, ''), form);
}

function momentEditor(host, trip, stop, api) {
  const kind = options(Object.fromEntries(Object.entries(MOMENTS).map(([key, glyph]) => [key, `${glyph} · ${key === 'tiny' ? 'tiny joy' : key}`])), 'tiny', 'Kind of memory');
  const title = textInput('What happened?', '', 'The tiny bit you’ll tell someone later…', { maxlength: 240, required: true });
  const detail = textArea('What made it stick?', '', 'A few sensory details beat a perfect report.', 3, 600);
  const day = el('input', { type: 'date', 'aria-label': 'Memory date' }); day.value = stop.arrival || '';
  const form = el('form', { class: 'travel-form', onsubmit: event => {
    event.preventDefault(); if (!form.reportValidity()) return;
    if (stop.moments.length >= MAX_MOMENTS) { api.say(`One stop can hold up to ${MAX_MOMENTS} memories.`); return; }
    const updatedStop = { ...stop, moments: [{ uid: id(), kind: kind.value, title: title.value.trim(), detail: detail.value.trim(), day: day.value, created: Date.now() }, ...stop.moments] };
    saveAndReturn({ ...trip, stops: trip.stops.map(item => item.uid === stop.uid ? updatedStop : item) }, api, stopPath(trip, stop));
  } }, field('KIND OF KEEPSAKE', kind), field('THE MOMENT', title), field('WHAT MADE IT STICK', detail), field('WHEN?', day),
    el('div', { class: 'travel-form-actions' }, commitButton('keep this little moment')));
  host.append(button('‹ ' + stop.place, () => go(api, stopPath(trip, stop)), { class: 'travel-back' }),
    formHeading('', 'Add moment · ' + stop.place, ''), form);
}

function library(host, trips, api) {
  api.title(host, 'travel', '', 'travel');
  host.append(el('div', { class: 'travel-library-actions' },
    button('+ new trip', () => go(api, '/travel/new'), { class: 'travel-commit' }),
    el('span', { class: 'travel-live-state', 'data-travel-state': '', role: 'status', text: sharing.syncLabel() })));
  const list = el('div', { class: 'travel-library' });
  for (const trip of trips) {
    const record = travelStore.getRecord(trip.uid), people = record?.members?.length || 1;
    list.append(button('', () => go(api, routePath(trip.uid)), { class: 'travel-library-trip' },
      el('h2', { text: trip.title }),
      el('span', { class: 'meta muted', text: [dateRange(trip.departure, trip.returnDate), `${trip.stops.length} stops`, people > 1 ? `shared · ${people} people` : 'private', record?.role === 'viewer' ? 'view only' : '', record?.conflict ? 'needs review' : ''].filter(Boolean).join(' · ') })));
  }
  if (!trips.length) list.append(el('p', { class: 'muted', text: 'No trips yet.' }));
  host.append(list);
  if (travelStore.recoveryEntries().length) host.append(button('saved recovery copies', () => go(api, '/travel/recovery')));
}

function recovery(host, api) {
  host.append(button('‹ trips', () => go(api, '/travel'), { class: 'travel-back' }));
  api.title(host, 'recovery copies', '', 'travel');
  for (const entry of travelStore.recoveryEntries()) {
    const row = el('section', { class: 'travel-recovery-row' }, el('h2', { text: entry.value?.title || 'Trip copy' }), el('p', { class: 'meta muted', text: entry.reason }));
    row.append(button('download copy', () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(entry, null, 2)], { type: 'application/json' }));
      el('a', { href: url, download: 'pocket-travel-recovery.json' }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }));
    if (entry.value?.title) row.append(button('save as a private trip', () => {
      try {
        const trip = travelStore.saveTrip({ ...entry.value, uid: id(), title: entry.value.title.slice(0, 92) + ' · copy', created: Date.now() });
        go(api, routePath(trip.uid));
      } catch (error) { api.say(error.message); }
    }));
    host.append(row);
  }
}

export function mount(host, route, api) {
  leave();
  const trips = readTrips(), rawId = route.tripId || '', tripId = travelStore.lookupAlias(rawId);
  if (tripId && tripId !== rawId) history.replaceState(null, '', location.hash.replace('/' + rawId, '/' + tripId));
  const trip = trips.find(item => item.uid === tripId) || null;
  const editor = route.sub === 'edit' || route.sub === 'stay' || route.sub === 'moment' || route.sub === 'connection' || route.sub === 'stop' && (route.leaf === 'new' || route.extra === 'edit');
  editBase = trip ? plainClone(trip) : null;
  editRevision = trip ? travelStore.getRecord(trip.uid)?.revision : null;
  const fingerprint = () => {
    if (rawId === 'recovery') return JSON.stringify(travelStore.recoveryEntries());
    if (!tripId) return JSON.stringify(readTrips().map(item => { const record = travelStore.getRecord(item.uid); return [item.uid, item.title, item.updated, record?.role, record?.members?.length, Boolean(record?.conflict)]; })) + ':' + travelStore.recoveryEntries().length;
    const record = travelStore.getRecord(tripId);
    return JSON.stringify([record?.value, record?.role, record?.members, Boolean(record?.conflict)]);
  };
  let signature = fingerprint(), queued = false;
  const mountedEpoch = epoch;
  cleanup.push(travelStore.subscribe(() => {
    if (!host.isConnected || epoch !== mountedEpoch) return;
    host.querySelectorAll('[data-travel-state]').forEach(node => { node.textContent = sharing.syncLabel(node.dataset.travelState); });
    const next = fingerprint(); if (next === signature || queued) return;
    const record = tripId && travelStore.getRecord(tripId);
    // A form keeps the captured baseline until it is saved. Remote edits merge
    // with just the fields changed by this form rather than replacing its draft.
    if (record?.value && !(record.role === 'viewer' && editor) && (editor || route.sub === 'share' || document.activeElement?.matches('input, textarea, select') || !document.getElementById('dialog')?.hidden)) return;
    signature = next; queued = true;
    setTimeout(() => { if (epoch === mountedEpoch && host.isConnected) dispatchEvent(new Event('hashchange')); }, 0);
  }));
  travelStore.startLive();
  if (rawId === 'join') { sharing.mountInvitation(host, route.sub, api); return; }
  if (rawId === 'recovery') { recovery(host, api); return; }
  if (!tripId) { library(host, trips, api); return; }
  if (rawId === 'new') { tripEditor(host, null, api); return; }
  if (!trip) {
    api.title(host, 'travel', '', 'travel');
    host.append(el('p', { text: 'This trip is no longer available.' }), button('‹ trips', () => go(api, '/travel')));
    if (travelStore.recoveryEntries().length) host.append(button('saved recovery copies', () => go(api, '/travel/recovery')));
    return;
  }
  const sub = route.sub || '', leaf = route.leaf || '', extra = route.extra || '';
  if (sub === 'share') { cleanup.push(sharing.mountSharing(host, trip, api)); return; }
  if (sub === 'conflict') { sharing.mountConflict(host, trip, api); return; }
  const viewer = travelStore.getRecord(trip.uid)?.role === 'viewer';
  host.classList.toggle('travel-readonly', viewer);
  if (viewer && editor) { go(api, routePath(trip.uid)); return; }
  if (editor) sharing.controls(host, trip, api);
  if (sub === 'edit') { tripEditor(host, trip, api); return; }
  if (sub === 'stop' && leaf === 'new') { stopEditor(host, trip, null, api); return; }
  if (sub === 'stop' && leaf && extra === 'edit') {
    const stop = trip.stops.find(item => item.uid === leaf); if (stop) { stopEditor(host, trip, stop, api); return; }
  }
  if (sub === 'stay' && leaf) {
    const stop = trip.stops.find(item => item.uid === leaf); if (!stop) return;
    const stay = extra ? stop.stays.find(item => item.uid === extra) : null;
    stayEditor(host, trip, stop, stay, api); return;
  }
  if (sub === 'moment' && leaf) {
    const stop = trip.stops.find(item => item.uid === leaf); if (stop) { momentEditor(host, trip, stop, api); return; }
  }
  if (sub === 'connection' && leaf) {
    const stop = leaf === 'home' ? null : trip.stops.find(item => item.uid === leaf);
    if (leaf === 'home' || stop) { connectionEditor(host, trip, stop, trip.stops.find(item => item.uid === extra), api); return; }
  }
  mountWorkspace(host, trip, route, api, { saveTrip, go, cleanup });
}
