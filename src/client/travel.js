import { storage } from './workspace-storage.js';

const KEY = 'pocket:travel-v2';
const MAX_TRIPS = 80, MAX_STOPS = 80, MAX_STAYS = 20, MAX_ACTIVITIES = 60, MAX_MOMENTS = 100;
const CURRENCIES = ['EUR', 'USD', 'PEN', 'BOB', 'CLP', 'BRL'];
const STOP_CURRENCY = { Peru: 'PEN', Bolivien: 'BOB', Chile: 'CLP', Brasilien: 'BRL' };
const STAY_STATUS = { idea: 'researching', shortlist: 'shortlist', booked: 'booked', included: 'in the tour' };
const TRANSFER_STATUS = { idea: 'to figure out', shortlist: 'option saved', booked: 'booked', included: 'in the tour' };
const STAY_KIND = { hotel: 'hotel', guesthouse: 'guesthouse', apartment: 'apartment', hostel: 'hostel', tour: 'tour lodging', camp: 'camp', other: 'somewhere else' };
const MOMENTS = { detour: '↗', taste: '✳', sound: '♫', person: '⌂', tiny: '·', weather: '☼', other: '✷' };
const PROMPTS = [
  'What sound will take you straight back here?',
  'Where did the day go beautifully off-plan?',
  'What did you eat twice?',
  'What detail would never make it into a guidebook?',
  'What did the light look like when you finally stopped?',
];

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
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
function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) if (value != null) node.setAttribute(key, String(value));
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
const trim = (value, limit = 500) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const id = () => globalThis.crypto?.randomUUID?.() || `trip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
const isDay = value => !value || typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(value + 'T12:00:00').getTime());
const cleanCurrency = value => CURRENCIES.includes(value) ? value : 'EUR';
const cleanStatus = (value, list) => has(list, value) ? value : Object.keys(list)[0];
const safeUrl = value => {
  if (typeof value !== 'string' || !value.trim()) return '';
  try { const url = new URL(value.trim()); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
};
const plainClone = value => JSON.parse(JSON.stringify(value));

function cleanConnection(value, stopCurrency, arrival) {
  const current = value && typeof value === 'object' ? value : {};
  return {
    mode: ['flight', 'train', 'bus', 'ferry', 'transfer', 'tour', 'other'].includes(current.mode) ? current.mode : 'transfer',
    label: trim(current.label, 160), date: isDay(current.date) ? current.date : arrival,
    url: safeUrl(current.url), cost: Number.isFinite(Number(current.cost)) && Number(current.cost) >= 0 && current.cost !== '' ? Number(current.cost) : '',
    currency: cleanCurrency(current.currency || stopCurrency), status: cleanStatus(current.status, TRANSFER_STATUS), reference: trim(current.reference, 120),
  };
}
function cleanStay(value, stopCurrency, index) {
  const current = value && typeof value === 'object' ? value : {};
  const money = input => Number.isFinite(Number(input)) && Number(input) >= 0 && input !== '' ? Number(input) : '';
  return {
    uid: trim(current.uid, 100) || `stay-${index}-${id()}`, name: trim(current.name, 140),
    kind: has(STAY_KIND, current.kind) ? current.kind : 'hotel', url: safeUrl(current.url),
    rating: Math.max(0, Math.min(5, Math.round(Number(current.rating) || 0))), status: cleanStatus(current.status, STAY_STATUS),
    nightlyCost: money(current.nightlyCost), totalCost: money(current.totalCost), currency: cleanCurrency(current.currency || stopCurrency),
    checkIn: isDay(current.checkIn) ? current.checkIn : '', checkOut: isDay(current.checkOut) ? current.checkOut : '',
    cancelBy: isDay(current.cancelBy) ? current.cancelBy : '', bookingRef: trim(current.bookingRef, 120),
    address: trim(current.address, 240), note: trim(current.note, 800),
  };
}
function cleanActivity(value, index) {
  const current = typeof value === 'string' ? { text: value } : value && typeof value === 'object' ? value : {};
  return { uid: trim(current.uid, 100) || `idea-${index}-${id()}`, text: trim(current.text, 240), done: Boolean(current.done), optional: Boolean(current.optional) };
}
function cleanMoment(value, index) {
  const current = value && typeof value === 'object' ? value : {};
  return { uid: trim(current.uid, 100) || `moment-${index}-${id()}`, kind: has(MOMENTS, current.kind) ? current.kind : 'other',
    title: trim(current.title, 240), detail: trim(current.detail, 600), day: isDay(current.day) ? current.day : '', created: Number(current.created) || Date.now() };
}
function cleanStop(value, index) {
  const current = value && typeof value === 'object' ? value : {};
  const country = trim(current.country, 80), currency = cleanCurrency(current.currency || STOP_CURRENCY[country]);
  return {
    uid: trim(current.uid, 100) || `stop-${index}-${id()}`, place: trim(current.place, 140), country,
    arrival: isDay(current.arrival) ? current.arrival : '', departure: isDay(current.departure) ? current.departure : '',
    nights: Math.max(0, Math.min(90, Math.round(Number(current.nights) || 0))), currency,
    guidance: trim(current.guidance, 700), activities: (Array.isArray(current.activities) ? current.activities : []).slice(0, MAX_ACTIVITIES).map(cleanActivity).filter(item => item.text),
    stays: (Array.isArray(current.stays) ? current.stays : []).slice(0, MAX_STAYS).map((stay, stayIndex) => cleanStay(stay, currency, stayIndex)).filter(item => item.name),
    moments: (Array.isArray(current.moments) ? current.moments : []).slice(0, MAX_MOMENTS).map(cleanMoment).filter(item => item.title),
    connection: cleanConnection(current.connection, currency, current.arrival),
  };
}
function normalizeTrip(value) {
  if (!value || typeof value !== 'object' || typeof value.uid !== 'string' || !value.uid || !trim(value.title, 100)) return null;
  const returnJourney = value.returnJourney && typeof value.returnJourney === 'object' ? value.returnJourney : {};
  const amount = input => Number.isFinite(Number(input)) && Number(input) >= 0 && input !== '' ? Number(input) : '';
  return {
    uid: trim(value.uid, 100), title: trim(value.title, 100), status: ['draft', 'active', 'done'].includes(value.status) ? value.status : 'draft',
    departure: isDay(value.departure) ? value.departure : '', returnDate: isDay(value.returnDate) ? value.returnDate : '', homeArrival: isDay(value.homeArrival) ? value.homeArrival : '',
    homeCity: trim(value.homeCity, 100), countries: trim(value.countries, 180), travelers: trim(value.travelers, 160), currency: cleanCurrency(value.currency), budget: amount(value.budget),
    intention: trim(value.intention, 900), returnPlan: trim(value.returnPlan, 900),
    returnJourney: { label: trim(returnJourney.label, 240), date: isDay(returnJourney.date) ? returnJourney.date : value.returnDate,
      url: safeUrl(returnJourney.url), cost: amount(returnJourney.cost), currency: cleanCurrency(returnJourney.currency || 'BRL'),
      status: cleanStatus(returnJourney.status, TRANSFER_STATUS), reference: trim(returnJourney.reference, 120) },
    stops: (Array.isArray(value.stops) ? value.stops : []).slice(0, MAX_STOPS).map(cleanStop).filter(stop => stop.place),
    moments: (Array.isArray(value.moments) ? value.moments : []).slice(0, MAX_MOMENTS).map(cleanMoment).filter(item => item.title),
    created: Number(value.created) || Date.now(), updated: Number(value.updated) || Date.now(),
  };
}

function readTrips() {
  const raw = storage.getItem(KEY);
  if (raw === null) {
    const initial = normalizeTrip(starter);
    storage.setItem(KEY, JSON.stringify({ v: 2, trips: [initial] }));
    return [initial];
  }
  try {
    const doc = JSON.parse(raw);
    return Array.isArray(doc?.trips) ? doc.trips.map(normalizeTrip).filter(Boolean) : [];
  } catch { return []; }
}
function writeTrips(trips) { storage.setItem(KEY, JSON.stringify({ v: 2, trips })); }
function saveTrip(value) {
  const trip = normalizeTrip({ ...value, updated: Math.max(Date.now(), Number(value.updated || 0) + 1), created: value.created || Date.now() });
  if (!trip) throw new Error('Add a trip name before saving.');
  const trips = readTrips(), index = trips.findIndex(item => item.uid === trip.uid);
  if (index < 0) { if (trips.length >= MAX_TRIPS) throw new Error(`The travel shelf holds up to ${MAX_TRIPS} trips.`); trips.unshift(trip); }
  else trips[index] = trip;
  writeTrips(trips); return trip;
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
const money = (value, currency) => {
  if (value === '' || value == null || !Number.isFinite(Number(value))) return 'no price saved';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cleanCurrency(currency), maximumFractionDigits: 2 }).format(Number(value)); }
  catch { return `${currency} ${Number(value).toFixed(2)}`; }
};
const nightsTotal = trip => trip.stops.reduce((sum, stop) => sum + stop.nights, 0);
const bookedStayCount = trip => trip.stops.filter(stop => stop.stays.some(stay => ['booked', 'included'].includes(stay.status))).length;
const stayCost = (stay, stop) => stay.totalCost !== '' ? Number(stay.totalCost) : stay.nightlyCost !== '' ? Number(stay.nightlyCost) * stop.nights : 0;
const transferCost = connection => connection?.cost === '' ? 0 : Number(connection?.cost || 0);
const balance = trip => {
  const result = new Map();
  const add = (currency, value, confirmed) => {
    if (!(value > 0)) return;
    const item = result.get(currency) || { booked: 0, planned: 0 };
    item[confirmed ? 'booked' : 'planned'] += value; result.set(currency, item);
  };
  for (const stop of trip.stops) {
    add(stop.connection.currency, transferCost(stop.connection), ['booked', 'included'].includes(stop.connection.status));
    for (const stay of stop.stays) add(stay.currency, stayCost(stay, stop), ['booked', 'included'].includes(stay.status));
  }
  add(trip.returnJourney.currency, transferCost(trip.returnJourney), ['booked', 'included'].includes(trip.returnJourney.status));
  return [...result.entries()].sort(([a], [b]) => a.localeCompare(b));
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
  return el('label', { class: 'travel-field' }, el('span', { text: labelText }), control, hint ? el('small', { text: hint }) : null);
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
  return el('div', { class: 'travel-form-heading' }, el('span', { class: 'travel-kicker', text: kicker }), el('h2', { class: 'travel-editor-title', text: title }), el('p', { text: sub }));
}
function commitButton(label) { return el('button', { type: 'submit', class: 'travel-commit', text: label }); }
function safeAnchor(label, href, className = 'travel-external-link') {
  const url = safeUrl(href);
  if (!url) return null;
  return el('a', { class: className, href: url, target: '_blank', rel: 'noopener noreferrer', text: label });
}

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
        returnJourney: { label: returnLabel.value, date: returnDateInput.value, url: returnUrl.value, cost: returnCost.value, currency: returnCurrency.value, status: returnStatus.value, reference: returnJourney.reference || '' } });
      go(api, routePath(saved.uid));
    } catch (error) { api.say(error.message); }
  } },
    el('div', { class: 'travel-form-grid' }, field('NAME THE TRIP', title), field('STARTING FROM', homeCity), field('LEAVE HOME', departure), field('LEAVE THE LAST STOP', returnDate),
      field('LAND BACK HOME', homeArrival), field('COUNTRIES', countries), field('TRAVEL CREW', travelers), field('DEFAULT CURRENCY', currency), field('TRIP BUDGET TARGET', budget)),
    field('THE HOPE FOR THIS TRIP', intention), field('THE WAY HOME', returnPlan),
    el('div', { class: 'travel-form-section' }, el('span', { class: 'travel-kicker', text: 'LAST LEG · SAVE THE BUFFER TOO' }),
      field('RETURN ROUTE', returnLabel), el('div', { class: 'travel-form-grid' }, field('TRAVEL DATE', returnDateInput), field('BOOKING LINK', returnUrl),
        field('COST', returnCost), field('CURRENCY', returnCurrency), field('STATUS', returnStatus))),
    el('div', { class: 'travel-form-actions' }, commitButton(fresh ? 'save this trip' : 'save trip changes')));
  host.append(button(fresh ? '‹ travel' : '‹ trip route', () => go(api, fresh ? '/travel' : routePath(current.uid)), { class: 'travel-back' }),
    formHeading(fresh ? 'A NEW ROUTE' : 'TRIP DETAILS', fresh ? 'start somewhere' : current.title, fresh ? 'The route, the rough dates, and all the little details can live in one place.' : 'Keep the flights, return buffer, budget and reason for going together.'), form);
  if (!fresh) host.append(el('button', { class: 'travel-delete', text: 'delete trip', onclick: async () => {
    if (!await api.confirm('Delete this trip and all its saved stays and links from this browser?', 'delete')) return;
    writeTrips(readTrips().filter(item => item.uid !== current.uid)); go(api, '/travel');
  } }));
}

function blankStop(trip, previous) {
  return { uid: id(), place: '', country: '', arrival: '', departure: '', nights: 1, currency: trip.currency || 'EUR', guidance: '', activities: [], stays: [], moments: [],
    connection: { mode: 'transfer', label: '', date: '', url: '', cost: '', currency: previous?.currency || trip.currency || 'EUR', status: 'idea', reference: '' } };
}
function stopEditor(host, trip, stop, api) {
  const index = stop ? trip.stops.findIndex(item => item.uid === stop.uid) : trip.stops.length;
  const previous = index > 0 ? trip.stops[index - 1] : null;
  const current = stop ? plainClone(stop) : blankStop(trip, previous);
  const place = textInput('Place', current.place, 'Cusco', { maxlength: 140, required: true });
  const country = textInput('Country', current.country, 'Peru', { maxlength: 80, required: true });
  const arrival = el('input', { type: 'date', 'aria-label': 'Arrival date' }); arrival.value = current.arrival || '';
  const departure = el('input', { type: 'date', 'aria-label': 'Departure date' }); departure.value = current.departure || '';
  const nights = el('input', { type: 'number', min: 0, max: 90, step: 1, 'aria-label': 'Nights' }); nights.value = String(current.nights ?? 1);
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
    const ideasByText = new Map(current.activities.map(item => [item.text, item]));
    const ideas = activities.value.split('\n').map(value => value.trim()).filter(Boolean).slice(0, MAX_ACTIVITIES).map(value => ({ ...(ideasByText.get(value) || { uid: id(), done: false }), text: value }));
    const updated = { ...current, place: place.value, country: country.value, arrival: arrival.value, departure: departure.value,
      nights: Number(nights.value), currency: currency.value, guidance: guidance.value, activities: ideas,
      connection: { mode: mode.value, label: connectionLabel.value, date: connectionDate.value, url: connectionUrl.value,
        cost: connectionCost.value, currency: connectionCurrency.value, status: connectionStatus.value, reference: reference.value } };
    const stops = [...trip.stops]; if (stop) stops[index] = updated; else stops.push(updated);
    saveAndReturn({ ...trip, stops }, api, stopPath(trip, updated));
  } },
    el('div', { class: 'travel-form-grid' }, field('WAYPOINT', place), field('COUNTRY', country), field('ARRIVE', arrival), field('MOVE ON', departure), field('NIGHTS HERE', nights), field('LOCAL CURRENCY', currency)),
    field('LOCAL FIELD NOTE', guidance), field('THINGS TO DO / MAYBE DO', activities, 'One line per idea. “Optional” is a perfectly good status.'),
    el('div', { class: 'travel-form-section' }, el('span', { class: 'travel-kicker', text: previous ? `GETTING HERE · ${previous.place.toUpperCase()} → ${current.place || 'THIS STOP'}` : `GETTING HERE · ${trip.homeCity || 'HOME'} → FIRST STOP` }),
      el('div', { class: 'travel-form-grid' }, field('TYPE OF CONNECTION', mode), field('ROUTE / OPERATOR', connectionLabel), field('TRAVEL DATE', connectionDate), field('BOOKING LINK', connectionUrl), field('COST', connectionCost), field('CURRENCY', connectionCurrency), field('STATUS', connectionStatus), field('BOOKING REFERENCE', reference))),
    el('div', { class: 'travel-form-actions' }, commitButton(stop ? 'save waypoint' : 'add waypoint')));
  host.append(button(stop ? '‹ waypoint' : '‹ trip route', () => go(api, stop ? stopPath(trip, stop) : routePath(trip.uid)), { class: 'travel-back' }),
    formHeading(stop ? 'EDIT THE ROUTE' : 'ADD A STOP', stop ? current.place : 'another somewhere', 'Arrival, departure, the way you get there, and the little things you might do.'), form);
  if (stop) host.append(el('button', { class: 'travel-delete', text: 'remove this waypoint', onclick: async () => {
    if (!await api.confirm(`Remove ${current.place} and its hotel options from this trip?`, 'remove')) return;
    saveAndReturn({ ...trip, stops: trip.stops.filter(item => item.uid !== stop.uid) }, api, routePath(trip.uid));
  } }));
}

function stayEditor(host, trip, stop, stay, api) {
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
  const checkIn = el('input', { type: 'date', 'aria-label': 'Check in' }); checkIn.value = current.checkIn || stop.arrival;
  const checkOut = el('input', { type: 'date', 'aria-label': 'Check out' }); checkOut.value = current.checkOut || stop.departure;
  const cancelBy = el('input', { type: 'date', 'aria-label': 'Free cancellation date' }); cancelBy.value = current.cancelBy || '';
  const reference = textInput('Booking reference', current.bookingRef, 'Reservation code', { maxlength: 120 });
  const address = textInput('Address', current.address, 'Street, neighborhood, pin for the taxi', { maxlength: 240 });
  const note = textArea('Stay note', current.note, 'Room request, cancellation terms, who owes whom…', 3, 800);
  const form = el('form', { class: 'travel-form', onsubmit: event => {
    event.preventDefault(); if (!form.reportValidity()) return;
    if (checkIn.value && checkOut.value && checkOut.value < checkIn.value) { checkOut.setCustomValidity('Check-out needs to be on or after check-in.'); checkOut.reportValidity(); checkOut.setCustomValidity(''); return; }
    const updated = { ...current, name: name.value, kind: kind.value, url: url.value, rating: Number(rating.value), status: status.value,
      nightlyCost: nightly.value, totalCost: total.value, currency: currency.value, checkIn: checkIn.value, checkOut: checkOut.value,
      cancelBy: cancelBy.value, bookingRef: reference.value, address: address.value, note: note.value };
    const stops = trip.stops.map(item => item.uid !== stop.uid ? item : { ...item, stays: fresh ? [...item.stays, updated] : item.stays.map(old => old.uid === stay.uid ? updated : old) });
    saveAndReturn({ ...trip, stops }, api, stopPath(trip, stop));
  } },
    el('div', { class: 'travel-form-grid' }, field('PROPERTY / TOUR NAME', name), field('KIND OF STAY', kind), field('BOOKING PAGE', url), field('YOUR RATING', rating), field('STATUS', status), field('PRICE CURRENCY', currency)),
    el('div', { class: 'travel-form-grid' }, field('PRICE PER NIGHT', nightly, `For ${stop.nights} ${stop.nights === 1 ? 'night' : 'nights'} · optional if you only know the total.`), field('TOTAL FOR THIS STAY', total, 'If entered, this total is used in the trip cost summary.'),
      field('CHECK-IN', checkIn), field('CHECK-OUT', checkOut), field('FREE CANCELLATION UNTIL', cancelBy), field('BOOKING REFERENCE', reference)),
    field('ADDRESS / NEIGHBORHOOD', address), field('THE IMPORTANT BITS', note),
    el('div', { class: 'travel-form-actions' }, commitButton(fresh ? 'save this stay' : 'save stay changes')));
  host.append(button('‹ ' + stop.place, () => go(api, stopPath(trip, stop)), { class: 'travel-back' }),
    formHeading(fresh ? `A PLACE TO SLEEP · ${stop.place.toUpperCase()}` : 'STAY DETAILS', fresh ? 'where are we sleeping?' : current.name, 'Keep the link, price, rating and cancellation date attached to the exact nights.'), form);
  if (!fresh) host.append(el('button', { class: 'travel-delete', text: 'remove this stay', onclick: async () => {
    if (!await api.confirm(`Remove ${current.name} from ${stop.place}?`, 'remove')) return;
    const stops = trip.stops.map(item => item.uid === stop.uid ? { ...item, stays: item.stays.filter(old => old.uid !== stay.uid) } : item);
    saveAndReturn({ ...trip, stops }, api, stopPath(trip, stop));
  } }));
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
    formHeading('A MEMORY IS NOT A CHECKBOX', `a little ${stop.place} story`, 'The best souvenir might be a sound, a meal, or a completely accidental turn.'), form);
}

function routeArt(trip, selectedIndex) {
  const count = Math.max(2, trip.stops.length), pts = [];
  for (let index = 0; index < count; index++) {
    const x = 12 + index * (396 / (count - 1)), y = 58 + Math.sin(index * 1.55) * 24 + Math.sin(index * .64) * 10;
    pts.push([x, y]);
  }
  const commands = pts.map(([x, y], index) => `${index ? 'L' : 'M'} ${x} ${y}`).join(' ');
  const art = svg('svg', { viewBox: '0 0 420 108', role: 'img', 'aria-label': `${trip.stops.length} waypoints from ${trip.homeCity || 'home'} through ${trip.countries || 'the route'}` },
    svg('path', { d: commands, class: 'travel-map-thread' }), svg('path', { d: commands, class: 'travel-map-route' }),
    ...pts.map(([x, y], index) => svg('circle', { cx: x, cy: y, r: index === selectedIndex ? 6 : 4, class: 'travel-map-stop' + (index === selectedIndex ? ' selected' : '') })));
  return el('div', { class: 'travel-route-art' }, art, el('div', { class: 'travel-route-ends' }, el('span', { text: trip.homeCity || 'home' }), el('span', { text: trip.stops.map(stop => stop.country).filter((country, index, list) => list.indexOf(country) === index).join(' → ') }), el('span', { text: trip.homeArrival ? `back ${dateLabel(trip.homeArrival, { day: 'numeric', month: 'short' })}` : 'home again' })));
}

function costLedger(trip) {
  const totals = balance(trip);
  if (!totals.length && trip.budget === '') return el('div', { class: 'travel-cost-empty' }, el('span', { class: 'travel-kicker', text: 'COSTS SO FAR' }), el('p', { text: 'No prices yet. Add a stay or connection and the trip sums itself, currency by currency.' }));
  const ledger = el('div', { class: 'travel-cost-ledger' }, el('span', { class: 'travel-kicker', text: 'KNOWN COSTS · KEPT IN ORIGINAL CURRENCIES' }));
  if (trip.budget !== '') ledger.append(el('p', { class: 'travel-budget-target', text: `trip target · ${money(trip.budget, trip.currency)}` }));
  if (totals.length) ledger.append(el('div', { class: 'travel-cost-groups' }, totals.map(([currency, values]) => el('div', { class: 'travel-cost-currency' },
    el('span', { class: 'travel-cost-code', text: currency }),
    el('span', {}, el('strong', { text: money(values.booked, currency) }), el('small', { text: 'booked / included' })),
    el('span', {}, el('strong', { text: money(values.planned, currency) }), el('small', { text: 'saved options' }))))));
  else ledger.append(el('p', { class: 'travel-cost-emptyline', text: 'No hotel or connection prices saved yet.' }));
  return ledger;
}

function tripHeader(host, trip, selectedIndex, api) {
  const totalNights = nightsTotal(trip), stayStops = bookedStayCount(trip);
  const header = el('section', { class: 'travel-trip-header' },
    el('div', { class: 'travel-trip-overline' }, el('span', { class: 'travel-kicker', text: `${trip.status.toUpperCase()} · SAVED ON THIS BROWSER` }),
      button('edit trip details', () => go(api, `${routePath(trip.uid)}/edit`), { class: 'travel-envelope-action' })),
    el('div', { class: 'travel-trip-titleline' }, el('div', {}, el('h2', { class: 'travel-trip-title', text: trip.title }),
      el('p', { class: 'travel-trip-subtitle', text: `${trip.countries || 'your route'}${trip.homeCity ? ` · ${trip.homeCity} out and back` : ''}` })),
      el('span', { class: 'travel-postmark', 'aria-label': `${trip.stops.length} waypoints` }, el('span', { text: String(trip.stops.length).padStart(2, '0') }), el('small', { text: 'waypoints' }))),
    el('p', { class: 'travel-trip-dates', text: `${dateRange(trip.departure, trip.returnDate)}${trip.homeArrival ? ` · home ${dateLabel(trip.homeArrival, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}${trip.travelers ? ` · ${trip.travelers}` : ''}` }),
    routeArt(trip, selectedIndex),
    el('div', { class: 'travel-metrics' },
      el('div', {}, el('strong', { text: String(trip.stops.length).padStart(2, '0') }), el('span', { text: 'waypoints' })),
      el('div', {}, el('strong', { text: String(totalNights).padStart(2, '0') }), el('span', { text: 'nights on the road' })),
      el('div', {}, el('strong', { text: `${stayStops}/${trip.stops.length}` }), el('span', { text: 'stops with booked / included stays' }))),
    costLedger(trip));
  if (trip.intention) header.append(el('p', { class: 'travel-intention' }, el('span', { class: 'travel-kicker', text: 'THE REASON FOR THIS ROUTE' }), el('span', { text: trip.intention })));
  host.append(header);
}

