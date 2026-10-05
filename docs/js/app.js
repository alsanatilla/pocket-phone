// Pocket workstation: the synced tools on a bigger screen. Pocket's look, not a pretend phone. No framework, no build step.
import * as drive from "./drive.js";
import { syncNow, describe, onStatus, status } from "./sync.js";
import { parking, receipt, dice, notes, noteTitle, thought, thoughtStatus, parkThought, when, meter, heckle, relative, daysOld, DELAYS, HECKLE, KIND, NOTE_LIMIT, dayKey, clock, longDate, load } from "./store.js";

const root = document.getElementById("app"), dialogHost = document.getElementById("dialog");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const TOOLS = ["parking", "notes", "receipt", "dice"];
let content = null, notice = null, parkingDraft = "";

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
const add = (node, ...children) => node.append(...children.flat().filter(child => child != null && child !== false));
const go = path => { location.hash = "#" + path; };
const say = text => { if (notice) notice.textContent = text || ""; };
const rowButton = (title, sub, onclick, props = {}) => h("button", { class: "row-button", onclick, ...props }, title, sub ? h("span", { class: "sub" }, sub) : null);
const keys = (...buttons) => h("div", { class: "keys" }, buttons.map(([label, run, extra]) => h("button", { onclick: run, ...(extra || {}) }, label)));
const section = (text, tone = "muted") => h("div", { class: "section " + tone, text });
const guard = run => () => { try { run(); } catch (error) { say(error.message); } };

// ── Shell: one bar of tools, then the open tool. ──
function shell() {
  if (content?.isConnected) return;
  const tabs = TOOLS.map((name, i) => h("button", { class: "tab", "data-tool": name, onclick: () => go("/" + name) }, h("span", { class: "key", text: String(i + 1) }), name));
  content = h("main", { class: "content" }); notice = h("div", { class: "notice", role: "status" });
  root.replaceChildren(
    h("header", { class: "bar" },
      h("span", { class: "brand", text: "POCKET" }),
      h("nav", { class: "tabs", "aria-label": "Tools" }, tabs),
      h("button", { class: "status", id: "sync-status", onclick: () => go("/sync"), title: "Sync settings" }, describe())),
    content, notice);
}
/** Clears the work area for one tool; toolbar actions sit at its top right. */
function view(tool, actions = []) {
  shell(); closeDialog(); say("");
  document.querySelectorAll(".tab").forEach(tab => { const on = tab.dataset.tool === tool; tab.classList.toggle("active", on); tab.setAttribute("aria-current", on ? "page" : "false"); });
  document.title = tool === "sync" ? "Pocket · sync" : "Pocket · " + tool;
  content.replaceChildren();
  if (actions.length) add(content, h("div", { class: "toolbar" }, actions.map(([label, run, extra]) => h("button", { onclick: run, ...(extra || {}) }, label))));
  const body = h("div", { class: "tool tool-" + tool }); add(content, body);
  if (!reduceMotion) body.classList.add("enter");
  return body;
}
const split = (body, ...columns) => { add(body, h("div", { class: "split" }, columns.map(c => h("div", { class: "col" }, c)))); };

