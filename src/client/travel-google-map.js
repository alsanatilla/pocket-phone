import { loadGoogleMaps, onMapsAuthFailure } from './google-maps.js';
import { resolveLocation } from './travel-geocoding.js';
import './travel-google-map.css';

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
const viewports = new Map();
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
  const options = { center: { lat: 0, lng: 0 }, zoom: 2, minZoom: 2, maxZoom: 18, styles: WARM_MAP_STYLE,
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
  }
  function select(uid, notify = false) {
    if (disposed || failed || !stops.some(stop => String(stop.uid) === String(uid))) return;
    const next = String(uid), changed = selected !== next;
    if (changed && options.focusStays) remember();
    selected = next; updateSelection();
    if (notify && changed) onSelect(uid);
    if (changed && map && !disposed && !failed) {
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
        this.element = el('div', { class: `travel-google-pin ${kind === 'stay' ? 'is-stay' : 'is-stop'}` });
        const name = kind === 'stay' ? point.stay.name || 'Stay' : point.stop.place || 'Destination';
        const status = kind === 'stay' ? point.stay.status : '';
        const descriptor = kind === 'stay' ? `${name}${status ? ', ' + status : ''}` : `${point.order + 1}. ${name}${point.stop.country ? ', ' + point.stop.country : ''}`;
        this.button = el('button', { type: 'button', class: 'travel-google-pin-button', 'aria-label': `${kind === 'stay' ? 'Open stay ' : 'Select '}${descriptor}${kind === 'stay' && point.location.approximate ? '. Approximate location.' : ''}`,
          'data-stop-uid': point.stop?.uid, 'data-stay-uid': point.stay?.uid },
          el('span', { class: 'travel-google-pin-number', 'aria-hidden': 'true' }, kind === 'stay' ? '⌂' : String(point.order + 1)),
          el('span', { class: 'travel-google-pin-name' }, name));
        this.element.classList.toggle('is-approximate', Boolean(point.location.approximate));
        if (kind === 'stay') this.element.classList.add(['booked', 'included'].includes(status) ? 'is-booked' : status === 'chosen' ? 'is-chosen' : 'is-saved');
        this.element.append(this.button); listen(this.button, 'click', event => { event.preventDefault(); if (!disposed && !failed) activate(); });
        listen(this.button, 'keydown', event => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const collection = kind === 'stay' ? stayOverlays : stopOverlays, index = collection.indexOf(this);
          collection[(index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + collection.length) % collection.length]?.button.focus();
        });
        maps.OverlayView.preventMapHitsAndGesturesFrom?.(this.element);
      }
      onAdd() { if (!disposed && !failed) this.getPanes()?.overlayMouseTarget?.append(this.element); }
      draw() {
        if (disposed || failed) return;
        const pixel = this.getProjection()?.fromLatLngToDivPixel(locationPoint(this.point.location));
        if (!pixel || !Number.isFinite(pixel.x) || !Number.isFinite(pixel.y)) { this.element.hidden = true; return; }
        this.element.hidden = false; this.element.style.left = `${pixel.x}px`; this.element.style.top = `${pixel.y}px`;
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
    };
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
        const overlay = new PinOverlay(point, 'stop', () => select(point.stop.uid, true));
        stopOverlays.push(overlay); overlay.setMap(map);
      }
      for (let i = 1; i < points.length; i++) if (points[i - 1].location && points[i].location) {
        const line = new maps.Polyline({ map, path: [locationPoint(points[i - 1].location), locationPoint(points[i].location)], geodesic: true, strokeOpacity: 0,
          clickable: false, icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: .85, strokeColor: '#ecc981', scale: 2 }, offset: '0', repeat: '12px' }] });
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
