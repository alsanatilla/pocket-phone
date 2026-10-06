// Component structure informed by beautifului.dev: conversation navigation,
// reply + expandable details, context cards, composer. Pocket owns the visuals.
import { ChatStore, ReplyRunner, DEFAULT_CONFIG, config, settings, saveSettings, apiKey, setKey, keyName, identity } from "./pip-core.js?v=20261006-080";
import { notes, tasks, parking, noteTitle, receipt, KIND } from "./store.js?v=20261006-080";
import { mascot } from "./pip-pixels.js?v=20261006-080";
import { backdrop } from "./pixel-backdrop.js?v=20261006-080";
import { CATEGORIES, access, saveAccess, definitions } from "./pip-tools.js?v=20261006-080";
import { activity, settle, mark, elapsed, activityTitle, phaseLabel } from "./pip-activity.js?v=20261006-080";

const store = new ChatStore();
let ui = null, mounted = null, paintTimer = 0, phaseTimer = 0;
const runner = new ReplyRunner(store, { onChange: event => {
  const entry = document.getElementById("pip-entry");
  if (entry) entry.textContent = runner.active ? "pip · replying" : "pip";
  if (!mounted?.root.isConnected) return;
  if (event.type === "delta" && mounted.uid === event.chatId) {
    mounted.latest = event.turn;
    if (!paintTimer) paintTimer = setTimeout(() => { paintTimer = 0; if (mounted?.latest) updateReply(mounted.latest); }, 100);
  } else if (event.type !== "delta") render();
} });
const safely = run => async () => { try { await run(); } catch (error) { ui?.say(error.message); } };
const button = (text, run, props = {}) => ui.h("button", { onclick: safely(run), ...props }, text);
const caption = text => ui.h("p", { class: "meta muted", text });

export function leave() {
  mounted?.root.querySelectorAll(".pip-mascot, .pixel-backdrop").forEach(c=>c.dispose?.());
  clearTimeout(paintTimer); clearInterval(phaseTimer); paintTimer = phaseTimer = 0; mounted = null;
}

export function withContext(source) {
  const current = store.get(localStorage.getItem("pocket:pip-current")) || store.list()[0] || store.create();
  return store.update(current.uid, chat => {
    if (chat.context.some(c => c.kind === source.kind && c.uid === source.uid)) return;
    if (chat.context.length >= 3) throw new Error("This draft already has three sources. Remove one in pip before adding another.");
    chat.context.push({ ...source, originalLength: source.text.length, text: source.text.slice(0, 8000) });
  }).uid;
}

export function mount(root, uid, helpers) {
  leave(); ui = helpers;
  try {
    let chat;
    if (uid === "new") chat = store.create();
    else if (uid) chat = store.get(uid);
    else chat = store.get(localStorage.getItem("pocket:pip-current")) || store.list()[0] || store.create();
    if (!chat) { root.append(caption("This chat was removed."), button("+ new chat", () => ui.go("/pip/new"))); return; }
    localStorage.setItem("pocket:pip-current", chat.uid);
    // A stable route makes browser Back work for both a chat and its source page.
    if (uid !== chat.uid) history.replaceState(null, "", "#/pip/" + chat.uid);
    mounted = { root, uid: chat.uid, replies: new Map(), latest: null }; render();
  } catch (error) { root.append(caption(error.message), button("API settings", () => apiSettings(DEFAULT_CONFIG))); }
}

function conversationNav(current) {
  const chats = store.list(), query = ui.h("input", { type: "search", "aria-label": "Find a chat", placeholder: "find a chat…" });
  const list = ui.h("div", { class: "pip-chat-list" });
  const filter = () => {
    const q = query.value.trim().toLowerCase();
    const matches = chats.filter(c => (c.title + " " + c.turns.map(t => t.text).join(" ")).toLowerCase().includes(q));
    list.replaceChildren(...matches.map(c => button(c.title, () => ui.go("/pip/" + c.uid), { class: "row-button" + (c.uid === current.uid ? " selected" : ""), "aria-current": c.uid === current.uid ? "page" : "false" })));
    if (!matches.length) list.append(caption("No chats found."));
  };
  query.oninput = filter; filter();
  return ui.h("details", { class: "pip-navigation", ...(matchMedia("(min-width: 900px)").matches ? { open: true } : {}) },
    ui.h("summary", { text: "chats [" + chats.length + "]" }),
    ui.h("nav", { "aria-label": "pip conversations" }, button("+ new chat", () => ui.go("/pip/new"), { class: "row-button accent" }), query, list));
}