function journeyIndex(trip, selected, api) {
  const index = el('aside', { class: 'travel-index', 'aria-label': 'Trip waypoints' });
  index.append(el('div', { class: 'travel-index-head' }, el('div', {}, el('span', { class: 'travel-kicker', text: 'THE ROUTE, IN ORDER' }), el('span', { class: 'travel-index-sub', text: 'where the next pin lands' })),
    button('+ stop', () => go(api, `${routePath(trip.uid)}/stop/new`), { class: 'travel-inline-add' })));
  trip.stops.forEach((stop, position) => {
    const stayCount = stop.stays.length, booked = stop.stays.some(stay => ['booked', 'included'].includes(stay.status));
    const row = el('div', { class: 'travel-index-row' });
    row.append(button('', () => go(api, stopPath(trip, stop)), { class: 'travel-index-trip' + (stop.uid === selected.uid ? ' selected' : ''), 'aria-current': stop.uid === selected.uid ? 'true' : 'false' },
      el('span', { class: 'travel-index-number', text: `${String(position + 1).padStart(2, '0')} · ${stop.country.toUpperCase()}` }),
      el('span', { class: 'travel-index-name', text: stop.place }),
      el('span', { class: 'travel-index-meta', text: `${dateRange(stop.arrival, stop.departure)} · ${stop.nights} ${stop.nights === 1 ? 'night' : 'nights'}` }),
      el('span', { class: 'travel-index-stay' + (booked ? ' booked' : ''), text: booked ? 'stay sorted' : stayCount ? `${stayCount} stay ${stayCount === 1 ? 'option' : 'options'}` : `${stop.nights} ${stop.nights === 1 ? 'night' : 'nights'} · find a bed` })));
    const order = el('div', { class: 'travel-reorder' },
      button('↑', () => reorderStop(trip, position, position - 1, api), { disabled: position === 0, 'aria-label': `Move ${stop.place} earlier` }),
      button('↓', () => reorderStop(trip, position, position + 1, api), { disabled: position === trip.stops.length - 1, 'aria-label': `Move ${stop.place} later` }));
    row.append(order); index.append(row);
  });
  index.append(el('p', { class: 'travel-local-note', text: 'Move a pin · the dates and nights stay attached.' }));
  return index;
}
function reorderStop(trip, from, to, api) {
  if (to < 0 || to >= trip.stops.length) return;
  const stops = [...trip.stops]; [stops[from], stops[to]] = [stops[to], stops[from]];
  saveAndReturn({ ...trip, stops }, api, stopPath(trip, stops[to]));
}

