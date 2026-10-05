// Pocket on the web: the synced apps in the phone's own layout. No framework, no build step.
import * as drive from "./drive.js";
import { syncNow, describe, onStatus, status } from "./sync.js";
import { parking, receipt, dice, when, meter, heckle, relative, daysOld, DELAYS, HECKLE, KIND, dayKey, clock, longDate, load } from "./store.js";
import { icon, paint, ICON } from "./icons.js";

const phone = document.getElementById("phone"), dialogHost = document.getElementById("dialog");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
// Wide windows: Home stays on the left as a rail and one app at a time opens beside it.
const deskQuery = matchMedia("(min-width: 760px)"), desk = () => deskQuery.matches;
const panels = {};
let notice = null, tick = 0, parkingDraft = "", selected = 0;

// ── DOM helpers ──
function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value; else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value); else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) if (child != null && child !== false) node.append(child);
  return node;
}
const go = path => { location.hash = "#" + path; };
const add = (node, ...children) => node.append(...children.flat().filter(child => child != null && child !== false));
function page(title, action) {
  const wide = desk();
  // The rail's clock keeps ticking while an app is open beside it.
  if (!wide) clearInterval(tick);
  closeDialog();
  const body = h("div", { class: "page" });
  // Home is always visible on the rail, so the wide header closes the app instead of offering "home".
  add(body, h("div", { class: "header" },
    h("button", { onclick: () => go("/"), "aria-label": wide ? "Close app" : "Back to home" }, wide ? "close" : "back"),
    h("h1", { text: title }),
    action ? h("button", { class: action.commit ? "commit" : "", onclick: action.run }, action.label) : wide ? h("span") : h("button", { onclick: () => go("/") }, "home")));
  notice = h("div", { class: "notice", role: "status" });
  (wide ? panels.main : phone).replaceChildren(body, notice);
  return body;
}
const say = text => { if (notice) notice.textContent = text || ""; };
const rowButton = (title, sub, onclick, props = {}) => h("button", { class: "row-button", onclick, ...props }, title, sub ? h("span", { class: "sub" }, sub) : null);
const keys = (...buttons) => h("div", { class: "keys" }, buttons.map(([label, run, extra]) => h("button", { onclick: run, ...(extra || {}) }, label)));
const guard = run => () => { try { run(); } catch (error) { say(error.message); } };

// ── Dialogs, shaped like Android's list dialog ──
let dialogDone = null;
function closeDialog(value = null) { if (dialogDone) { const done = dialogDone; dialogDone = null; done(value); } dialogHost.hidden = true; dialogHost.replaceChildren(); }
function dialog(title, content, actions) {
  closeDialog();
  return new Promise(resolve => {
    dialogDone = resolve;
    const box = h("div", { class: "box", role: "dialog", "aria-modal": "true", "aria-label": title }, h("h2", { text: title }), content,
      h("div", { class: "actions" }, actions.map(([label, value]) => h("button", { onclick: () => closeDialog(typeof value === "function" ? value() : value) }, label))));
    dialogHost.replaceChildren(box); dialogHost.hidden = false;
    dialogHost.onclick = event => { if (event.target === dialogHost) closeDialog(); };
    (box.querySelector("input, textarea") || box.querySelector("button"))?.focus();
  });
}
const choose = (title, options) => dialog(title, h("div", {}, options.map((label, i) => rowButton(label, "", () => closeDialog(i)))), [["cancel", null]]);
function ask(title, { value = "", placeholder = "", multiline = false, ok = "save" } = {}) {
  const field = multiline ? h("textarea", { placeholder }) : h("input", { placeholder, maxlength: 120 });
  field.value = value;
  if (!multiline) field.addEventListener("keydown", event => { if (event.key === "Enter") closeDialog(field.value); });
  return dialog(title, field, [["cancel", null], [ok, () => field.value]]);
}
const confirmBox = (title, ok) => dialog(title, null, [["cancel", false], [ok, true]]);