function contextCards(items, remove = null) {
  return ui.h("div", { class: "pip-context" }, items.map((item, i) => ui.h("div", { class: "pip-context-item" },
    ui.h("details", {}, ui.h("summary", {}, ui.h("span", { text: item.kind + " · " + item.title }), item.originalLength > item.text.length ? ui.h("span", { class: "meta muted", text: " · first " + item.text.length.toLocaleString() + " characters" }) : null),
      ui.h("pre", { text: item.text }), item.href ? button("open source", () => ui.go(item.href), { class: "meta" }) : null),
    remove ? button("×", () => remove(i), { "aria-label": "Remove " + item.title }) : null)));
}

function replyComponent(turn, chat) {
  const answer = ui.h("div", { class: "md pip-answer" });
  const reasoningText = ui.h("div", { class: "pip-reasoning-text", text: turn.reasoning });
  const reasoning = ui.h("details", { class: "pip-reasoning", hidden: !turn.reasoning }, ui.h("summary", { text: "reasoning summary" }), reasoningText);
  const phase = ui.h("p", { class: "meta muted pip-phase", role: "status" });
  const toolTitle = ui.h("summary", { class: "pip-activity-title" }), tools = ui.h("div", { class: "pip-activity-steps" });
  const toolGroup = ui.h("details", { class: "pip-activity", "aria-label": "Tool activity", hidden: true }, toolTitle, tools);
  const sourceTitle = ui.h("summary"), sourceList = ui.h("div");
  const sources = ui.h("details", { class: "pip-sources", "aria-label": "Reply sources", hidden: true }, sourceTitle, sourceList);
  const actions = ui.h("div", { class: "pip-reply-actions" });
  const reply = ui.h("article", { class: "pip-reply", "aria-label": "pip reply" }, ui.h("div", { class: "pip-speaker", text: "pip" }), toolGroup, reasoning, answer, sources, phase, actions);
  const message = ui.h("section", { class: "pip-message", "data-turn": turn.uid },
    ui.h("p", { class: "pip-question", text: "> " + turn.text }), contextCards(turn.context || []), reply);
  mounted.replies.set(turn.uid, { answer, reasoning, reasoningText, tools, toolGroup, toolTitle, sources, sourceTitle, sourceList, phase, actions, chat });
  updateReply(turn); return message;
}

function selectedAnswer(node, fallback) {
  const selection = window.getSelection();
  return selection?.rangeCount && node.contains(selection.getRangeAt(0).commonAncestorContainer) && selection.toString().trim() ? selection.toString().trim() : fallback;
}

