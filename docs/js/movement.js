// A visual concept only. These activities are invented and never read or saved.
const SAMPLE = [
  { type: "RUN", daysAgo: 1, name: "Run", km: 6.2, minutes: 38, climb: 73, pace: "6:08 /km", route: "M48 148 C65 130 72 109 91 114 L119 74 C132 58 157 86 174 59 C194 38 221 54 225 83 L262 101 C270 126 241 146 215 135 L181 155 C151 169 131 139 110 150 C83 161 61 155 48 148" },
  { type: "RIDE", daysAgo: 3, name: "Ride", km: 24.8, minutes: 72, climb: 156, pace: "20.7 km/h", route: "M38 152 L69 135 L84 93 L122 101 L145 57 L193 42 L228 55 L276 33 L290 68 L252 92 L268 125 L230 143 L190 117 L144 149 L101 135 L65 155" },
  { type: "WALK", daysAgo: 5, name: "Walk", km: 4.6, minutes: 58, climb: 24, pace: "12:36 /km", route: "M65 146 L93 126 L80 105 L101 78 L141 91 L158 60 L185 86 L220 72 L242 99 L223 128 L182 114 L154 144 L115 135 L91 156" }
];
const NS = "http://www.w3.org/2000/svg";
const el = (tag, className, ...children) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children.flat().filter(child => child != null));
  return node;
};
const words = (tag, className, text) => el(tag, className, document.createTextNode(text));
function svg(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}
const day = offset => {
  const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() - offset);
  return date;
};
const dateLabel = date => new Intl.DateTimeFormat("en", { weekday: "short", day: "2-digit", month: "short" }).format(date).toUpperCase();
const minutes = value => value >= 60 ? `${Math.floor(value / 60)}h ${String(value % 60).padStart(2, "0")}m` : `${value} min`;

export function mount(body) {
  let selected = 0;
  const totalKm = SAMPLE.reduce((sum, item) => sum + item.km, 0);
  const totalMinutes = SAMPLE.reduce((sum, item) => sum + item.minutes, 0);
  const totalClimb = SAMPLE.reduce((sum, item) => sum + item.climb, 0);

  const heading = el("div", "movement-heading",
    words("h1", "movement-title", "movement"),
    words("span", "movement-demo", "SAMPLE DATA"));
  const hero = el("section", "movement-summary",
    words("div", "movement-kicker", "LAST 7 DAYS"),
    el("div", "movement-distance", words("span", "movement-distance-number", totalKm.toFixed(1)), words("span", "movement-distance-unit", "km")),
    el("div", "movement-totals",
      el("div", "", words("strong", "", minutes(totalMinutes)), words("span", "", "moving")),
      el("div", "", words("strong", "", String(SAMPLE.length)), words("span", "", "activities")),
      el("div", "", words("strong", "", `${totalClimb} m`), words("span", "", "climb"))));
  const bars = el("div", "movement-bars");
  bars.setAttribute("role", "img");
  bars.setAttribute("aria-label", "Distance by day, last seven days: 4.6, 24.8 and 6.2 kilometres on three different days");
  for (let offset = 6; offset >= 0; offset--) {
    const activity = SAMPLE.find(item => item.daysAgo === offset);
    const column = el("div", "movement-bar-column");
    const stem = el("span", "movement-bar" + (offset === 1 ? " recent" : ""));
    stem.style.height = activity ? `${Math.max(10, activity.km / 24.8 * 100)}%` : "0";
    column.title = activity ? `${activity.km.toFixed(1)} km` : "No activity";
    column.append(stem, words("span", "movement-day", new Intl.DateTimeFormat("en", { weekday: "short" }).format(day(offset)).slice(0, 2).toUpperCase()));
    bars.append(column);
  }

  const list = el("div", "movement-list");
  const detail = el("section", "movement-detail");
  const render = () => {
    list.replaceChildren();
    for (const [index, item] of SAMPLE.entries()) {
      const row = el("button", "movement-row" + (index === selected ? " selected" : ""),
        el("span", "movement-row-main", words("span", "movement-row-type", item.type), words("span", "movement-row-date", dateLabel(day(item.daysAgo)))),
        el("span", "movement-row-values", `${item.km.toFixed(1)} km`, words("span", "movement-row-time", minutes(item.minutes))));
      row.type = "button";
      row.setAttribute("aria-pressed", String(index === selected));
      row.setAttribute("aria-label", `${item.type.toLowerCase()}, ${item.km.toFixed(1)} kilometres, ${minutes(item.minutes)}, ${dateLabel(day(item.daysAgo))}`);
      row.addEventListener("click", () => {
        selected = index; render();
        list.children[index].focus({ preventScroll: true });
        if (matchMedia("(max-width: 899px)").matches) detail.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
      });
      list.append(row);
    }
    const item = SAMPLE[selected];
    const route = svg("svg", { viewBox: "0 0 320 190", role: "img", "aria-label": `Sample ${item.type.toLowerCase()} route` });
    route.append(svg("path", { d: item.route, fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }));
    const start = selected === 0 ? [48, 148] : selected === 1 ? [38, 152] : [65, 146];
    route.append(svg("circle", { cx: start[0], cy: start[1], r: 4, fill: "currentColor" }));
    detail.replaceChildren(
      el("div", "movement-detail-header", words("span", "movement-kicker", `${item.type} / ${dateLabel(day(item.daysAgo))}`), words("span", "movement-detail-index", `0${selected + 1} / 0${SAMPLE.length}`)),
      words("h2", "movement-detail-title", item.name),
      el("div", "movement-route", route),
      el("div", "movement-detail-distance", words("strong", "", item.km.toFixed(1)), words("span", "", "km")),
      el("div", "movement-detail-metrics",
        el("div", "", words("strong", "", minutes(item.minutes)), words("span", "", "moving")),
        el("div", "", words("strong", "", item.pace), words("span", "", item.type === "RIDE" ? "average" : "pace")),
        el("div", "", words("strong", "", `${item.climb} m`), words("span", "", "climb"))));
  };
  body.replaceChildren(heading, el("div", "movement-layout",
    el("div", "movement-overview", hero, bars),
    detail,
    el("section", "movement-activities", words("h2", "movement-kicker movement-list-label", "ACTIVITIES"), list)));
  render();
}