// ── Home ──
const APPS = [
  { name: "parking", kind: ICON.PARKING, path: "/parking", dot: () => parking.open().some(i => i.due <= Date.now()) },
  { name: "receipt", kind: ICON.RECEIPT, path: "/receipt" },
  { name: "dice", kind: ICON.DICE, path: "/dice" },
  { name: "sync", kind: ICON.SYNC, path: "/sync" },
];
function home() {
  clearInterval(tick); closeDialog();
  const time = h("div", { class: "clock", "aria-live": "off" }), day = h("div", { class: "day" }), state = h("div", { class: "status", id: "sync-status" });
  const update = () => {
    const now = new Date(); time.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }).replace(/\s?[ap]\.?m\.?$/i, "");
    day.textContent = now.toLocaleDateString([], { weekday: "short", day: "2-digit", month: "short" }).replace(/,/g, "").toUpperCase();
    state.textContent = describe();
  };
  update(); tick = setInterval(update, 1000);
  const back = parking.open().filter(i => i.due <= Date.now());
  const next = back[0] ? rowButton(back[0].text, heckle(back[0]) || "back from the parking lot", () => go("/parking")) : null;
  const tiles = APPS.map((app, index) => {
    const tile = h("button", { class: "tile", onclick: () => go(app.path), onfocus: () => select(index), "aria-label": app.name },
      icon(app.kind, "#fff", "#000", app.dot?.()), app.name);
    tile.dataset.kind = app.kind; tile.dataset.dot = app.dot?.() ? "1" : ""; return tile;
  });
  const grid = h("div", { class: "grid" }, tiles);
  const body = h("div", { class: "page" },
    h("div", { class: "day", style: "display:flex;justify-content:space-between;padding-top:12px" }, h("span", {}, "POCKET WEB"), h("span", {}, navigator.onLine ? "ONLINE" : "OFFLINE")),
    time, day, state,
    back.length ? h("div", { class: "section accent" }, `BACK NOW [${back.length}]`) : null, next,
    grid, h("div", { class: "spacer" }),
    h("div", { class: "softkeys" },
      h("button", { onclick: () => drive.connected() ? syncNow() : connectFlow(true) }, "sync"),
      h("button", { onclick: () => go(APPS[selected].path) }, "select"),
      h("button", { onclick: help }, "keys")));
  notice = h("div", { class: "notice", role: "status" });
  (desk() ? panels.rail : phone).replaceChildren(body, notice);
  select(selected);
}
/** The wide layout's right side before an app is chosen. */
function nothingOpen() {
  notice = null;
  panels.main.replaceChildren(h("div", { class: "page empty" },
    h("div", { class: "empty-title", text: "POCKET" }), h("p", { class: "small muted", text: "Choose an app on the left, or press 1–4." })));
}
function select(index) {
  selected = Math.max(0, Math.min(APPS.length - 1, index));
  document.querySelectorAll(".tile").forEach((tile, i) => {
    const on = i === selected; tile.classList.toggle("selected", on);
    paint(tile.querySelector("canvas"), Number(tile.dataset.kind), on ? "#000" : "#fff", on ? getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() : "#000", tile.dataset.dot === "1");
  });
}
const help = () => dialog("Keys", h("p", { class: "small" }, desk() ? "1–4 open an app · esc closes it · space rolls the dice" : "1–4 open an app · arrows move · enter opens · esc goes home · space rolls the dice"), [["ok", null]]);