function updateReply(turn) {
  const parts = mounted?.replies.get(turn.uid); if (!parts) return;
  const active = runner.active?.turnId === turn.uid;
  const thread = mounted.thread, follow = thread && thread.scrollHeight - thread.scrollTop - thread.clientHeight < 70;
  if (parts.lastAnswer !== turn.answer) { parts.answer.replaceChildren(ui.markdown(turn.answer || "")); parts.lastAnswer = turn.answer; }
  parts.reasoning.hidden = !turn.reasoning; parts.reasoningText.textContent = turn.reasoning || "";
  const rows = !active && turn.status === "streaming" ? settle(turn.activity, "failed", "Interrupted") : activity(turn.activity), signature = JSON.stringify(rows);
  parts.toolGroup.hidden = !rows.length; parts.toolTitle.textContent = activityTitle(rows);
  if (parts.lastStatus !== turn.status) { parts.toolGroup.open = active; parts.lastStatus = turn.status; }
  if (parts.activitySignature !== signature) {
    const expanded = new Set([...parts.tools.querySelectorAll("details[open]")].map(node => node.dataset.id));
    parts.tools.replaceChildren(...rows.map(row => ui.h("details", { class: "pip-tool " + row.state, "data-id": row.id, ...(expanded.has(row.id) ? { open: true } : {}) },
      ui.h("summary", {}, ui.h("span", { text: mark(row.state) + " " + row.title }), ui.h("span", { class: "meta muted", text: [row.state, elapsed(row)].filter(Boolean).join(" · ") })),
      ui.h("div", { class: "pip-tool-details" }, row.summary ? caption(row.summary) : null, row.sources.map(item => sourceLink(item)),
        ui.h("details", { class: "pip-parameters" }, ui.h("summary", { text: "◇ parameters" }), ui.h("code", { text: row.name }), row.input ? ui.h("pre", { text: row.input }) : null)))));
    parts.activitySignature = signature;
  }
  const citations = JSON.stringify(turn.sources || []);
  if (parts.sourceSignature !== citations) { parts.sources.hidden = !turn.sources?.length; parts.sourceTitle.textContent = "△ sources [" + (turn.sources?.length || 0) + "]"; parts.sourceList.replaceChildren(...(turn.sources || []).map((item, index) => sourceLink(item, "[" + (index + 1) + "] " + item.title))); parts.sourceSignature = citations; }
  const label = active || turn.status === "done" ? "" : turn.error || "Interrupted";
  if (active) {
    const progress = mounted.root.querySelector(".pip-loading [role='status']");
    if (progress) progress.textContent = phaseLabel(turn.phase);
  }
  parts.phase.textContent = label;
  parts.phase.classList.toggle("warn", !active && turn.status !== "done");
  if (!active) {
    const text = () => selectedAnswer(parts.answer, turn.answer);
    parts.actions.replaceChildren(...(turn.answer ? [
      button("keep note", () => { const note = notes.create("# " + parts.chat.title + "\n\n" + text()); ui.go("/notes/" + note.uid); }),
      button("park thought", async () => {
        const value = await ui.ask("thought", { value: text().slice(0, 500), multiline: true, limit: 500 });
        if (!value?.trim()) return;
        if (value.trim().length > 500) throw new Error("Keep a thought within 500 characters.");
        const thought = parking.park(value, 0); receipt.log(KIND.PARK, thought.text); ui.go("/thoughts/" + thought.id);
      }),
      button("make task", async () => {
        const value = await ui.ask("Choose one action", { value: text().split("\n").find(line => line.trim())?.replace(/^#+\s*/, "").slice(0, 500), limit: 500 });
        if (!value?.trim()) return;
        const task = tasks.create(value, { kind: "shared", name: "pip · " + parts.chat.title, text: text().slice(0, 8000) }); ui.go("/tasks/" + task.uid);
      }),
      button("copy", async () => { await navigator.clipboard.writeText(text()); ui.say("Copied."); })
    ] : []), ...(turn.status !== "done" && parts.chat.turns.at(-1)?.uid === turn.uid ? [button("retry", () => runner.send(parts.chat.uid, { retry: turn.uid }), { disabled: Boolean(runner.active) })] : []));
  } else parts.actions.replaceChildren();
  if (follow) thread.scrollTop = thread.scrollHeight;
}

function sourceLink(item, title = item.title) {
  return item.href.startsWith("/") ? button(title, () => ui.go(item.href), { class: "pip-source" })
    : ui.h("a", { class: "pip-source", href: item.href, target: "_blank", rel: "noopener noreferrer", text: title });
}

async function pocketAccess(chat) {
  const enabled = access(chat.config), fields = CATEGORIES.map(([key, title]) => {
    const input = ui.h("input", { type: "checkbox" }); input.checked = enabled.includes(key);
    return { key, input, view: ui.h("label", { class: "check-label" }, input, title) };
  });
  await ui.dialog("Pocket tools · read only", ui.h("div", { class: "pip-settings" }, caption(new URL(chat.config.baseUrl).hostname), fields.map(field => field.view),
    button("save access", () => {
      if (runner.active) runner.stop(); saveAccess(chat.config, fields.filter(f => f.input.checked).map(f => f.key)); ui.closeDialog(); render();
    }, { class: "row-button accent" })), [["cancel", null]]);
}

function composer(chat) {
  const field = ui.h("textarea", { id: "pip-prompt", "aria-label": "Message pip", placeholder: "Think it through with pip…", maxlength: 16000, rows: 3 });
  field.value = chat.draft;
  const draftStatus = caption(""), saveDraft = () => {
    try { store.update(chat.uid, c => { c.draft = field.value; }); draftStatus.textContent = ""; }
    catch (error) { draftStatus.textContent = "Draft could not be saved: " + error.message; }
  };
  field.oninput = saveDraft;
  const send = () => runner.send(chat.uid, { text: field.value, context: store.get(chat.uid).context });
  field.onkeydown = event => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!runner.active) void safely(send)(); } };
  const activeHere = runner.active?.chatId === chat.uid;
  const capabilities = ui.h("div", { class: "pip-capabilities" },
    button("□ tools [" + definitions(chat.config).length + "]", () => pocketAccess(chat), { title: "Choose Pocket sources Pip can read" }),
    button(chat.config.provider === "anthropic" ? "△ web · " + (chat.config.webSearch ? "on" : "off") : "△ web · unavailable", () => {
      if (runner.active) runner.stop();
      const value = config({ ...chat.config, webSearch: !chat.config.webSearch });
      store.update(chat.uid, c => { c.config = value; }); saveSettings(value); render();
    }, { disabled: chat.config.provider !== "anthropic", "aria-pressed": String(chat.config.webSearch), title: "Provider web search" }));
  const actions = ui.h("div", { class: "pip-composer-actions" },
    button("+ context", () => attachSource(chat.uid)),
    button(chat.config.model, () => apiSettings(chat.config), { class: "pip-model", title: "Model and API settings" }),
    activeHere ? button("stop", () => runner.stop(), { class: "accent", id: "pip-send" }) : button("send", send, { class: "accent", id: "pip-send", disabled: Boolean(runner.active) }));
  return ui.h("form", { class: "pip-composer", onsubmit: event => event.preventDefault() },
    contextCards(chat.context, i => { store.update(chat.uid, c => c.context.splice(i, 1)); render(); }), capabilities, field, actions, draftStatus);
}

