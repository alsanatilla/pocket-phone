import { storage as localStorage } from './workspace-storage.js';
// Pocket workstation, hosted by Astro.
import * as cloud from "./cloud.js";
import * as legacyDrive from "./drive.js";
import { clearWorkspace, activeAccount, guestHasData } from "./workspace-storage.js";
import { FILES, importDocument, merge } from "./store.js";
import { validDocument } from '../shared/workspace.js';
import { SEARCH_KINDS, documentRows, chatRows, localSearch } from '../shared/search.js';
import { ChatStore } from './pip-core.js';
import * as reader from "./reader.js";
import * as pip from "./pip.js";
import { backdrop } from "./pixel-backdrop.js";
import * as zines from "./zines.js";
import * as movement from "./movement.js";
import * as gymView from "./gym.js";
import * as coros from "./coros.js";
import { syncNow, describe, onStatus, status } from "./sync.js";
import { gym, weekStart } from "./store.js";
import { installRefresh } from "./retro-loading.js";
import { initExtras, todayTiles, TODAY_CATALOG } from "./extras.js";
import { agenda, clock as clockStore, mountAgenda, mountClock, startClockRuntime } from "./planner.js";
import { parking, tasks, taskDay, receipt, dice, notes, journal, noteTitle, thought, thoughtStatus, thoughtParked, parkThought, when, meter, heckle, relative, daysOld, DELAYS, HECKLE, KIND, NOTE_LIMIT, dayKey, clock, longDate, load } from "./store.js";

