import { activeAccount } from './workspace-storage.js';

const el = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
const SEARCH_DELAY = 250, MIN_INPUT = 2, MAX_SUGGESTIONS = 5;

// The lookup stays within the open form. A place only becomes trip data when the person chooses it and then saves
// the form; late results cannot save it.
//
// With `search`, the given field searches Google Places as you type (search.kind 'stop' or 'stay'); choosing a
// suggestion calls search.apply to fill the form. The address lookup remains for stays, since many rentals are not
// listed places, and becomes the stop search's fallback when Places is unavailable.
export function locationPicker(host, readSubject, initial, helpers, cleanup, search = null) {
  let alive = true, busy = false, current = initial || null, sequence = 0, controller;
  const account = activeAccount();
  const state = el('span', current ? 'location selected' : '', 'travel-location-state'); state.setAttribute('role', 'status');
  const button = el('button', search?.kind === 'stay' ? 'find address' : 'find location'); button.type = 'button';
  const results = el('div', '', 'travel-location-results');
  const suggestions = el('div', '', 'travel-place-suggestions'); suggestions.hidden = true;
  const root = el('div', '', 'travel-location-picker'); root.append(suggestions, button, state, results); host.append(root);
  if (search?.kind === 'stop') button.hidden = true;
  const clear = () => { sequence++; controller?.abort(); current = null; state.textContent = ''; results.replaceChildren(); button.disabled = false; busy = false; };
  const set = (location, label) => { sequence++; controller?.abort(); current = location; state.textContent = 'location set · ' + label; results.replaceChildren(); button.disabled = false; busy = false; };
  cleanup.push(() => { alive = false; sequence++; controller?.abort(); });
  // Without a configured key there is nothing to look up; a location chosen elsewhere is still kept.
  import('./google-maps.js').then(({ mapsEnabled }) => mapsEnabled()).then(enabled => { if (enabled === false && alive) root.hidden = true; }).catch(() => {});
  const subjectKey = subject => [String(subject.place || '').trim(), String(subject.country || '').trim()].join('\n');
  const find = async () => {
    if (busy || !alive) return;
    const subject = readSubject(), captured = subjectKey(subject), attempt = ++sequence;
    if (!subject.place?.trim()) { helpers.say(search?.kind === 'stay' ? 'Enter the address first.' : 'Enter a destination or address first.'); return; }
    const valid = () => alive && root.isConnected && activeAccount() === account && attempt === sequence && subjectKey(readSubject()) === captured;
    controller?.abort(); controller = new AbortController(); busy = true; button.disabled = true;
    state.textContent = 'locating…'; results.replaceChildren();
    try {
      const { resolveLocation, locationQuery } = await import('./travel-geocoding.js');
      if (!valid()) return;
      const result = await resolveLocation({ ...subject, location: current }, { signal: controller.signal, refresh: true });
      if (!valid()) return;
      if (result.status === 'resolved') {
        current = { placeId: result.location.placeId, query: locationQuery(subject) };
        state.textContent = result.location.approximate ? 'area located' : 'location selected';
      } else if (result.status === 'ambiguous' && result.candidates?.length) {
        state.textContent = 'choose location';
        const candidates = result.candidates.slice(0, 5);
        candidates.forEach(candidate => {
          const choose = el('button', candidate.address || subject.place); choose.type = 'button';
          choose.addEventListener('click', () => {
            if (!valid()) return;
            current = { placeId: candidate.placeId, query: locationQuery(subject) };
            state.textContent = candidate.approximate ? 'area selected' : 'location selected'; results.replaceChildren();
          });
          results.append(choose);
        });
        const attribution = el('span', 'Google Maps', 'travel-location-attribution'); results.append(attribution);
      } else state.textContent = result.status === 'unresolved' ? 'no location found' : 'location lookup unavailable';
    } catch (error) { if (valid() && error?.name !== 'AbortError') state.textContent = 'location lookup unavailable'; }
    finally { if (alive && attempt === sequence) { busy = false; button.disabled = false; } }
  };
  button.addEventListener('click', () => { void find(); });
  if (search?.input) placeSearch(search, suggestions, {
    alive: () => alive && root.isConnected && activeAccount() === account,
    chosen: (suggestion, location) => { search.apply(suggestion); set(location(readSubject()), suggestion.text); },
    unavailable: () => { if (alive) button.hidden = false; },
  });
  return { clear, set, value: () => current };
}

