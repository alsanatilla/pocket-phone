import world from './travel-world.json';
import { normalizeDestination as norm, destinationCountry as countryName, destinationPlace as placeName } from './travel-links.js';
export { mapsSearchUrl, mapsDirectionsUrl } from './travel-links.js';

// This is a bundled trip overview, not a road routing or geocoding service.
// Country outlines and the small, verified destination index are credited in public/maps/CREDITS.md.
const SVG_NS = 'http://www.w3.org/2000/svg';
const WORLD_WIDTH = 3600;
// Route UI redraws after selection/live updates. Keep only eight in-memory viewports;
// nothing is written to a browser store or synced to another person.
const viewportCache = new Map();
const keepViewport = (uid, value) => {
  if (!uid) return;
  viewportCache.delete(uid); viewportCache.set(uid, value);
  while (viewportCache.size > 8) viewportCache.delete(viewportCache.keys().next().value);
};
const index = new Map(world.locations.map(place => [`${norm(place.name)}|${norm(place.country)}`, place]));
const knownLocation = stop => index.get(`${norm(placeName(stop))}|${norm(countryName(stop?.country))}`) || null;
const project = ([longitude, latitude]) => [(longitude + 180) * 10, (90 - latitude) * 10];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) if (value != null) node.setAttribute(key, value);
  node.append(...children);
  return node;
}
function svg(tag, attributes = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) if (value != null) node.setAttribute(key, value);
  node.append(...children);
  return node;
}
const countryPath = country => country.rings.map(ring => ring.map((coordinate, i) => {
  const [x, y] = project(coordinate);
  return `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
}).join(' ') + 'Z').join(' ');
const countryPaths = world.countries.map(country => ({ ...country, path: countryPath(country) }));

/**
 * Mount a local geographic route overview. Selection is always a stop UID.
 * Returns an idempotent disposer; disposer.select(uid) changes selection without resetting the viewport.
 * There are no writes, external fetches, geolocation requests, or provider SDK calls.
 */
export function mountRouteMap(host, trip, selectedStopId, onSelect = () => {}) {
  const stops = Array.isArray(trip?.stops) ? trip.stops.filter(stop => stop?.uid) : [];
  const controller = new AbortController();
  const listen = (node, event, handler, options = {}) => node.addEventListener(event, handler, { ...options, signal: controller.signal });
  let disposed = false, selected = String(selectedStopId || ''), frame = 0;
  const wrapper = el('div', { class: 'travel-route-map' });
  const selections = new Map();
  const mapped = stops.map((stop, order) => ({ stop, order, location: knownLocation(stop) })).filter(point => point.location);
  const unmapped = stops.filter(stop => !knownLocation(stop));
  const tripId = String(trip?.uid || '');
  const routeIdentity = JSON.stringify(stops.map(stop => [String(stop.uid), knownLocation(stop)?.coordinates || null]));
  const select = (uid, notify = false) => {
    if (disposed || !stops.some(stop => String(stop.uid) === String(uid))) return;
    const changed = selected !== String(uid);
    selected = String(uid);
    for (const [id, nodes] of selections) for (const node of nodes) {
      const active = id === selected;
      node.classList.toggle('is-selected', active);
      node.setAttribute('aria-pressed', String(active));
    }
    if (notify && changed) onSelect(uid);
  };
  const registerSelection = (node, stop) => {
    const uid = String(stop.uid), nodes = selections.get(uid) || [];
    nodes.push(node); selections.set(uid, nodes);
    node.setAttribute('data-stop-uid', uid);
  };
  const fallback = (items, allUnknown = false) => {
    const row = el('div', { class: `travel-map-unmapped${allUnknown ? ' travel-map-schematic' : ''}` });
    row.append(el('span', { class: 'travel-map-fallback-label' }, allUnknown ? 'Route order' : 'Not on map'));
    const list = el('ol', { class: 'travel-map-route-order' });
    for (const stop of items) {
      const button = el('button', { type: 'button', 'aria-pressed': 'false', 'aria-label': `Select ${placeName(stop)}` },
        el('span', { class: 'travel-map-order-number', 'aria-hidden': 'true' }, String(stops.indexOf(stop) + 1)),
        el('span', {}, placeName(stop) || 'Destination'));
      registerSelection(button, stop);
      listen(button, 'click', () => select(stop.uid, true));
      list.append(el('li', {}, button));
    }
    row.append(list); return row;
  };
  if (!mapped.length) {
    if (tripId) viewportCache.delete(tripId);
    wrapper.dataset.mapMode = 'schematic';
    wrapper.append(stops.length ? fallback(stops, true) : el('p', { class: 'travel-map-empty' }, 'No destinations yet'));
    host.replaceChildren(wrapper); select(selected);
    const dispose = () => { if (disposed) return; disposed = true; controller.abort(); wrapper.remove(); };
    dispose.select = uid => select(uid);
    return dispose;
  }

  wrapper.dataset.mapMode = 'geographic';
  // Keep trips crossing the date line together instead of drawing a line around the globe.
  let previousX = null;
  for (const point of mapped) {
    point.coordinate = project(point.location.coordinates);
    if (previousX != null) {
      while (point.coordinate[0] - previousX > WORLD_WIDTH / 2) point.coordinate[0] -= WORLD_WIDTH;
      while (previousX - point.coordinate[0] > WORLD_WIDTH / 2) point.coordinate[0] += WORLD_WIDTH;
    }
    previousX = point.coordinate[0];
  }
  const viewport = el('div', { class: 'travel-map-viewport' });
  const canvas = svg('svg', { class: 'travel-map-canvas', viewBox: '0 0 680 340', tabindex: '0', role: 'group',
    'aria-label': 'Trip route map. Arrow keys pan, plus and minus zoom, Home fits the trip.' });
  const visited = new Set(stops.map(stop => norm(countryName(stop.country))));
  const earth = svg('g', { class: 'travel-map-earth', 'aria-hidden': 'true' });
  for (const shift of [-WORLD_WIDTH, 0, WORLD_WIDTH]) {
    const layer = svg('g', { transform: `translate(${shift} 0)` });
    for (const country of countryPaths) layer.append(svg('path', { class: `travel-map-country${visited.has(norm(country.name)) ? ' is-visited' : ''}`, d: country.path, 'fill-rule': 'evenodd' }));
    earth.append(layer);
  }
  const countryLabels = svg('g', { class: 'travel-map-country-labels', 'aria-hidden': 'true' });
  const labelPositions = [];
  for (const country of countryPaths.filter(country => visited.has(norm(country.name)))) {
    const text = svg('text', { class: 'travel-map-country-label', 'text-anchor': 'middle' });
    text.textContent = country.name;
    const point = project(country.label);
    const nearbyX = mapped[0].coordinate[0];
    point[0] += Math.round((nearbyX - point[0]) / WORLD_WIDTH) * WORLD_WIDTH;
    countryLabels.append(text); labelPositions.push({ text, coordinate: point });
  }
  const route = svg('g', { class: 'travel-map-connections', 'aria-hidden': 'true' });
  for (let i = 1; i < mapped.length; i++) {
    const from = mapped[i - 1], to = mapped[i];
    // An unknown stop breaks the geographic route: never silently skip it.
    if (to.order !== from.order + 1) continue;
    route.append(svg('path', { class: 'travel-map-thread', d: `M${from.coordinate.join(',')}L${to.coordinate.join(',')}` }));
  }
  const pins = svg('g', { class: 'travel-map-pins' });
  for (const point of mapped) {
    const { stop, order, coordinate, location } = point;
    const marker = svg('g', { class: 'travel-map-marker', transform: `translate(${coordinate.join(' ')})` });
    const pin = svg('g', { class: 'travel-map-pin', role: 'button', tabindex: '0', 'aria-pressed': 'false',
      'aria-label': `Select ${order + 1}. ${placeName(stop)}, ${countryName(stop.country)}`,
      transform: 'translate(0 0)' });
    const title = svg('title'); title.textContent = `${order + 1}. ${placeName(stop)} · ${location.country}`;
    const number = svg('text', { class: 'travel-map-pin-number', 'text-anchor': 'middle', 'dominant-baseline': 'central', 'aria-hidden': 'true' });
    number.textContent = String(order + 1);
    const label = svg('text', { class: 'travel-map-pin-label', 'aria-hidden': 'true' }); label.textContent = placeName(stop);
    const leader = svg('line', { class: 'travel-map-pin-leader', x1: '0', y1: '0', x2: '0', y2: '0' });
    const locationDot = svg('circle', { class: 'travel-map-location-dot', r: '2.5', cx: '0', cy: '0' });
    const hit = svg('rect', { class: 'travel-map-pin-hit', x: '-22', y: '-22', width: '44', height: '44' });
    pin.append(title, hit, svg('circle', { class: 'travel-map-pin-circle', r: '13' }), number, label);
    marker.append(leader, locationDot, pin); pins.append(marker);
    registerSelection(pin, stop);
    point.pin = pin; point.marker = marker; point.hit = hit; point.leader = leader; point.dot = locationDot; point.label = label;
  }
  canvas.append(earth, countryLabels, route, pins);
  const fitButton = el('button', { type: 'button', class: 'travel-map-fit', 'aria-label': 'Fit all mapped destinations' }, 'Fit trip');
  const zoomIn = el('button', { type: 'button', 'aria-label': 'Zoom in' }, '+');
  const zoomOut = el('button', { type: 'button', 'aria-label': 'Zoom out' }, '−');
  const controls = el('div', { class: 'travel-map-zoom', role: 'group', 'aria-label': 'Map zoom' }, zoomIn, zoomOut);
  viewport.append(canvas, fitButton, controls);
  const credit = el('div', { class: 'travel-map-credit' },
    el('span', {}, 'Trip order'),
    el('span', {}, el('a', { href: 'https://www.naturalearthdata.com/', target: '_blank', rel: 'noopener noreferrer' }, 'Natural Earth'), ' · ',
      el('a', { href: 'https://www.geonames.org/', target: '_blank', rel: 'noopener noreferrer' }, 'GeoNames')));
  wrapper.append(viewport, credit);
  if (unmapped.length) wrapper.append(fallback(unmapped));
  host.replaceChildren(wrapper);

  let view = [0, 0, 680, 340], manuallyMoved = false, suppressClickUntil = 0;
  const pointers = new Map();
  let gesture = null;
  const size = () => {
    const rect = canvas.getBoundingClientRect();
    return { width: rect.width || host.clientWidth || 680, height: rect.height || 340, left: rect.left, top: rect.top };
  };
  const updatePins = () => {
    if (disposed) return;
    const { width, height } = size(), scale = view[2] / width;
    const occupied = [];
    for (const point of mapped) {
      const x = (point.coordinate[0] - view[0]) / scale, y = (point.coordinate[1] - view[1]) / scale;
      // Labels move only to separate nearby destinations; a leader retains the real coordinate.
      const candidates = [[0, 0], [0, -44], [0, 44], [-44, -44], [44, 44], [-44, 44], [44, -44], [0, -88], [0, 88]];
      for (const distance of [88, 132, 176]) for (const dx of [-distance, 0, distance]) for (const dy of [-distance, 0, distance]) if (dx || dy) candidates.push([dx, dy]);
      const labelWidth = Math.max(35, point.label.getComputedTextLength());
      let offset = [0, 0], best = Infinity, side = 1;
      for (const [dx, dy] of candidates) {
        const px = x + dx, py = y + dy;
        const candidateSide = px > width * .6 ? -1 : 1;
        const box = { x1: candidateSide > 0 ? px - 22 : px - labelWidth - 26, x2: candidateSide > 0 ? px + labelWidth + 26 : px + 22, y1: py - 22, y2: py + 22 };
        let score = Math.hypot(dx, dy) / 1000;
        for (const other of occupied) if (box.x1 < other.x2 && box.x2 > other.x1 && box.y1 < other.y2 && box.y2 > other.y1) score += 10;
        if (x >= 0 && x <= width && y >= 0 && y <= height) {
          if (box.x1 < 4 || box.x2 > width - 4 || box.y1 < 6 || box.y2 > height - 6) score += 20;
          if (box.y1 < 58 && box.x1 < 108 || box.y1 < 105 && box.x2 > width - 58) score += 20;
        }
        if (score < best) { best = score; offset = [dx, dy]; side = candidateSide; point.labelBox = box; }
        if (score < 1) break;
      }
      occupied.push(point.labelBox);
      point.marker.setAttribute('transform', `translate(${point.coordinate.join(' ')}) scale(${scale})`);
      point.pin.setAttribute('transform', `translate(${offset.join(' ')})`);
      point.hit.setAttribute('x', side > 0 ? '-22' : String(-labelWidth - 26));
      point.hit.setAttribute('width', String(labelWidth + 48));
      point.leader.setAttribute('x2', offset[0]); point.leader.setAttribute('y2', offset[1]);
      point.leader.style.display = offset[0] || offset[1] ? '' : 'none';
      point.dot.style.display = offset[0] || offset[1] ? '' : 'none';
      point.label.setAttribute('x', side * 22); point.label.setAttribute('y', '4');
      point.label.setAttribute('text-anchor', side > 0 ? 'start' : 'end');
    }
    for (const { text, coordinate } of labelPositions) text.setAttribute('transform', `translate(${coordinate.join(' ')}) scale(${scale})`);
    zoomIn.disabled = view[2] <= 25.01; zoomOut.disabled = view[2] >= 3799.99;
  };
  const applyView = next => {
    if (disposed) return;
    const { width, height } = size(), ratio = width / height;
    const w = clamp(next[2], 25, 3800), h = w / ratio;
    let cx = next[0] + next[2] / 2, cy = next[1] + next[3] / 2;
    cx = clamp(cx, -WORLD_WIDTH / 2, WORLD_WIDTH * 1.5);
    cy = clamp(cy, -h * .2, 1800 + h * .2);
    view = [cx - w / 2, cy - h / 2, w, h];
    canvas.setAttribute('viewBox', view.join(' '));
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; updatePins(); });
  };
  const fit = () => {
    const { width, height } = size(), ratio = width / height;
    const xs = mapped.map(point => point.coordinate[0]), ys = mapped.map(point => point.coordinate[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const usableWidth = Math.max(.35, 1 - Math.min(180, width * .3) / width);
    const usableHeight = Math.max(.35, 1 - 120 / height);
    const w = Math.max(100, (maxX - minX) / usableWidth, (maxY - minY) / usableHeight * ratio);
    const h = w / ratio;
    applyView([(minX + maxX - w) / 2, (minY + maxY - h) / 2, w, h]);
    manuallyMoved = false;
  };
  const zoom = (factor, anchor = null) => {
    const { width, height } = size(), p = anchor || [width / 2, height / 2];
    const nextWidth = clamp(view[2] * factor, 25, 3800), nextHeight = nextWidth / (width / height);
    const x = view[0] + p[0] / width * view[2], y = view[1] + p[1] / height * view[3];
    applyView([x - p[0] / width * nextWidth, y - p[1] / height * nextHeight, nextWidth, nextHeight]);
    manuallyMoved = true;
  };
  const resetGesture = () => {
    const values = [...pointers.values()];
    if (!values.length) { gesture = null; canvas.classList.remove('is-dragging'); return; }
    gesture = { points: values.map(point => ({ ...point })), view: [...view], moved: false };
    if (values.length > 1) {
      gesture.distance = Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y) || 1;
      gesture.midpoint = [(values[0].x + values[1].x) / 2, (values[0].y + values[1].y) / 2];
      suppressClickUntil = Date.now() + 350;
    }
  };
  listen(canvas, 'pointerdown', event => {
    if (event.button !== 0) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); resetGesture();
    // A simple pin tap remains a click; dragging or a second finger captures the canvas.
    if (!event.target.closest('.travel-map-pin') || pointers.size > 1) canvas.setPointerCapture(event.pointerId);
    if (pointers.size > 1) for (const pointerId of pointers.keys()) { try { canvas.setPointerCapture(pointerId); } catch {} }
  });
  listen(canvas, 'pointermove', event => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const values = [...pointers.values()], { width, height, left, top } = size();
    if (values.length > 1 && gesture.points.length > 1) {
      const distance = Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y) || 1;
      const midpoint = [(values[0].x + values[1].x) / 2, (values[0].y + values[1].y) / 2];
      const factor = gesture.distance / distance, w = clamp(gesture.view[2] * factor, 25, 3800), h = w / (width / height);
      const worldX = gesture.view[0] + (gesture.midpoint[0] - left) / width * gesture.view[2];
      const worldY = gesture.view[1] + (gesture.midpoint[1] - top) / height * gesture.view[3];
      applyView([worldX - (midpoint[0] - left) / width * w, worldY - (midpoint[1] - top) / height * h, w, h]);
      gesture.moved = true;
    } else {
      const dx = values[0].x - gesture.points[0].x, dy = values[0].y - gesture.points[0].y;
      if (!gesture.moved && Math.hypot(dx, dy) < 5) return;
      canvas.setPointerCapture(event.pointerId);
      applyView([gesture.view[0] - dx / width * gesture.view[2], gesture.view[1] - dy / height * gesture.view[3], gesture.view[2], gesture.view[3]]);
      gesture.moved = true;
    }
    manuallyMoved = true; canvas.classList.add('is-dragging'); suppressClickUntil = Date.now() + 350;
  });
  const release = event => {
    if (!pointers.has(event.pointerId)) return;
    if (gesture?.moved || pointers.size > 1) suppressClickUntil = Date.now() + 350;
    pointers.delete(event.pointerId);
    try { if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); } catch {}
    resetGesture();
  };
  listen(canvas, 'pointerup', release); listen(canvas, 'pointercancel', release); listen(canvas, 'lostpointercapture', release);
  listen(canvas, 'click', event => {
    const pin = event.target.closest('.travel-map-pin');
    if (pin && Date.now() >= suppressClickUntil) select(pin.getAttribute('data-stop-uid'), true);
  });
  listen(canvas, 'keydown', event => {
    const pin = event.target.closest('.travel-map-pin');
    if (pin) {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(pin.getAttribute('data-stop-uid'), true); }
      else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); const n = mapped.findIndex(point => point.pin === pin), direction = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
        const next = mapped[(n + direction + mapped.length) % mapped.length]; next.pin.focus();
        const { width, height } = size(), margin = view[2] / width * 65;
        if (next.coordinate[0] < view[0] + margin || next.coordinate[0] > view[0] + view[2] - margin || next.coordinate[1] < view[1] + margin || next.coordinate[1] > view[1] + view[3] - margin) {
          applyView([next.coordinate[0] - view[2] / 2, next.coordinate[1] - view[3] / 2, view[2], view[2] / (width / height)]); manuallyMoved = true;
        }
      }
      return;
    }
    if (['+', '=', '-', '_', 'Home', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) event.preventDefault();
    if (event.key === '+' || event.key === '=') zoom(.75);
    else if (event.key === '-' || event.key === '_') zoom(1.35);
    else if (event.key === 'Home') fit();
    else if (event.key.startsWith('Arrow')) {
      const dx = event.key === 'ArrowLeft' ? -.12 : event.key === 'ArrowRight' ? .12 : 0;
      const dy = event.key === 'ArrowUp' ? -.12 : event.key === 'ArrowDown' ? .12 : 0;
      applyView([view[0] + view[2] * dx, view[1] + view[3] * dy, view[2], view[3]]); manuallyMoved = true;
    }
  });
  listen(canvas, 'wheel', event => {
    // Keep ordinary page scrolling available; focus or a modifier opts into map zoom.
    if (!event.ctrlKey && !event.metaKey && document.activeElement !== canvas) return;
    event.preventDefault(); const rect = size();
    zoom(Math.exp(clamp(event.deltaY, -150, 150) * .003), [event.clientX - rect.left, event.clientY - rect.top]);
  }, { passive: false });
  listen(fitButton, 'click', fit); listen(zoomIn, 'click', () => zoom(.75)); listen(zoomOut, 'click', () => zoom(1.35));
  let lastSize = size();
  const resized = () => {
    if (disposed) return;
    const nextSize = size();
    if (nextSize.width === lastSize.width && nextSize.height === lastSize.height) return;
    if (!manuallyMoved) fit();
    else {
      const width = view[3] * nextSize.width / nextSize.height;
      applyView([view[0] + (view[2] - width) / 2, view[1], width, view[3]]);
    }
    lastSize = nextSize;
  };
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resized) : null;
  if (observer) observer.observe(viewport); else listen(window, 'resize', resized);
  const saved = tripId && viewportCache.get(tripId);
  select(selected);
  if (saved?.identity === routeIdentity && saved.manuallyMoved) {
    const { width, height } = size(), nextWidth = saved.view[3] * width / height;
    applyView([saved.view[0] + (saved.view[2] - nextWidth) / 2, saved.view[1], nextWidth, saved.view[3]]);
    manuallyMoved = true;
  } else fit();
  updatePins();
  const dispose = () => {
    if (disposed) return;
    keepViewport(tripId, { identity: routeIdentity, view: [...view], manuallyMoved });
    disposed = true; controller.abort(); observer?.disconnect();
    if (frame) cancelAnimationFrame(frame);
    pointers.clear(); gesture = null; wrapper.remove();
  };
  dispose.select = uid => select(uid);
  return dispose;
}