function transferBlock(trip, stop, index, api) {
  const previous = index > 0 ? trip.stops[index - 1] : null;
  const leg = stop.connection;
  const label = leg.label || (previous ? `${previous.place} → ${stop.place}` : `${trip.homeCity || 'home'} → ${stop.place}`);
  const source = previous ? previous.place : trip.homeCity || 'home';
  return el('section', { class: 'travel-transfer' },
    el('div', { class: 'travel-section-heading' }, el('div', {}, el('span', { class: 'travel-kicker', text: 'GETTING TO THIS PIN' }), el('h3', { text: label })),
      button('edit leg', () => go(api, `${routePath(trip.uid)}/stop/${stop.uid}/edit`), { class: 'travel-inline-add' })),
    el('div', { class: 'travel-transfer-summary' }, el('span', { class: 'travel-transfer-glyph', text: leg.mode === 'train' ? '═' : leg.mode === 'flight' ? '✈' : leg.mode === 'ferry' ? '≈' : leg.mode === 'tour' ? '↗' : '→' }),
      el('div', {}, el('span', { class: 'travel-beat-when', text: `${source} → ${stop.place} · ${dateLabel(leg.date || stop.arrival)}` }),
        el('span', { class: 'travel-beat-meta', text: `${leg.mode} · ${TRANSFER_STATUS[leg.status]}${leg.reference ? ' · ref ' + leg.reference : ''}` }),
        leg.cost !== '' ? el('span', { class: 'travel-beat-meta', text: money(leg.cost, leg.currency) }) : null),
      safeAnchor('booking / timetable ↗', leg.url)));
}

