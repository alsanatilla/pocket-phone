import { activeAccount } from './workspace-storage.js';

const el = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };

// The lookup stays within the open form. A match only becomes trip data when
// the person chooses it and then saves the form; late results cannot save it.
export function locationPicker(host, readSubject, initial, helpers, cleanup) {
  let alive = true, busy = false, current = initial || null, sequence = 0, controller;
  const account = activeAccount();
  const state = el('span', current ? 'location selected' : '', 'travel-location-state'); state.setAttribute('role', 'status');
  const button = el('button', 'find location'); button.type = 'button';
  const results = el('div', '', 'travel-location-results');
  const root = el('div', '', 'travel-location-picker'); root.append(button, state, results); host.append(root);
  // Without a configured key there is nothing to look up; a location chosen elsewhere is still kept.
  import('./google-maps.js').then(({ mapsEnabled }) => mapsEnabled()).then(enabled => { if (enabled === false && alive) root.hidden = true; }).catch(() => {});
  const clear = () => { sequence++; controller?.abort(); current = null; state.textContent = ''; results.replaceChildren(); button.disabled = false; busy = false; };
  cleanup.push(() => { alive = false; sequence++; controller?.abort(); });
  const subjectKey = subject => [String(subject.place || '').trim(), String(subject.country || '').trim()].join('\n');
  const find = async () => {
    if (busy || !alive) return;
    const subject = readSubject(), captured = subjectKey(subject), attempt = ++sequence;
    if (!subject.place?.trim()) { helpers.say('Enter a destination or address first.'); return; }
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
  return { clear, value: () => current };
}