// ── Dialogs, shaped like Pocket's list dialog ──
let dialogDone = null;
function closeDialog(value = null) { if (dialogDone) { const done = dialogDone; dialogDone = null; done(value); } dialogHost.hidden = true; dialogHost.replaceChildren(); }
function dialog(title, body, actions) {
  closeDialog();
  return new Promise(resolve => {
    dialogDone = resolve;
    const box = h("div", { class: "box", role: "dialog", "aria-modal": "true", "aria-label": title }, h("h2", { text: title }), body,
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

// ── Parking Lot: capture and what's back on the left, everything still parked on the right. ──
function parkingView() {
  const body = view("parking");
  const field = h("input", { placeholder: "park a thought…", maxlength: 200, "aria-label": "Thought to park", oninput: e => { parkingDraft = e.target.value; } });
  field.value = parkingDraft;
  field.addEventListener("keydown", async event => { if (event.key === "Enter") { const i = await choose("Back in", DELAYS); if (i != null) park(DELAYS[i]); } });
  const park = delay => guard(() => {
    const due = when(delay), item = parking.park(field.value, due);
    receipt.log(KIND.PARK, item.text); parkingDraft = ""; parkingView(); say("Parked until " + relative(due) + ".");
  })();
  const now = Date.now(), open = parking.open(now), back = open.filter(i => i.due <= now), waiting = open.filter(i => i.due > now);
  const left = [field, h("div", { class: "meta muted", text: "back in · or press enter" }),
    keys(["1h", () => park("1 hour")], ["tonight", () => park("tonight")], ["tmrw", () => park("tomorrow")], ["next wk", () => park("next week")]),
    section(`BACK NOW [${back.length}]`, back.length ? "accent" : "muted"),
    back.length ? null : h("p", { class: "small muted", text: "Nothing is back yet." })];
  for (const item of back) {
    const nag = heckle(item, now), age = daysOld(item, now);
    left.push(h("div", { class: "thought", text: item.text }),
      h("div", { class: "meta muted", text: `${meter(item.notches)}  parked ${item.notches + 1}× · first ${age === 0 ? "today" : age + "d ago"}` }),
      nag ? h("div", { class: "meta warn", text: nag }) : null,
      source(item) ? h("button", { class: "source", onclick: () => go("/notes/" + item.note) }, "from note · " + noteTitle(source(item))) : null,
      keys(["clear", () => clear(item)], ["park", () => repark(item)], ["let go", () => letGo(item)]));
  }
  const right = [section(`PARKED [${waiting.length}]`), waiting.length ? null : h("p", { class: "small muted", text: "Nothing waiting." })];
  for (const item of waiting) right.push(rowButton(item.text, "back " + relative(item.due, now) + (item.notches ? "  " + meter(item.notches) : "") + (source(item) ? "  · " + noteTitle(source(item)) : ""), async () => {
    const i = await choose(item.text, source(item) ? ["Bring back now", "Clear", "Let go", "Open note"] : ["Bring back now", "Clear", "Let go"]);
    if (i === 0) guard(() => { parking.bringBack(item.id); parkingView(); })(); else if (i === 1) clear(item); else if (i === 2) letGo(item); else if (i === 3) go("/notes/" + item.note);
  }));
  right.push(h("p", { class: "meta muted", text: "Move to Today and the comeback notifications are on the phone." }));
  split(body, left, right);
  if (!parkingDraft) field.focus({ preventScroll: true });
}
/** The note a thought was written in, if this browser has it. */
const source = item => (item.note ? notes.get(item.note) : null);
const clear = item => guard(() => { parking.close(item.id, "cleared"); receipt.log(KIND.CLEAR, item.text); parkingView(); say("Cleared. Nice."); })();
const letGo = item => guard(() => { parking.close(item.id, "killed"); receipt.log(KIND.KILL, item.text); parkingView(); say(item.notches >= HECKLE ? "Let go. That was overdue." : "Let go."); })();
async function repark(item) {
  const i = await choose("Park again", DELAYS); if (i == null) return;
  guard(() => {
    const again = parking.repark(item.id, when(DELAYS[i]));
    receipt.log(KIND.PARK, `${again.text} (${again.notches + 1}×)`); parkingView();
    say(again.notches >= HECKLE ? "Parked. Again." : "Parked until " + relative(again.due) + ".");
  })();
}

// ── Notes: list on the left, the open note on the right. Saves as you type. ──
let noteQuery = "", previewing = false, saveTimer = 0;
function notesView(uid) {
  const open = uid === "new" ? null : uid ? notes.get(uid) : null;
  const editing = uid === "new" || Boolean(open);
  const body = view("notes", [["+ new note", () => go("/notes/new")]]);
  body.classList.toggle("editing", editing);
  const search = h("input", { placeholder: "find in notes…", "aria-label": "Find in notes", oninput: e => { noteQuery = e.target.value; renderList(); } });
  search.value = noteQuery;
  const list = h("div", { class: "note-list" });
  const renderList = () => {
    const q = noteQuery.trim().toLowerCase(), all = notes.list().filter(n => !q || n.text.toLowerCase().includes(q));
    list.replaceChildren(...(all.length ? all.map(n => rowButton((n.pinned ? "▲ " : "") + noteTitle(n), new Date(n.updated).toLocaleDateString([], { day: "2-digit", month: "short" }) + " · " + snippet(n),
      () => go("/notes/" + n.uid), { class: "row-button" + (n.uid === uid ? " selected" : "") }))
      : [h("p", { class: "small muted", text: q ? "No note matches." : "No notes yet. Notes from the phone appear here after a sync." })]));
  };
  renderList();
  split(body, [search, list], editing ? editor(open) : h("div", { class: "empty" }, h("div", { class: "empty-title", text: "NOTES" }), h("p", { class: "small muted", text: "Pick a note on the left, or start a new one." })));
}
const snippet = n => n.text.split("\n").filter(l => l.trim()).slice(1).join(" ").slice(0, 60) || "—";
function editor(note) {
  let uid = note?.uid || null;
  const state = h("span", { class: "meta muted", text: note ? "saved" : "new" });
  const area = h("textarea", { class: "note-editor", maxlength: NOTE_LIMIT, placeholder: "# Title\n\nWrite in Markdown…", "aria-label": "Note text", spellcheck: "true" });
  area.value = note?.text || "";
  const preview = h("div", { class: "md", hidden: !previewing });
  area.hidden = previewing; if (previewing) preview.replaceChildren(markdown(area.value, uid));
  // Thought lines already handled in this note, counted per line text. A line parks once the cursor has left it,
  // so a half-typed ">> cal" never parks; revisiting an old line without changing it never parks it again.
  let seen = new Map();
  for (const line of area.value.split("\n")) { const t = thought(line); if (t) seen.set(t.key, (seen.get(t.key) || 0) + 1); }
  const parkFinished = finished => {
    const cursor = area.value.slice(0, area.selectionStart).split("\n").length - 1, counts = new Map(), fresh = [];
    area.value.split("\n").forEach((line, i) => {
      const t = thought(line); if (!t) return;
      const n = counts.get(t.key) || 0, known = seen.get(t.key) || 0;
      if (!finished && i === cursor) { if (n < known) counts.set(t.key, n + 1); return; }
      counts.set(t.key, n + 1); if (n >= known) fresh.push(t);
    });
    seen = counts;
    let parked = 0; for (const t of fresh) if (parkThought(uid, t)) parked++;
    if (parked) say(parked === 1 ? "1 thought parked." : parked + " thoughts parked.");
  };
  const save = (finished = false) => {
    clearTimeout(saveTimer);
    try {
      if (!uid) { if (!area.value.trim()) return; uid = notes.create(area.value).uid; history.replaceState(null, "", "#/notes/" + uid); }
      else notes.update(uid, area.value);
      parkFinished(finished);
      state.textContent = "saved";
    } catch (error) { say(error.message); }
  };
  area.addEventListener("input", () => { state.textContent = "…"; clearTimeout(saveTimer); saveTimer = setTimeout(save, 600); });
  area.addEventListener("keyup", event => { if (event.key === "Enter" || event.key.startsWith("Arrow")) { clearTimeout(saveTimer); saveTimer = setTimeout(save, 150); } });
  area.addEventListener("blur", () => save(true));
  const toggle = () => { save(true); previewing = !previewing; area.hidden = previewing; preview.hidden = !previewing; mode.textContent = previewing ? "edit" : "preview"; if (previewing) preview.replaceChildren(markdown(area.value, uid)); else area.focus(); };
  const mode = h("button", { onclick: toggle }, previewing ? "edit" : "preview");
  const bar = h("div", { class: "editor-bar" },
    h("button", { class: "narrow-only", onclick: () => { save(true); go("/notes"); } }, "‹ notes"), state, h("span", { class: "spacer" }), mode,
    h("button", { onclick: () => { save(true); if (!uid) return; const n = notes.get(uid); notes.pin(uid, !n.pinned); notesView(uid); } }, note?.pinned ? "unpin" : "pin"),
    h("button", { onclick: async () => { if (!uid) { go("/notes"); return; } if (await confirmBox("Delete this note on all devices?", "delete")) { notes.remove(uid); go("/notes"); say("Deleted."); } } }, "delete"));
  if (!previewing) setTimeout(() => area.focus({ preventScroll: true }), 0);
  return [bar, area, preview, h("div", { class: "meta muted", text: "Markdown, the same as the phone's notes. A line starting with >> parks a thought; add @tonight, @tomorrow or @nextweek." })];
}
/** A small Markdown renderer for what the phone's editor writes. Text is escaped before any formatting. */
function markdown(source, uid = null) {
  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = s => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>").replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  const out = []; let list = null, code = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of source.split("\n")) {
    if (line.startsWith("```")) { if (code === null) { close(); code = []; } else { out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`); code = null; } continue; }
    if (code !== null) { code.push(line); continue; }
    let m; const t = thought(line);
    if (t) { close(); out.push(`<p class="thought-line"><span class="accent">»</span> ${inline(t.text)} <span class="meta muted">· ${esc(thoughtStatus(uid, line))}</span></p>`); }
    else if ((m = line.match(/^(#{1,3})\s+(.*)/))) { close(); out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`); }
    else if ((m = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)/))) { if (list !== "ul") { close(); out.push('<ul class="tasks">'); list = "ul"; } out.push(`<li>${m[1] === " " ? "[ ]" : "[x]"} ${inline(m[2])}</li>`); }
    else if ((m = line.match(/^\s*[-*]\s+(.*)/))) { if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== "ol") { close(); out.push("<ol>"); list = "ol"; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^>\s?(.*)/))) { close(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); }
    else if (!line.trim()) close();
    else { close(); out.push(`<p>${inline(line)}</p>`); }
  }
  if (code !== null) out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
  close();
  const node = document.createElement("div"); node.innerHTML = out.join(""); return node;
}