function ratingControl(stay, trip, stop, api) {
  return el('div', { class: 'travel-stars', role: 'group', 'aria-label': `Your rating for ${stay.name}` },
    ...Array.from({ length: 5 }, (_, index) => button(index < stay.rating ? '★' : '☆', () => {
      const rating = stay.rating === index + 1 ? 0 : index + 1;
      const updated = { ...trip, stops: trip.stops.map(item => item.uid === stop.uid ? { ...item, stays: item.stays.map(old => old.uid === stay.uid ? { ...old, rating } : old) } : item) };
      saveAndReturn(updated, api, stopPath(trip, stop));
    }, { class: 'travel-star' + (index < stay.rating ? ' active' : ''), 'aria-label': `Rate ${stay.name} ${index + 1} out of 5`, 'aria-pressed': String(index < stay.rating) })));
}

function stayCard(host, trip, stop, stay, api) {
  const total = stayCost(stay, stop), hasMoney = total > 0, rate = stay.rating ? `${stay.rating} / 5` : 'not rated yet';
  const costLine = hasMoney ? `${money(total, stay.currency)} total${stay.totalCost === '' && stay.nightlyCost !== '' ? ` · ${money(stay.nightlyCost, stay.currency)} / night` : ''}` : 'price not entered yet';
  host.append(el('article', { class: 'travel-stay' },
    el('div', { class: 'travel-stay-head' }, el('div', {}, el('span', { class: 'travel-stay-kind', text: `${STAY_KIND[stay.kind]} · ${STAY_STATUS[stay.status]}` }),
      el('h4', { text: stay.name }), el('span', { class: 'travel-stay-price', text: costLine })),
      el('div', { class: 'travel-stay-actions' }, button('edit', () => go(api, `${routePath(trip.uid)}/stay/${stop.uid}/${stay.uid}`), { class: 'travel-text-action' }),
        button('remove', async () => {
          if (!await api.confirm(`Remove ${stay.name} from your stay options?`, 'remove')) return;
          const stops = trip.stops.map(item => item.uid === stop.uid ? { ...item, stays: item.stays.filter(old => old.uid !== stay.uid) } : item);
          saveAndReturn({ ...trip, stops }, api, stopPath(trip, stop));
        }, { class: 'travel-text-action' }))),
    el('div', { class: 'travel-stay-meta' }, ratingControl(stay, trip, stop, api), el('span', { class: 'travel-stay-rating-text', text: rate }),
      stay.checkIn || stay.checkOut ? el('span', { text: `${dateLabel(stay.checkIn)} → ${dateLabel(stay.checkOut)}` }) : null,
      stay.cancelBy ? el('span', { class: 'travel-cancel', text: `free cancellation until ${dateLabel(stay.cancelBy, { day: 'numeric', month: 'short', year: 'numeric' })}` }) : null),
    stay.address ? el('p', { class: 'travel-stay-address', text: stay.address }) : null,
    stay.bookingRef ? el('p', { class: 'travel-stay-ref', text: `booking ref · ${stay.bookingRef}` }) : null,
    stay.note ? el('p', { class: 'travel-stay-note', text: stay.note }) : null,
    safeAnchor(stay.url ? 'open property / booking link ↗' : '', stay.url)));
}

