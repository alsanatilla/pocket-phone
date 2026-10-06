// Small SVG instruments for the Movement cockpit. One accent for what matters now, greys for context;
// numbers and labels stay in text colours. Every mark carries a <title>, so hovering shows its value.
const NS = "http://www.w3.org/2000/svg";
export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) if (value != null) node.setAttribute(key, String(value));
  node.append(...children.filter(child => child != null));
  return node;
}
const title = text => svg("title", {}, document.createTextNode(text));
const lerp = ([d0, d1], [r0, r1]) => value => d1 === d0 ? (r0 + r1) / 2 : r0 + (value - d0) / (d1 - d0) * (r1 - r0);
const extent = values => { const known = values.filter(v => v != null); return known.length ? [Math.min(...known), Math.max(...known)] : [0, 1]; };
/** Joins points into path segments, breaking the line where a value is missing. */
const segments = points => {
  let d = "", open = false;
  for (const point of points) {
    if (!point) { open = false; continue; }
    d += `${open ? "L" : "M"}${point[0].toFixed(1)} ${point[1].toFixed(1)}`; open = true;
  }
  return d;
};

/** Ring gauge for a 0–100 value, with the number in its centre. */
export function ring(percent, size = 92, text = null) {
  const middle = size / 2, radius = middle - 5, length = 2 * Math.PI * radius, share = Math.max(0, Math.min(100, percent ?? 0)) / 100;
  return svg("svg", { viewBox: `0 0 ${size} ${size}`, class: "chart-ring", role: "img", "aria-label": `${percent ?? "no"} percent` },
    svg("circle", { cx: middle, cy: middle, r: radius, class: "chart-track", fill: "none", "stroke-width": 6 }),
    svg("circle", { cx: middle, cy: middle, r: radius, class: "chart-accent", fill: "none", "stroke-width": 6,
      "stroke-dasharray": `${(length * share).toFixed(1)} ${length.toFixed(1)}`, transform: `rotate(-90 ${middle} ${middle})` }),
    svg("text", { x: middle, y: middle, class: "chart-ring-value", "text-anchor": "middle", "dominant-baseline": "central" }, document.createTextNode(text ?? (percent == null ? "—" : `${percent}%`))));
}

/** A horizontal scale with a grey normal band, an optional baseline tick and the value as an accent marker. */
export function meter({ min, max, value, band = null, baseline = null, label = "" }) {
  const x = lerp([min, max], [4, 236]), clamp = v => Math.max(4, Math.min(236, x(v)));
  return svg("svg", { viewBox: "0 0 240 22", class: "chart-meter", role: "img", "aria-label": label },
    svg("rect", { x: 4, y: 10, width: 232, height: 2, class: "chart-fill-track" }),
    band ? svg("rect", { x: clamp(band[0]), y: 6, width: Math.max(2, clamp(band[1]) - clamp(band[0])), height: 10, class: "chart-fill-context" }, title(`normal ${band[0]}–${band[1]}`)) : null,
    baseline != null ? svg("rect", { x: clamp(baseline) - 1, y: 3, width: 2, height: 16, class: "chart-fill-white" }, title(`baseline ${baseline}`)) : null,
    value != null ? svg("rect", { x: clamp(value) - 2, y: 0, width: 4, height: 22, class: "chart-fill-accent" }, title(String(value))) : null);
}

/** Proportions as one bar split into parts, with a 2px gap between them. */
export function stack(parts) {
  const total = parts.reduce((sum, part) => sum + (part.value || 0), 0) || 1, bar = document.createElement("div");
  bar.className = "chart-stack";
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", parts.map(part => `${part.label} ${part.text}`).join(", "));
  for (const part of parts) {
    if (!part.value) continue;
    const piece = document.createElement("span");
    piece.className = "chart-stack-part tone-" + part.tone;
    piece.style.flexGrow = String(part.value / total);
    piece.title = `${part.label} ${part.text}`;
    bar.append(piece);
  }
  return bar;
}