/** Google Places Autocomplete on one field, rendered as Pocket's own list. One session lasts until a choice. */
function placeSearch(search, list, hooks) {
  const input = search.input, listId = 'travel-place-list-' + Math.random().toString(36).slice(2);
  let timer = 0, serial = 0, token = null, places = null, bias = undefined, broken = false;
  list.id = listId; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Places');
  Object.entries({ role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': listId, autocomplete: 'off' }).forEach(([key, value]) => input.setAttribute(key, value));
  const close = () => { list.hidden = true; list.replaceChildren(); input.setAttribute('aria-expanded', 'false'); };
  const options = () => [...list.querySelectorAll('button')];
  async function library() {
    if (places) return places;
    const { loadGoogleMaps } = await import('./google-maps.js');
    const maps = await loadGoogleMaps(), loaded = await maps.importLibrary('places');
    if (typeof loaded?.AutocompleteSuggestion?.fetchAutocompleteSuggestions !== 'function') throw new Error('Places search is unavailable.');
    return places = loaded;
  }
  // A stay is searched near its stop and within its country.
  async function nearby() {
    if (bias !== undefined || !search.near) return bias || null;
    bias = null;
    try {
      const { resolveLocation, countryCode } = await import('./travel-geocoding.js');
      const stop = search.near(), code = countryCode(stop.country), result = await resolveLocation(stop);
      bias = { ...(code ? { includedRegionCodes: [code] } : {}),
        ...(result.status === 'resolved' ? { locationBias: { center: { lat: result.location.lat, lng: result.location.lng }, radius: 40000 } } : {}) };
    } catch { bias = null; }
    return bias;
  }
  async function suggest(text, attempt) {
    try {
      const library_ = await library(), near = await nearby();
      if (attempt !== serial || !hooks.alive()) return;
      token ??= new library_.AutocompleteSessionToken();
      const { suggestions = [] } = await library_.AutocompleteSuggestion.fetchAutocompleteSuggestions({ input: text, sessionToken: token, language: navigator.language || document.documentElement.lang, ...near });
      if (attempt !== serial || !hooks.alive() || input.value.trim() !== text) return;
      const found = suggestions.map(item => item.placePrediction).filter(Boolean).slice(0, MAX_SUGGESTIONS).map(prediction => ({
        placeId: prediction.placeId, main: prediction.mainText?.text || prediction.text?.text || '', secondary: prediction.secondaryText?.text || '',
        text: prediction.text?.text || prediction.mainText?.text || '', types: Array.isArray(prediction.types) ? prediction.types : [],
      })).filter(item => item.placeId && item.main);
      if (!found.length) { close(); return; }
      list.replaceChildren(...found.map((item, index) => {
        const option = el('button', '', 'travel-place-option'); option.type = 'button'; option.id = listId + '-' + index;
        option.setAttribute('role', 'option'); option.append(el('span', item.main), el('span', item.secondary, 'travel-place-secondary'));
        option.addEventListener('mousedown', event => event.preventDefault());   // keep the field focused until the choice
        option.addEventListener('click', () => choose(item));
        return option;
      }), el('span', 'Google Maps', 'travel-location-attribution'));
      list.hidden = false; input.setAttribute('aria-expanded', 'true');
    } catch {
      if (attempt !== serial || broken) return;
      broken = true; close(); hooks.unavailable();
    }
  }
  async function choose(item) {
    close(); token = null; serial++;
    const { locationQuery } = await import('./travel-geocoding.js');
    if (!hooks.alive()) return;
    hooks.chosen(item, subject => ({ placeId: item.placeId, query: locationQuery(subject) }));
    input.focus();
  }
  input.addEventListener('input', () => {
    clearTimeout(timer); const text = input.value.trim(), attempt = ++serial;
    if (broken || text.length < MIN_INPUT) { close(); return; }
    timer = setTimeout(() => { void suggest(text, attempt); }, SEARCH_DELAY);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' && !list.hidden) { event.preventDefault(); options()[0]?.focus(); }
    else if (event.key === 'Enter' && !list.hidden && options().length) { event.preventDefault(); options()[0].click(); }
    else if (event.key === 'Escape' && !list.hidden) { event.preventDefault(); close(); }
  });
  list.addEventListener('keydown', event => {
    const all = options(), index = all.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); all[Math.min(all.length - 1, index + 1)]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); if (index <= 0) input.focus(); else all[index - 1].focus(); }
    else if (event.key === 'Escape') { event.preventDefault(); close(); input.focus(); }
  });
  input.addEventListener('blur', () => setTimeout(() => { if (!list.contains(document.activeElement) && document.activeElement !== input) close(); }, 150));
}