function staySection(host, trip, stop, api) {
  const stays = el('section', { class: 'travel-stays' });
  stays.append(el('div', { class: 'travel-section-heading' }, el('div', {}, el('span', { class: 'travel-kicker', text: 'THE BED FOR THESE NIGHTS' }),
    el('h3', { text: 'where we’re staying' })), button('+ stay option', () => go(api, `${routePath(trip.uid)}/stay/${stop.uid}`), { class: 'travel-inline-add' })));
  if (stop.guidance) stays.append(el('p', { class: 'travel-stop-guidance' }, el('span', { class: 'travel-guidance-mark', text: '!' }), el('span', { text: stop.guidance })));
  if (!stop.stays.length) stays.append(el('div', { class: 'travel-no-stay' }, el('span', { class: 'travel-no-stay-mark', text: '⌂' }),
    el('p', { text: `No stay saved for these ${stop.nights} ${stop.nights === 1 ? 'night' : 'nights'} yet.` }),
    el('span', { class: 'travel-no-stay-hint', text: 'Add a hotel, guesthouse, tour lodging, booking link, rating and price.' }),
    button('+ save a place to stay', () => go(api, `${routePath(trip.uid)}/stay/${stop.uid}`), { class: 'travel-inline-add' })));
  else {
    const list = el('div', { class: 'travel-stay-list' }); stop.stays.forEach(stay => stayCard(list, trip, stop, stay, api)); stays.append(list);
  }
  host.append(stays);
}

