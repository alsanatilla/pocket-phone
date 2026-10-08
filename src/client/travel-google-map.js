import { loadGoogleMaps, onMapsAuthFailure } from './google-maps.js';
import { resolveLocation } from './travel-geocoding.js';
import { sheet, drawFrame, SIZE, stepMs, frameCount } from './sprite-player.js';

const WARM_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#302f27' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#c7bca8' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#282720' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#645b47' }] },
  { featureType: 'administrative.country', elementType: 'labels.text.fill', stylers: [{ color: '#d3c5aa' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#f0e9dd' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#363b2d' }] },
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#384631' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#57503e' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#2b2922' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#a18d5e' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#514836' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#e1d4b9' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#69614c' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#454238' }] },
  { featureType: 'transit', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#202f32' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#93abad' }] },
];
// Close up (a stay's street) the map shows everything; for a whole trip only land, water, borders and countries,
// so the stops are the only names on it.
const DETAIL_STYLE = [...WARM_MAP_STYLE,
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ visibility: 'on' }, { color: '#384631' }] },
  { featureType: 'landscape', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] }];
const QUIET_STYLE = [...DETAIL_STYLE,
  ...['administrative.locality', 'administrative.neighborhood', 'administrative.province', 'road', 'water', 'landscape'].map(featureType => ({ featureType, elementType: 'labels', stylers: [{ visibility: 'off' }] })),
  ...['road.arterial', 'road.local', 'transit', 'administrative.land_parcel'].map(featureType => ({ featureType, stylers: [{ visibility: 'off' }] })),
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#433d2e' }] },
  { featureType: 'administrative.country', elementType: 'labels.text.fill', stylers: [{ color: '#8f8676' }] }];
const DETAIL_ZOOM = 11;
const viewports = new Map();
// Keep Pip's last stop across route redraws, with the same small limit as map viewports.
const walked = new Set(), pipAt = new Map();
// One SDK map survives detached route redraws; adapter overlays/listeners do not.
// This avoids constructing another billable map on every stop/tab/live update.
let retainedMap = null;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const validLocation = value => value && Number.isFinite(value.lat) && Number.isFinite(value.lng)
  && Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180;
const locationPoint = value => ({ lat: value.lat, lng: value.lng });
const abortError = () => new DOMException('Map cancelled.', 'AbortError');
const unavailableError = () => Object.assign(new Error('Google Maps is unavailable.'), { code: 'MAP_UNAVAILABLE' });
const noLocation = () => ({ status: 'unavailable' });

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) if (value != null) node.setAttribute(key, value);
  node.append(...children); return node;
}
function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const aborted = () => { signal.removeEventListener('abort', aborted); reject(abortError()); };
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(value => { signal.removeEventListener('abort', aborted); if (!signal.aborted) resolve(value); }, error => {
      signal.removeEventListener('abort', aborted); reject(signal.aborted ? abortError() : error);
    });
  });
}
async function resolveSafely(subject, signal) {
  if (signal.aborted) throw abortError();
  try {
    const result = await abortable(resolveLocation(subject, { signal }), signal);
    return result?.status === 'resolved' && !validLocation(result.location) ? noLocation() : result || noLocation();
  } catch (error) {
    if (signal.aborted || error?.name === 'AbortError') throw abortError();
    return noLocation();
  }
}
async function resolveMany(subjects, signal) {
  const result = new Array(subjects.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, subjects.length) }, async () => {
    while (cursor < subjects.length && !signal.aborted) {
      const index = cursor++; result[index] = await resolveSafely(subjects[index], signal);
    }
  }));
  if (signal.aborted) throw abortError();
  return result;
}
function rememberViewport(key, value) {
  if (!key || !validLocation(value?.center) || !Number.isFinite(value.zoom)) return;
  viewports.delete(key); viewports.set(key, value);
  while (viewports.size > 8) viewports.delete(viewports.keys().next().value);
}
function centerOf(map) {
  const center = map.getCenter?.();
  if (!center) return null;
  const value = typeof center.toJSON === 'function' ? center.toJSON() : {
    lat: typeof center.lat === 'function' ? center.lat() : center.lat,
    lng: typeof center.lng === 'function' ? center.lng() : center.lng,
  };
  return validLocation(value) ? value : null;
}
function acquireMap(maps, viewport) {
  const options = { center: { lat: 0, lng: 0 }, zoom: 2, minZoom: 2, maxZoom: 18, styles: QUIET_STYLE,
    gestureHandling: 'cooperative', disableDefaultUI: true, keyboardShortcuts: true, clickableIcons: false,
    mapTypeId: 'roadmap', backgroundColor: '#202f32' };
  if (retainedMap && !retainedMap.active && !retainedMap.broken && retainedMap.maps === maps) {
    retainedMap.active = true; viewport.append(retainedMap.canvas); retainedMap.map.setOptions(options);
    return retainedMap;
  }
  const canvas = el('div', { class: 'travel-google-canvas', role: 'region', 'aria-label': 'Google travel map' });
  viewport.append(canvas);
  const instance = { maps, canvas, map: new maps.Map(canvas, options), active: true, broken: false };
  if (!retainedMap || !retainedMap.active) retainedMap = instance;
  return instance;
}
function releaseMap(instance) {
  if (!instance) return;
  instance.active = false;
  instance.map.setOptions?.({ gestureHandling: 'none', keyboardShortcuts: false });
  instance.canvas.remove();
  if (retainedMap === instance && instance.broken) retainedMap = null;
}