// ── Receipt: days on the left, the printed day on the right. ──
function receiptView(key) {
  const today = dayKey(Date.now()), day = /^\d{8}$/.test(key || "") && key <= today ? key : today;
  const date = new Date(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8)), lines = receipt.lines(+date), isToday = day === today;
  const shift = days => { const d = new Date(date); d.setDate(d.getDate() + days); const k = dayKey(+d); go("/receipt/" + (k > today ? today : k)); };
  const body = view("receipt", [["copy", async () => { try { await navigator.clipboard.writeText(receipt.text(+date, lines)); say("Copied."); } catch { say("Copy is blocked in this browser."); } }], ["print", () => window.print()]]);
  const days = Object.entries(load("receipt.json").days || {}).filter(([k]) => /^\d{8}$/.test(k)).sort(([a], [b]) => b.localeCompare(a));
  if (!days.some(([k]) => k === today)) days.unshift([today, []]);
  const dayList = [section("DAYS"), days.map(([k, l]) => {
    const d = new Date(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8));
    return rowButton(k === today ? "today" : longDate(+d).toLowerCase(), `${l.length} item${l.length === 1 ? "" : "s"}`, () => go("/receipt/" + k), { class: "row-button" + (k === day ? " selected" : "") });
  })];
  const paper = h("div", { class: "paper" },
    h("div", { class: "title", text: "POCKET PHONE" }), h("div", { class: "c", text: "** DAY RECEIPT **" }), h("div", { class: "c", text: longDate(+date) }), rule(),
    lines.length ? lines.map(l => h("div", { class: "line" }, h("span", { class: "t", text: clock(l.t) }), h("span", { class: "b", text: l.k }), h("span", { text: l.x })))
      : h("div", { class: "c", text: isToday ? "NOTHING YET. GO DO SOMETHING." : "NO ITEMS" }),
    rule(), receipt.totals(lines).map(([name, n]) => h("div", { class: "total" + (name === "ITEMS" ? " b" : "") }, h("span", { text: name }), h("span", { text: String(n) }))), rule(),
    h("div", { class: "c b", text: "THANK YOU FOR LIVING" }), h("div", { class: "c", text: "PLEASE COME AGAIN" }), h("div", { class: "c bars", text: barcode(lines.length * 31 + Math.floor(+date / 86_400_000)) }));
  split(body, h("div", { class: "wide-only" }, dayList), [
    h("div", { class: "narrow-only" }, keys(["‹ prev", () => shift(-1)], ["today", () => go("/receipt"), { disabled: isToday }], ["next ›", () => shift(1), { disabled: isToday }])),
    h("div", { class: "roll" }, h("div", { class: "tear top" }), paper, h("div", { class: "tear" })),
    isToday ? rowButton("+ add a line", "", async () => { const text = await ask("Add to today's receipt", { placeholder: "Had a great coffee", ok: "print" }); if (text && text.trim()) { receipt.log(KIND.MEMO, text); receiptView(day); } }) : null]);
}
const rule = () => h("div", { class: "rule", text: "- ".repeat(40) });
/** Same stripes for the same day: a small seeded generator instead of java.util.Random. */
function barcode(seed) { let s = seed >>> 0, out = ""; for (let i = 0; i < 22; i++) { s = (s * 1103515245 + 12345) >>> 0; out += (s >>> 16) % 3 === 0 ? " " : "|"; } return out; }

