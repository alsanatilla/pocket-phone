// Pocket workstation: the synced tools on a bigger screen. Pocket's look, not a pretend phone. No framework, no build step.
import * as drive from "./drive.js?v=20261005-tasks1";
import * as reader from "./reader.js?v=20261005-tasks1";
import * as zines from "./zines.js?v=20261005-tasks1";
import * as movement from "./movement.js?v=20261005-tasks1";
import * as coros from "./coros.js?v=20261005-tasks1";
import { syncNow, describe, onStatus, status } from "./sync.js?v=20261005-tasks1";
import { parking, receipt, dice, notes, journal, noteTitle, thought, thoughtStatus, thoughtParked, parkThought, when, meter, heckle, relative, daysOld, DELAYS, HECKLE, KIND, NOTE_LIMIT, dayKey, clock, longDate, load } from "./store.js?v=20261005-tasks1";

const root = document.getElementById("app"), dialogHost = document.getElementById("dialog");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const TOOLS = ["parking", "notes", "receipt", "dice", "zines", "movement"];
let content = null, notice = null, parkingDraft = "";

// ── DOM helpers ──
function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value; else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value); else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat(Infinity)) if (child != null && child !== false) node.append(child);
  return node;
}
const add = (node, ...children) => node.append(...children.flat(Infinity).filter(child => child != null && child !== false));
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
      h("span", { class: "brand", text: "pocket" }),
      h("nav", { class: "tabs", "aria-label": "Tools" }, tabs),
      h("button", { class: "status", id: "sync-status", onclick: () => go("/sync"), title: "Sync settings" }, describe())),
    content, notice);
}
/** Clears the work area for one tool; toolbar actions sit at its top right. */
function view(tool, actions = []) {
  zines.leave(); shell(); closeDialog(); say("");
  document.querySelectorAll(".tab").forEach(tab => { const on = tab.dataset.tool === tool; tab.classList.toggle("active", on); tab.setAttribute("aria-current", on ? "page" : "false"); });
  const activeTab = document.querySelector(".tab.active"), tabs = activeTab?.parentElement;
  if (tabs) tabs.scrollLeft = activeTab.offsetLeft - tabs.offsetLeft - (tabs.clientWidth - activeTab.clientWidth) / 2;
  document.title = tool === "sync" ? "pocket · sync" : "pocket · " + tool;
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
function ask(title, { value = "", placeholder = "", multiline = false, ok = "save", password = false, hint = "" } = {}) {
  const field = multiline ? h("textarea", { placeholder }) : h("input", { type: password ? "password" : "text", placeholder, ...(password ? {} : { maxlength: 120 }) });
  field.value = value;
  if (!multiline) field.addEventListener("keydown", event => { if (event.key === "Enter") closeDialog(field.value); });
  return dialog(title, hint ? h("div", {}, h("p", { class: "small muted", text: hint }), field) : field, [["cancel", null], [ok, () => field.value]]);
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
  const picker = h("input", { type: "file", accept: "image/*", multiple: true, hidden: true, onchange: e => { uploadPages([...e.target.files]); e.target.value = ""; } });
  const body = view("notes", [["+ page", () => picker.click(), { title: "Upload photos of journal pages" }], ["+ new note", () => go("/notes/new")]]);
  body.classList.toggle("editing", editing);
  // Photos of journal pages can also be dropped anywhere on the notes tab.
  body.addEventListener("dragover", event => { if ([...event.dataTransfer.types].includes("Files")) { event.preventDefault(); body.classList.add("dropping"); } });
  body.addEventListener("dragleave", event => { if (event.target === body) body.classList.remove("dropping"); });
  body.addEventListener("drop", event => { event.preventDefault(); body.classList.remove("dropping"); uploadPages([...event.dataTransfer.files]); });
  const waiting = journal.unread();
  const pages = waiting.length ? [section(`PAGES [${waiting.length}]`, "accent"), waiting.map(page => rowButton(
    "Journal page · " + new Date(page.created).toLocaleDateString([], { day: "2-digit", month: "short" }),
    page.state === "failed" ? page.error || "could not be read" : page.state === "reading" ? "reading it…" : page.error || "waiting to be read",
    () => pageDialog(page)))] : null;
  const search = h("input", { placeholder: "find in notes…", "aria-label": "Find in notes", oninput: e => { noteQuery = e.target.value; renderList(location.hash.split("/")[2]); } });
  search.value = noteQuery;
  const list = h("div", { class: "note-list" });
  const renderList = (current = uid) => {
    const q = noteQuery.trim().toLowerCase(), all = notes.list().filter(n => !q || n.text.toLowerCase().includes(q));
    list.replaceChildren(...(all.length ? all.map(n => rowButton((n.pinned ? "▲ " : "") + noteTitle(n), summary(n),
      () => go("/notes/" + n.uid), { class: "row-button" + (n.uid === current ? " selected" : "") }))
      : [h("p", { class: "small muted", text: q ? "No note matches." : "No notes yet. Notes from the phone appear here after a sync." })]));
  };
  renderList();
  split(body, [picker, pages, search, list], editing ? editor(open, renderList) : h("div", { class: "empty" }, h("div", { class: "empty-title", text: "NOTES" }),
    h("p", { class: "small muted", text: "Pick a note on the left, or start a new one. Drop photos of journal pages here: Claude reads them into notes, on your phone or on demand from a page." })));
}
/** Scales a photo like the phone does (long edge 2000 px, upright, JPEG) so Drive and the phone get the same kind of file. */
async function pagePhoto(file) {
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { throw new Error(`${file.name} can't be opened here. Use a JPEG or PNG.`); }
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas"); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error(`${file.name} could not be converted.`);
  return { blob, width: canvas.width, height: canvas.height };
}
/** Uploads journal photos to Drive as waiting pages: read by the phone, or on demand here with Claude. */
async function uploadPages(files) {
  const images = files.filter(f => f.type.startsWith("image/"));
  if (!images.length) { say("Drop photos (JPEG or PNG) of journal pages."); return; }
  if (!drive.connected()) { say("Connect Google Drive first (sync, top right): pages go to your Drive, where your phone can read them."); return; }
  let done = 0;
  for (const file of images) {
    say(`Uploading page ${done + 1} of ${images.length}…`);
    try {
      const photo = await pagePhoto(file), uid = crypto.randomUUID();
      await drive.writeImage(`page-${uid}.jpg`, photo.blob);
      photos.set(uid, Promise.resolve({ url: URL.createObjectURL(photo.blob), width: photo.width, height: photo.height, blob: photo.blob }));
      journal.addWaiting(uid); done++;
    } catch (error) { say(error.message); return; }
  }
  if (location.hash.startsWith("#/notes")) notesView(location.hash.split("/")[2]);
  say(done === 1 ? "Page uploaded. Read it here, or your phone reads it on its next sync and it becomes a note." : `${done} pages uploaded. Read them here, or your phone reads them on their next sync.`);
}
// Only an active request in this tab blocks retrying. A reload can leave the synced state at "reading".
const activeReads = new Set();
/** A page that has no note yet: show the photo, read it with Claude here, or take it back. */
async function pageDialog(page) {
  const reading = activeReads.has(page.uid);
  const body = reading || reader.hasKey() ? paperView(page)
    : h("div", {}, paperView(page), h("p", { class: "small muted", text: "Reading here uses your own Claude API key, kept in this tab only and sent straight to Anthropic. About 1–2¢ per page." }));
  const actions = reading ? [["close", null]] : [["read with Claude", "read"], ["remove", "remove"], ["close", null]];
  const choice = await dialog("Journal page", body, actions);
  if (choice === "read") readPage(page);
  else if (choice === "remove" && await confirmBox("Remove this page? Its photo stays in Drive until your phone syncs.", "remove")) { journal.remove(page.uid); refreshNotes(); }
}
/** Re-renders the notes tab on the page it is showing, after a page changed. */
function refreshNotes() { if (location.hash.startsWith("#/notes")) notesView(location.hash.split("/")[2]); }
/** Reads a waiting page here, with the key held for this tab: the same note the phone would store. */
async function readPage(page) {
  if (activeReads.has(page.uid)) return;
  if (!reader.hasKey() && (await askKey()) == null) return;
  if (activeReads.has(page.uid)) return;
  journal.edit(page.uid, p => { p.state = "reading"; p.error = ""; });
  activeReads.add(page.uid);
  refreshNotes(); say("Reading the page with Claude…");
  let message;
  try {
    const { result, cents } = await reader.read(await pageBlob(page.uid));
    const note = reader.apply(page, result, cents);
    message = `Page read into “${noteTitle(note)}”.`;
  } catch (error) {
    // A later page keeps waiting, for a retry here and for the phone; a permanent problem ends failed.
    journal.edit(page.uid, p => { p.state = error instanceof reader.Later ? "waiting" : "failed"; p.error = error.message; });
    message = error.message;
  } finally { activeReads.delete(page.uid); }
  refreshNotes();
  say(message);
}
/** Asks for the Claude key and keeps it for this tab; returns the key, or null if it was not set. */
async function askKey() {
  const value = await ask("Claude API key", { placeholder: "sk-ant-…", ok: "save", password: true,
    hint: "Kept in this tab only, sent straight to Anthropic. Pages are read with Claude Sonnet 5.5, about 1–2¢ each, billed to your Anthropic account." });
  if (value == null) return null;
  try { reader.setKey(value); return value; } catch (error) { say(error.message); return null; }
}
/** Under a note's title: the date and a plain-text snippet, then its thoughts marked like the preview, by state. */
function summary(n) {
  const lines = n.text.split("\n").filter(l => l.trim()).slice(1), found = lines.filter(l => thought(l));
  const text = lines.filter(l => !thought(l)).map(l => l.replace(/^\s*(#+|>|[-*+]\s+(\[[ xX]\]\s*)?|\d+[.)])\s*/, "")).join(" ").slice(0, 60);
  const chips = found.slice(0, 3).map(line => {
    const state = thoughtStatus(n.uid, line), done = /cleared|let go|moved to Today/.test(state);
    return h("span", { class: "chip" + (done ? " done" : state === "back now" ? " back" : ""), title: state }, "» " + thought(line).text);
  });
  return [new Date(n.updated).toLocaleDateString([], { day: "2-digit", month: "short" }) + (text ? " · " + text : ""), chips,
    found.length > 3 ? h("span", { class: "chip more" }, `+${found.length - 3} more`) : null];
}
/** onSaved refreshes the list beside the editor, so a new note and changed titles show up while typing. */
function editor(note, onSaved = () => {}) {
  let uid = note?.uid || null;
  const state = h("span", { class: "meta muted", text: note ? "saved" : "new" });
  const area = h("textarea", { class: "note-editor", maxlength: NOTE_LIMIT, placeholder: "# Title\n\nWrite in Markdown…", "aria-label": "Note text", spellcheck: "true" });
  area.value = note?.text || "";
  const preview = h("div", { class: "md", hidden: !previewing });
  area.hidden = previewing; if (previewing) preview.replaceChildren(markdown(area.value, uid));
  // Thought lines already handled in this note, counted per line text. A line parks once the cursor has left it,
  // so a half-typed ">> cal" never parks; revisiting an old line without changing it never parks it again.
  let seen = new Map();
  // A line counts as handled only if its thought exists in Parking; anything else parks once the line is finished.
  for (const line of area.value.split("\n")) { const t = thought(line); if (t && thoughtParked(uid, t.key)) seen.set(t.key, (seen.get(t.key) || 0) + 1); }
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
      parkFinished(finished); onSaved(uid);
      state.textContent = "saved";
    } catch (error) { say(error.message); }
  };
  area.addEventListener("input", () => { state.textContent = "…"; clearTimeout(saveTimer); saveTimer = setTimeout(save, 600); });
  area.addEventListener("keyup", event => { if (event.key === "Enter" || event.key.startsWith("Arrow")) { clearTimeout(saveTimer); saveTimer = setTimeout(save, 150); } });
  area.addEventListener("blur", () => save(true));
  // A note read from a journal page can show the page itself; leaving "paper" returns to the text.
  const page = journal.forNote(uid);
  const paperPane = h("div", { hidden: true });
  const showPaper = on => { paperPane.hidden = !on; paperButton.textContent = on ? "text" : "paper"; if (on) { area.hidden = preview.hidden = true; paperPane.replaceChildren(paperView(page)); } else { area.hidden = previewing; preview.hidden = !previewing; } };
  const paperButton = h("button", { onclick: () => { save(true); showPaper(paperPane.hidden); } }, "paper");
  const toggle = () => { save(true); showPaper(false); previewing = !previewing; area.hidden = previewing; preview.hidden = !previewing; mode.textContent = previewing ? "edit" : "preview"; if (previewing) preview.replaceChildren(markdown(area.value, uid)); else area.focus(); };
  const mode = h("button", { onclick: toggle }, previewing ? "edit" : "preview");
  const bar = h("div", { class: "editor-bar" },
    h("button", { class: "narrow-only", onclick: () => { save(true); go("/notes"); } }, "‹ notes"), state, h("span", { class: "spacer" }), page ? paperButton : null, mode,
    h("button", { onclick: () => { save(true); if (!uid) return; const n = notes.get(uid); notes.pin(uid, !n.pinned); notesView(uid); } }, note?.pinned ? "unpin" : "pin"),
    h("button", { onclick: async () => { if (!uid) { go("/notes"); return; } if (await confirmBox("Delete this note on all devices?", "delete")) { notes.remove(uid); go("/notes"); say("Deleted."); } } }, "delete"));
  if (!previewing) setTimeout(() => area.focus({ preventScroll: true }), 0);
  return [bar, area, preview, paperPane, h("div", { class: "meta muted", text: page
    ? "Read from a journal page. In preview, ▸ unfolds the handwriting of a line; paper shows the whole page."
    : "Markdown, the same as the phone's notes. A line starting with >> parks a thought; add @tonight, @tomorrow, @nextweek or a time like @16:30." })];
}
/** A small Markdown renderer for what the phone's editor writes. Text is escaped before any formatting. */
function markdown(source, uid = null) {
  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = s => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>").replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  const out = []; let list = null, code = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  // Lines read from a journal page remember where they sit on the photo.
  const page = journal.forNote(uid);
  const at = line => { const l = journal.lineFor(page, line); return l ? ` data-top="${+l.top}" data-bottom="${+l.bottom}"` : ""; };
  for (const line of source.split("\n")) {
    if (line.startsWith("```")) { if (code === null) { close(); code = []; } else { out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`); code = null; } continue; }
    if (code !== null) { code.push(line); continue; }
    let m; const t = thought(line);
    if (t) { close(); out.push(`<p class="thought-line"${at(line)}><span class="accent">»</span> ${inline(t.text)} <span class="meta muted">· ${esc(thoughtStatus(uid, line))}</span></p>`); }
    else if ((m = line.match(/^(#{1,3})\s+(.*)/))) { close(); out.push(`<h${m[1].length + 1}${at(line)}>${inline(m[2])}</h${m[1].length + 1}>`); }
    else if ((m = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)/))) { if (list !== "ul") { close(); out.push('<ul class="tasks">'); list = "ul"; } out.push(`<li${at(line)}>${m[1] === " " ? "[ ]" : "[x]"} ${inline(m[2])}</li>`); }
    else if ((m = line.match(/^\s*[-*]\s+(.*)/))) { if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; } out.push(`<li${at(line)}>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== "ol") { close(); out.push("<ol>"); list = "ol"; } out.push(`<li${at(line)}>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^>\s?(.*)/))) { close(); out.push(`<blockquote${at(line)}>${inline(m[1])}</blockquote>`); }
    else if (!line.trim()) close();
    else { close(); out.push(`<p${at(line)}>${inline(line)}</p>`); }
  }
  if (code !== null) out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
  close();
  const node = document.createElement("div"); node.innerHTML = out.join("");
  // Each such line gets a small handle that unfolds its strip of handwriting underneath.
  if (page) for (const el of node.querySelectorAll("[data-top]")) {
    const toggle = h("button", { class: "strip-toggle", title: "Show the handwriting", "aria-label": "Show the handwriting of this line" }, "▸");
    toggle.onclick = async () => {
      const open = el.querySelector(".strip"); if (open) { open.remove(); toggle.textContent = "▸"; return; }
      try { const photo = await paperPhoto(page.uid); el.append(strip(photo, +el.dataset.top, +el.dataset.bottom)); toggle.textContent = "▾"; }
      catch (error) { say(error.message); }
    };
    el.prepend(toggle);
  }
  return node;
}

// ── Journal photos: loaded from Drive once per page and kept for this visit. ──
const photos = new Map();
function paperPhoto(pageUid) {
  if (!photos.has(pageUid)) photos.set(pageUid, (async () => {
    if (!drive.connected()) throw new Error("Connect Google Drive to see the handwriting.");
    const blob = await drive.readBlob("page-" + pageUid + ".jpg");
    if (!blob) throw new Error("The photo hasn't synced from the phone yet.");
    const url = URL.createObjectURL(blob), image = new Image(); image.src = url; await image.decode();
    return { url, width: image.naturalWidth, height: image.naturalHeight, blob };
  })().catch(error => { photos.delete(pageUid); throw error; }));
  return photos.get(pageUid);
}
/** The page photo bytes, from this visit's upload or from Drive; a missing photo keeps the page waiting. */
async function pageBlob(uid) {
  if (photos.has(uid)) { try { const photo = await photos.get(uid); if (photo.blob) return photo.blob; } catch { /* ask Drive below */ } }
  if (!drive.connected()) throw new reader.Later("Connect Google Drive to fetch this page's photo.");
  try { const blob = await drive.readBlob("page-" + uid + ".jpg"); if (blob) return blob; }
  catch { throw new reader.Later("Drive could not be reached; the page keeps waiting."); }
  throw new reader.Later("The photo isn't on Drive yet; it arrives with your phone's next sync.");
}
/** One line of the page, cut from the photo by CSS alone: the photo scaled to the width, shifted to the line. */
function strip(photo, top, bottom) {
  const pad = 0.012, t = Math.max(0, top - pad), b = Math.min(1, bottom + pad), span = b - t;
  const el = h("div", { class: "strip", role: "img", "aria-label": "Handwriting of this line" });
  Object.assign(el.style, { backgroundImage: `url(${photo.url})`, aspectRatio: `${photo.width} / ${photo.height * span}`,
    backgroundPosition: `0 ${span >= 1 ? 0 : (t / (1 - span)) * 100}%` });
  return el;
}
/** The whole page with a band over each line it was read from; hovering a band shows its text. */
function paperView(page) {
  const view = h("div", { class: "paper-view" }, h("p", { class: "small muted", text: "Loading the photo…" }));
  paperPhoto(page.uid).then(photo => {
    const frame = h("div", { class: "paper-frame" }, h("img", { src: photo.url, alt: "Journal page photo" }),
      (page.lines || []).filter(l => l.bottom > l.top).map(l => h("div", { class: "band", title: l.text,
        style: `top:${l.top * 100}%;height:${(l.bottom - l.top) * 100}%` })));
    view.replaceChildren(frame);
  }).catch(error => view.replaceChildren(h("p", { class: "small warn", text: error.message })));
  return view;
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
    }),
    section("CLAUDE"),
    rowButton(reader.hasKey() ? "Claude key · set for this tab (" + reader.hint() + ")" : "set Claude API key",
      reader.hasKey() ? "used to read journal pages here; kept until this tab closes" : "to read journal pages on the web, without the phone",
      () => keySettings()),
    h("p", { class: "small muted", text: "Reading a journal page here uses Claude Sonnet 5.5, about 1–2¢ per page. The key stays in this tab, is sent only to Anthropic, and the phone keeps its own key separately." })));
}
/** Sets or forgets the Claude key kept for this tab. */
async function keySettings() {
  if (reader.hasKey()) {
    if (await confirmBox("Forget the Claude key in this tab?", "forget")) { reader.clearKey(); syncView(); say("Key forgotten."); }
    return;
  }
  if (await askKey()) { syncView(); say("Key set for this tab."); }
}
async function connectFlow(quiet) {
  try { say("Opening Google…"); await drive.connect(quiet); say("Connected. Syncing…"); await syncNow(); route(); }
  catch (error) { say(error.message); }
}

// ── Routing and keys ──
function route() {
  const [, name, arg] = (location.hash.replace(/^#/, "") || "/").split("/");
  if (name === "notes") notesView(arg); else if (name === "receipt") receiptView(arg); else if (name === "dice") diceView(); else if (name === "sync") syncView();
  else if (name === "zines") zines.mount(view("zines"), arg, { go, say, dialog, confirm: confirmBox });
  else if (name === "movement") movement.mount(view("movement"), { say });
  else if (name === "parking") parkingView(); else { history.replaceState(null, "", "#/parking"); parkingView(); }
}
addEventListener("hashchange", route);
let lastState = status.state;
onStatus(() => {
  const state = document.getElementById("sync-status"); if (state) state.textContent = describe();
  const finished = lastState === "syncing" && status.state === "idle"; lastState = status.state;
  // Merged edits from the phone appear without a reload, unless the user is typing or a dialog is open.
  if (finished && status.changed && !["#/zines", "#/movement"].some(path => location.hash.startsWith(path)) && dialogHost.hidden && !document.activeElement?.matches("input, textarea")) { const text = notice?.textContent; route(); say(text); }
});
addEventListener("keydown", event => {
  if (!dialogHost.hidden) { if (event.key === "Escape") closeDialog(); return; }
  const typing = document.activeElement?.matches("input, textarea, select"), name = location.hash.split("/")[1];
  if (typing) { if (event.key === "Escape") document.activeElement.blur(); return; }
  if (event.key >= "1" && event.key <= String(TOOLS.length) && !event.ctrlKey && !event.metaKey && !event.altKey) { go("/" + TOOLS[Number(event.key) - 1]); return; }
  if (event.key === "n" && name === "notes") { event.preventDefault(); go("/notes/new"); return; }
  if (name === "dice" && event.key === " ") { event.preventDefault(); document.getElementById("roll")?.click(); }
});

// A COROS sign-in comes back to this page with ?code=…; finish it before drawing the Movement tab.
if (coros.returning()) coros.finish().then(() => { route(); say("COROS connected."); }, error => { route(); say(error.message); });
else route();
syncNow();
addEventListener("pagehide", () => zines.leave());
addEventListener("pageshow", event => { if (event.persisted) route(); });
