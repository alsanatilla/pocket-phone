import * as store from "./zine-store.js?v=20261006-072";
import { preparePhoto, renderer, pageCount } from "./zine-render.js?v=20261006-072";
import { makePDF } from "./zine-pdf.js?v=20261006-072";

const LIMIT = 40;
let current;
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  node.append(...children.flat(Infinity).filter(value => value != null));
  return node;
}
const button = (text, onclick, attrs = {}) => el("button", { text, onclick, ...attrs });
const hint = text => el("p", { class: "small muted", text });
const label = (text, field) => el("label", { class: "zine-field" }, el("span", { class: "meta muted", text }), field);
const fresh = () => ({ id: crypto.randomUUID(), title: "", byline: "", tone: "deep", photos: [], created: Date.now(), updated: Date.now() });
const alive = state => current === state && state.host.isConnected;
function report(state, error) {
  if (alive(state)) state.api.say(error.name === "QuotaExceededError" ? "This browser is out of space. Download a PDF, then delete an old zine or add fewer photos." : error.message || "Couldn't open this zine.");
}
export function leave() {
  if (!current) return;
  const state = current;
  clearTimeout(state.saveTimer);
  if (state.dirty) persist(state).catch(() => {});
  state.urls.forEach(url => URL.revokeObjectURL(url));
  state.painter.clear();
  state.abort.abort();
  current = null;
}
async function persist(state) {
  clearTimeout(state.saveTimer);
  if (!state.dirty || (!state.persisted && !state.book.photos.length)) return;
  const stamp = state.book.updated;
  if (alive(state)) state.saved.textContent = "saving…";
  try {
    await store.saveBook(state.book);
    state.persisted = true;
    if (state.book.updated === stamp) state.dirty = false;
    if (alive(state) && !state.dirty) { state.saved.textContent = "saved in this browser"; state.retry.hidden = true; }
  } catch (error) {
    if (alive(state)) { state.saved.textContent = "couldn't save"; state.retry.hidden = false; }
    report(state, error); throw error;
  }
}
function changed(state, repaint = true) {
  state.book.updated = Math.max(Date.now(), state.book.updated + 1);
  state.dirty = true;
  state.saved.textContent = state.persisted ? "saving…" : "add photos to save this zine";
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => persist(state).catch(() => {}), 250);
  if (repaint) paint(state);
}
function lock(state, busy) {
  state.busy = busy;
  state.host.querySelectorAll("input, textarea, select, button[data-edit]").forEach(node => { node.disabled = busy || node.hasAttribute("data-boundary"); });
  state.host.querySelectorAll("button[data-export]").forEach(node => { node.disabled = busy || !state.book.photos.length; });
}
async function addPhotos(state, files) {
  if (state.busy || !files.length) return;
  if (files.length + state.book.photos.length > LIMIT) { state.api.say(`A pocket zine holds up to ${LIMIT} photos. Choose fewer photos.`); return; }
  lock(state, true);
  try {
    await persist(state);
    const records = [];
    for (let i = 0; i < files.length; i++) {
      if (alive(state)) state.api.say(`Preparing photo ${i + 1} of ${files.length}…`);
      records.push(await preparePhoto(files[i]));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const book = structuredClone(state.book);
    book.photos.push(...records.map(record => ({ id: record.id, caption: "", layout: "frame" })));
    book.updated = Math.max(Date.now(), book.updated + 1);
    await store.saveBook(book, records);
    state.book = book; state.persisted = true; state.dirty = false;
    if (alive(state)) {
      // Give the first successful save a durable URL, without remounting the editor.
      history.replaceState(null, "", "#/zines/" + book.id);
      state.saved.textContent = "saved in this browser";
      state.retry.hidden = true;
      state.api.say(`${files.length} photo${files.length === 1 ? "" : "s"} added.`);
      await photoList(state); paint(state);
    }
  } catch (error) { report(state, error); }
  finally { if (alive(state)) lock(state, false); }
}
export async function mount(host, id, api) {
  const state = { host, api, urls: [], painter: renderer(), abort: new AbortController(), dirty: false, busy: false, page: 0, paintId: 0, listId: 0, saveTimer: 0 };
  current = state;
  host.append(hint("opening zines…"));
  try {
    if (!id) { await library(state); return; }
    state.book = id === "new" ? fresh() : await store.getBook(id);
    if (!alive(state)) return;
    if (!state.book) {
      host.replaceChildren(hint("This zine isn't saved in this browser."), button("← zines", () => api.go("/zines")));
      return;
    }
    state.persisted = id !== "new";
    editor(state);
    await photoList(state);
    paint(state);
  } catch (error) {
    if (alive(state)) { host.replaceChildren(hint("Zines couldn't open. Allow this site to save browser data and try again."), button("try again", () => { leave(); mount(host, id, api); })); report(state, error); }
  }
}
async function library(state) {
  const books = await store.listBooks();
  if (!alive(state)) return;
  const list = el("div", { class: "zine-library" });
  state.host.replaceChildren(
    el("div", { class: "zine-heading" }, el("div", {}, el("h1", { class: "zine-title", text: "zines" })), button("+ new zine", () => state.api.go("/zines/new"))),
    books.length ? list : el("div", { class: "zine-empty" }, hint("No zines yet."), button("new zine", () => state.api.go("/zines/new")))
  );
  for (const book of books) {
    const image = el("img", { alt: "", loading: "lazy", class: "zine-thumb" });
    const row = button("", () => state.api.go("/zines/" + book.id), { class: "zine-book" });
    row.append(image, el("span", {}, el("span", { class: "zine-book-title", text: book.title || "untitled" }), el("span", { class: "sub", text: `${book.photos.length} photos · ${pageCount(book)} pages` })));
    list.append(row);
    if (book.photos.length) {
      const photo = await store.getPhoto(book.photos[0].id);
      if (!alive(state)) return;
      if (photo) { const url = URL.createObjectURL(photo.thumbnail); state.urls.push(url); image.src = url; }
    }
  }
}
function editor(state) {
  const book = state.book;
  const picker = el("input", { type: "file", accept: "image/*", multiple: true, hidden: true, "aria-label": "Add zine photos", onchange: event => {
    const files = [...event.target.files]; event.target.value = ""; addPhotos(state, files);
  } });
  const field = (name, max) => {
    const input = el("input", { type: "text", maxlength: max, "aria-label": name === "title" ? "Zine title" : "Byline", oninput: event => { state.book[name] = event.target.value; changed(state); } });
    input.value = book[name]; return input;
  };
  const title = field("title", 60), byline = field("byline", 48);
  const treatment = el("select", { "aria-label": "Photo treatment", onchange: event => { state.book.tone = event.target.value; state.painter.clear(); changed(state); } },
    el("option", { value: "deep", text: "deep dark · smooth" }), el("option", { value: "soft", text: "soft silver" }),
    el("option", { value: "grain", text: "photocopy grain" }), el("option", { value: "ink", text: "hard ink" }));
  treatment.value = book.tone;
  state.saved = el("span", { class: "meta muted", role: "status", text: state.persisted ? "saved in this browser" : "add photos to save this zine" });
  state.retry = button("retry save", () => persist(state).then(() => { if (alive(state)) state.api.say("Saved."); }).catch(() => {}), { hidden: true, "data-edit": true });
  state.list = el("div", { class: "zine-photo-list" });
  state.settings = el("div", { class: "zine-settings" });
  const caption = el("textarea", { rows: 2, maxlength: 100, "aria-label": "Photo caption", placeholder: "a place, a date, a few words…", oninput: event => {
    const entry = state.book.photos[state.page - 1]; if (entry) { entry.caption = event.target.value; changed(state); }
  } });
  const layout = el("select", { "aria-label": "Page layout", onchange: event => {
    const entry = state.book.photos[state.page - 1]; if (entry) { entry.layout = event.target.value; changed(state); }
  } }, el("option", { value: "frame", text: "black frame · whole photo" }), el("option", { value: "bleed", text: "fill page · crop to fit" }));
  state.caption = caption; state.layout = layout;
  state.settings.append(label("caption", caption), label("page layout", layout));
  const edit = el("aside", { class: "zine-edit", "aria-label": "Edit zine" },
    label("title", title), label("byline", byline), label("print treatment", treatment),
    el("div", { class: "zine-save" }, state.saved, state.retry),
    el("div", { class: "zine-photo-heading" }, el("span", { class: "meta muted", text: "PHOTOS / FIRST ONE IS THE COVER" }), button("+ photos", () => picker.click(), { "data-edit": true })),
    state.list, state.settings,
    button("delete zine", async () => {
      if (state.busy || !await state.api.confirm("Delete this zine and its photos from this browser?", "delete")) return;
      if (!alive(state)) return;
      lock(state, true); clearTimeout(state.saveTimer);
      const wasDirty = state.dirty;
      state.dirty = false; // Navigating away must not queue a save after deletion.
      try { await store.deleteBook(state.book); state.dirty = false; if (alive(state)) state.api.go("/zines"); }
      catch (error) { state.dirty = wasDirty; report(state, error); if (alive(state)) lock(state, false); }
    }, { class: "zine-delete", "data-edit": true })
  );
  state.frame = el("div", { class: "zine-page", role: "img", "aria-label": "Zine cover", tabindex: 0 });
  state.pageLabel = el("span", { class: "meta", role: "status" });
  state.prev = button("← previous", () => turn(state, -1), { "aria-label": "Previous page" });
  state.next = button("next →", () => turn(state, 1), { "aria-label": "Next page" });
  const reader = el("section", { class: "zine-reader", "aria-label": "Read zine" }, state.frame,
    el("div", { class: "zine-pagination" }, state.prev, state.pageLabel, state.next));
  const read = button("read zine", () => {
    const reading = state.host.classList.toggle("reading"); read.textContent = reading ? "edit zine" : "read zine"; read.setAttribute("aria-pressed", String(reading));
    if (reading) state.frame.focus({ preventScroll: true });
  }, { "aria-pressed": "false" });
  state.host.replaceChildren(picker,
    el("div", { class: "zine-actions" }, button("← zines", () => state.api.go("/zines")),
      button("+ photos", () => picker.click(), { "data-edit": true, "aria-label": "Add photos to zine" }), read,
      button("reading PDF", () => download(state, false), { "data-export": true, disabled: !book.photos.length }),
      button("print booklet", () => download(state, true), { "data-export": true, disabled: !book.photos.length })),
    el("div", { class: "zine-workspace" }, edit, reader));
  const signal = state.abort.signal;
  state.host.addEventListener("dragover", event => { event.preventDefault(); if (!state.busy) state.host.classList.add("dropping"); }, { signal });
  state.host.addEventListener("dragleave", event => { if (!state.host.contains(event.relatedTarget)) state.host.classList.remove("dropping"); }, { signal });
  state.host.addEventListener("drop", event => {
    event.preventDefault(); state.host.classList.remove("dropping"); addPhotos(state, [...event.dataTransfer.files]);
  }, { signal });
  addEventListener("keydown", event => {
    if (!alive(state) || !document.getElementById("dialog").hidden || event.ctrlKey || event.metaKey || event.altKey || document.activeElement?.matches("input, textarea, select")) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); turn(state, event.key === "ArrowLeft" ? -1 : 1); }
  }, { signal });
  let touch;
  state.frame.addEventListener("touchstart", event => { if (event.touches.length === 1) touch = { x: event.touches[0].clientX, y: event.touches[0].clientY }; }, { passive: true, signal });
  state.frame.addEventListener("touchend", event => {
    if (!touch) return;
    const dx = event.changedTouches[0].clientX - touch.x, dy = event.changedTouches[0].clientY - touch.y; touch = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) turn(state, dx < 0 ? 1 : -1);
  }, { passive: true, signal });
}
function turn(state, by) {
  state.page = Math.max(0, Math.min(pageCount(state.book) - 1, state.page + by));
  selectPhoto(state); paint(state);
}
function selectPhoto(state) {
  const entry = state.book.photos[state.page - 1];
  state.settings.hidden = !entry;
  if (entry) { state.caption.value = entry.caption; state.layout.value = entry.layout; }
  state.list.querySelectorAll("button[data-photo]").forEach(node => {
    const selected = Number(node.dataset.photo) === state.page - 1;
    node.classList.toggle("selected", selected); node.setAttribute("aria-pressed", String(selected));
  });
}
async function photoList(state) {
  const generation = ++state.listId;
  const oldURLs = state.urls; state.urls = [];
  state.list.replaceChildren();
  oldURLs.forEach(url => URL.revokeObjectURL(url));
  for (let i = 0; i < state.book.photos.length; i++) {
    const entry = state.book.photos[i], image = el("img", { alt: "", class: "zine-thumb", loading: "lazy" });
    const select = button("", () => { state.page = i + 1; selectPhoto(state); paint(state); }, { class: "zine-photo-select", "data-photo": i, "aria-label": `Open photo ${i + 1}` });
    select.append(image, el("span", { text: String(i + 1).padStart(2, "0") + (i === 0 ? " / cover" : "") }));
    state.list.append(el("div", { class: "zine-photo-row" }, select,
      button("↑", () => move(state, i, i - 1), { "data-edit": true, "aria-label": `Move photo ${i + 1} earlier`, disabled: i === 0, "data-boundary": i === 0 }),
      button("↓", () => move(state, i, i + 1), { "data-edit": true, "aria-label": `Move photo ${i + 1} later`, disabled: i === state.book.photos.length - 1, "data-boundary": i === state.book.photos.length - 1 }),
      button("×", () => remove(state, i), { "data-edit": true, "aria-label": `Remove photo ${i + 1}` })));
    const photo = await store.getPhoto(entry.id);
    if (!alive(state) || generation !== state.listId) return;
    if (photo) { const url = URL.createObjectURL(photo.thumbnail); state.urls.push(url); image.src = url; }
  }
  if (!state.book.photos.length) state.list.append(hint("No photos yet."));
  selectPhoto(state);
  if (state.busy) lock(state, true);
}
function move(state, from, to) {
  if (state.busy || to < 0 || to >= state.book.photos.length) return;
  const selected = state.book.photos[state.page - 1]?.id;
  state.book.photos.splice(to, 0, state.book.photos.splice(from, 1)[0]);
  if (selected) state.page = state.book.photos.findIndex(photo => photo.id === selected) + 1;
  changed(state); photoList(state).catch(error => report(state, error));
}
async function remove(state, index) {
  if (state.busy || !await state.api.confirm(`Remove photo ${index + 1} from this zine?`, "remove")) return;
  if (!alive(state)) return;
  lock(state, true);
  try {
    await persist(state);
    const book = structuredClone(state.book), [entry] = book.photos.splice(index, 1);
    book.updated = Math.max(Date.now(), book.updated + 1);
    await store.saveBook(book, [], [entry.id]);
    state.book = book; state.dirty = false;
    state.page = Math.min(state.page, pageCount(book) - 1);
    state.painter.clear();
    if (alive(state)) { state.saved.textContent = "saved in this browser"; await photoList(state); paint(state); state.api.say("Photo removed."); }
  } catch (error) { report(state, error); }
  finally { if (alive(state)) lock(state, false); }
}
async function paint(state) {
  const generation = ++state.paintId, book = structuredClone(state.book), page = state.page;
  const name = page === 0 ? "cover" : page === pageCount(book) - 1 ? "back cover" : `photo ${page}`;
  state.prev.disabled = page === 0; state.next.disabled = page === pageCount(book) - 1;
  state.pageLabel.textContent = `${name} / ${page + 1} of ${pageCount(book)}`;
  state.frame.setAttribute("aria-label", `${book.title || "untitled"} · ${name}${book.photos[page - 1]?.caption ? " · " + book.photos[page - 1].caption : ""}`);
  state.frame.setAttribute("aria-busy", "true");
  try {
    const surface = await state.painter.page(book, page);
    if (!alive(state) || generation !== state.paintId) return;
    state.frame.replaceChildren(surface);
  } catch (error) { if (generation === state.paintId) report(state, error); }
  finally { if (alive(state) && generation === state.paintId) state.frame.setAttribute("aria-busy", "false"); }
}
async function download(state, booklet) {
  if (state.busy || !state.book.photos.length) return;
  if (booklet && !await state.api.dialog("Print booklet", hint("A5 landscape · 100% · double-sided · flip short edge · fold and staple."), [["cancel", false], ["download PDF", true]])) return;
  if (!alive(state)) return;
  lock(state, true);
  try {
    // A full browser can still export its stored photos and unsaved title edits.
    await persist(state).catch(() => {});
    const book = structuredClone(state.book);
    const pdf = await makePDF(book, booklet, (page, total) => { if (alive(state)) state.api.say(`Making PDF ${page} / ${total}…`); });
    const url = URL.createObjectURL(pdf);
    const filename = (book.title.trim() || "pocket").replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 60) + (booklet ? "-booklet.pdf" : "-zine.pdf");
    const link = el("a", { href: url, download: filename }); document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    if (alive(state)) state.api.say(booklet ? "Booklet PDF downloaded. Print A5 landscape, both sides, flip short edge." : "Reading PDF downloaded.");
  } catch (error) { report(state, error); }
  finally { if (alive(state)) lock(state, false); }
}