// ── Dice: the roller on the left, history and the pick list on the right. ──
const MODES = ["dice", "d20", "coin", "pick"];
const diceState = () => ({ mode: localStorage.getItem("pocket:dice-mode") || "dice", count: Math.max(1, Math.min(5, Number(localStorage.getItem("pocket:dice-count") || 2))) });
const rolls = () => { try { return JSON.parse(localStorage.getItem("pocket:dice-history") || "[]"); } catch { return []; } };
const random = n => { const v = new Uint32Array(1); crypto.getRandomValues(v); return v[0] % n; };
let rolling = false;
function diceView() {
  const { mode, count } = diceState(), list = dice.list();
  const body = view("dice", [["edit list", editList]]);
  const result = h("div", { class: "result" + (mode === "pick" ? " long" : ""), text: localStorage.getItem("pocket:dice-face") || "?", "aria-live": "polite" });
  const detail = h("div", { class: "small muted center", text: localStorage.getItem("pocket:dice-detail") || "" });
  const setMode = m => { localStorage.setItem("pocket:dice-mode", m); localStorage.removeItem("pocket:dice-face"); localStorage.removeItem("pocket:dice-detail"); diceView(); };
  const left = [keys(...MODES.map(m => [m, () => setMode(m), { class: m === mode ? "selected" : "", "aria-pressed": String(m === mode) }])), result, detail,
    mode === "dice" ? keys(["−", () => setCount(count - 1)], [`${count} ${count === 1 ? "die" : "dice"}`, () => {}, { disabled: true }], ["+", () => setCount(count + 1)]) : null,
    mode === "pick" ? rowButton(list.length ? `From ${list.length}: ${list.join(", ")}` : "Add things to pick from", "", editList) : null,
    h("button", { class: "primary", id: "roll", onclick: () => roll(result, detail) }, mode === "coin" ? "flip" : mode === "pick" ? "pick one" : "roll"),
    h("div", { class: "meta muted center", text: "or press space" })];
  const past = rolls();
  const right = [section("LAST"), past.length ? h("div", { class: "small muted", style: "white-space:pre-line", text: past.join("\n") }) : h("p", { class: "small muted", text: "No rolls yet." }),
    section("PICK LIST"), h("p", { class: "small muted", text: list.length ? list.join(" · ") : "Empty. Synced with the phone." })];
  split(body, left, right);
}
const setCount = n => { localStorage.setItem("pocket:dice-count", String(Math.max(1, Math.min(5, n)))); diceView(); };
async function editList() {
  const text = await ask("Pick from", { value: dice.raw(), placeholder: "One per line: sushi, pizza, tacos…", multiline: true });
  if (text != null) { dice.setList(text); diceView(); }
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
  localStorage.setItem("pocket:dice-history", JSON.stringify([log, ...rolls()].slice(0, 12)));
  receipt.log(KIND.ROLL, log); rolling = false; diceView();
}