function render() {
  if (!mounted?.root.isConnected) return;
  const chat = store.get(mounted.uid); if (!chat) return;
  mounted.root.querySelectorAll(".pip-mascot, .pixel-backdrop").forEach(c=>c.dispose?.());
  clearInterval(phaseTimer); mounted.replies.clear(); mounted.latest = null;
  const thread = ui.h("div", { class: "pip-thread", tabindex: 0, "aria-label": "Conversation" }); mounted.thread = thread;
  if (chat.turns.length) thread.append(...chat.turns.map(turn => replyComponent(turn, chat)));
  else thread.append(ui.h("div", { class: "pip-empty" }, mascot(), ui.h("h2", { text: "room to think" })));
  const other = runner.active && runner.active.chatId !== chat.uid ? ui.h("div", { class: "pip-running" }, button("open reply", () => ui.go("/pip/" + runner.active.chatId)), button("stop", () => runner.stop())) : null;
  const progress=runner.active?.chatId===chat.uid ? ui.h("div",{class:"pip-loading"},mascot(true),ui.h("span",{class:"meta muted",text:phaseLabel(runner.active.turn.phase),role:"status"})) : null;
  const header = ui.h("header", { class: "pip-heading" }, ui.h("div", {}, ui.h("h1", { class: "workspace-title", text: "pip" }), caption(chat.title)), ui.h("div", { class: "pip-chat-actions" },
    button("rename", async () => { const title = await ui.ask("Name this chat", { value: chat.title, limit: 80 }); if (title?.trim()) { store.update(chat.uid, c => { c.title = title.trim(); }); render(); } }),
    button("delete", async () => { if (await ui.confirm("Delete this chat and its draft from this browser?", "delete")) { if (runner.active?.chatId === chat.uid) runner.stop(); store.remove(chat.uid); localStorage.removeItem("pocket:pip-current"); ui.go("/pip"); } }),
    button("API settings", () => apiSettings(chat.config))));
  const panel = ui.h("div", { class: "pip-panel" }, backdrop("glow"), header, other, thread, progress, composer(chat));
  mounted.root.replaceChildren(ui.h("div", { class: "pip-layout" }, conversationNav(chat), panel));
  requestAnimationFrame(() => { if (mounted?.thread === thread) thread.scrollTop = thread.scrollHeight; });
}