// ── Parking Lot ──
function parkingPage() {
  const body = page("parking");
  const field = h("input", { placeholder: "park a thought…", maxlength: 200, "aria-label": "Thought to park", oninput: e => { parkingDraft = e.target.value; } });
  field.value = parkingDraft;
  field.addEventListener("keydown", async event => { if (event.key === "Enter") { const i = await choose("Back in", DELAYS); if (i != null) park(DELAYS[i]); } });
  const park = delay => guard(() => {
    const due = when(delay), item = parking.park(field.value, due);
    receipt.log(KIND.PARK, item.text); parkingDraft = ""; parkingPage(); say("Parked until " + relative(due) + ".");
  })();
  add(body, field, h("div", { class: "meta muted", text: "back in" }),
    keys(["1h", () => park("1 hour")], ["tonight", () => park("tonight")], ["tmrw", () => park("tomorrow")], ["next wk", () => park("next week")]));
  const now = Date.now(), open = parking.open(now), back = open.filter(i => i.due <= now), waiting = open.filter(i => i.due > now);
  if (!open.length) add(body, h("p", { class: "small muted", text: "Nothing parked. Type a thought, then choose when it should come back." }));
  if (back.length) add(body, h("div", { class: "section accent", text: `BACK NOW [${back.length}]` }));
  for (const item of back) {
    const nag = heckle(item, now), age = daysOld(item, now);
    add(body, h("div", { class: "thought", text: item.text }),
      h("div", { class: "meta muted", text: `${meter(item.notches)}  parked ${item.notches + 1}× · first ${age === 0 ? "today" : age + "d ago"}` }),
      nag ? h("div", { class: "meta warn", text: nag }) : null,
      keys(["clear", () => clear(item)], ["park", () => repark(item)], ["let go", () => letGo(item)]));
  }
  if (waiting.length) add(body, h("div", { class: "section muted", text: `PARKED [${waiting.length}]` }));
  for (const item of waiting) add(body, rowButton(item.text, "back " + relative(item.due, now) + (item.notches ? "  " + meter(item.notches) : ""), async () => {
    const i = await choose(item.text, ["Bring back now", "Clear", "Let go"]);
    if (i === 0) guard(() => { parking.bringBack(item.id); parkingPage(); })(); else if (i === 1) clear(item); else if (i === 2) letGo(item);
  }));
  add(body, h("p", { class: "meta muted", text: "Move to Today and notifications are on the phone." }));
  if (!parkingDraft) field.focus({ preventScroll: true });
}
const clear = item => guard(() => { parking.close(item.id, "cleared"); receipt.log(KIND.CLEAR, item.text); parkingPage(); say("Cleared. Nice."); })();
const letGo = item => guard(() => { parking.close(item.id, "killed"); receipt.log(KIND.KILL, item.text); parkingPage(); say(item.notches >= HECKLE ? "Let go. That was overdue." : "Let go."); })();
async function repark(item) {
  const i = await choose("Park again", DELAYS); if (i == null) return;
  guard(() => {
    const again = parking.repark(item.id, when(DELAYS[i]));
    receipt.log(KIND.PARK, `${again.text} (${again.notches + 1}×)`); parkingPage();
    say(again.notches >= HECKLE ? "Parked. Again." : "Parked until " + relative(again.due) + ".");
  })();
}

// ── Receipt ──
function receiptPage(key) {
  const today = dayKey(Date.now()), day = /^\d{8}$/.test(key || "") && key <= today ? key : today;
  const date = new Date(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8)), lines = receipt.lines(+date), isToday = day === today;
  const shift = days => { const d = new Date(date); d.setDate(d.getDate() + days); const k = dayKey(+d); go("/receipt/" + (k > today ? today : k)); };
  const body = page("receipt", { label: "print", run: () => window.print() });
  body.classList.add("receipt");
  const paper = h("div", { class: "paper" },
    h("div", { class: "title", text: "POCKET PHONE" }), h("div", { class: "c", text: "** DAY RECEIPT **" }), h("div", { class: "c", text: longDate(+date) }), rule(),
    lines.length ? lines.map(l => h("div", { class: "line" }, h("span", { class: "t", text: clock(l.t) }), h("span", { class: "b", text: l.k }), h("span", { text: l.x })))
      : h("div", { class: "c", text: isToday ? "NOTHING YET. GO DO SOMETHING." : "NO ITEMS" }),
    rule(), receipt.totals(lines).map(([name, n]) => h("div", { class: "total" + (name === "ITEMS" ? " b" : "") }, h("span", { text: name }), h("span", { text: String(n) }))), rule(),
    h("div", { class: "c b", text: "THANK YOU FOR LIVING" }), h("div", { class: "c", text: "PLEASE COME AGAIN" }), h("div", { class: "c bars", text: barcode(lines.length * 31 + Math.floor(+date / 86_400_000)) }));
  add(body, keys(["‹ prev", () => shift(-1)], ["today", () => go("/receipt"), { disabled: isToday }], ["next ›", () => shift(1), { disabled: isToday }]),
    h("div", { class: "tear top" }), paper, h("div", { class: "tear" }),
    isToday ? rowButton("+ add a line", "", async () => { const text = await ask("Add to today's receipt", { placeholder: "Had a great coffee", ok: "print" }); if (text && text.trim()) { receipt.log(KIND.MEMO, text); receiptPage(day); } }) : null,
    rowButton("copy as text", "", async () => { try { await navigator.clipboard.writeText(receipt.text(+date, lines)); say("Copied."); } catch { say("Copy is blocked in this browser."); } }));
}
const rule = () => h("div", { class: "rule", text: "- ".repeat(40) });
/** Same stripes for the same day: a small seeded generator instead of java.util.Random. */
function barcode(seed) { let s = seed >>> 0, out = ""; for (let i = 0; i < 22; i++) { s = (s * 1103515245 + 12345) >>> 0; out += (s >>> 16) % 3 === 0 ? " " : "|"; } return out; }