// ── Sync settings ──
function syncView() {
  const body = view("sync"), connected = drive.connected();
  const parked = load("parking.json").items.filter(i => i.state === "parked").length, days = Object.keys(load("receipt.json").days || {}).length;
  add(body, h("div", { class: "narrow" },
    h("p", { class: connected ? "accent" : "", text: describe() }),
    status.error ? h("p", { class: "small warn", text: status.error }) : null,
    h("p", { class: "small muted", text: "Parking Lot, notes, Receipt and Dice lists live in a hidden Pocket folder in your own Google Drive. Edits here save in this browser first and upload when you're online; the phone picks them up on its next sync." }),
    drive.configured() ? null : h("p", { class: "small warn", text: "This page has no Google client id yet. Add it to docs/js/config.js (see CLOUD.md)." }),
    connected ? [rowButton("sync now", "", async () => { say("Syncing…"); const ok = await syncNow(); syncView(); say(ok ? "Synced." : describe()); }),
      rowButton("disconnect", "this browser keeps its copy", async () => { await drive.disconnect(); syncView(); })]
      : rowButton("connect google drive", drive.remembered() ? "you were connected before" : "", () => connectFlow(drive.remembered())),
    section("IN THIS BROWSER"),
    h("p", { class: "small muted", style: "white-space:pre-line", text: `parking   ${parked} open\nnotes     ${notes.list().length}\nreceipt   ${days} day${days === 1 ? "" : "s"}\ndice      ${dice.list().length} on the list` }),
    rowButton("forget this browser's copy", "", async () => {
      if (await confirmBox("Forget the copy in this browser? Your Drive copy and the phone are not touched.", "forget")) {
        Object.keys(localStorage).filter(k => k.startsWith("pocket:")).forEach(k => localStorage.removeItem(k)); syncView();
      }
    })));
}
async function connectFlow(quiet) {
  try { say("Opening Google…"); await drive.connect(quiet); say("Connected. Syncing…"); await syncNow(); route(); }
  catch (error) { say(error.message); }
}

