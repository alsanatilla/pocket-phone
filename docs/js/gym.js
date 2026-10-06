// Gym: log sets during a workout, then read each lift's estimated best over time. Same records as GymActivity on the phone.
import { gym, e1rm, kgText, weekStart } from "./store.js?v=20261006-gym2";

const day = at => new Date(at).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
const minutes = ms => { const m = Math.max(0, Math.floor(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m} min`; };
const tonnes = kg => kg >= 1000 ? (kg / 1000).toFixed(1) + " t" : Math.round(kg) + " kg";
const set = s => `${kgText(s.kg)} × ${s.reps}`;
const line = sets => sets.map(set).join(" · ");
function trend(history) {
  if (history.length < 2) return "";
  const since = Date.now() - 28 * 864e5; let before = 0, recent = 0;
  for (const p of history) if (p.at < since) before = Math.max(before, p.e1rm); else recent = Math.max(recent, p.e1rm);
  if (!before) { before = history[0].e1rm; recent = Math.max(...history.slice(1).map(p => p.e1rm)); }
  if (!recent) return "";
  const change = recent - before; return Math.abs(change) < .05 ? " · steady" : ` · ${change > 0 ? "+" : "−"}${kgText(Math.abs(change))} kg`;
}

/** Pixel bars or a stepped line; the latest value in full accent. */
function chart(values, { line: asLine = false, height = 72 } = {}) {
  const ns = "http://www.w3.org/2000/svg", width = 320, cell = 4, svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`); svg.setAttribute("class", "gym-chart"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("preserveAspectRatio", "none"); svg.style.height = height + "px";
  const max = Math.max(...values, 0), min = Math.min(...values), floor = asLine ? Math.max(0, min - (max - min) * .25 - 1) : 0, slot = width / values.length, base = height - cell;
  const y = v => Math.round((base - (v - floor) / ((max - floor) || 1) * (base - cell)) / cell) * cell;
  const rect = (x, top, w, h, latest, faint) => { const r = document.createElementNS(ns, "rect"); Object.entries({ x, y: top, width: w, height: h }).forEach(([k, v]) => r.setAttribute(k, v)); r.setAttribute("class", latest ? "latest" : faint ? "faint" : ""); svg.append(r); };
  values.forEach((v, i) => {
    const latest = i === values.length - 1;
    if (!asLine) { const top = v > 0 ? y(v) : base; rect(Math.round(i * slot) + cell, top, Math.max(cell, Math.round(slot) - cell * 2), height - top, latest); return; }
    const x = Math.round((i + .5) * slot / cell) * cell; rect(x - cell, y(v), cell * 2, cell * 2, latest);
    if (i) { const px = Math.round((i - .5) * slot / cell) * cell, py = y(values[i - 1]); for (let sx = px + cell * 2; sx < x - cell; sx += cell * 2) rect(sx, Math.round((py + (y(v) - py) * (sx - px) / (x - px)) / cell) * cell, cell, cell, false, true); }
  });
  return svg;
}

let current = "";
export function mount(body, arg, ui) {
  const { h, add, say, section, rowButton, keys, split, confirm, go, title } = ui;
  body.querySelectorAll(".pixel-backdrop").forEach(canvas => canvas.dispose?.()); body.replaceChildren();
  const [kind, value] = arg ? [arg.slice(0, arg.indexOf(":")), decodeURIComponent(arg.slice(arg.indexOf(":") + 1))] : ["", ""];
  if (kind === "lift") return lift(value);
  if (kind === "w" && gym.get(value)) return workout(gym.get(value));
  home();

  function home() {
    const now = gym.active(), lifts = gym.trained(), weeks = gym.weekly(8), sessions = gym.all().filter(w => w.started >= weekStart(Date.now())).length;
    title(body, "gym", sessions ? `${sessions} ${sessions === 1 ? "session" : "sessions"} this week` : "");
    const left = [];
    if (now) {
      const names = gym.names(now);
      if (!current || !names.some(n => n.toLowerCase() === current.toLowerCase())) current = names[names.length - 1] || "";
      const picked = current, today = picked ? gym.sets(now, picked) : [], before = picked ? gym.previous(picked, now.id) : [];
      const seed = today[today.length - 1] || before[0] || { kg: /pull|dip/i.test(picked) ? 0 : 20, reps: 8 };
      const exercise = h("input", { list: "gym-exercises", value: picked, placeholder: "Exercise", "aria-label": "Exercise", maxlength: 60 });
      const options = h("datalist", { id: "gym-exercises" }, gym.exercises().map(n => h("option", { value: n })));
      const kg = h("input", { type: "number", min: 0, max: 1000, step: 2.5, value: kgText(seed.kg), "aria-label": "Kilograms", inputmode: "decimal" });
      const reps = h("input", { type: "number", min: 1, max: 100, step: 1, value: seed.reps, "aria-label": "Reps", inputmode: "numeric" });
      const log = () => { try {
        const name = exercise.value.trim(), best = gym.record(gym.history(name)), w = Number(kg.value), r = Number(reps.value);
        gym.addSet(now.id, name, w, r); current = name; mount(body, "", ui);
        if (best && e1rm(w, r) > best.e1rm + .05) say(`New best: ${kgText(e1rm(w, r))} kg e1RM`);
        body.querySelector(".gym-log input[type=number]")?.focus();
      } catch (error) { say(error.message); } };
      for (const field of [exercise, kg, reps]) field.addEventListener("keydown", event => { if (event.key === "Enter") log(); });
      exercise.addEventListener("change", () => { const name = exercise.value.trim(); if (!name) return; try { gym.addExercise(now.id, name); current = name; mount(body, "", ui); } catch (error) { say(error.message); } });
      const rest = h("span", { class: "gym-rest accent" });
      left.push(section("NOW · " + minutes(Date.now() - now.started).toUpperCase()),
        h("div", { class: "gym-log" }, exercise, options, h("label", {}, "kg", kg), h("label", {}, "reps", reps)),
        keys(["log set", log, { class: "accent" }], ["undo", () => { if (!picked || !today.length) return; gym.undoSet(now.id, picked); mount(body, "", ui); }], ["finish", async () => { if (await confirm("Finish this workout?", "finish")) { gym.finish(now.id); current = ""; mount(body, "", ui); } }]),
        rest);
      const last = Math.max(0, ...(now.entries || []).flatMap(e => e.sets.map(s => s.at)));
      if (last) { const tick = () => { const s = Math.floor((Date.now() - last) / 1000); rest.textContent = s < 3600 ? `rest ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : ""; };
        tick(); const timer = setInterval(() => rest.isConnected ? tick() : clearInterval(timer), 1000); }
      for (const name of names) { const sets = gym.sets(now, name);
        left.push(rowButton(name, sets.length ? line(sets) : "no sets yet", () => { current = name; mount(body, "", ui); }, { class: "row-button" + (name === picked ? " selected" : "") })); }
      if (before.length) left.push(section("LAST TIME · " + day(before[0].at).toUpperCase()), h("p", { class: "small muted", text: line(before) }));
      const best = picked && gym.record(gym.history(picked));
      if (best) left.push(section("BEST"), h("p", { class: "small muted", text: `${kgText(best.e1rm)} kg e1RM · ${set(best.best)} · ${day(best.at)}` }));
    } else left.push(keys(["start workout", () => { gym.start(); current = ""; mount(body, "", ui); body.querySelector(".gym-log input")?.focus(); }, { class: "accent" }]));
    const past = gym.all().filter(w => w.ended).slice(0, 12);
    if (past.length) left.push(section("HISTORY"), past.map(w => rowButton(`${day(w.started)} · ${minutes(w.ended - w.started)}`, `${gym.names(w).join(", ")} · ${gym.count(w)} sets · ${tonnes(gym.volume(w))}`, () => go("/gym/w:" + w.id))));
    const right = [];
    if (lifts.length) {
      right.push(section("VOLUME · 8 WEEKS"), chart(weeks), h("p", { class: "small muted", text: `this week ${tonnes(weeks[7])}` }), section("PROGRESS"));
      for (const name of lifts) { const history = gym.history(name);
        right.push(rowButton(name, `best ${kgText(gym.record(history).e1rm)} kg${trend(history)}`, () => go("/gym/lift:" + encodeURIComponent(name)))); }
    } else if (!now && !past.length) right.push(h("p", { class: "small muted", text: "No workouts yet." }));
    split(body, left, right);
  }

  function lift(name) {
    const history = gym.history(name), best = gym.record(history);
    title(body, name.toLowerCase(), best ? `best ${kgText(best.e1rm)} kg e1RM${trend(history)}` : "");
    add(body, rowButton("‹ gym", "", () => go("/gym")));
    if (!best) { add(body, h("p", { class: "small muted", text: "No sets yet." })); return; }
    split(body, [section("E1RM"), history.length > 1 ? chart(history.map(p => p.e1rm), { line: true, height: 120 }) : null],
      [section("SESSIONS"), [...history].reverse().map(p => rowButton(`${day(p.at)} · ${set(p.best)}`, `e1RM ${kgText(p.e1rm)} kg`, () => {}, { tabindex: -1, class: "row-button static" }))]);
  }

  function workout(w) {
    title(body, day(w.started).toLowerCase(), `${minutes((w.ended || Date.now()) - w.started)} · ${gym.count(w)} sets · ${tonnes(gym.volume(w))}`);
    add(body, rowButton("‹ gym", "", () => go("/gym")),
      h("div", { class: "narrow" }, gym.names(w).map(name => [section(name.toUpperCase()), h("p", { class: "gym-sets", text: gym.sets(w, name).map(set).join("\n") })]),
        keys(["delete workout", async () => { if (await confirm("Delete this workout on all devices?", "delete")) { gym.remove(w.id); go("/gym"); } }])));
  }
}