// ── Dice ──
const MODES = ["dice", "d20", "coin", "pick"];
const diceState = () => ({ mode: localStorage.getItem("pocket:dice-mode") || "dice", count: Math.max(1, Math.min(5, Number(localStorage.getItem("pocket:dice-count") || 2))) });
const history = () => { try { return JSON.parse(localStorage.getItem("pocket:dice-history") || "[]"); } catch { return []; } };
const random = n => { const v = new Uint32Array(1); crypto.getRandomValues(v); return v[0] % n; };
let rolling = false;
function dicePage() {
  const { mode, count } = diceState(), list = dice.list();
  const body = page("dice", { label: "list", run: editList });
  const result = h("div", { class: "result" + (mode === "pick" ? " long" : ""), text: localStorage.getItem("pocket:dice-face") || "?", "aria-live": "polite" });
  const detail = h("div", { class: "small muted center", text: localStorage.getItem("pocket:dice-detail") || "" });
  const setMode = m => { localStorage.setItem("pocket:dice-mode", m); localStorage.removeItem("pocket:dice-face"); localStorage.removeItem("pocket:dice-detail"); dicePage(); };
  add(body, keys(...MODES.map(m => [m, () => setMode(m), { class: m === mode ? "selected" : "", "aria-pressed": String(m === mode) }])), result, detail);
  if (mode === "dice") add(body, keys(["−", () => setCount(count - 1)], [`${count} ${count === 1 ? "die" : "dice"}`, () => {}, { disabled: true }], ["+", () => setCount(count + 1)]));
  if (mode === "pick") add(body, rowButton(list.length ? `From ${list.length}: ${list.join(", ")}` : "Add things to pick from", "", editList));
  add(body, h("button", { class: "primary", id: "roll", onclick: () => roll(result, detail) }, mode === "coin" ? "flip" : mode === "pick" ? "pick one" : "roll"),
    h("div", { class: "meta muted center", text: "or press space" }));
  const past = history(); if (past.length) add(body, h("div", { class: "section muted", text: "LAST" }), h("div", { class: "small muted", style: "white-space:pre-line", text: past.join("\n") }));
}
const setCount = n => { localStorage.setItem("pocket:dice-count", String(Math.max(1, Math.min(5, n)))); dicePage(); };
async function editList() {
  const text = await ask("Pick from", { value: dice.raw(), placeholder: "One per line: sushi, pizza, tacos…", multiline: true });
  if (text != null) { dice.setList(text); dicePage(); }
}
function preview(mode, count, list) {
  if (mode === "d20") return [random(20) + 1];
  if (mode === "coin") return [random(2)];
  if (mode === "pick") return [random(Math.max(1, list.length))];
  return Array.from({ length: count }, () => random(6) + 1);
}
function face(mode, values, list) {
  if (mode === "d20") return String(values[0]);
  if (mode === "coin") return values[0] === 0 ? "HEADS" : "TAILS";
  if (mode === "pick") return list[values[0] % list.length] || "?";
  return values.join(" ");
}
async function roll(result, detail) {
  if (rolling) return;
  const { mode, count } = diceState(), list = dice.list();
  if (mode === "pick" && list.length < 2) { say("Add at least two things to pick from."); editList(); return; }
  rolling = true;
  if (!reduceMotion) for (let i = 0; i < 7; i++) { result.textContent = face(mode, preview(mode, count, list), list); await new Promise(r => setTimeout(r, 55)); }
  const values = preview(mode, count, list), shown = face(mode, values, list); let note = "", log;
  if (mode === "d20") { note = values[0] === 20 ? "NAT 20!" : values[0] === 1 ? "critical fail" : ""; log = "d20 → " + shown; }
  else if (mode === "coin") log = "coin → " + shown;
  else if (mode === "pick") { note = "out of " + list.length; log = "pick → " + shown; }
  else { const total = values.reduce((a, b) => a + b, 0); note = values.length > 1 ? "total " + total : ""; log = `${values.length}d6 → ${shown}${values.length > 1 ? " = " + total : ""}`; }
  localStorage.setItem("pocket:dice-face", shown); localStorage.setItem("pocket:dice-detail", note);
  localStorage.setItem("pocket:dice-history", JSON.stringify([log, ...history()].slice(0, 8)));
  receipt.log(KIND.ROLL, log); rolling = false; dicePage();
}