/**
 * Google geometry is used exclusively on this Google map. Neither the trip nor
 * an offline overview receives geocoded coordinates or formatted address data.
 * Ready rejects on SDK/service failure. A late failure calls onUnavailable.
 */
export function mountGoogleRouteMap(host, trip, selectedUID, onSelect = () => {}, options = {}) {
  const stops = Array.isArray(trip?.stops) ? trip.stops.filter(stop => stop?.uid) : [];
  const controller = new AbortController();
  const listen = (node, event, fn, extra = {}) => node.addEventListener(event, fn, { ...extra, signal: controller.signal });
  let disposed = false, failed = false, complete = false, maps = null, instance = null, map = null;
  let selected = String(selectedUID || stops[0]?.uid || ''), points = [], identity = '', manuallyMoved = false;
  let stayController = null, stayGeneration = 0, stayTimer = null, resizeObserver = null, frame = 0;
  let savedViewport = null, currentStayPromise = Promise.resolve([]), fitScope = options.focusStays ? 'stays' : 'trip';
  const mapListeners = [], stopOverlays = [], stayOverlays = [], lines = [], pendingTimers = new Set();
  const resolvedStays = new Map();
  let pip = null, pipLife = null, styled = null, PipOverlay, tidyFrame = 0;
  const wrapper = el('div', { class: 'travel-google-route-map', 'data-map-provider': 'google', 'aria-busy': 'true' });
  const viewport = el('div', { class: 'travel-google-viewport' });
  const loading = el('div', { class: 'travel-google-loading', role: 'status', 'aria-label': 'Loading map' },
    el('span', { 'aria-hidden': 'true' }), el('span', { 'aria-hidden': 'true' }), el('span', { 'aria-hidden': 'true' }));
  const fitButton = el('button', { type: 'button', class: 'travel-google-fit', 'aria-label': options.focusStays ? 'Fit stays and selected destination' : 'Fit all mapped destinations', disabled: '' }, options.focusStays ? 'Fit stays' : 'Fit trip');
  const stayArea = el('button', { type: 'button', class: 'travel-google-stay-area', hidden: '', disabled: '' }, 'Stay area');
  const zoomIn = el('button', { type: 'button', 'aria-label': 'Zoom in', disabled: '' }, '+');
  const zoomOut = el('button', { type: 'button', 'aria-label': 'Zoom out', disabled: '' }, '−');
  const zoomControls = el('div', { class: 'travel-google-zoom', role: 'group', 'aria-label': 'Map zoom' }, zoomIn, zoomOut);
  const unavailable = el('div', { class: 'travel-google-missing', hidden: '' });
  viewport.append(loading, fitButton, stayArea, zoomControls);
  wrapper.append(viewport, el('div', { class: 'travel-google-caption' }, options.focusStays ? 'Stays' : 'Trip order'), unavailable);
  host.replaceChildren(wrapper);
  const viewportKey = () => trip?.uid ? `${trip.uid}:${options.focusStays ? 'stays:' + selected : 'route'}` : '';
  const remember = () => {
    if (!map || !identity || failed) return;
    rememberViewport(viewportKey(), { identity, center: centerOf(map), zoom: map.getZoom?.(), manuallyMoved, scope: fitScope });
  };
  const addMapListener = (name, fn) => {
    const handle = map?.addListener?.(name, fn);
    if (handle) mapListeners.push(handle); return handle;
  };
  const later = fn => {
    const timer = setTimeout(() => { pendingTimers.delete(timer); if (!disposed && !failed) fn(); }, 0);
    pendingTimers.add(timer); return timer;
  };
  const removeOverlays = overlays => { for (const overlay of overlays.splice(0)) overlay.setMap(null); };
  const teardownAdapter = () => {
    stayGeneration++; stayController?.abort(); controller.abort(); resizeObserver?.disconnect();
    for (const timer of pendingTimers) clearTimeout(timer); pendingTimers.clear();
    if (stayTimer != null) clearTimeout(stayTimer);
    if (frame) cancelAnimationFrame(frame); frame = 0;
    pipLife?.dispose(); pipLife = null; pip?.setMap(null); pip = null;
    if (tidyFrame) cancelAnimationFrame(tidyFrame); tidyFrame = 0;
    for (const handle of mapListeners.splice(0)) handle.remove?.();
    removeOverlays(stopOverlays); removeOverlays(stayOverlays);
    for (const line of lines.splice(0)) line.setMap(null);
    resolvedStays.clear(); releaseMap(instance);
  };
  let unsubscribeFailure = () => {};
  const fail = () => {
    if (disposed || failed) return;
    failed = true; if (instance) instance.broken = true;
    teardownAdapter(); unsubscribeFailure(); loading.remove();
    wrapper.setAttribute('aria-busy', 'false'); wrapper.dataset.mapState = 'unavailable';
    unavailable.hidden = false; unavailable.replaceChildren(el('span', {}, 'Map unavailable'));
    if (complete) options.onUnavailable?.(unavailableError());
  };
  unsubscribeFailure = onMapsAuthFailure(fail);
  listen(window, 'offline', fail);

  function selectedPoint() { return points.find(point => String(point.stop.uid) === selected); }
  function savedStays() { return resolvedStays.get(selected) || []; }
  function fit(scope = options.focusStays ? 'stays' : 'trip') {
    if (!map || disposed || failed) return;
    const mapped = scope === 'stays'
      ? [selectedPoint(), ...savedStays()].filter(point => point?.location)
      : points.filter(point => point.location);
    if (!mapped.length) return;
    manuallyMoved = false; fitScope = scope;
    if (mapped.length === 1) { map.setCenter(locationPoint(mapped[0].location)); map.setZoom(scope === 'stays' ? 14 : 9); }
    else {
      // The shortest longitude arc also fits routes across the date line.
      const latitudes = mapped.map(point => point.location.lat);
      const longitudes = mapped.map(point => (point.location.lng + 360) % 360).sort((a, b) => a - b);
      let gapIndex = 0, largestGap = -1;
      for (let i = 0; i < longitudes.length; i++) {
        const gap = (i === longitudes.length - 1 ? longitudes[0] + 360 : longitudes[i + 1]) - longitudes[i];
        if (gap > largestGap) { largestGap = gap; gapIndex = i; }
      }
      const longitude = value => value > 180 ? value - 360 : value;
      const bounds = new maps.LatLngBounds({ south: Math.min(...latitudes), north: Math.max(...latitudes),
        west: longitude(longitudes[(gapIndex + 1) % longitudes.length]), east: longitude(longitudes[gapIndex]) });
      map.fitBounds(bounds, { top: 64, bottom: 50, left: 62, right: 62 });
      // Avoid excessive zoom when several addresses share the same result.
      const handle = map.addListener?.('idle', () => {
        if (disposed || failed || manuallyMoved) return;
        if ((map.getZoom?.() || 0) > (scope === 'stays' ? 16 : 12)) map.setZoom(scope === 'stays' ? 16 : 12);
        handle?.remove?.(); const index = mapListeners.indexOf(handle); if (index >= 0) mapListeners.splice(index, 1);
      });
      if (handle) mapListeners.push(handle);
    }
  }
  function drawMissing() {
    const missing = points.filter(point => !point.location);
    unavailable.hidden = !missing.length;
    unavailable.replaceChildren();
    if (!missing.length) return;
    unavailable.append(el('span', { class: 'travel-google-missing-label' }, 'Needs location'));
    for (const { stop, status } of missing) {
      const row = el('div', { class: 'travel-google-missing-stop' });
      const choose = el('button', { type: 'button', 'data-stop-uid': stop.uid, 'aria-label': `Select ${stop.place || 'destination'}`, 'aria-pressed': String(String(stop.uid) === selected) }, stop.place || 'Destination');
      listen(choose, 'click', () => select(stop.uid, true)); row.append(choose);
      if (typeof options.onLocateStop === 'function') {
        const locate = el('button', { type: 'button', class: 'travel-google-locate', 'aria-label': `Locate ${stop.place || 'destination'}` }, 'locate');
        listen(locate, 'click', () => { if (!disposed && !failed) options.onLocateStop(stop.uid); }); row.append(locate);
      }
      if (status === 'ambiguous') row.append(el('span', { class: 'travel-google-location-status' }, 'choose a place'));
      unavailable.append(row);
    }
  }
  function updateSelection() {
    for (const overlay of stopOverlays) overlay.setSelected(String(overlay.stopUID) === selected);
    for (const node of unavailable.querySelectorAll('[data-stop-uid]')) node.setAttribute('aria-pressed', String(node.getAttribute('data-stop-uid') === selected));
    declutter();
  }
  function select(uid, notify = false) {
    if (disposed || failed || !stops.some(stop => String(stop.uid) === String(uid))) return;
    const next = String(uid), changed = selected !== next;
    if (changed && options.focusStays) remember();
    selected = next; updateSelection();
    if (notify && changed) onSelect(uid);
    if (changed && map && !disposed && !failed) {
      pipLife?.select(next);
      stayGeneration++; stayController?.abort(); removeOverlays(stayOverlays);
      if (stayTimer != null) { clearTimeout(stayTimer); pendingTimers.delete(stayTimer); }
      stayTimer = later(() => { stayTimer = null; refreshStays(); });
    }
  }
  let PinOverlay;
  function createOverlayClass() {
    PinOverlay = class extends maps.OverlayView {
      constructor(point, kind, activate) {
        super(); this.point = point; this.kind = kind; this.stopUID = point.stop?.uid;
        this.pixel = null; this.merged = false; this.group = null; this.numberWidth = 30;
        this.element = el('div', { class: `travel-google-pin ${kind === 'stay' ? 'is-stay' : 'is-stop'}` });
        const name = kind === 'stay' ? point.stay.name || 'Stay' : point.stop.place || 'Destination';
        const status = kind === 'stay' ? point.stay.status : '';
        this.nameText = name;
        this.descriptor = kind === 'stay' ? `${name}${status ? ', ' + status : ''}` : `${point.order + 1}. ${name}${point.stop.country ? ', ' + point.stop.country : ''}`;
        this.number = el('span', { class: 'travel-google-pin-number', 'aria-hidden': 'true' }, kind === 'stay' ? '⌂' : String(point.order + 1));
        this.button = el('button', { type: 'button', class: 'travel-google-pin-button', 'aria-label': `${kind === 'stay' ? 'Open stay ' : 'Select '}${this.descriptor}${kind === 'stay' && point.location.approximate ? '. Approximate location.' : ''}`,
          'data-stop-uid': point.stop?.uid, 'data-stay-uid': point.stay?.uid }, this.number, el('span', { class: 'travel-google-pin-name' }, name));
        this.element.classList.toggle('is-approximate', Boolean(point.location.approximate));
        if (kind === 'stay') this.element.classList.add(['booked', 'included'].includes(status) ? 'is-booked' : status === 'chosen' ? 'is-chosen' : 'is-saved');
        this.element.append(this.button); listen(this.button, 'click', event => { event.preventDefault(); if (!disposed && !failed) activate(this); });
        listen(this.button, 'keydown', event => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const collection = (kind === 'stay' ? stayOverlays : stopOverlays).filter(overlay => !overlay.merged), index = collection.indexOf(this);
          collection[(index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + collection.length) % collection.length]?.button.focus();
        });
        maps.OverlayView.preventMapHitsAndGesturesFrom?.(this.element);
      }
      onAdd() { if (!disposed && !failed) this.getPanes()?.overlayMouseTarget?.append(this.element); }
      draw() {
        if (disposed || failed) return;
        const pixel = this.getProjection()?.fromLatLngToDivPixel(locationPoint(this.point.location));
        if (!pixel || !Number.isFinite(pixel.x) || !Number.isFinite(pixel.y)) { this.pixel = null; this.element.hidden = true; return; }
        this.pixel = { x: pixel.x, y: pixel.y };
        this.element.hidden = this.merged; this.element.style.left = `${pixel.x}px`; this.element.style.top = `${pixel.y}px`;
        // Google places pins on its own schedule; sort out shared spots and names once they have positions.
        if (this.kind === 'stop' && !tidyFrame) tidyFrame = requestAnimationFrame(() => { tidyFrame = 0; declutter(); });
        this.element.classList.toggle('is-wide-view', (map.getZoom?.() || 0) < 7);
        // Address pins share a city's position at continent zoom; the Stay area
        // control exposes them at a useful scale without inventing offsets.
        if (this.kind === 'stay') this.element.hidden = (map.getZoom?.() || 0) < 7;
      }
      onRemove() { this.element.remove(); }
      setSelected(active) {
        this.element.classList.toggle('is-selected', active);
        if (this.kind === 'stop') this.button.setAttribute('aria-pressed', String(active));
      }
      /** Leads a shared spot (members), stands alone (one member) or is drawn by another pin (null). */
      setGroup(members) {
        this.merged = !members; this.group = members; this.element.hidden = this.merged || !this.pixel;
        if (!members) return;
        const label = members.map(overlay => overlay.point.order + 1).join('·');
        this.number.textContent = label; this.numberWidth = Math.max(30, label.length * 8 + 12);
        this.element.classList.toggle('is-group', members.length > 1);
        this.button.setAttribute('aria-label', members.length > 1 ? 'Select ' + members.map(overlay => overlay.descriptor).join(' or ') : 'Select ' + this.descriptor);
      }
    };
  }
  // Stops at one spot (a trip that starts and ends at the airport) share one pin; tapping it moves between them.
  // A name that would cover another pin or name is left out; the selected stop always keeps its name.
  function declutter() {
    if (!map || disposed || failed) return;
    const groups = [];
    for (const overlay of stopOverlays) {
      if (!overlay.pixel) continue;
      const near = groups.find(group => Math.hypot(group[0].pixel.x - overlay.pixel.x, group[0].pixel.y - overlay.pixel.y) < 26);
      if (near) near.push(overlay); else groups.push([overlay]);
    }
    const leads = groups.map(group => {
      const lead = group.find(overlay => String(overlay.stopUID) === selected) || group[0];
      for (const overlay of group) overlay.setGroup(overlay === lead ? group : null);
      return lead;
    });
    const hits = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
    const taken = leads.map(({ pixel, numberWidth }) => ({ x1: pixel.x - 15, y1: pixel.y - 41, x2: pixel.x - 15 + numberWidth, y2: pixel.y - 11 }));
    const wide = (map.getZoom?.() || 0) < 7, isSelected = overlay => overlay.group?.some(member => String(member.stopUID) === selected);
    for (const lead of [...leads].sort((a, b) => Number(isSelected(b)) - Number(isSelected(a)))) {
      const left = lead.pixel.x - 15 + lead.numberWidth + 6;
      const label = { x1: left, y1: lead.pixel.y - 35, x2: left + Math.min(172, lead.nameText.length * 7.3), y2: lead.pixel.y - 17 };
      const fits = isSelected(lead) || !wide && !taken.some(other => hits(label, other));
      lead.element.classList.toggle('is-label-hidden', !fits);
      if (fits) taken.push(label);
    }
  }
  const choose = overlay => {
    const members = overlay.group?.length ? overlay.group : [overlay], index = members.findIndex(member => String(member.stopUID) === selected);
    select(members[(index + 1) % members.length].stopUID, true);
  };

  // Pip follows the route, then wanders and keeps busy around its stop.
  function createPipClass() {
    PipOverlay = class extends maps.OverlayView {
      constructor() {
        super(); this.position = null; this.facing = 1; this.resting = true; this.frame = 0;
        this.canvas = el('canvas', { class: 'travel-google-pip', 'aria-hidden': 'true', width: String(SIZE), height: String(SIZE) });
        this.context = this.canvas.getContext('2d');
      }
      onAdd() { this.getPanes()?.overlayLayer?.append(this.canvas); }
      draw() {
        const pixel = this.position && this.getProjection()?.fromLatLngToDivPixel(this.position);
        if (!pixel || !Number.isFinite(pixel.x) || !Number.isFinite(pixel.y)) { this.canvas.hidden = true; return; }
        this.canvas.hidden = false; this.canvas.style.left = `${pixel.x}px`; this.canvas.style.top = `${pixel.y}px`;
        this.canvas.classList.toggle('is-resting', this.resting); this.canvas.classList.toggle('is-west', this.facing < 0);
      }
      onRemove() { this.canvas.remove(); }
      paint(activity, frame) { drawFrame(this.context, 'pip', 'yellow', activity, frame); }
    };
  }
  async function startPip() {
    const located = points.filter(point => point.location);
    if (options.focusStays || !located.length || pip) return;
    try { await sheet('pip', 'yellow'); } catch { return; }
    if (disposed || failed || pip) return;
    let spherical = null;
    try { spherical = (await maps.importLibrary?.('geometry'))?.spherical; } catch { /* Strolls still work without geometry. */ }
    if (disposed || failed || pip) return;
    createPipClass(); pip = new PipOverlay(); pip.setMap(map);
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let closed = false, inView = true, pageActive = true, observer = null, walkFrame = 0, lifeTimer = 0;
    let frameWork = null, timerWork = null, pausedAt = null, pausedFor = 0;
    const gone = () => closed || disposed || failed || !pip;
    const canRun = () => !gone() && pageActive && !document.hidden && inView && !motion.matches;
    // Freeze animation time as well as callbacks: returning to the tab never skips a walk.
    const time = () => { const now = performance.now(); return (pausedAt ?? now) - pausedFor; };
    const cancelHandles = () => {
      if (walkFrame) cancelAnimationFrame(walkFrame); walkFrame = 0;
      clearTimeout(lifeTimer); lifeTimer = 0;
    };
    const still = () => { cancelHandles(); frameWork = null; timerWork = null; };
    const armFrame = () => {
      if (!frameWork || walkFrame || !canRun()) return;
      walkFrame = requestAnimationFrame(() => {
        walkFrame = 0;
        if (!canRun()) { playbackChanged(); return; }
        const next = frameWork; frameWork = null; next?.(time());
      });
    };
    const armTimer = () => {
      if (!timerWork || lifeTimer || !canRun()) return;
      lifeTimer = setTimeout(() => {
        lifeTimer = 0;
        if (!canRun()) { playbackChanged(); return; }
        const next = timerWork; timerWork = null; next?.fn();
      }, Math.max(0, timerWork.due - time()));
    };
    function playbackChanged() {
      if (gone()) return;
      if (!canRun()) {
        pausedAt ??= performance.now(); cancelHandles();
      } else {
        if (pausedAt != null) { pausedFor += performance.now() - pausedAt; pausedAt = null; }
        armFrame(); armTimer();
      }
    }
    const nextFrame = fn => { frameWork = fn; armFrame(); };
    const pause = (fn, ms) => {
      clearTimeout(lifeTimer); lifeTimer = 0;
      timerWork = { fn, due: time() + ms }; armTimer();
    };
    const longitude = value => ((value + 180) % 360 + 360) % 360 - 180;
    const deltaLongitude = (a, b) => longitude(b - a);
    const literal = value => typeof value?.toJSON === 'function' ? value.toJSON() : locationPoint(value);
    const metersPerPixel = lat => 156543.03392 * Math.cos(clamp(lat, -85, 85) * Math.PI / 180) / 2 ** (map.getZoom?.() || 2);
    const distance = (a, b) => spherical?.computeDistanceBetween
      ? spherical.computeDistanceBetween(a, b)
      : Math.hypot(a.lat - b.lat, deltaLongitude(a.lng, b.lng) * Math.cos(a.lat * Math.PI / 180)) * 111320;
    let home = located[0];
    const stand = (position, resting) => { pip.position = position; pip.resting = resting; pip.paint(0, 2); pip.draw(); };
    const settle = point => {
      still(); home = point;
      pipAt.delete(trip.uid); pipAt.set(trip.uid, String(point.stop.uid));
      while (pipAt.size > 8) { const key = pipAt.keys().next().value; pipAt.delete(key); walked.delete(key); }
      stand(locationPoint(point.location), true);
    };
    const along = (a, b) => { const i = located.indexOf(a), j = located.indexOf(b), path = located.slice(Math.min(i, j), Math.max(i, j) + 1); return (i <= j ? path : path.reverse()).map(point => locationPoint(point.location)); };

    /** Walks through positions (a stroll is slower than a trip leg), then calls done. */
    const walk = (positions, done, pace = 0.16) => {
      still();
      const legs = [];
      for (let i = 1; i < positions.length; i++) {
        const a = literal(positions[i - 1]), b = literal(positions[i]), pixels = distance(a, b) / metersPerPixel((a.lat + b.lat) / 2);
        if (pixels >= 1) legs.push({ a, b, ms: clamp(pixels / pace, 450, 1600), facing: deltaLongitude(a.lng, b.lng) < 0 ? -1 : 1 });
      }
      if (!legs.length) { done(); return; }
      const total = legs.reduce((sum, leg) => sum + leg.ms, 0), scale = total > 12000 ? 12000 / total : 1;
      let leg = 0, started = time(), painted = -Infinity;
      pip.resting = false; pip.frame = 0;
      const step = now => {
        if (gone()) return;
        const current = legs[leg], t = Math.min(1, (now - started) / (current.ms * scale));
        pip.position = spherical?.interpolate ? literal(spherical.interpolate(current.a, current.b, t))
          : { lat: current.a.lat + (current.b.lat - current.a.lat) * t, lng: longitude(current.a.lng + deltaLongitude(current.a.lng, current.b.lng) * t) };
        pip.facing = current.facing;
        if (now - painted >= stepMs('pip', 1)) { painted = now; pip.frame = (pip.frame + 1) % frameCount('pip', 1); pip.paint(1, pip.frame); }
        pip.draw();
        if (t >= 1 && ++leg >= legs.length) { done(); return; }
        if (t >= 1) started = now;
        nextFrame(step);
      };
      nextFrame(step);
    };
    /** One of pip's activities in place: wave, juggle, read, hop or write. */
    const play = (activity, loops, done) => {
      still(); let frame = 0, count = 0;
      const tick = () => {
        if (gone()) return;
        pip.paint(activity, frame); frame = (frame + 1) % frameCount('pip', activity);
        if (frame === 0) count++;
        pause(() => { if (count >= loops) { pip.paint(0, 2); done(); } else tick(); }, stepMs('pip', activity));
      };
      tick();
    };
    let activities = [], lastActivity = null;
    const nextActivity = () => {
      if (!activities.length) {
        activities = [0, 2, 3, 4, 5];
        for (let i = activities.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [activities[i], activities[j]] = [activities[j], activities[i]]; }
        if (activities.at(-1) === lastActivity) activities.unshift(activities.pop());
      }
      return lastActivity = activities.pop();
    };
    const stroll = base => {
      const angle = Math.random() * Math.PI * 2, reach = 24 + Math.random() * 56;
      const projection = pip.getProjection(), pixel = projection?.fromLatLngToContainerPixel?.(base);
      const width = viewport.clientWidth, height = viewport.clientHeight;
      if (pixel && Number.isFinite(pixel.x) && Number.isFinite(pixel.y) && width > 88 && height > 100) {
        // Stay inside the map, including the sprite's head and the mobile viewport edges.
        if (pixel.x < 0 || pixel.x > width || pixel.y < 0 || pixel.y > height) return null;
        const value = projection.fromContainerPixelToLatLng(new maps.Point(
          clamp(pixel.x + Math.cos(angle) * reach, 28, width - 28),
          clamp(pixel.y + Math.sin(angle) * reach, 48, height - 28)));
        return value && validLocation(literal(value)) ? literal(value) : null;
      }
      const mpp = metersPerPixel(base.lat);
      return { lat: clamp(base.lat - Math.sin(angle) * reach * mpp / 111320, -85, 85),
        lng: longitude(base.lng + Math.cos(angle) * reach * mpp / (111320 * Math.cos(clamp(base.lat, -85, 85) * Math.PI / 180))) };
    };
    const live = () => {
      if (gone()) return;
      const base = locationPoint(home.location), here = pip.position || base, roll = Math.random(), index = located.indexOf(home);
      const away = distance(here, base) / metersPerPixel(base.lat) > 12;
      if (away && roll < .45) walk([here, base], () => { stand(base, true); pause(live, 600 + Math.random() * 1400); }, .07);
      else if (roll < .45) play(nextActivity(), 1 + Math.floor(Math.random() * 2), () => pause(live, 1500 + Math.random() * 3500));
      else if (roll < .88 || located.length < 2) {
        const target = stroll(base);
        if (!target) { pause(live, 2000); return; }
        walk([here, target], () => { stand(target, false); pause(live, 800 + Math.random() * 2400); }, .07);
      } else {
        const neighbour = located[index === 0 ? 1 : index === located.length - 1 ? index - 1 : index + (Math.random() < .5 ? -1 : 1)], there = locationPoint(neighbour.location);
        walk([here, base, there], () => { stand(there, false); play(0, 1, () => walk([there, base], () => { stand(base, true); pause(live, 1500 + Math.random() * 2500); })); });
      }
    };
    const selectedStop = () => located.find(point => String(point.stop.uid) === selected) || located[0];
    const arrive = point => { settle(point); pause(live, 1200); };
    pipLife = {
      dispose() { closed = true; still(); observer?.disconnect(); },
      select(uid) {
        const point = located.find(point => String(point.stop.uid) === uid);
        if (!point || gone()) return;
        if (motion.matches) settle(point);
        else walk([pip.position || locationPoint(home.location), ...along(home, point)], () => arrive(point));
      },
    };
    listen(document, 'visibilitychange', playbackChanged);
    listen(window, 'pagehide', () => { pageActive = false; playbackChanged(); });
    listen(window, 'pageshow', () => { pageActive = true; playbackChanged(); });
    listen(motion, 'change', () => {
      if (motion.matches) settle(selectedStop()); else arrive(selectedStop());
      playbackChanged();
    });
    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver(entries => {
        inView = entries.some(entry => entry.isIntersecting); playbackChanged();
      });
      observer.observe(viewport);
    }
    playbackChanged();
    const target = selectedStop(), from = located.find(point => String(point.stop.uid) === pipAt.get(trip.uid));
    if (motion.matches) { settle(target); return; }
    if (!walked.has(trip.uid)) { walked.add(trip.uid); settle(located[0]); walk(located.map(point => locationPoint(point.location)), () => arrive(located.at(-1))); }
    else if (from && from !== target) { settle(from); walk(along(from, target), () => arrive(target)); }
    else arrive(target);
  }
  function drawStays(rows) {
    removeOverlays(stayOverlays);
    for (const point of rows.filter(point => point.location)) {
      const overlay = new PinOverlay(point, 'stay', () => options.onStaySelect?.(point.stay.uid));
      stayOverlays.push(overlay); overlay.setMap(map);
    }
    const hasStays = rows.some(point => point.location);
    stayArea.hidden = !hasStays || Boolean(options.focusStays); stayArea.disabled = !hasStays;
  }
  function refreshStays() {
    if (!map || disposed || failed) return Promise.resolve([]);
    const uid = selected, stop = stops.find(stop => String(stop.uid) === uid), generation = ++stayGeneration;
    stayController?.abort(); stayController = new AbortController();
    const stopSignal = stayController.signal;
    const abortStays = () => stayController?.abort();
    controller.signal.addEventListener('abort', abortStays, { once: true });
    const cached = resolvedStays.get(uid);
    currentStayPromise = (async () => {
      try {
        const stays = Array.isArray(stop?.stays) ? stop.stays.filter(stay => stay?.uid && typeof stay.address === 'string' && stay.address.trim()) : [];
        const results = cached || await resolveMany(stays.map(stay => ({ place: stay.address, country: stop.country, location: stay.location })), stopSignal)
          .then(values => values.map((value, i) => ({ stay: stays[i], stop, status: value.status, location: value.status === 'resolved' ? value.location : null })));
        if (disposed || failed || stopSignal.aborted || generation !== stayGeneration || selected !== uid) return [];
        resolvedStays.set(uid, results); drawStays(results);
        if (options.focusStays) {
          const saved = viewports.get(viewportKey());
          if (saved?.identity === identity && saved.manuallyMoved) { map.setCenter(saved.center); map.setZoom(saved.zoom); manuallyMoved = true; fitScope = saved.scope || 'stays'; }
          else fit('stays');
        }
        return results;
      } catch (error) {
        if (disposed || failed || stopSignal.aborted || generation !== stayGeneration) return [];
        drawStays([]); return [];
      } finally { controller.signal.removeEventListener('abort', abortStays); }
    })();
    return currentStayPromise;
  }
  function viewportChanged() {
    if (disposed || failed || !map) return;
    zoomIn.disabled = (map.getZoom?.() || 0) >= 18; zoomOut.disabled = (map.getZoom?.() || 0) <= 2;
    for (const overlay of [...stopOverlays, ...stayOverlays]) overlay.draw();
    const style = (map.getZoom?.() || 0) >= DETAIL_ZOOM ? DETAIL_STYLE : QUIET_STYLE;
    if (style !== styled) { styled = style; map.setOptions({ styles: style }); }
    declutter(); pip?.draw();
  }
  const ready = (async () => {
    try {
      maps = await abortable(loadGoogleMaps(), controller.signal);
      if (disposed || failed || controller.signal.aborted) throw abortError();
      if (![maps?.Map, maps?.OverlayView, maps?.Polyline, maps?.LatLngBounds].every(value => typeof value === 'function')) throw unavailableError();
      const locations = await resolveMany(stops, controller.signal);
      if (disposed || failed || controller.signal.aborted) throw abortError();
      points = stops.map((stop, order) => ({ stop, order, status: locations[order].status,
        location: locations[order].status === 'resolved' ? locations[order].location : null }));
      if (stops.length && locations.every(value => value.status === 'unavailable')) throw unavailableError();
      identity = JSON.stringify(points.map(point => [String(point.stop.uid), point.location ? [point.location.lat, point.location.lng] : null]));
      savedViewport = viewports.get(viewportKey());
      instance = acquireMap(maps, viewport); map = instance.map;
      createOverlayClass();
      for (const point of points.filter(point => point.location)) {
        const overlay = new PinOverlay(point, 'stop', choose);
        stopOverlays.push(overlay); overlay.setMap(map);
      }
      for (let i = 1; i < points.length; i++) if (points[i - 1].location && points[i].location) {
        const line = new maps.Polyline({ map, path: [locationPoint(points[i - 1].location), locationPoint(points[i].location)], geodesic: true, strokeOpacity: 0,
          clickable: false, icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: .85, strokeColor: '#ecc981', scale: 2 }, offset: '0', repeat: '12px' },
            // which way the route runs
            { icon: { path: maps.SymbolPath?.FORWARD_CLOSED_ARROW ?? 1, scale: 2.6, strokeColor: '#ecc981', strokeOpacity: .95, fillColor: '#ecc981', fillOpacity: .95 }, offset: '55%' }] });
        lines.push(line);
      }
      drawMissing(); updateSelection(); loading.remove();
      fitButton.disabled = !points.some(point => point.location); zoomIn.disabled = false; zoomOut.disabled = false;
      addMapListener('dragstart', () => { manuallyMoved = true; });
      addMapListener('zoom_changed', viewportChanged);
      addMapListener('idle', viewportChanged);
      listen(viewport, 'wheel', event => { if (event.ctrlKey || event.metaKey) manuallyMoved = true; }, { passive: true });
      listen(viewport, 'keydown', event => { if (['+', '=', '-', '_', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) manuallyMoved = true; });
      listen(viewport, 'pointerdown', event => { if (event.pointerType === 'touch' && !event.target.closest('button')) manuallyMoved = true; }, { passive: true });
      listen(zoomIn, 'click', () => { manuallyMoved = true; map.setZoom(clamp((map.getZoom?.() || 2) + 1, 2, 18)); });
      listen(zoomOut, 'click', () => { manuallyMoved = true; map.setZoom(clamp((map.getZoom?.() || 2) - 1, 2, 18)); });
      listen(fitButton, 'click', () => fit()); listen(stayArea, 'click', () => fit('stays'));
      if (savedViewport?.identity === identity && savedViewport.manuallyMoved) {
        map.setCenter(savedViewport.center); map.setZoom(savedViewport.zoom); manuallyMoved = true; fitScope = savedViewport.scope || fitScope;
      } else fit(options.focusStays ? 'stays' : 'trip');
      let lastWidth = viewport.clientWidth, lastHeight = viewport.clientHeight;
      if (typeof ResizeObserver === 'function') {
        resizeObserver = new ResizeObserver(() => {
          if (disposed || failed || !map || lastWidth === viewport.clientWidth && lastHeight === viewport.clientHeight) return;
          const center = centerOf(map); lastWidth = viewport.clientWidth; lastHeight = viewport.clientHeight;
          maps.event?.trigger?.(map, 'resize');
          if (!manuallyMoved) fit(fitScope); else if (center) map.setCenter(center);
        });
        resizeObserver.observe(viewport);
      }
      maps.event?.trigger?.(map, 'resize'); viewportChanged();
      await refreshStays();
      if (disposed || failed || controller.signal.aborted) throw abortError();
      // If selection changed during initial address lookup, wait for its lookup.
      let pending = currentStayPromise;
      while (!disposed && !failed) { await pending; if (pending === currentStayPromise) break; pending = currentStayPromise; }
      if (disposed || failed || controller.signal.aborted) throw abortError();
      complete = true; wrapper.setAttribute('aria-busy', 'false'); wrapper.dataset.mapState = 'ready';
      void startPip();
      return { provider: 'google', resolvedStops: points.filter(point => point.location).length, unmappedStops: points.filter(point => !point.location).map(point => ({ uid: point.stop.uid, status: point.status })) };
    } catch (error) {
      if (disposed) throw abortError();
      fail(); throw unavailableError();
    }
  })();
  // Keep fire-and-forget callers from creating an unhandled rejection while
  // preserving the original rejecting promise for the owner's fallback path.
  ready.catch(() => {});
  const dispose = () => {
    if (disposed) return;
    remember(); disposed = true; teardownAdapter(); unsubscribeFailure(); wrapper.remove();
  };
  dispose.select = uid => select(uid);
  dispose.ready = ready;
  return dispose;
}