const root = document.getElementById("app"), dialogHost = document.getElementById("dialog");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const TOOLS = ["today", "thoughts", "tasks", "notes", "movement", "gym", "apps"];
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
      h("button", { class: "brand", onclick: () => go("/today"), title: "Today", text: "pocket" }),
      h("nav", { class: "tabs", "aria-label": "Workspace" }, tabs),
      h("button", { class: "pip-entry", id: "pip-entry", onclick: () => go("/pip"), text: "pip" }),
      h("button", { class: "status", id: "sync-status", onclick: () => go("/sync"), title: "Sync settings" }, describe())),
    content, notice);
}
/** Clears the work area for one tool; toolbar actions sit at its top right. */
function view(tool, actions = []) {
  zines.leave(); pip.leave(); shell(); closeDialog(); say("");
  content.querySelectorAll('.pixel-backdrop').forEach(canvas=>canvas.dispose?.());
  const pipEntry = document.getElementById("pip-entry"); pipEntry.classList.toggle("selected", tool === "pip"); pipEntry.setAttribute("aria-current", tool === "pip" ? "page" : "false");
  document.querySelectorAll(".tab").forEach(tab => { const on = tab.dataset.tool === tool || tab.dataset.tool === "apps" && ["receipt", "dice", "zines", "sync", "calendar", "clock", "account"].includes(tool); tab.classList.toggle("active", on); tab.setAttribute("aria-current", on ? "page" : "false"); });
  const activeTab = document.querySelector(".tab.active"), tabs = activeTab?.parentElement;
  if (tabs) tabs.scrollLeft = activeTab.offsetLeft - tabs.offsetLeft - (tabs.clientWidth - activeTab.clientWidth) / 2;
  document.title = "pocket · " + (tool === "sync" ? "account" : tool);
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
function ask(title, { value = "", placeholder = "", multiline = false, ok = "save", password = false, hint = "", limit = 120 } = {}) {
  const field = multiline ? h("textarea", { placeholder }) : h("input", { type: password ? "password" : "text", placeholder, ...(password ? {} : { maxlength: limit }) });
  field.value = value;
  if (!multiline) field.addEventListener("keydown", event => { if (event.key === "Enter") closeDialog(field.value); });
  return dialog(title, hint ? h("div", {}, h("p", { class: "small muted", text: hint }), field) : field, [["cancel", null], [ok, () => field.value]]);
}
const confirmBox = (title, ok) => dialog(title, null, [["cancel", false], [ok, true]]);
const plannerApi = { get h() { return h; }, add, rowButton, section, keys, split, say, go, confirm: confirmBox, title: (...args) => workspaceTitle(...args) };
const pipHelpers = { h, go, say, ask, choose, dialog, closeDialog, confirm: confirmBox, markdown };
function thinkWithPip(kind, uid, title, text, href) { guard(() => go("/pip/" + pip.withContext({ kind, uid: String(uid), title, text, href })))(); }

// The workspace follows the same decisions as the phone: capture, choose an action, do it, review.
const source = item => item.note ? notes.get(item.note) : null;
const thoughtMeta = item => !item.due ? "Undecided" : item.due <= Date.now() ? "Ready to revisit" : "Revisit " + relative(item.due);
const taskMeta = task => [task.done ? "Done" : task.due ? (task.due < taskDay() ? "Overdue · " : "") + task.due : "No date", task.important ? "Important" : "", task.steps?.length ? task.steps.filter(s => s.done).length + "/" + task.steps.length + " steps" : ""].filter(Boolean).join(" · ");
// Each area has its own header artwork, so a page is recognisable before it is read.
const SCENE = { calendar: "tiles", clock: "rings", today: "sky", thoughts: "stars", tasks: "road", notes: "waves", search: "rings", apps: "tiles", gym: "iron" };
// Every area header has the same size; the page's actions sit in its top right corner.
function workspaceTitle(body, title, meta = "", scene = SCENE[title] || SCENE[body.className.match(/tool-(\w+)/)?.[1]] || "sky") {
  const actions = body.previousElementSibling?.classList.contains("toolbar") ? body.previousElementSibling : null;
  add(body, h("header", { class: "workspace-sky" }, backdrop(scene),
    h("div", { class: "workspace-sky-title" }, h("h1", { class: "workspace-title", text: title }), h("p", { class: "small muted", text: meta })), actions));
}
async function capture() {
  const choice = await choose("Capture", ["Thought", "Task", "Note"]);
  if(choice === 0)go("/thoughts"); else if(choice === 1)go("/tasks/new"); else if(choice === 2)go("/notes/new");
}
const MINUTE = 60000;
function tileReading(kind) {
  const now = Date.now();
  switch (kind) {
    case "tasks": { const open = tasks.list().filter(t => !t.done); return [open.length ? open.length + " open" : "clear", open[0]?.text || "nothing waiting", "/tasks"]; }
    case "agenda": {
      const next = agenda.all().find(event => event.when + event.minutes * MINUTE >= now);
      if (!next) return ["free", "no appointments", "/calendar"];
      const same = new Date(next.when).toDateString() === new Date(now).toDateString();
      return [(same ? "" : new Date(next.when).toLocaleDateString([], { weekday: "short" }) + " ") + new Date(next.when).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), next.title, "/calendar"];
    }
    case "thoughts": { const open = parking.open(), ready = open.filter(t => t.due > 0 && t.due <= now).length; return [open.length + " open", ready ? ready + " to revisit" : "undecided", "/thoughts"]; }
    case "notes": { const list = notes.list(); return [String(list.length), list[0] ? noteTitle(list[0]) : "no notes yet", "/notes"]; }
    case "movement": { const percent = coros.connected() ? coros.cachedCockpit()?.recovery?.percent : null; return coros.connected() ? [percent != null ? percent + "%" : "…", "recovery", "/movement"] : ["connect", "COROS", "/movement"]; }
    case "gym": { if (gym.active()) return ["now", "workout in progress", "/gym"]; const week = gym.all().filter(w => w.started >= weekStart(now)).length; return [week + "×", "this week", "/gym"]; }
    case "pip": return ["ask", "think with context", "/pip"];
    case "activity": return [String(receipt.lines(now).length), "recorded today", "/receipt"];
    case "focus": return ["start", "a focus session", "/clock/new/focus"];
    case "clock": { const running = clockStore.all().filter(entry => entry.enabled && entry.kind !== "stopwatch").length; return [running ? running + " running" : "clock", "alarms · timers", "/clock"]; }
    case "paper": { const pages = load("journal.json").pages.filter(p => !p.deleted); return [String(pages.length), journal.unread().length ? "waiting to be read" : "handwritten pages", "/notes"]; }
    case "zines": return ["zines", "photo books", "/zines"];
    case "dice": return ["roll", "dice · coin · pick", "/dice"];
    default: return ["", "", "/today"];
  }
}
function tileGrid() {
  const grid = h("div", { class: "today-tiles" });
  for (const tile of todayTiles.list()) {
    const [value, detail, path] = tileReading(tile.kind), name = tile.label || tile.kind;
    grid.append(h("button", { class: "row-button today-tile", "data-tile": tile.kind, "aria-label": name + ", " + value + ", " + detail, onclick: () => go(path) },
      h("span", { class: "section muted", text: name.toUpperCase() }), h("span", { class: "tile-value", text: value }), h("span", { class: "sub", text: detail })));
  }
  return grid;
}
async function editTiles() {
  const body = h("div", { class: "today-tile-editor" });
  const draw = () => {
    const list = todayTiles.list(), missing = TODAY_CATALOG.filter(kind => !list.some(tile => tile.kind === kind));
    const mutate = next => { todayTiles.save(next); draw(); };
    body.replaceChildren(
      ...list.map((tile, i) => h("div", { class: "tile-row" }, h("span", { text: tile.label || tile.kind }),
        h("span", { class: "tile-row-keys" },
          h("button", { disabled: i === 0, "aria-label": "Move " + tile.kind + " up", onclick: () => { const next = [...list]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; mutate(next); } }, "↑"),
          h("button", { disabled: i === list.length - 1, "aria-label": "Move " + tile.kind + " down", onclick: () => { const next = [...list]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; mutate(next); } }, "↓"),
          h("button", { "aria-label": "Remove " + tile.kind, onclick: () => mutate(list.filter((_, k) => k !== i)) }, "×")))),
      missing.length ? section("ADD") : null,
      ...missing.map(kind => rowButton("+ " + kind, "", () => mutate([...list, { uid: kind, kind }]))));
  };
  draw();
  await dialog("Today tiles", body, [["done", true]]);
  if (location.hash === "#/today" || location.hash === "" || location.hash === "#/") route();
}
function todayView() {
  const body = view("today", [["+ capture", capture], ["tiles", editTiles], ["search", () => go("/search")], ["pip", () => go("/pip")]]);
  workspaceTitle(body, "today", new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }));
  add(body, tileGrid());
  const chosen = load("tasks.json").next?.uid, all = tasks.list(), due = all.filter(t => !t.done && (t.uid === chosen || t.due && t.due <= taskDay()));
  due.sort((a,b) => Number(b.uid === chosen) - Number(a.uid === chosen));
  const ready = parking.open().filter(t => t.due > 0 && t.due <= Date.now());
  const left = [section("DO TODAY"), ...due.map(t => rowButton(t.text, taskMeta(t) + (t.uid === chosen ? " · Chosen next" : ""), () => go("/tasks/" + t.uid)))];
  if(!due.length)left.push(h("p", { class: "small muted", text: "No tasks for today." }));
  left.push(keys(["all tasks", () => go("/tasks")], ["+ task", () => go("/tasks/new")]));
  const right = [section("REVISIT"), ready.length ? rowButton(ready.length + (ready.length === 1 ? " thought is ready" : " thoughts are ready"), "", () => go("/thoughts")) : h("p", { class: "small muted", text: "Nothing to revisit." })];
  const latest = notes.list()[0];
  if(latest)right.push(section("PICK UP WHERE YOU LEFT OFF"), rowButton(noteTitle(latest), "Open note", () => go("/notes/" + latest.uid)));
  right.push(section("REVIEW"), rowButton("Activity", "", () => go("/receipt")));
  split(body,left,right);
}
function parkingView(id) {
  const body = view("thoughts", [["+ thought", () => { go("/thoughts"); setTimeout(() => document.getElementById("thought-capture")?.focus(), 0); }], ["search", () => go("/search")]]);
  workspaceTitle(body, "thoughts", parking.open().length + " undecided");
  const item = id ? load("parking.json").items.find(i => String(i.id) === String(id)) : null;
  if(item) {
    add(body,rowButton("‹ thoughts", "", () => go("/thoughts")),h("p", { class: "thought", text: item.text }),h("p", { class: "meta muted", text: item.state === "parked" ? thoughtMeta(item) : item.state === "task" ? "Made into a task" : "Let go" }));
    const linked = tasks.list().find(t => t.source?.token === "thought:" + item.id);
    if(item.state === "parked")add(body, keys(["make task", guard(() => { const task = tasks.fromThought(item); go("/tasks/" + task.uid); })], ["edit", async () => { const value = await ask("Edit thought", { value: item.text, multiline: true }); if(value?.trim())guard(() => { if(value.trim().length>500)throw new Error("Keep a thought within 500 characters."); parking.update(item.id,t => { t.text=value.trim(); }); parkingView(id); })(); }], ["revisit", () => repark(item)], ["let go", () => letGo(item)]));
    else if(linked)add(body,rowButton("Open task", linked.text, () => go("/tasks/" + linked.uid)));
    if(source(item))add(body,rowButton("Source note", noteTitle(source(item)), () => go("/notes/" + item.note)));
    add(body,rowButton("think with pip", "", () => thinkWithPip("thought", item.id, item.text, item.text, "/thoughts/" + item.id)));
    return;
  }
  const field = h("textarea", { id: "thought-capture", placeholder: "An idea, a question, something to consider…", maxlength: 500, "aria-label": "New thought", oninput: e => { parkingDraft=e.target.value; localStorage.setItem("pocket:thought-draft",parkingDraft); } });
  field.value = parkingDraft || localStorage.getItem("pocket:thought-draft") || "";
  const review = h("select", { "aria-label": "Revisit thought" }, h("option", { value: "none", text: "Revisit when I choose" }), DELAYS.map(d => h("option", { value: d, text: "Revisit " + d })));
  const saveThought = guard(() => { const item = parking.park(field.value,when(review.value)); receipt.log(KIND.PARK,item.text); parkingDraft=""; localStorage.removeItem("pocket:thought-draft"); parkingView(); say("Saved to Thoughts."); });
  const open = parking.open();
  split(body,[section("CAPTURE"),field,review,keys(["save thought",saveThought,{class:"accent"}]),rowButton("Handled thoughts", "", async () => { const items=load("parking.json").items.filter(t=>t.state!=="parked").sort((a,b)=>b.updated-a.updated); if(!items.length){say("No handled thoughts yet.");return;} const i=await choose("Handled thoughts",items.map(t=>t.text));if(i!=null)go("/thoughts/"+items[i].id); })],
    [section("UNDECIDED ["+open.length+"]"),open.length ? open.map(item => rowButton(item.text,thoughtMeta(item)+(source(item)?" · "+noteTitle(source(item)):""),()=>go("/thoughts/"+item.id))) : h("p",{class:"small muted",text:"Nothing parked yet."})]);
}
async function letGo(item) { if(await confirmBox("Let this thought go?", "let go"))guard(()=>{parking.close(item.id,"killed");receipt.log(KIND.KILL,item.text);go("/thoughts");})(); }
async function repark(item) { const choices=["When I choose",...DELAYS];const i=await choose("Revisit thought",choices);if(i==null)return;guard(()=>{parking.repark(item.id,i===0?0:when(choices[i]));parkingView(item.id);})(); }
let taskFilter = "Open";
function tasksView(uid) {
  const task = uid && uid !== "new" ? tasks.get(uid) : null;
  const body = view("tasks", [["+ task",()=>go("/tasks/new")],["search",()=>go("/search")]]);
  workspaceTitle(body,"tasks",tasks.list().filter(t=>!t.done).length+" open");
  if(uid === "new" || task && location.hash.endsWith("/edit")){taskEditor(body,task);return;}
  if(uid && !task){add(body,rowButton("‹ tasks","",()=>go("/tasks")),h("p",{class:"small muted",text:"This task was removed."}));return;}
  if(task){
    add(body,rowButton("‹ tasks","",()=>go("/tasks")),h("p",{class:"thought",text:task.text}),h("p",{class:"meta muted",text:taskMeta(task)}),
      keys([task.done?"reopen":"complete",guard(()=>{tasks.complete(uid);tasksView(uid);}),{class:"accent"}],["edit",()=>go("/tasks/"+uid+"/edit")],...(!task.done?[["do next",guard(()=>{tasks.next(uid);go("/today");})]]:[])));
    for(const [i,step] of (task.steps||[]).entries())add(body,rowButton((step.done?"[x] ":"[ ] ")+step.text,"",guard(()=>{tasks.edit(uid,t=>{t.steps[i].done=!t.steps[i].done;});tasksView(uid);})));
    if(task.source){const context=task.source;const note=context.note_uid?notes.get(context.note_uid):null;const thoughtId=context.token?.startsWith("thought:")?context.token.slice(8):null;
      if(thoughtId)add(body,rowButton("Source thought","",()=>go("/thoughts/"+thoughtId)));
      if(note)add(body,rowButton("Source note",noteTitle(note),()=>go("/notes/"+note.uid)));
      add(body,section("CONTEXT"),h("p",{class:"small muted",style:"white-space:pre-wrap",text:context.text}));}
    add(body,rowButton("think with pip", "", () => thinkWithPip("task", task.uid, task.text, [task.text,...(task.steps||[]).map(s=>(s.done?"[x] ":"[ ] ")+s.text)].join("\n"), "/tasks/" + uid)),rowButton("delete task","",async()=>{if(await confirmBox("Delete this task on all devices?","delete"))guard(()=>{tasks.remove(uid);go("/tasks");})();}));return;
  }
  add(body,keys(...["Open","Today","Later","Done"].map(f=>[f,()=>{taskFilter=f;tasksView();},{class:f===taskFilter?"selected":""}])));
  const all=tasks.list().filter(t=>t.done===(taskFilter==="Done")&&(taskFilter!=="Today"||t.due&&t.due<=taskDay()||t.uid===load("tasks.json").next?.uid)&&(taskFilter!=="Later"||t.due>taskDay()));
  add(body,all.length?all.map(t=>rowButton(t.text,taskMeta(t),()=>go("/tasks/"+t.uid))):h("p",{class:"small muted",text:"No tasks in this view."}));
}
function taskEditor(body, task) {
  const draftKey="pocket:task-draft"+(task?":"+task.uid:"");
  let draft=null;try{draft=JSON.parse(localStorage.getItem(draftKey));}catch{}
  const current=draft||task||{text:"",due:"",important:false,steps:[]}, title=h("textarea",{maxlength:500,"aria-label":"Task action",placeholder:"What will you do?"});title.value=current.text;
  const due=h("input",{type:"date","aria-label":"Task date"});due.value=current.due||"";
  const steps=h("textarea",{"aria-label":"Task steps",placeholder:"Steps, one per line"});steps.value=(current.steps||[]).map(s=>s.text).join("\n");
  const important=h("input",{type:"checkbox","aria-label":"Important task"});important.checked=Boolean(current.important);
  const values=()=>({text:title.value.trim(),due:due.value,important:important.checked,steps:steps.value.split("\n").map(s=>s.trim()).filter(Boolean).map(s=>({text:s,done:current.steps?.find(old=>old.text===s)?.done||false}))});
  const draftSave=()=>localStorage.setItem(draftKey,JSON.stringify(values()));for(const field of [title,due,steps,important])field.addEventListener("input",draftSave);
  add(body,rowButton("‹ tasks","",()=>go("/tasks")),h("div",{class:"narrow"},section(task?"EDIT ACTION":"NEW ACTION"),title,h("label",{},"Date",due),h("label",{class:"check-label"},important,"Important"),section("STEPS"),steps,
    keys(["save task",guard(()=>{const value=values();if(!value.text||value.text.length>500)throw new Error("Write an action, up to 500 characters.");if(value.steps.length>32||value.steps.some(s=>s.text.length>160))throw new Error("Use up to 32 steps, each within 160 characters.");const saved=task?tasks.edit(task.uid,t=>Object.assign(t,value)):tasks.create(value.text,null,value);localStorage.removeItem(draftKey);go("/tasks/"+saved.uid);}),{class:"accent"}])));
}
const KIND_LABEL = { note: "NOTES", task: "TASKS", thought: "THOUGHTS", chat: "PIP", paper: "PAPER" };
const marked = text => text.split("\u0001").flatMap((part, i) => { if (!i) return [part]; const [hit, rest = ""] = part.split("\u0002"); return [h("mark", { text: hit }), rest]; });
let searchOpening = 0;
async function openResult(kind, uid, updated = 0, current = () => true) {
  const available = () => kind === 'note' ? notes.get(uid) : kind === 'task' ? tasks.list().find(t => t.uid === uid) : kind === 'thought' ? parking.open().find(t => String(t.id) === String(uid)) : kind === 'paper' ? journal.get(uid) : kind === 'chat' ? new ChatStore().get(uid) : null;
  const copy = available();
  if ((!copy || (copy.updated || 0) < updated) && cloud.connected()) {
    say('Loading…'); searchOpening++;
    try { const synced = await syncNow(); if (!current()) return; if (!synced) { say(describe()); return; } }
    finally { searchOpening--; }
    say('');
  }
  if (!current()) return;
  if (!available()) { say('Connect to load this result.'); return; }
  if (kind === "note") go("/notes/" + uid); else if (kind === "task") go("/tasks/" + uid); else if (kind === "thought") go("/thoughts/" + uid);
  else if (kind === "chat") go("/pip/" + uid);
  else if (kind === "paper") { const page = journal.get(uid); if (page?.note) go("/notes/" + page.note); else if (page) pageDialog(page); else say("This page is not in this browser yet."); }
}
let searchQuery = "";
function searchView() {
  const body=view("search",[["‹ today",()=>go("/today")]]),field=h("input",{placeholder:"Find anything…","aria-label":"Search workspace",value:searchQuery,maxlength:200}),results=h("div",{class:"search-results","aria-live":"polite"});
  workspaceTitle(body,"search");add(body,field,results);
  let timer=0, asked=0;
  const local=q=>{
    const chats=[],store=new ChatStore();
    for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith('pocket:pip-chat:'))try{const chat=store.get(key.slice('pocket:pip-chat:'.length));if(chat)chats.push(chat);}catch{/* Preserve an unreadable chat while searching the remaining records. */}}
    return localSearch([...Object.keys(SEARCH_KINDS).flatMap(name=>documentRows(name,load(name))),...chats.flatMap(chatRows)],q);
  };
  const combine=(remote,q)=>{
    const hits=local(q), key=r=>r.kind+':'+r.uid, matched=new Map(hits.map(r=>[key(r),r]));
    const copies=new Map();
    for(const [name,kinds] of Object.entries(SEARCH_KINDS)){
      const doc=load(name),items=doc.notes||doc.tasks||doc.items||doc.pages||[];
      for(const item of items)copies.set(kinds[0]+':'+String(item.uid??item.id),item);
    }
    for(let i=0;i<localStorage.length;i++){
      const name=localStorage.key(i);if(!name?.startsWith('pocket:pip-chat:'))continue;
      try{const chat=JSON.parse(localStorage.getItem(name));copies.set('chat:'+chat.uid,chat);}catch{}
    }
    const list=[];
    for(const result of remote){const id=key(result),copy=copies.get(id);
      if(copy&&(copy.deleted||result.kind==='thought'&&copy.state!=='parked'||(copy.updated||0)>=result.updated)){
        const fresh=matched.get(id);if(fresh){list.push(fresh);matched.delete(id);}continue;
      }
      list.push(result);matched.delete(id);
    }
    return [...matched.values(),...list].slice(0,40);
  };
  const show=list=>{results.replaceChildren();if(!list.length){add(results,h("p",{class:"small muted",text:"Nothing found."}));return;}
    for(const r of list)add(results,h("button",{class:"row-button search-hit",onclick:()=>{const ticket=asked;openResult(r.kind,r.uid,r.updated,()=>ticket===asked&&body.isConnected).catch(error=>{if(ticket===asked&&body.isConnected)say(error.message);});}},h("span",{class:"search-kind",text:KIND_LABEL[r.kind]||r.kind}),h("span",{text:r.title}),r.snippet?h("span",{class:"sub"},marked(r.snippet)):null));};
  const find=()=>{const q=field.value.trim(),ticket=++asked;searchQuery=field.value;clearTimeout(timer);if(!q){results.replaceChildren();return;}
    show(local(q));if(!cloud.connected())return;
    timer=setTimeout(async()=>{try{const {results:list}=await cloud.search(q);if(ticket===asked&&body.isConnected)show(combine(list,q));}catch{if(ticket===asked&&body.isConnected)show(local(q));}},180);};
  field.addEventListener("input",find);field.focus();if(searchQuery)find();
}
function appsView() {
  const body=view("apps");workspaceTitle(body,"apps");
  split(body,[section("THINK"),rowButton("pip","",()=>go("/pip")),section("PLAN"),rowButton("Calendar","",()=>go("/calendar")),rowButton("Clock","",()=>go("/clock")),section("REVIEW"),rowButton("Activity","",()=>go("/receipt")),section("CREATE & KEEP"),rowButton("Zines","",()=>go("/zines"))],
    [section("BODY"),rowButton("Movement","",()=>go("/movement")),rowButton("Gym","",()=>go("/gym")),section("EXTRAS"),rowButton("Dice","",()=>go("/dice")),section("SETTINGS"),rowButton("Account & devices","",()=>go("/sync"))]);
}