const DAY_W = 280, DAY_H = 64, DAY_PAD = 4;
/** Values over consecutive days as a line; missing days break it. The latest point is the accent. */
export function dayLine(days, values, { band = null, format = String, label = "" } = {}) {
  const [low, high] = extent([...values, ...(band ? band.flat() : [])]), pad = (high - low) * .15 || 1;
  const x = lerp([0, days.length - 1], [DAY_PAD, DAY_W - DAY_PAD]), y = lerp([low - pad, high + pad], [DAY_H - DAY_PAD, DAY_PAD]);
  const root = svg("svg", { viewBox: `0 0 ${DAY_W} ${DAY_H}`, class: "chart-days", role: "img", "aria-label": label });
  if (band) {
    const top = band.map((b, i) => b && [x(i), y(b[1])]), bottom = band.map((b, i) => b && [x(i), y(b[0])]).reverse();
    const known = top.filter(Boolean);
    if (known.length > 1) root.append(svg("path", { d: segments(top.filter(Boolean)) + segments(bottom.filter(Boolean)).replace(/^M/, "L") + "Z", class: "chart-fill-band" }, title("normal range")));
  }
  root.append(svg("path", { d: segments(values.map((v, i) => v != null && [x(i), y(v)])), class: "chart-line", fill: "none", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
  values.forEach((v, i) => { if (v != null) root.append(svg("circle", { cx: x(i), cy: y(v), r: 6, class: "chart-hit" }, title(`${days[i]} · ${format(v)}`))); });
  const last = values.findLastIndex(v => v != null);
  if (last >= 0) root.append(svg("circle", { cx: x(last), cy: y(values[last]), r: 4, class: "chart-fill-accent" }, title(`${days[last]} · ${format(values[last])}`)));
  return root;
}
/** Values over consecutive days as bars from zero. The latest bar is the accent. */
export function dayBars(days, values, { format = String, label = "", max = null } = {}) {
  const top = max ?? Math.max(1, ...values.filter(v => v != null)), slot = (DAY_W - DAY_PAD * 2) / days.length, width = Math.max(2, slot - 2);
  const y = lerp([0, top], [DAY_H, DAY_PAD]), last = values.findLastIndex(v => v != null && v > 0);
  const root = svg("svg", { viewBox: `0 0 ${DAY_W} ${DAY_H}`, class: "chart-days", role: "img", "aria-label": label });
  values.forEach((v, i) => {
    const left = DAY_PAD + i * slot;
    if (v) root.append(svg("rect", { x: left.toFixed(1), y: y(v).toFixed(1), width: width.toFixed(1), height: (DAY_H - y(v)).toFixed(1), class: i === last ? "chart-fill-accent" : "chart-fill-context" }));
    root.append(svg("rect", { x: left.toFixed(1), y: 0, width: slot.toFixed(1), height: DAY_H, class: "chart-hit" }, title(`${days[i]} · ${v ? format(v) : "no data"}`)));
  });
  return root;
}
/** Two measures in the same unit over days: `accent` is the one to watch, `context` the reference. */
export function dayPair(days, accent, context, { label = "", names = ["", ""] } = {}) {
  const [low, high] = extent([...accent, ...context]), y = lerp([Math.min(0, low), high * 1.1 || 1], [DAY_H - DAY_PAD, DAY_PAD]);
  const x = lerp([0, days.length - 1], [DAY_PAD, DAY_W - DAY_PAD]);
  const line = (values, cls) => svg("path", { d: segments(values.map((v, i) => v != null && [x(i), y(v)])), class: cls, fill: "none", "stroke-width": 2, "stroke-linejoin": "round" });
  const root = svg("svg", { viewBox: `0 0 ${DAY_W} ${DAY_H}`, class: "chart-days", role: "img", "aria-label": label },
    line(context, "chart-line-context"), line(accent, "chart-line-accent"));
  days.forEach((day, i) => root.append(svg("rect", { x: x(i) - 5, y: 0, width: 10, height: DAY_H, class: "chart-hit" },
    title(`${day} · ${names[0]} ${accent[i] ?? "—"} · ${names[1]} ${context[i] ?? "—"}`))));
  return root;
}

export const TRACE_W = 600, TRACE_H = 84;
/** Robust range: ignores the most extreme 2% at each end, so a standing stop does not flatten a pace chart. */
function spread(values) {
  const known = values.filter(v => v != null).sort((a, b) => a - b);
  if (!known.length) return [0, 1];
  const lo = known[Math.floor(known.length * .02)], hi = known[Math.ceil(known.length * .98) - 1];
  return lo === hi ? [lo - 1, hi + 1] : [lo, hi];
}
/**
 * One channel of an activity along its distance. `invert` puts lower values on top (pace: faster is higher).
 * Returns the chart and a function that moves its crosshair to a sample index (or hides it with null).
 */
export function trace(x, values, { invert = false, area = false } = {}) {
  const [lo, hi] = spread(values), pad = (hi - lo) * .08;
  const px = lerp([x[0], x.at(-1)], [0, TRACE_W]), py = lerp(invert ? [hi + pad, lo - pad] : [lo - pad, hi + pad], [TRACE_H - 2, 2]);
  const clamp = v => Math.max(1, Math.min(TRACE_H - 1, py(v)));
  const points = values.map((v, i) => v != null && [px(x[i]), clamp(v)]);
  const root = svg("svg", { viewBox: `0 0 ${TRACE_W} ${TRACE_H}`, preserveAspectRatio: "none", class: "chart-trace", "aria-hidden": "true" });
  if (area) {
    const known = points.filter(Boolean);
    if (known.length > 1) root.append(svg("path", { d: `M${known[0][0]} ${TRACE_H}` + segments(known).replace(/^M/, "L") + `L${known.at(-1)[0]} ${TRACE_H}Z`, class: "chart-fill-band" }));
  }
  root.append(svg("path", { d: segments(points), class: area ? "chart-line-context" : "chart-line", fill: "none", "stroke-width": 2, "vector-effect": "non-scaling-stroke", "stroke-linejoin": "round" }));
  const cross = svg("line", { x1: 0, x2: 0, y1: 0, y2: TRACE_H, class: "chart-line-accent", "stroke-width": 1, "vector-effect": "non-scaling-stroke", visibility: "hidden" });
  root.append(cross);
  const move = index => {
    if (index == null) { cross.setAttribute("visibility", "hidden"); return; }
    const at = px(x[index]).toFixed(1);
    cross.setAttribute("x1", at); cross.setAttribute("x2", at); cross.setAttribute("visibility", "visible");
  };
  return { node: root, move };
}