function activitySection(host, trip, stop, api) {
  const section = el('section', { class: 'travel-activities' });
  section.append(el('div', { class: 'travel-section-heading' }, el('div', {}, el('span', { class: 'travel-kicker', text: 'THINGS THIS PIN COULD HOLD' }), el('h3', { text: 'activity ideas' })),
    button('edit ideas', () => go(api, `${routePath(trip.uid)}/stop/${stop.uid}/edit`), { class: 'travel-inline-add' })));
  if (!stop.activities.length) section.append(el('p', { class: 'travel-empty-hint', text: 'No activity ideas yet. Leave a day blank on purpose if that feels good.' }));
  else {
    const list = el('div', { class: 'travel-activity-list' });
    stop.activities.forEach(activity => {
      list.append(el('div', { class: 'travel-activity-row' }, button(activity.done ? '☑' : '□', () => {
        const stops = trip.stops.map(item => item.uid === stop.uid ? { ...item, activities: item.activities.map(old => old.uid === activity.uid ? { ...old, done: !old.done } : old) } : item);
        saveAndReturn({ ...trip, stops }, api, stopPath(trip, stop));
      }, { class: 'travel-activity-check', 'aria-label': `${activity.done ? 'Unmark' : 'Mark'} ${activity.text}`, 'aria-pressed': String(activity.done) }),
      el('span', { class: 'travel-activity-text' + (activity.done ? ' done' : ''), text: activity.text }),
      activity.optional || /OPTIONAL/.test(activity.text) ? el('span', { class: 'travel-activity-tag', text: 'optional' }) : null));
    }); section.append(list);
  }
  host.append(section);
}