// ── Routing and keys ──
function route() {
  const [, name, arg] = (location.hash.replace(/^#/, "") || "/").split("/");
  if (name === "notes") notesView(arg); else if (name === "receipt") receiptView(arg); else if (name === "dice") diceView(); else if (name === "sync") syncView();
  else if (name === "parking") parkingView(); else { history.replaceState(null, "", "#/parking"); parkingView(); }
}
addEventListener("hashchange", route);
let lastState = status.state;
onStatus(() => {
  const state = document.getElementById("sync-status"); if (state) state.textContent = describe();
  const finished = lastState === "syncing" && status.state === "idle"; lastState = status.state;
  // Merged edits from the phone appear without a reload, unless the user is typing or a dialog is open.
  if (finished && status.changed && dialogHost.hidden && !document.activeElement?.matches("input, textarea")) { const text = notice?.textContent; route(); say(text); }
});
addEventListener("keydown", event => {
  if (!dialogHost.hidden) { if (event.key === "Escape") closeDialog(); return; }
  const typing = document.activeElement?.matches("input, textarea"), name = location.hash.split("/")[1];
  if (typing) { if (event.key === "Escape") document.activeElement.blur(); return; }
  if (event.key >= "1" && event.key <= String(TOOLS.length) && !event.ctrlKey && !event.metaKey && !event.altKey) { go("/" + TOOLS[Number(event.key) - 1]); return; }
  if (event.key === "n" && name === "notes") { event.preventDefault(); go("/notes/new"); return; }
  if (name === "dice" && event.key === " ") { event.preventDefault(); document.getElementById("roll")?.click(); }
});

route();
syncNow();