async function attachSource(uid) {
  const kind = await ui.choose("Attach Pocket context", ["Thought", "Task", "Note"]); if (kind == null) return;
  const name = ["thought", "task", "note"][kind], items = kind === 0 ? parking.open() : kind === 1 ? tasks.list() : notes.list();
  if (!items.length) { ui.say("No " + name + "s to attach yet."); return; }
  const titles = items.map(item => kind === 2 ? noteTitle(item) : item.text);
  const index = await ui.choose("Choose a " + name, titles); if (index == null) return;
  const item = items[index], text = kind === 1 ? item.text + (item.steps?.length ? "\nSteps:\n" + item.steps.map(s => (s.done ? "[x] " : "[ ] ") + s.text).join("\n") : "") : item.text;
  store.update(uid, chat => {
    if (chat.context.some(c => c.kind === name && c.uid === String(item.uid || item.id))) return;
    if (chat.context.length >= 3) throw new Error("Attach up to three sources. Remove one before adding another.");
    chat.context.push({ kind: name, uid: String(item.uid || item.id), title: titles[index], text: text.slice(0,8000), originalLength: text.length, href: "/" + ["thoughts","tasks","notes"][kind] + "/" + (item.uid || item.id) });
  }); render();
}

async function apiSettings(current) {
  const provider = ui.h("select", { "aria-label": "API provider" }, ui.h("option", { value: "anthropic", text: "Anthropic" }), ui.h("option", { value: "compatible", text: "Compatible chat API" })); provider.value = current.provider;
  const model = ui.h("input", { "aria-label": "Model ID", placeholder: "provider model ID", maxlength: 120 }); model.value = current.model;
  const endpoint = ui.h("input", { "aria-label": "API base URL", placeholder: "https://your-provider.example/v1", type: "url" }); endpoint.value = current.baseUrl;
  const key = ui.h("input", { "aria-label": "API key", type: "password", autocomplete: "off", placeholder: "API key · leave blank to keep" });
  const limit = ui.h("input", { "aria-label": "Reply token limit", type: "number", min:64, max:8192 }); limit.value = current.maxTokens;
  const thinking = ui.h("input", { type: "checkbox", "aria-label": "Provider reasoning summary" }); thinking.checked = current.thinking;
  const destination = caption(""), error = caption(""); error.classList.add("warn");
  const refresh = () => { endpoint.disabled = provider.value === "anthropic"; thinking.disabled = provider.value !== "anthropic"; destination.textContent = provider.value === "anthropic" ? "Key · this tab · shared with Paper" : "Key · this endpoint and tab · CORS required"; };
  provider.onchange = () => { model.value = provider.value === "anthropic" ? DEFAULT_CONFIG.model : ""; endpoint.value = provider.value === "anthropic" ? DEFAULT_CONFIG.baseUrl : ""; key.value = ""; refresh(); }; refresh();
  const form = ui.h("div", { class:"pip-settings" },
    ui.h("label", {}, "Provider", provider), ui.h("label", {}, "Model", model), ui.h("label", {}, "API base URL", endpoint), ui.h("label", {}, "Key", key), destination,
    ui.h("label", {}, "Reply limit (tokens)", limit), ui.h("label", { class:"check-label" }, thinking, "Reasoning summary"), error,
    button("forget this endpoint’s key", () => { const value=config({provider:provider.value,model:model.value,baseUrl:endpoint.value,maxTokens:limit.value,thinking:thinking.checked}); if (runner.active) runner.stop(); sessionStorage.removeItem(keyName(value)); destination.textContent="Key forgotten for this endpoint."; }, {class:"row-button"}),
    button("save settings", () => {
      try {
        const value=config({provider:provider.value,model:model.value,baseUrl:endpoint.value,maxTokens:limit.value,thinking:thinking.checked,webSearch:current.webSearch && provider.value===current.provider});
        if (runner.active) runner.stop(); if (key.value.trim()) setKey(value,key.value); saveSettings(value);
        const chat=mounted ? store.get(mounted.uid) : null;
        if (!chat) { const next=store.create(value); ui.closeDialog(); ui.go("/pip/"+next.uid); return; }
        if (identity(value) !== identity(chat.config) && chat.turns.length) {
          const next=store.create(value); ui.closeDialog(); ui.go("/pip/"+next.uid); ui.say("New model, new chat. The previous conversation is kept.");
        } else { store.update(chat.uid,c=>{c.config=value;}); ui.closeDialog(); render(); }
      } catch (failure) { error.textContent=failure.message; }
    }, {class:"row-button accent"}));
  await ui.dialog("pip · API settings", form, [["cancel",null]]);
}

addEventListener("pagehide", () => { try { runner.stop(); } catch {} leave(); });
addEventListener("storage", event => { if (event.key?.startsWith("pocket:pip-chat:") && mounted && !document.activeElement?.matches("textarea, input")) render(); });