// ── Sync ──
function syncPage() {
  const body = page("sync"), connected = drive.connected();
  add(body, h("p", { class: connected ? "accent" : "", text: describe() }));
  if (status.error) add(body, h("p", { class: "small warn", text: status.error }));
  add(body, h("p", { class: "small muted", text: "Parking Lot, Receipt and Dice lists live in a hidden Pocket folder in your own Google Drive. Edits here save in this browser first and upload when you're online; the phone picks them up on its next sync." }));
  if (!drive.configured()) add(body, h("p", { class: "small warn", text: "This page has no Google client id yet. Add it to docs/js/config.js (see CLOUD.md)." }));
  if (connected) add(body, rowButton("sync now", "", async () => { say("Syncing…"); say((await syncNow()) ? "Synced." : describe()); syncPage(); }),
    rowButton("disconnect", "this browser keeps its copy", async () => { await drive.disconnect(); syncPage(); }));
  else add(body, rowButton("connect google drive", drive.remembered() ? "you were connected before" : "", () => connectFlow(drive.remembered())));
  const parked = load("parking.json").items.filter(i => i.state === "parked").length, days = Object.keys(load("receipt.json").days || {}).length;
  add(body, h("div", { class: "section muted", text: "IN THIS BROWSER" }),
    h("p", { class: "small muted", style: "white-space:pre-line", text: `parking   ${parked} open\nreceipt   ${days} day${days === 1 ? "" : "s"}\ndice      ${dice.list().length} on the list` }),
    rowButton("forget this browser's copy", "", async () => {
      if (await confirmBox("Forget the copy in this browser? Your Drive copy and the phone are not touched.", "forget")) {
        Object.keys(localStorage).filter(k => k.startsWith("pocket:")).forEach(k => localStorage.removeItem(k)); syncPage();
      }
    }));
}
async function connectFlow(quiet) {
  try { say("Opening Google…"); await drive.connect(quiet); say("Connected. Syncing…"); await syncNow(); route(); }
  catch (error) { say(error.message); }
}

// ── Routing and keys ──
function route() {
  const [, name, arg] = (location.hash.replace(/^#/, "") || "/").split("/");
  phone.classList.toggle("desk-mode", desk());
  if (desk()) {
    if (!panels.rail?.isConnected) {
      panels.rail = h("aside", { class: "rail", "aria-label": "Home" }); panels.main = h("section", { class: "main", "aria-label": "App" });
      phone.replaceChildren(panels.rail, panels.main);
    }
    const open = APPS.findIndex(app => app.name === name); if (open >= 0) selected = open;
    home();
    if (open < 0) nothingOpen();
  }
  if (name === "parking") parkingPage(); else if (name === "receipt") receiptPage(arg); else if (name === "dice") dicePage(); else if (name === "sync") syncPage(); else if (!desk()) home();
}
addEventListener("hashchange", route);
deskQuery.addEventListener("change", route);
let lastState = status.state;
onStatus(() => {
  const state = document.getElementById("sync-status"); if (state) state.textContent = describe();
  const finished = lastState === "syncing" && status.state === "idle"; lastState = status.state;
  // Merged phone edits appear without a reload, unless the user is typing or a dialog is open.
  if (finished && status.changed && dialogHost.hidden && !(document.activeElement?.matches("input, textarea") && document.activeElement.value)) {
    const name = location.hash.split("/")[1], text = notice?.textContent;
    if (desk() || name === "parking" || name === "receipt" || !name) { route(); say(text); }
  }
});
addEventListener("keydown", event => {
  if (!dialogHost.hidden) { if (event.key === "Escape") closeDialog(); return; }
  const typing = document.activeElement?.matches("input, textarea"), name = location.hash.split("/")[1];
  if (typing && event.key === "Escape" && desk()) { document.activeElement.blur(); return; }
  if (event.key === "Escape" || (event.key === "Backspace" && !typing)) { if (name) { event.preventDefault(); go("/"); } return; }
  if (typing) return;
  // On the wide layout the tiles stay visible, so 1–4 switch apps from anywhere.
  if (event.key >= "1" && event.key <= String(APPS.length) && (!name || desk())) { go(APPS[Number(event.key) - 1].path); return; }
  if (!name) {
    const columns = 3, moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
    if (moves[event.key] != null) { event.preventDefault(); select(selected + moves[event.key]); }
    else if (event.key === "Enter") go(APPS[selected].path);
  } else if (name === "dice" && (event.key === " " || event.key === "Enter") && document.getElementById("roll")) { event.preventDefault(); document.getElementById("roll").click(); }
});

route();
syncNow();