function memorySection(host, trip, stop, api) {
  const section = el('section', { class: 'travel-memory-section' });
  section.append(el('div', { class: 'travel-section-heading' }, el('div', {}, el('span', { class: 'travel-kicker', text: 'THE BIT THAT WON’T FIT IN YOUR BAG' }),
    el('h3', { text: stop.moments.length ? 'little moments' : 'one day, future-you' })), button('+ keep a moment', () => go(api, `${routePath(trip.uid)}/moment/${stop.uid}`), { class: 'travel-inline-add' })));
  if (!stop.moments.length) {
    const prompt = el('p', { class: 'travel-memory-prompt', 'aria-live': 'polite' });
    section.append(el('p', { class: 'travel-memory-tease', text: 'Not a checklist. Just a place to keep a sound, a meal, or the wrong turn that became the whole story.' }),
      button('give me a memory prompt', () => { prompt.textContent = PROMPTS[Math.floor(Math.random() * PROMPTS.length)]; }, { class: 'travel-prompt-button' }), prompt);
  } else {
    const list = el('div', { class: 'travel-moments' });
    stop.moments.forEach(moment => list.append(el('article', { class: 'travel-moment' }, el('span', { class: 'travel-moment-glyph', 'aria-hidden': 'true', text: MOMENTS[moment.kind] || MOMENTS.other }),
      el('div', {}, el('span', { class: 'travel-moment-meta', text: `${moment.kind} · ${dateLabel(moment.day)}` }), el('h4', { text: moment.title }), moment.detail ? el('p', { text: moment.detail }) : null))));
    section.append(list);
  }
  host.append(section);
}