// ── Notes: list on the left, the open note on the right. Saves as you type. ──
let noteQuery = "", previewing = false, saveTimer = 0;
function notesView(uid) {
  const open = uid === "new" ? null : uid ? notes.get(uid) : null;
  const editing = uid === "new" || Boolean(open);
  const picker = h("input", { type: "file", accept: "image/*", multiple: true, hidden: true, onchange: e => { uploadPages([...e.target.files]); e.target.value = ""; } });
  const body = view("notes", [["+ page", () => picker.click(), { title: "Upload photos of journal pages" }], ["+ new note", () => go("/notes/new")]]);
  body.classList.toggle("editing", editing);
  workspaceTitle(body, "notes", notes.list().length + " notes");
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
      : [h("p", { class: "small muted", text: q ? "No note matches." : "No notes yet." })]));
  };
  renderList();
  const deleted = cloud.connected() ? h("button", { class: "row-button quiet-row", onclick: recentlyDeleted }, "recently deleted") : null;
  split(body, [picker, pages, search, list, deleted], editing ? editor(open, renderList) : h("div", { class: "empty" }, h("div", { class: "empty-title", text: "NOTES" })));
}
const stamp = at => new Date(at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
/** The server preserves the current text before applying an older version. */
async function noteHistory(uid) {
  try {
    say("Loading history…"); const { versions } = await cloud.noteHistory(uid); say("");
    const current = notes.get(uid)?.text || "";
    const older = versions.filter(v => v.text !== current);
    if (!older.length) { say("No earlier versions yet."); return; }
    const pick = await dialog("History", h("div", { class: "history-list" }, older.map((v, i) => rowButton(stamp(v.updated), v.text.split("\n").find(line => line.trim())?.slice(0, 80) + " · " + v.text.length + " chars", () => closeDialog(i)))), [["close", null]]);
    if (pick == null) return;
    const version = older[pick];
    const ok = await dialog(stamp(version.updated), h("pre", { class: "history-text", text: version.text }), [["back", false], ["restore", true]]);
    if (!ok) { noteHistory(uid); return; }
    const { document } = await cloud.restoreNote(uid, version.id, notes.get(uid));
    importDocument('notes.json', merge['notes.json'](load('notes.json'), document.value, Date.now()));
    notesView(uid); say("Restored.");
  } catch (error) { say(error.message); }
}
async function recentlyDeleted() {
  try {
    const { notes: gone } = await cloud.deletedNotes();
    if (!gone.length) { say("No notes deleted in the last 30 days."); return; }
    const pick = await dialog("Recently deleted", h("div", { class: "history-list" }, gone.map((n, i) => rowButton(n.text.split("\n").find(line => line.trim())?.replace(/^#+\s*/, "").slice(0, 80) || "Untitled", "deleted " + stamp(n.updated), () => closeDialog(i)))), [["close", null]]);
    if (pick == null) return;
    const ok = await dialog("Restore this note?", h("pre", { class: "history-text", text: gone[pick].text }), [["cancel", false], ["restore", true]]);
    if (!ok) return;
    const note = notes.create(gone[pick].text); go("/notes/" + note.uid); say("Restored.");
  } catch (error) { say(error.message); }
}
/** Scales a photo like the phone does (long edge 2000 px, upright, JPEG). */
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
/** Uploads Paper photos as waiting pages: read by the phone, or on demand here with Claude. */
async function uploadPages(files) {
  const images = files.filter(f => f.type.startsWith("image/"));
  if (!images.length) { say("Drop photos (JPEG or PNG) of journal pages."); return; }
  if (!cloud.connected()) { say("Sign in to Pocket to save Paper photos."); return; }
  let done = 0;
  for (const file of images) {
    say(`Uploading page ${done + 1} of ${images.length}…`);
    try {
      const photo = await pagePhoto(file), uid = crypto.randomUUID();
      await cloud.writeImage(`page-${uid}.jpg`, photo.blob);
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
  else if (choice === "remove" && await confirmBox("Remove this page?", "remove")) { journal.remove(page.uid); refreshNotes(); }
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
    hint: "Key · this tab" });
  if (value == null) return null;
  try { reader.setKey(value); return value; } catch (error) { say(error.message); return null; }
}
/** Under a note's title: the date and a plain-text snippet, then its thoughts marked like the preview, by state. */
function summary(n) {
  const lines = n.text.split("\n").filter(l => l.trim()).slice(1), found = lines.filter(l => thought(l));
  const text = lines.filter(l => !thought(l)).map(l => l.replace(/^\s*(#+|>|[-*+]\s+(\[[ xX]\]\s*)?|\d+[.)])\s*/, "")).join(" ").slice(0, 60);
  const chips = found.slice(0, 3).map(line => {
    const state = thoughtStatus(n.uid, line), done = /cleared|let go|made into a task/.test(state);
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
    h("button", { class: "narrow-only", onclick: () => { save(true); go("/notes"); } }, "‹ notes"), state, h("span", { class: "spacer" }), page ? paperButton : null, mode, h("button", { onclick: async () => { save(true); if(!uid)return; const selected=area.value.substring(area.selectionStart,area.selectionEnd).trim(); const title=await ask("Choose an action from this note", { value:selected||noteTitle(notes.get(uid)), limit:500 }); if(title?.trim())guard(()=>{const n=notes.get(uid);const task=tasks.create(title,{kind:"note",name:noteTitle(n),text:n.text,note_uid:n.uid});go("/tasks/"+task.uid);})(); } }, "make task"),
    h("button", { onclick: () => { save(true); if (!uid) return; const n = notes.get(uid); notes.pin(uid, !n.pinned); notesView(uid); } }, note?.pinned ? "unpin" : "pin"),
    cloud.connected() ? h("button", { onclick: () => { save(true); if (uid) noteHistory(uid); } }, "history") : null,
    h("button", { onclick: () => { save(true); if(!uid)return; const n=notes.get(uid),selected=area.value.substring(area.selectionStart,area.selectionEnd).trim(); thinkWithPip("note",n.uid,noteTitle(n),selected||n.text,"/notes/"+n.uid); } }, "pip"),
    h("button", { onclick: async () => { if (!uid) { go("/notes"); return; } if (await confirmBox("Delete this note on all devices?", "delete")) { notes.remove(uid); go("/notes"); say("Deleted."); } } }, "delete"));
  if (!previewing) setTimeout(() => area.focus({ preventScroll: true }), 0);
  return [bar, area, preview, paperPane];
}
/** A small Markdown renderer for what the phone's editor writes. Text is escaped before any formatting. */
function markdown(source, uid = null) {
  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
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
    let m; const t = uid ? thought(line) : null;
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

// ── Paper photos: loaded from Pocket once per page and kept for this visit. ──
const photos = new Map();
function paperPhoto(pageUid) {
  if (!photos.has(pageUid)) photos.set(pageUid, (async () => {
    if (!cloud.connected()) throw new Error("Sign in to Pocket to see the handwriting.");
    const blob = await cloud.readBlob("page-" + pageUid + ".jpg");
    if (!blob) throw new Error("The photo hasn't synced from the phone yet.");
    const url = URL.createObjectURL(blob), image = new Image(); image.src = url; await image.decode();
    return { url, width: image.naturalWidth, height: image.naturalHeight, blob };
  })().catch(error => { photos.delete(pageUid); throw error; }));
  return photos.get(pageUid);
}
/** The page photo bytes, from this visit's upload or Pocket; a missing photo keeps the page waiting. */
async function pageBlob(uid) {
  if (photos.has(uid)) { try { const photo = await photos.get(uid); if (photo.blob) return photo.blob; } catch { /* fetch below */ } }
  if (!cloud.connected()) throw new reader.Later("Sign in to Pocket to fetch this page's photo.");
  try { const blob = await cloud.readBlob("page-" + uid + ".jpg"); if (blob) return blob; }
  catch { throw new reader.Later("Pocket could not be reached; the page keeps waiting."); }
  throw new reader.Later("This photo has not synced yet.");
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

// ── Account: who you are, which devices are linked, and this browser's copy ──
let passwordMode = true;
const KEY_GLYPH = '<svg viewBox="0 0 12 7" aria-hidden="true" shape-rendering="crispEdges"><path fill="currentColor" d="M1 1h3v1h1v1h6v1h-1v1h-1v-1h-1v1h-1v-1h-2v1h-1v1h-3v-1h-1v-3h1zM2 3v1h1v-1z"/></svg>';
const deviceLabel = ua => !ua ? 'linked device' : /Pocket Android|okhttp|Dalvik/i.test(ua) ? 'Pocket phone' : [
  /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser',
  /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ''].filter(Boolean).join(' · ');
const keyGlyph = () => { const glyph = h('span', { class: 'account-glyph' }); glyph.innerHTML = KEY_GLYPH; return glyph; };
const shortDay = at => new Date(at).toLocaleDateString([], { day: 'numeric', month: 'short' });
const bringGuest = () => !activeAccount() && guestHasData();
const normalCode = value => value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8).replace(/^(.{4})(.+)$/, '$1-$2');

const PHONE_LINK = 'pocket:pending-phone-link';
function accountView(code = '', creating = false) {
  if (!creating) passwordMode = true;
  if (code) globalThis.sessionStorage.setItem(PHONE_LINK, normalCode(decodeURIComponent(code)));
  const body = view('sync'), signed = cloud.connected();
  workspaceTitle(body, !signed && creating ? 'new account' : 'account', signed ? cloud.account().email : cloud.configured() ? creating ? '' : 'not signed in' : 'this browser only');
  const left = h('div', { class: 'account' }), right = h('div', {});
  split(body, left, right);
  add(right, section('THIS BROWSER'),
    signed ? rowButton('import from Drive', '', importDrive) : null,
    rowButton('download backup', '', exportWorkspace), rowButton('restore backup', '', restoreWorkspace),
    rowButton('forget this browser’s copy', '', async () => { if (await confirmBox('Forget this browser’s copy?', 'forget')) { clearWorkspace(); location.reload(); } }),
    section('CLAUDE'), rowButton(reader.hasKey() ? 'Claude key · ' + reader.hint() : 'set Claude API key', '', keySettings));
  if (!cloud.configured()) return;
  if (signed) signedInAccount(left); else signedOutAccount(left, creating);
}

function signedOutAccount(pane, creating = false) {
  const passkeys = cloud.passkeysSupported(), usePassword = passwordMode || !passkeys;
  let busy = false;
  const run = async (label, work) => {
    if (busy) return; busy = true; say(label);
    const controls=[...pane.querySelectorAll('button,input')];controls.forEach(control=>control.disabled=true);
    try { if (await work() === false) say(''); } catch (error) { say(error.message); } finally { busy = false;controls.forEach(control=>control.disabled=false); }
  };
  const field = (label, input) => h('label', { class: 'account-field' }, h('span', { text: label }), input);
  const email = h('input', { type: 'email', autocomplete: usePassword ? 'username' : 'username webauthn', placeholder: 'you@example.com', maxlength: 254, required: true });
  const bring=h('input',{type:'checkbox'});
  if(bringGuest())add(pane,h('label',{class:'check-label account-import'},bring,'bring this browser’s workspace'));
  if (!usePassword) {
    if(creating)add(pane,h('form',{class:'account-create',onsubmit:event=>{event.preventDefault();if(!email.checkValidity()){email.reportValidity();return;}
      run('Creating your account and passkey…',()=>cloud.createAccount(email.value.trim(),bring.checked));}},
      field('EMAIL',email),h('button',{type:'submit',class:'account-primary'},keyGlyph(),'create account with passkey')));
    else add(pane,h('button',{class:'account-primary',onclick:()=>run('Waiting for your passkey…',()=>cloud.signInWithPasskey(bring.checked))},keyGlyph(),'sign in with passkey'));
    add(pane,h('button',{class:'account-switch',onclick:()=>{passwordMode=true;route();}},'use a password'),
      h('button',{class:'account-switch',onclick:()=>go(creating?'/account':'/account/new')},creating?'back to sign in':'create account'));
    return;
  }
  const password = h('input', { type: 'password', autocomplete: creating ? 'new-password' : 'current-password', minlength: creating ? 12 : null, maxlength: 128, required: true });
  const submit = () => {
    if (!email.checkValidity() || !password.value) { email.reportValidity(); password.reportValidity(); return; }
    if (creating && password.value.length < 12) { say('Use at least 12 characters for your password.'); return; }
    run(creating ? 'Creating account…' : 'Signing in…', () => cloud.login(email.value.trim(), password.value, creating, bring.checked));
  };
  add(pane, h('form', { class: 'account-create', onsubmit: event => { event.preventDefault(); submit(); } },
    field('EMAIL', email), field('PASSWORD', password),
    h('button', { type: 'submit', class: 'account-primary' }, creating ? 'create account' : 'sign in')),
    passkeys ? h('button', { class: 'account-switch', onclick: () => {
      if (creating) { passwordMode = false; route(); }
      else run('Waiting for your passkey…', () => cloud.signInWithPasskey(bring.checked));
    } }, creating ? 'create with a passkey' : 'sign in with passkey') : null,
    h('button',{class:'account-switch',onclick:()=>go(creating?'/account':'/account/new')},creating?'back to sign in':'create account'));
}

function signedInAccount(pane) {
  const state = h('div', { class: 'account-status' },
    h('span', { class: status.state === 'error' ? 'warn' : 'accent', text: status.state === 'error' ? 'sync failed' : describe().toLowerCase() }),
    h('button', { onclick: async () => { const ok = await syncNow(); route(); say(ok ? 'Synced.' : describe()); } }, 'sync now'));
  const devices = h('div', {}, h('p', { class: 'small muted', text: '…' })), keysList = h('div', {}, h('p', { class: 'small muted', text: '…' }));
  const link = h('form', { class: 'account-link', onsubmit: event => { event.preventDefault(); linkPhone(codeInput.value); } });
  const codeInput = h('input', { class: 'code-input', placeholder: 'XXXX-XXXX', maxlength: 9, autocomplete: 'one-time-code', 'aria-label': 'Code shown on the phone',
    oninput: event => { event.target.value = normalCode(event.target.value); } });
  add(link, codeInput, h('button', { type: 'submit', class: 'account-commit' }, 'link phone'));
  add(pane, state, section('DEVICES'), devices, section('LINK A PHONE'), link, section('PASSKEYS'), keysList,
    rowButton('sign out', '', async () => { try { await syncNow(); await cloud.disconnect(); } catch (error) { say(error.message); } }));
  const pending = globalThis.sessionStorage.getItem(PHONE_LINK);
  if (pending) { codeInput.value = pending; globalThis.sessionStorage.removeItem(PHONE_LINK); setTimeout(() => codeInput.focus(), 0); }
  drawDevices(devices); drawPasskeys(keysList);
}
async function drawDevices(host) {
  try {
    const [list, current] = await Promise.all([cloud.sessions(), cloud.request('/api/auth/get-session')]);
    list.sort((a, b) => (b.id === current?.session?.id) - (a.id === current?.session?.id) || new Date(b.updatedAt) - new Date(a.updatedAt));
    host.replaceChildren(...list.map(item => {
      const mine = item.id === current?.session?.id;
      return h('div', { class: 'account-item' }, h('div', {}, h('div', { text: deviceLabel(item.userAgent) }), h('div', { class: 'small muted', text: mine ? 'this browser' : 'active ' + shortDay(item.updatedAt) })),
        mine ? null : h('button', { onclick: async () => { if (!await confirmBox('Sign out ' + deviceLabel(item.userAgent) + '?', 'sign out')) return;
          try { await cloud.revokeSession(item.token); drawDevices(host); say('Signed out.'); } catch (error) { say(error.message); } } }, 'sign out'));
    }));
  } catch (error) { host.replaceChildren(h('p', { class: 'small warn', text: error.message })); }
}
async function drawPasskeys(host) {
  try {
    const list = await cloud.passkeys();
    host.replaceChildren(...list.map(item => h('div', { class: 'account-item' },
      h('div', {}, h('div', { text: item.name || 'passkey' }), h('div', { class: 'small muted', text: 'added ' + shortDay(item.createdAt) })),
      h('button', { onclick: async () => { if (!await confirmBox('Remove this passkey?', 'remove')) return; try { await cloud.removePasskey(item.id); drawPasskeys(host); } catch (error) { say(error.message); } } }, 'remove'))),
      cloud.passkeysSupported() ? h('button', { class: 'account-add', onclick: async () => { try { if (await cloud.addPasskey()) { drawPasskeys(host); say('Passkey added.'); } } catch (error) { say(error.message); } } }, '+ add passkey to this account') : null);
  } catch (error) { host.replaceChildren(h('p', { class: 'small warn', text: error.message })); }
}
async function linkPhone(value) {
  const code = normalCode(value);
  if (code.length !== 9) { say('Enter the 8-character code shown on the phone.'); return; }
  try {
    await cloud.checkCode(code);
    if (!await confirmBox('Link the phone showing ' + code + ' to this account?', 'link')) { await cloud.denyCode(code).catch(() => {}); return; }
    await cloud.approveCode(code); route(); say('Phone linked.');
  } catch (error) { say(/invalid|expired|not found/i.test(error.message) ? 'That code has expired. Show a new one on the phone.' : error.message); }
}
function exportWorkspace() {
  const data = { format: 'pocket-workspace', version: 1, exportedAt: new Date().toISOString(), documents: Object.fromEntries(FILES.map(name => [name, load(name)])) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = h('a', { href: url, download: 'pocket-backup-' + new Date().toISOString().slice(0, 10) + '.json' });
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function restoreWorkspace() {
  const picker = h('input', { type: 'file', accept: '.json,application/json' });
  picker.onchange = async () => {
    try {
      const file = picker.files?.[0]; if (!file) return;
      if (file.size > 3 * 1024 * 1024) throw new Error('Keep a workspace backup under 3 MB.');
      const backup = JSON.parse(await file.text());
      if (backup.format !== 'pocket-workspace' || backup.version !== 1 || !backup.documents || Object.entries(backup.documents).some(([name, value]) => !FILES.includes(name) || !validDocument(name, value))) throw new Error('This is not a Pocket workspace backup.');
      if (!await confirmBox('Merge this backup into your workspace?', 'restore')) return;
      for (const [name, value] of Object.entries(backup.documents)) importDocument(name, merge[name](load(name), value, Date.now()));
      await syncNow(); route(); say('Restored.');
    } catch (error) { say(error.message); }
  };
  picker.click();
}
async function importDrive() {
  try {
    say('Opening Drive…'); await legacyDrive.connect();
    for (const name of FILES) {
      const remote = await legacyDrive.read(name);
      if (!remote) continue;
      if (name === 'journal.json') for (const page of remote.pages || []) {
        if (page.deleted) continue;
        const name = 'page-' + page.uid + '.jpg', photo = await legacyDrive.readBlob(name);
        if (photo) await cloud.writeImage(name, photo);
      }
      importDocument(name, merge[name](load(name), remote, Date.now()));
    }
    await syncNow(); route(); say('Imported.');
  } catch (error) { say(error.message); }
  finally { await legacyDrive.disconnect(); }
}
/** Sets or forgets the Claude key kept for this tab. */
async function keySettings() {
  if (reader.hasKey()) {
    if (await confirmBox("Forget the Claude key in this tab?", "forget")) { reader.clearKey(); route(); say("Key forgotten."); }
    return;
  }
  if (await askKey()) { route(); say("Key set for this tab."); }
}
// ── Routing and keys ──
function route() {
  const [, name, arg] = (location.hash.replace(/^#/, "") || "/").split("/");
  if (name === "notes") notesView(arg); else if (name === "receipt") receiptView(arg); else if (name === "dice") diceView(); else if (name === "sync" || name === "account" || name === "link") accountView(name === "link" ? arg || "" : "", name === "account" && arg === "new");
  else if (name === "pip") pip.mount(view("pip"), arg, pipHelpers);
  else if (name === "zines") zines.mount(view("zines"), arg, { go, say, dialog, confirm: confirmBox });
  else if (name === "movement") movement.mount(view("movement"), { say });
  else if (name === "calendar") mountAgenda(view("calendar"), plannerApi);
  else if (name === "clock") mountClock(view("clock"), plannerApi);
  else if (name === "gym") gymView.mount(view("gym"), arg, { h, add, say, section, rowButton, keys, split, go, ask, choose, confirm: confirmBox, title: workspaceTitle });
  else if (name === "thoughts" || name === "parking") parkingView(arg); else if (name === "tasks") tasksView(arg); else if (name === "apps") appsView(); else if (name === "search") searchView(); else if (name === "today") todayView(); else { history.replaceState(null, "", "#/today"); todayView(); }
}
addEventListener("hashchange", route);
let lastState = status.state;
onStatus(() => {
  const state = document.getElementById("sync-status"); if (state) state.textContent = describe();
  const finished = lastState === "syncing" && status.state === "idle"; lastState = status.state;
  // Merged edits from the phone appear without a reload, unless the user is typing or a dialog is open.
  if (finished && status.changed && !searchOpening && !["#/zines", "#/movement", "#/pip"].some(path => location.hash.startsWith(path)) && dialogHost.hidden && !document.activeElement?.matches("input, textarea")) { const text = notice?.textContent; route(); say(text); }
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
cloud.init().then(() => { if (!document.activeElement?.matches('input, textarea')) route(); return syncNow(); }).catch(error => say(error.message));
initExtras();
startClockRuntime();
const refresh = installRefresh({ sync: syncNow, status, onStatus, describe, say });
if ('serviceWorker' in navigator && !import.meta.env.DEV) navigator.serviceWorker.register('/sw.js').catch(() => {});
addEventListener("pagehide", () => zines.leave());
addEventListener("pageshow", event => { if (event.persisted) route(); });