function stopDetail(host, trip, stop, api) {
  const index = trip.stops.findIndex(item => item.uid === stop.uid);
  const prior = index > 0 ? trip.stops[index - 1] : null;
  const mapHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${stop.place}, ${stop.country}`)}`;
  const detail = el('article', { class: 'travel-stop-detail' },
    el('div', { class: 'travel-stop-heading' }, el('div', {}, el('span', { class: 'travel-kicker', text: `${String(index + 1).padStart(2, '0')} / ${String(trip.stops.length).padStart(2, '0')} WAYPOINT · ${stop.country.toUpperCase()}` }),
      el('h2', { class: 'travel-stop-title', text: stop.place }), el('p', { class: 'travel-stop-dates', text: `${dateRange(stop.arrival, stop.departure)} · ${stop.nights} ${stop.nights === 1 ? 'night' : 'nights'}` })),
      el('div', { class: 'travel-stop-actions' }, safeAnchor('open map ↗', mapHref, 'travel-text-action'), button('edit stop', () => go(api, `${routePath(trip.uid)}/stop/${stop.uid}/edit`), { class: 'travel-text-action' }))),
    el('div', { class: 'travel-stop-stats' }, el('div', {}, el('span', { class: 'travel-kicker', text: 'ARRIVE' }), el('strong', { text: dateLabel(stop.arrival, { day: 'numeric', month: 'short', year: 'numeric' }) })),
      el('div', {}, el('span', { class: 'travel-kicker', text: 'MOVE ON' }), el('strong', { text: dateLabel(stop.departure, { day: 'numeric', month: 'short', year: 'numeric' }) })),
      el('div', {}, el('span', { class: 'travel-kicker', text: 'NIGHTS' }), el('strong', { text: String(stop.nights) }))),
    transferBlock(trip, stop, index, api));
  if (prior) detail.insertBefore(el('p', { class: 'travel-between-stops', text: `next pin after ${prior.place}` }), detail.children[1]);
  else detail.insertBefore(el('p', { class: 'travel-between-stops', text: `first stop after leaving ${trip.homeCity || 'home'}` }), detail.children[1]);
  staySection(detail, trip, stop, api); activitySection(detail, trip, stop, api); memorySection(detail, trip, stop, api);
  host.append(detail);
}

function summaryNotes(host, trip, api) {
  const section = el('section', { class: 'travel-return' }, el('span', { class: 'travel-kicker', text: 'DON’T LET THE LAST DAY GET WEIRD' }),
    el('h3', { text: 'the way home' }), el('p', { text: trip.returnPlan || 'Keep the final transfer and the international flight together here.' }));
  const journey = trip.returnJourney;
  section.append(el('div', { class: 'travel-return-leg' }, el('div', {}, el('span', { class: 'travel-beat-when', text: `${journey.label || 'Add the last transfer and flight'} · ${dateLabel(journey.date || trip.returnDate, { day: 'numeric', month: 'short', year: 'numeric' })}` }),
    el('span', { class: 'travel-beat-meta', text: `${TRANSFER_STATUS[journey.status]}${journey.reference ? ' · ref ' + journey.reference : ''}${journey.cost !== '' ? ' · ' + money(journey.cost, journey.currency) : ''}` })),
    safeAnchor('open return booking ↗', journey.url), button('edit trip', () => go(api, `${routePath(trip.uid)}/edit`), { class: 'travel-text-action' })));
  if (journey.cost !== '' || journey.url) section.append(el('p', { class: 'travel-return-note', text: `${journey.cost !== '' ? `return leg · ${money(journey.cost, journey.currency)}` : 'No transfer price entered.'} ${journey.url ? ' · booking link saved.' : ''}` }));
  host.append(section);
}

export function mount(host, route, api) {
  const trips = readTrips();
  const tripId = route.tripId || '';
  if (tripId === 'new') { api.title(host, 'travel', 'a new route · saved on this browser', 'travel'); tripEditor(host, null, api); return; }
  const trip = trips.find(item => item.uid === tripId) || trips[0] || null;
  if (!trip) {
    api.title(host, 'travel', 'your local trip notebook', 'travel');
    host.append(el('section', { class: 'travel-empty-library' }, el('span', { class: 'travel-kicker', text: 'THE MAP IS A BLANK PAGE' }), el('h2', { text: 'Let’s give it a somewhere.' }),
      el('p', { text: 'Start with a place. Add where you’ll sleep, how you’ll get there and every helpful link.' }), button('+ plan the first trip', () => go(api, '/travel/new'), { class: 'travel-commit' })));
    return;
  }
  const sub = route.sub || '', leaf = route.leaf || '', extra = route.extra || '';
  api.title(host, 'travel', `${trip.stops.length} waypoints · ${nightsTotal(trip)} nights · saved on this browser`, 'travel');
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
  const selectedStop = trip.stops.find(item => item.uid === (sub === 'stop' ? leaf : '')) || trip.stops[0];
  if (!selectedStop) { host.append(el('p', { class: 'travel-empty-hint', text: 'Add the first waypoint to give the trip a route.' }), button('+ add a stop', () => go(api, `${routePath(trip.uid)}/stop/new`), { class: 'travel-commit' })); return; }
  const selectedIndex = trip.stops.findIndex(item => item.uid === selectedStop.uid);
  tripHeader(host, trip, selectedIndex, api);
  const layout = el('div', { class: 'travel-planner-grid' }, journeyIndex(trip, selectedStop, api));
  const detail = el('div', { class: 'travel-detail-column' }); stopDetail(detail, trip, selectedStop, api); layout.append(detail); host.append(layout);
  summaryNotes(host, trip, api);
  host.append(el('div', { class: 'travel-bottom-actions' }, button('+ another trip', () => go(api, '/travel/new'), { class: 'travel-inline-add' })));
}
