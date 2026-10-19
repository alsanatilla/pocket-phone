import { storage as localStorage, activeAccount } from './workspace-storage.js';
// Component structure informed by beautifului.dev: conversation navigation,
// reply + expandable details, context cards, composer. Pocket owns the visuals.
import { ChatStore, ReplyRunner, DEFAULT_CONFIG, config, settings, saveSettings, apiKey, identity, contextCoverage, streamReply } from "./pip-core.js";
import { notes, tasks, parking, taskDay, noteTitle, receipt, KIND } from "./store.js";
import { modelName, starters } from './pip-presentation.js';
import { enter, pressMotion } from './ui-motion.js';
import { mascot } from "./pip-pixels.js";
import { backdrop } from "./pixel-backdrop.js";
import { CATEGORIES, access, saveAccess, firecrawlKey, setFirecrawlKey, changeName, changeTarget } from "./pip-tools.js";
import { activity, settle, mark, elapsed, activityTitle, phaseLabel } from "./pip-activity.js";
import { applyProposal, applyChange, applyCoros } from './pip-actions.js';
import { corosAction, corosCourse, corosDated, corosDate, corosProblem, corosTitle, courseLines, sportName } from '../shared/coros-course.js';
import { travelDraft } from '../shared/travel-context.js';
import { CONTEXT_OVERFLOW, POCKET_UPDATED } from './pip-limits.js';
import { pipAway, openTraining } from './pip-away.js';
import { pipScheduled, scheduledState } from './pip-scheduled.js';
import { routineCaption, sortRoutines } from './pip-routine-model.js';
import { serverRuns, streamReplyRemote } from './pip-remote.js';
import { trainingChatRoutine, trainingReply } from './pip-training-chat.js';
import { resolve as resolveCredential, status as credentialStatus, save as saveCredential, forget as forgetCredential } from './pip-credentials.js';

const store = new ChatStore();
let ui = null, mounted = null, paintTimer = 0, phaseTimer = 0, viewportCleanup = null;
const runner = new ReplyRunner(store, { key: (value, chat) => trainingChatRoutine(chat.uid) ? 'account-key' : resolveCredential(value),
  remote: { available: chat => trainingChatRoutine(chat.uid) ? false : serverRuns({ chat: chat.uid }).then(state => state.available), stream: streamReplyRemote },
  stream: (chat, turn, options) => trainingChatRoutine(chat.uid) ? trainingReply(chat, turn, options) : streamReply(chat, turn, options), onChange: event => {
  const entry = document.getElementById("pip-entry");
  if (entry) {
    entry.classList.toggle('replying', Boolean(runner.active));
    entry.setAttribute('aria-label', runner.active ? 'Pip · replying' : 'Pip');
    entry.title = runner.active ? 'Pip · replying' : 'Pip';
  }
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
  for (const reply of mounted?.replies.values() || []) { reply.answer.firstElementChild?.disposeMarkdown?.(); reply.reasoningText.firstElementChild?.disposeMarkdown?.(); }
  mounted?.root.querySelectorAll(".pip-mascot, .pixel-backdrop").forEach(c=>c.dispose?.());
  clearTimeout(paintTimer); clearInterval(phaseTimer); paintTimer = phaseTimer = 0; mounted = null;
  viewportCleanup?.(); viewportCleanup = null;
}

function fitViewport() {
  const panel = mounted?.root.querySelector('.pip-panel'); if (!panel) return;
  const viewport = window.visualViewport;
  const height = viewport?.height || innerHeight;
  const keyboard = height < innerHeight * .78 && document.activeElement?.id === 'pip-prompt';
  document.documentElement.classList.toggle('pip-keyboard', Boolean(keyboard));
  const top = Math.max(0, panel.getBoundingClientRect().top - (viewport?.offsetTop || 0));
  const gutter = parseFloat(getComputedStyle(mounted.root.parentElement).paddingBottom) || 0;
  panel.style.setProperty('--pip-available', Math.max(128, height - top - gutter) + 'px');
}
function watchViewport() {
  const viewport = window.visualViewport;
  const fit = () => requestAnimationFrame(fitViewport);
  window.addEventListener('resize', fit); viewport?.addEventListener('resize', fit); viewport?.addEventListener('scroll', fit);
  document.addEventListener('focusin', fit); document.addEventListener('focusout', fit);
  viewportCleanup = () => { window.removeEventListener('resize', fit); viewport?.removeEventListener('resize', fit); viewport?.removeEventListener('scroll', fit); document.removeEventListener('focusin', fit); document.removeEventListener('focusout', fit); document.documentElement.classList.remove('pip-keyboard'); };
  fit();
}

export function withContext(source) {
  const current = store.get(localStorage.getItem("pocket:pip-current")) || store.list()[0] || store.create();
  return store.update(current.uid, chat => {
    if (chat.context.some(c => c.kind === source.kind && c.uid === source.uid)) return;
    if (chat.context.length >= 3) throw new Error("This draft already has three sources. Remove one in pip before adding another.");
    chat.context.push({ ...source, originalLength: source.text.length, text: source.text.slice(0, 8000) });
  }).uid;
}

/** An explicit brief action starts an unsent draft; it never replaces another conversation. */
export function withBrief(brief) {
  const text = String(brief?.context || '').slice(0,6000);
  if(!text.trim())throw new Error('The brief is unavailable.');
  const chat = store.create();
  return store.update(chat.uid, value => {
    value.title = ('Daily brief · ' + String(brief.day || '')).slice(0,100);
    value.draft = 'Help me choose one thing for today. Use only the facts below; ask when context is missing. Do not change anything.\n\n' + text;
  }).uid;
}

export function withMovement(text) {
  const chat = store.create();
  return store.update(chat.uid, value => { value.title = 'Training'; value.draft = String(text).slice(0,8000); }).uid;
}

/** Travel prepares a separate draft; only the composer's Send starts a provider request. */
export function withTravel(trip, stop, action = 'find') {
  const prepared = travelDraft(trip, stop, action);
  const chat = store.create();
  return store.update(chat.uid, value => {
    value.title = prepared.title;
    value.draft = prepared.draft;
    value.context = [prepared.context];
  }).uid;
}

export function mount(root, uid, helpers) {
  leave(); ui = helpers;
  // Every routine, its next run and its recent outcomes; the nav points here when something failed.
  if (uid === 'scheduled') {
    pipScheduled(ui, { root, go: ui.go, openChat: id => ui.go('/pip/' + id) })
      .catch(error => root.replaceChildren(ui.h('p', { class: 'meta warn', text: error.message || 'Scheduled runs are unavailable.' })));
    return;
  }
  try {
    let chat;
    if (uid === "new") chat = store.create();
    else if (uid) chat = store.get(uid);
    else chat = store.get(localStorage.getItem("pocket:pip-current")) || store.list()[0] || store.create();
    if (!chat) { root.append(caption("This chat was removed."), button("+ new chat", () => ui.go("/pip/new"))); return; }
    localStorage.setItem("pocket:pip-current", chat.uid);
    // A stable route makes browser Back work for both a chat and its source page.
    if (uid !== chat.uid) history.replaceState(null, "", "#/pip/" + chat.uid);
    mounted = { root, uid: chat.uid, replies: new Map(), latest: null, seen: new Set(chat.turns.map(t => t.uid)), startersShown: false }; render(); watchViewport();
  } catch (error) { root.append(caption(error.message), button("API settings", () => apiSettings(DEFAULT_CONFIG))); }
}

function conversationNav(current) {
  const chats = store.list(), query = ui.h("input", { type: "search", "aria-label": "Find a chat", placeholder: "find a chat…" });
  const list = ui.h("div", { class: "pip-chat-list" });
  const filter = () => {
    const q = query.value.trim().toLowerCase();
    const matches = chats.filter(c => (c.title + " " + c.turns.map(t => t.text).join(" ")).toLowerCase().includes(q));
    list.replaceChildren(...matches.map(c => ui.h('div', { class: 'pip-chat-row' },
      button(c.title, () => ui.go("/pip/" + c.uid), { class: "row-button" + (c.uid === current.uid ? " selected" : ""), "aria-current": c.uid === current.uid ? "page" : "false" }),
      button('…', () => chatMenu(c.uid), { class: 'pip-chat-menu', 'aria-label': 'Options for ' + c.title, 'aria-haspopup': 'dialog' }))));
    if (!matches.length) list.append(caption("No chats found."));
  };
  query.oninput = filter; filter();
  const routines = ui.h('div', { class: 'pip-routine-list', 'aria-label': 'Chats Pip writes on a schedule' });
  void fillRoutines(routines, current);
  return ui.h("details", { class: "pip-navigation", ...(matchMedia("(min-width: 900px)").matches ? { open: true } : {}) },
    ui.h("summary", { text: "chats [" + chats.length + "]" }),
    ui.h("nav", { "aria-label": "pip conversations" }, button("+ new chat", () => ui.go("/pip/new"), { class: "row-button accent" }), routines, query, list));
}

/** Each routine's own chat, above the chats: the quickest way to what ran on its own, and where a failure shows. */
async function fillRoutines(node, current) {
  try {
    const state = await scheduledState(), list = sortRoutines(state.routines || []).filter(routine => routine.chat || routine.lastChat);
    if (!list.length || !node.isConnected) return;
    const trouble = list.filter(routine => routine.lastError || routine.lastStatus === 'failed');
    if (trouble.length) {
      const entry = document.getElementById('pip-entry');
      if (entry && !entry.classList.contains('replying')) { entry.classList.add('warn'); entry.title = trouble.length + (trouble.length === 1 ? ' scheduled run needs attention' : ' scheduled runs need attention'); }
    }
    node.replaceChildren(ui.h('p', { class: 'meta muted pip-routine-heading', text: 'routines · ' + (state.settings?.enabled === false || !state.hasKey ? 'paused' : 'on schedule') }),
      ...list.map(routine => {
        const chat = routine.chat || routine.lastChat, problem = routine.lastError || routine.lastStatus === 'failed';
        return ui.h('div', { class: 'pip-chat-row' },
          button((problem ? '⚠ ' : '') + routine.title + ' · ' + routineCaption(routine), () => ui.go('/pip/' + chat),
            { class: 'row-button' + (chat === current.uid ? ' selected' : ''), 'aria-current': chat === current.uid ? 'page' : 'false', title: problem ? routine.lastError || 'the last run failed' : "open this routine's chat" }),
          button('›', () => ui.go('/pip/scheduled'), { class: 'pip-chat-menu', 'aria-label': 'All scheduled runs of ' + routine.title }));
      }));
  } catch { /* signed out or offline: the chat list stays as it is */ }
}

async function chatMenu(uid) {
  const chat = store.get(uid); if (!chat) return;
  const choice = await ui.choose(chat.title, ['Rename', chat.pinned ? 'Unpin this chat' : 'Pin this chat', 'Delete']);
  if (choice === 0) {
    const title = await ui.ask('Name this chat', { value: chat.title, limit: 80 });
    if (title?.trim()) { store.update(uid, value => { value.title = title.trim(); }); render(); }
  } else if (choice === 1) {
    store.update(uid, value => { value.pinned = !value.pinned; }); render();
  } else if (choice === 2 && await ui.confirm('Delete this chat?', 'delete')) {
    if (runner.active?.chatId === uid) runner.stop();
    store.remove(uid);
    if (mounted?.uid === uid) { localStorage.removeItem('pocket:pip-current'); ui.go('/pip'); }
    else render();
  }
}

function contextCards(items, remove = null) {
  return ui.h("div", { class: "pip-context" }, items.map((item, i) => ui.h("div", { class: "pip-context-item" },
    ui.h("details", {}, ui.h("summary", {}, ui.h("span", { text: item.kind + " · " + item.title }), item.originalLength > item.text.length ? ui.h("span", { class: "meta muted", text: " · first " + item.text.length.toLocaleString() + " characters" }) : null),
      ui.h("pre", { text: item.text }), item.href ? button("open source", () => ui.go(item.href), { class: "meta" }) : null),
    remove ? button("×", () => remove(i), { "aria-label": "Remove " + item.title }) : null)));
}

function replyComponent(turn, chat) {
  const plan = ui.h('div', {class:'pip-plan'}), proposals = ui.h('div', {class:'pip-proposals'});
  const answer = ui.h("div", { class: "md pip-answer" });
  const reasoningText = ui.h("div", { class: "md pip-reasoning-text" });
  const reasoning = ui.h("details", { class: "pip-reasoning", hidden: !turn.reasoning }, ui.h("summary", { text: "reasoning summary" }), reasoningText);
  const phase = ui.h("p", { class: "meta muted pip-phase", role: "status" });
  const toolTitle = ui.h("summary", { class: "pip-activity-title" }), tools = ui.h("div", { class: "pip-activity-steps" });
  const toolGroup = ui.h("details", { class: "pip-activity", "aria-label": "Tool activity", hidden: true }, toolTitle, tools);
  const sourceTitle = ui.h("summary"), sourceList = ui.h("div");
  const sources = ui.h("details", { class: "pip-sources", "aria-label": "Reply sources", hidden: true }, sourceTitle, sourceList);
  const usageLine = ui.h("p", { class: "meta muted pip-usage", hidden: true });
  const contextLine = ui.h("p", { class: "meta muted pip-usage", hidden: true });
  const replyStatus = ui.h("p", { class: "meta warn pip-reply-status", hidden: true });
  const actions = ui.h("div", { class: "pip-reply-actions" });
  const resumeHelp = ui.h("p", { class: "meta muted pip-resume-help", hidden: true, text: "Continue keeps completed lookups. Restart starts new research." });
  const reply = ui.h("article", { class: "pip-reply", "aria-label": "pip reply" }, ui.h("div", { class: "pip-speaker", text: "pip" }), plan, toolGroup, reasoning, replyStatus, answer, proposals, sources, contextLine, usageLine, phase, actions, resumeHelp);
  const message = ui.h("section", { class: "pip-message", "data-turn": turn.uid, tabindex: -1, "aria-label": "Conversation turn" },
    ui.h("p", { class: "pip-question" }, ui.h("span", { class: "accent", text: "> " }), turn.text), contextCards(turn.context || []), reply);
  mounted.replies.set(turn.uid, { answer, reasoning, reasoningText, tools, toolGroup, toolTitle, sources, sourceTitle, sourceList, usageLine, contextLine, replyStatus, phase, actions, resumeHelp, chat, plan, proposals });
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
  const formatting = { streaming: active,
    onBeforeRender: () => mounted?.thread === thread && thread.scrollHeight - thread.scrollTop - thread.clientHeight < 70,
    onRender: (node, follow) => { if (follow && mounted?.thread === thread) thread.scrollTop = thread.scrollHeight; } };
  if (!parts.answer.firstElementChild) parts.answer.append(ui.markdown(turn.answer || "", null, formatting));
  else parts.answer.firstElementChild.updateMarkdown(turn.answer || "", formatting);
  parts.reasoning.hidden = !turn.reasoning;
  if (!parts.reasoningText.firstElementChild) parts.reasoningText.append(ui.markdown(turn.reasoning || "", null, formatting));
  else parts.reasoningText.firstElementChild.updateMarkdown(turn.reasoning || "", formatting);
  const rows = !active && turn.status === "streaming" ? settle(turn.activity, "stopped", "Interrupted") : activity(turn.activity), signature = JSON.stringify(rows);
  if (parts.agentSignature !== signature + active) {
    const decoded = rows.filter(row => row.state === 'done').flatMap(row => { try { return [{row,value:JSON.parse(row.result || '{}')}]; } catch { return []; } });
    const lastPlan = (decoded.filter(item => Array.isArray(item.value.plan)).at(-1)?.value.plan || []).filter(step => step && typeof step.text === 'string' && ['pending','in_progress','done'].includes(step.status)).slice(0,8);
    parts.plan.replaceChildren(...lastPlan.map(step => ui.h('div', {class:'pip-plan-step ' + step.status}, ui.h('span', {text:step.status === 'done' ? '□' : step.status === 'in_progress' ? '◌' : '◇'}), ui.h('span', {text:step.text}))));
    parts.proposals.replaceChildren(...decoded.filter(item => ['note','task','appointment'].includes(item.value.proposal?.kind) && typeof item.value.proposal.title === 'string').map(({row,value}) => ui.h('section', {class:'pip-proposal','data-proposal':row.id},
      caption(value.proposal.kind), ui.h('strong', {text:value.proposal.title}),
      row.applied_href ? sourceLink({href:row.applied_href,title:'open saved ' + value.proposal.kind}) : button('review ' + value.proposal.kind, () => reviewProposal(parts.chat, turn, row, value.proposal), {disabled:active}))),
      ...decoded.filter(item => item.value.kind === 'change' && typeof item.value.change?.change === 'string' && typeof item.value.before?.title === 'string').map(({row,value}) => ui.h('section', {class:'pip-proposal','data-proposal':row.id},
        caption(changeName(value.change.change)), ui.h('strong', {text:value.before.title}),
        row.applied_href ? sourceLink({href:row.applied_href,title:'open ' + changeTarget(value.change.change)}) : button('review change', () => reviewChange(parts.chat, turn, row, value), {disabled:active}))),
      ...decoded.filter(item => item.value.kind === 'coros' && typeof item.value.coros?.tool === 'string' && typeof item.value.title === 'string').map(({row,value}) => ui.h('section', {class:'pip-proposal','data-proposal':row.id},
        caption(corosAction(value.coros.tool) + (corosDated(value.coros.tool) && corosDate(value.coros.arguments?.date) ? ' · ' + corosDate(value.coros.arguments.date) : '')), ui.h('strong', {text:value.title}),
        row.applied_href ? sourceLink({href:row.applied_href,title:'saved to COROS'}) : button('review workout', () => reviewCoros(parts.chat, turn, row, value), {disabled:active}))),
      ...decoded.filter(item => item.value.kind === 'action' && typeof item.value.action?.title === 'string').map(({row,value}) => ui.h('section', {class:'pip-proposal','data-proposal':row.id},
        caption(actionName(row.name, value.action.kind) + ' · ' + (row.applied_href ? 'saved' : 'declined')), ui.h('strong', {text:value.action.title}),
        row.applied_href ? sourceLink({href:row.applied_href,title:'open'}) : null)),
      ...rows.filter(row => row.state === 'awaiting').flatMap(row => { try { return [{row,value:JSON.parse(row.result || '{}'),input:JSON.parse(row.input || '{}')}]; } catch { return []; } }).map(({row,value,input}) => {
        const waiting = runner.approvalOf(turn.uid, row.id), decided = waiting?.decision;
        return ui.h('section', {class:'pip-proposal','data-proposal':row.id},
          caption(actionName(row.name, value.action?.kind) + ' · ' + (decided ? (decided.approved ? 'approved' : 'declined') : 'needs your approval')), ui.h('strong', {text:value.action?.title || row.title}),
          waiting && !decided ? [button('review', () => reviewApproval(parts.chat, turn, row, value, input), {class:'accent'}), button('decline', () => runner.decide(turn.uid, row.id, {approved:false}))] : null);
      }));
    parts.agentSignature = signature + active;
  }
  parts.toolGroup.hidden = !rows.length; parts.toolTitle.textContent = activityTitle(rows);
  if (parts.lastStatus !== turn.status) { parts.toolGroup.open = active; parts.lastStatus = turn.status; }
  if (parts.activitySignature !== signature) {
    const expanded = new Set([...parts.tools.querySelectorAll("details[open]")].map(node => node.dataset.id));
    parts.tools.replaceChildren(...rows.map(row => ui.h("details", { class: "pip-tool " + row.state, "data-id": row.id, ...(expanded.has(row.id) ? { open: true } : {}) },
      ui.h("summary", {}, ui.h("span", { text: mark(row.state) + " " + row.title }), ui.h("span", { class: "meta muted pip-tool-status", text: [row.state, elapsed(row)].filter(Boolean).join(" · ") })),
      ui.h("div", { class: "pip-tool-details" }, row.summary ? caption(row.summary) : null, row.sources.map(item => sourceLink(item)),
        ui.h("details", { class: "pip-parameters" }, ui.h("summary", { text: "◇ parameters" }), ui.h("code", { text: row.name }), row.input ? ui.h("pre", { text: row.input }) : null)))));
    parts.activitySignature = signature;
  }
  for (const node of parts.tools.querySelectorAll('.pip-tool')) {
    const row = rows.find(item => item.id === node.dataset.id), status = node.querySelector('.pip-tool-status');
    if (row && status) status.textContent = [row.state, row.ended ? elapsed(row) : row.started ? Math.max(0, Math.floor((Date.now() - row.started) / 1000)) + 's' : ''].filter(Boolean).join(' · ');
  }
  const citations = JSON.stringify(turn.sources || []);
  if (parts.sourceSignature !== citations) { parts.sources.hidden = !turn.sources?.length; parts.sourceTitle.textContent = "△ sources [" + (turn.sources?.length || 0) + "]"; parts.sourceList.replaceChildren(...(turn.sources || []).map((item, index) => sourceLink(item, "[" + (index + 1) + "] " + item.title))); parts.sourceSignature = citations; }
  const inputTokens = turn.usage?.last_input_tokens, outputTokens = turn.usage?.last_output_tokens;
  const actualInput = typeof inputTokens === "number" && Number.isFinite(inputTokens) && inputTokens >= 0;
  const server = turn.usage?.runtime === 'pocket-server';
  const counts = actualInput ? (typeof outputTokens === "number" && Number.isFinite(outputTokens) && outputTokens >= 0 ? inputTokens.toLocaleString() + " input · " + outputTokens.toLocaleString() + " output tokens" : inputTokens.toLocaleString() + " input tokens") : "";
  parts.usageLine.hidden = !server && !actualInput;
  parts.usageLine.textContent = server ? "on Pocket's server" + (counts ? " · " + counts : "") : counts;
  const replay = turn.usage?.history_replay;
  parts.contextLine.hidden = !replay || !Number.isInteger(replay.replayed) || !Number.isInteger(replay.total);
  parts.contextLine.textContent = parts.contextLine.hidden ? '' : 'history used · ' + replay.replayed + '/' + replay.total + ' earlier turns' + (replay.clipped_ids?.length ? ' · ' + replay.clipped_ids.length + ' excerpts' : '');
  parts.replyStatus.hidden = active || turn.status === 'done';
  parts.replyStatus.textContent = parts.replyStatus.hidden ? '' : (turn.answer ? 'partial reply' : 'reply incomplete') + ' · ' + (turn.status === 'streaming' ? 'interrupted' : turn.status);
  const label = active || turn.status === "done" ? "" : turn.error || "Interrupted";
  if (active) {
    const progress = mounted.root.querySelector(".pip-loading [role='status']");
    if (progress) progress.textContent = phaseLabel(turn.phase);
  }
  parts.phase.textContent = label;
  parts.phase.classList.toggle("warn", !active && turn.status !== "done");
  const resumable = !active && turn.status !== "done" && parts.chat.turns.at(-1)?.uid === turn.uid;
  const contextTooLong = turn.error === CONTEXT_OVERFLOW;
  parts.resumeHelp.hidden = !resumable;
  parts.resumeHelp.textContent = contextTooLong ? 'Start a new chat with this question, or choose a model with more context.'
    : turn.error === POCKET_UPDATED ? 'Reload to pick up the current Pocket build, then restart this reply.'
    : 'Continue keeps completed lookups. Restart starts new research.';
  if (!active) {
    const text = () => selectedAnswer(parts.answer, turn.answer);
    parts.actions.replaceChildren(...(turn.answer ? [
      button("save note", () => { const note = notes.create("# " + parts.chat.title + "\n\n" + text()); store.recordKept(parts.chat.uid, turn.uid, 'note', noteTitle(note), '/notes/' + note.uid); ui.go("/notes/" + note.uid); }),
      button("park thought", async () => {
        const value = await ui.ask("thought", { value: text().slice(0, 500), multiline: true, limit: 500 });
        if (!value?.trim()) return;
        if (value.trim().length > 500) throw new Error("Keep a thought within 500 characters.");
        const thought = parking.park(value, 0); receipt.log(KIND.PARK, thought.text); store.recordKept(parts.chat.uid, turn.uid, 'thought', thought.text, '/thoughts/' + thought.id); ui.go("/thoughts/" + thought.id);
      }),
      button("make task", async () => {
        const value = await ui.ask("Choose one action", { value: text().split("\n").find(line => line.trim())?.replace(/^#+\s*/, "").slice(0, 500), limit: 500 });
        if (!value?.trim()) return;
        const task = tasks.create(value, { kind: "shared", name: "pip · " + parts.chat.title, text: text().slice(0, 8000) }); store.recordKept(parts.chat.uid, turn.uid, 'task', task.text, '/tasks/' + task.uid); ui.go("/tasks/" + task.uid);
      }),
      button("copy", async () => { await navigator.clipboard.writeText(text()); ui.say("Copied."); })
    ] : []), ...(resumable ? contextTooLong ? [
      button('new chat', () => {
        const next = store.create(parts.chat.config);
        store.update(next.uid, chat => { chat.draft = turn.text; chat.context = structuredClone(turn.context || []); });
        ui.go('/pip/' + next.uid);
      }, { disabled: Boolean(runner.active), title: 'Open a new chat with this question ready to review and send' }),
      button('model settings', () => apiSettings(parts.chat.config, { text: turn.text, context: turn.context || [] }), { disabled: Boolean(runner.active), title: 'Choose a model with a larger context window' })
    ] : turn.error === POCKET_UPDATED ? [button('reload', () => location.reload(), { title: 'Load the current Pocket build, then restart this reply' })]
      : [button("continue", () => runner.send(parts.chat.uid, { resume: turn.uid }), {disabled:Boolean(runner.active), title: "Continue this reply using its completed lookups"}), button("restart", () => runner.send(parts.chat.uid, { retry: turn.uid }), { disabled: Boolean(runner.active), title: "Start this request again with fresh research" })] : []));
  } else parts.actions.replaceChildren();
  if (follow) thread.scrollTop = thread.scrollHeight;
}

function sourceLink(item, title = item.title) {
  return item.href.startsWith("/") ? button(title, () => ui.go(item.href), { class: "pip-source" })
    : ui.h("a", { class: "pip-source", href: item.href, target: "_blank", rel: "noopener noreferrer", text: title });
}

const actionName = (name, kind) => name === 'change_record' ? changeName(kind) : name === 'coros_write' ? corosAction(kind) : kind || 'record';

/** A write Pip asked for, in the same review as a proposal. Saving approves the call with the user's edits; the AI SDK then runs it. */
function reviewApproval(chat, turn, row, value, input) {
  const approve = edited => runner.decide(turn.uid, row.id, { approved: true, input: edited });
  if (row.name === 'create_record') return reviewProposal(chat, turn, row, input, payload => approve({ kind: payload.kind, title: payload.title.trim(), text: payload.text,
    ...(payload.kind === 'task' ? { due: payload.due, steps: payload.steps } : {}), ...(payload.kind === 'appointment' ? { when: payload.when, minutes: payload.minutes } : {}) }));
  if (row.name === 'change_record') return reviewChange(chat, turn, row, value, approve);
  return reviewCoros(chat, turn, row, { coros: { tool: input.tool, arguments: input.arguments, summary: input.summary }, title: value.action?.title, before: value.before }, (tool, args) => approve({ tool, arguments: args, summary: input.summary }));
}

/** A new note, task or appointment. With approve, the edits go back to Pip instead of being saved here. */
async function reviewProposal(chat, turn, row, proposal, approve = null) {
  let saving = false;
  const title = ui.h('input', {'aria-label':'Proposal title',maxlength:200,value:proposal.title});
  const text = ui.h('textarea', {'aria-label':'Proposal text',maxlength:6000,rows:5}); text.value = proposal.text || '';
  const due = ui.h('input', {type:'date','aria-label':'Task due date',value:proposal.due || ''});
  const steps = ui.h('textarea', {'aria-label':'Task steps',rows:4}); steps.value = (proposal.steps || []).join('\n');
  const when = ui.h('input', {type:'datetime-local','aria-label':'Appointment time'});
  const initial = new Date(proposal.when || Date.now() + 3600000);
  if (Number.isFinite(+initial)) when.value = new Date(+initial - initial.getTimezoneOffset() * 60000).toISOString().slice(0,16);
  const minutes = ui.h('input', {type:'number',min:15,max:480,'aria-label':'Appointment minutes',value:proposal.minutes || 60});
  const error = caption(''); error.classList.add('warn');
  const form = ui.h('div', {class:'pip-settings'}, ui.h('label', {}, 'title', title), proposal.kind !== 'appointment' ? ui.h('label', {}, proposal.kind === 'task' ? 'context' : 'text', text) : null,
    proposal.kind === 'task' ? [ui.h('label', {}, 'due', due), ui.h('label', {}, 'steps', steps)] : null,
    proposal.kind === 'appointment' ? [ui.h('label', {}, 'when', when), ui.h('label', {}, 'minutes', minutes)] : null, error,
    button('save ' + proposal.kind, async () => {
      if (saving) return;
      saving = true;
      try {
        const payload = {...proposal,title:title.value,text:text.value,due:due.value,steps:steps.value.split('\n').map(s=>s.trim()).filter(Boolean),minutes:Number(minutes.value),
          ...(proposal.kind === 'appointment' ? {when:new Date(when.value).toISOString()} : {})};
        if (approve) { approve(payload); ui.closeDialog(); render(); return; }
        const current = store.get(chat.uid), latest = current?.turns.find(t => t.uid === turn.uid), event = activity(latest?.activity).find(item => item.id === row.id);
        if (!event || runner.active?.chatId === chat.uid) throw new Error('Let Pip finish first.');
        if (event.applied_href) { ui.closeDialog(); return; }
        const href = await applyProposal(chat.uid, turn.uid, row.id, payload);
        store.recordApplied(chat.uid, turn.uid, row.id, href, { kind: 'proposal', proposal: payload, requires_confirmation: false });
        ui.closeDialog(); render();
      } catch (failure) { error.textContent = failure.message; }
      finally { saving = false; }
    }, {class:'accent'}));
  await ui.dialog(proposal.kind, form, [['cancel', null]]);
}

/** A change to an existing record: what it is now, what it becomes, and nothing applied until the button. */
async function reviewChange(chat, turn, row, value, approve = null) {
  const change = value.change, before = value.before, error = caption(''), fields = [];
  let saving = false, read = () => ({ ...change });
  error.classList.add('warn');
  if (change.change === 'complete_task') fields.push(ui.h('p', { class: 'small', text: 'Mark “' + before.title + '” as done.' }));
  else if (change.change === 'update_task') {
    const title = ui.h('input', { 'aria-label': 'Task title', maxlength: 500, value: change.title ?? before.title });
    const due = ui.h('input', { type: 'date', 'aria-label': 'Task due date', value: change.due ?? before.due });
    const steps = ui.h('textarea', { 'aria-label': 'Steps to add', rows: 4 }); steps.value = (change.add_steps || []).join('\n');
    fields.push(caption('now: ' + [before.due ? 'due ' + before.due : 'no date', before.steps + (before.steps === 1 ? ' step' : ' steps')].join(' · ')),
      ui.h('label', {}, 'title', title), ui.h('label', {}, 'due', due), ui.h('label', {}, 'add steps', steps));
    read = () => ({ ...change, title: title.value, due: due.value, add_steps: steps.value.split('\n').map(step => step.trim()).filter(Boolean) });
  } else if (change.change === 'append_note') {
    const text = ui.h('textarea', { 'aria-label': 'Text to add', rows: 6, maxlength: 4000 }); text.value = change.text || '';
    fields.push(before.ending ? ui.h('p', { class: 'small muted', text: '…' + before.ending }) : null, ui.h('label', {}, 'add', text));
    read = () => ({ ...change, text: text.value });
  } else {
    const when = ui.h('input', { type: 'datetime-local', 'aria-label': 'New time' }), at = new Date(change.when);
    if (Number.isFinite(+at)) when.value = new Date(+at - at.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const minutes = ui.h('input', { type: 'number', min: 15, max: 480, 'aria-label': 'Minutes', value: change.minutes || before.minutes || 60 });
    fields.push(caption('now: ' + new Date(before.when).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' · ' + before.minutes + ' min'),
      ui.h('label', {}, 'when', when), ui.h('label', {}, 'minutes', minutes));
    read = () => ({ ...change, when: new Date(when.value).toISOString(), minutes: Number(minutes.value) });
  }
  const form = ui.h('div', { class: 'pip-settings' }, change.reason ? caption(change.reason) : null, ...fields, error,
    button(changeName(change.change), () => {
      if (saving) return;
      saving = true;
      try {
        if (approve) { approve(read()); ui.closeDialog(); render(); return; }
        const current = store.get(chat.uid), latest = current?.turns.find(t => t.uid === turn.uid), event = activity(latest?.activity).find(item => item.id === row.id);
        if (!event || runner.active?.chatId === chat.uid) throw new Error('Let Pip finish first.');
        if (event.applied_href) { ui.closeDialog(); return; }
        const payload = read(), href = applyChange(payload);
        store.recordApplied(chat.uid, turn.uid, row.id, href, { ...value, change: payload, requires_confirmation: false });
        ui.closeDialog(); render();
      } catch (failure) { error.textContent = failure.message; }
      finally { saving = false; }
    }, { class: 'accent' }));
  await ui.dialog(before.title, form, [['cancel', null]]);
}

/** A COROS workout change: the date, name and sections as they will appear in COROS. Nothing is sent until the button. */
async function reviewCoros(chat, turn, row, value, approve = null) {
  const tool = value.coros.tool, args = structuredClone(value.coros.arguments), error = caption('');
  let saving = false;
  error.classList.add('warn');
  const iso = raw => /^\d{8}$/.test(raw || '') ? raw.slice(0, 4) + '-' + raw.slice(4, 6) + '-' + raw.slice(6, 8) : '';
  const day = corosDated(tool) ? ui.h('input', { type: 'date', 'aria-label': 'Workout date', value: iso(args.date) }) : null;
  const name = corosCourse(tool) ? ui.h('input', { 'aria-label': 'Workout name', maxlength: 100, value: args.course.courseName }) : null;
  const notes = corosCourse(tool) ? ui.h('textarea', { 'aria-label': 'Workout description', rows: 3, maxlength: 1000 }) : null;
  if (notes) notes.value = args.course.courseDescription || '';
  const course = corosCourse(tool) ? ui.h('div', { class: 'pip-course' }, caption(sportName(args.course)), ...courseLines(args.course).map(line => ui.h('p', { class: 'small' + (line.nested ? ' nested' : ''), text: line.text }))) : null;
  const form = ui.h('div', { class: 'pip-settings' }, caption(value.coros.summary),
    value.before ? ui.h('details', { class: 'pip-before' }, ui.h('summary', { class: 'meta muted', text: tool === 'scheduleWorkout' ? 'workout' : 'now' }), ui.h('p', { class: 'small muted', text: value.before })) : null,
    day ? ui.h('label', {}, 'date', day) : null, name ? ui.h('label', {}, 'name', name) : null, notes ? ui.h('label', {}, 'description', notes) : null, course,
    caption('remove it later in the COROS app'), error,
    button(corosAction(tool), async () => {
      if (saving) return;
      saving = true;
      try {
        if (day) args.date = day.value.replaceAll('-', '');
        if (name) { args.course.courseName = name.value.trim(); args.course.courseDescription = notes.value.trim(); }
        const problem = corosProblem(tool, args); if (problem) throw new Error(problem);
        if (approve) { approve(tool, args); ui.closeDialog(); render(); return; }
        const current = store.get(chat.uid), latest = current?.turns.find(t => t.uid === turn.uid), event = activity(latest?.activity).find(item => item.id === row.id);
        if (!event || runner.active?.chatId === chat.uid) throw new Error('Let Pip finish first.');
        if (event.applied_href) { ui.closeDialog(); return; }
        const href = await applyCoros(chat.uid, turn.uid, row.id, tool, args);
        store.recordApplied(chat.uid, turn.uid, row.id, href, { ...value, coros: { ...value.coros, arguments: args }, title: corosTitle(tool, args), requires_confirmation: false });
        ui.closeDialog(); render();
      } catch (failure) { error.textContent = failure.message; }
      finally { saving = false; }
    }, { class: 'accent' }));
  await ui.dialog(corosTitle(tool, args), form, [['cancel', null]]);
}

async function pocketAccess(chat) {
  const enabled = access(chat.config), fields = CATEGORIES.map(([key, title]) => {
    const input = ui.h("input", { type: "checkbox" }); input.checked = enabled.includes(key);
    return { key, input, view: ui.h("label", { class: "check-label" }, input, title) };
  });
  await ui.dialog("Pocket tools", ui.h("div", { class: "pip-settings" }, caption(new URL(chat.config.baseUrl).hostname), fields.map(field => field.view),
    button("save access", () => {
      if (runner.active) runner.stop(); saveAccess(chat.config, fields.filter(f => f.input.checked).map(f => f.key)); ui.closeDialog(); render();
    }, { class: "row-button accent" })), [["cancel", null]]);
}

async function chatHistory(uid, control) {
  const chat = store.get(uid); if (!chat) throw new Error("This chat was removed.");
  const coverage = contextCoverage(chat), selected = new Set(coverage.selected_ids), clipped = new Set(coverage.clipped_ids);
  updateHistoryControl(control, coverage);
  const query = ui.h("input", { type: "search", "aria-label": "Search stored questions and completed replies", "aria-controls": "pip-history-list", placeholder: "find in this chat…" });
  const results = ui.h("ul", { class: "pip-history-list", id: "pip-history-list", "aria-label": "Stored conversation turns" });
  const resultCount = ui.h("p", { class: "meta muted", role: "status" });
  const compact = value => String(value || "").replace(/\s+/g, " ").trim();
  const excerpt = value => { const text = compact(value); return text.length > 180 ? text.slice(0, 179) + "…" : text; };
  const entries = chat.turns.map((turn, index) => ({ turn, index, search: (String(turn.text || "") + "\n" + (turn.status === "done" ? String(turn.answer || "") : "")).toLowerCase() }));
  const open = turnId => {
    ui.closeDialog();
    const message = mounted?.uid === uid ? [...mounted.root.querySelectorAll("[data-turn]")].find(node => node.dataset.turn === turnId) : null;
    if (!message) { ui.say("This turn is no longer available."); return; }
    message.focus({ preventScroll: true });
    message.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };
  const filter = () => {
    const text = query.value.trim().toLowerCase(), matches = entries.filter(entry => entry.search.includes(text));
    resultCount.textContent = matches.length + (matches.length === 1 ? " turn" : " turns") + (text ? " found" : " stored");
    results.replaceChildren(...matches.map(({ turn, index }) => {
      const included = clipped.has(turn.uid) ? "excerpt" : selected.has(turn.uid) ? "included" : "older on request";
      const state = turn.status === "done" ? "" : turn.status === "stopped" ? "stopped" : turn.status === "failed" ? "failed" : runner.active?.turnId === turn.uid ? "in progress" : "interrupted";
      const detail = ["turn " + (index + 1), included, index === 0 && coverage.first_request_pinned ? "first goal kept" : "", state].filter(Boolean).join(" · ");
      return ui.h("li", {}, button(ui.h("span", {},
        ui.h("span", { class: "meta muted pip-history-detail", text: detail }),
        ui.h("span", { class: "pip-history-request", text: "> " + (excerpt(turn.text) || "Request without text") }),
        ui.h("span", { class: "sub", text: turn.status === "done" ? "pip · " + (excerpt(turn.answer) || "Completed reply without text") : "No completed reply" })), () => open(turn.uid), { class: "row-button pip-history-turn", title: "Open this turn in the conversation" }));
    }));
    if (!matches.length) results.append(ui.h("li", {}, caption(chat.turns.length ? "No stored turns match." : "Your first request will stay available here.")));
  };
  query.oninput = filter; filter();
  await ui.dialog("pip · history", ui.h("div", { class: "pip-history" },
    caption(coverage.replayed + " of " + coverage.total + " earlier turns included for the next reply" + (coverage.clipped_ids.length ? " · " + coverage.clipped_ids.length + (coverage.clipped_ids.length === 1 ? " excerpt" : " excerpts") : "") + "."),
    caption("Pip can look up older history when it needs it. Search stored questions and completed replies."), query, resultCount, results), [["close", null]]);
}

function updateHistoryControl(control, coverage) {
  control.textContent = "◇ history [" + coverage.replayed + "/" + coverage.total + "]";
  control.title = coverage.replayed + " of " + coverage.total + " earlier turns included for the next reply. Browse stored questions and completed replies.";
  control.setAttribute("aria-label", "History for the next reply: " + coverage.replayed + " of " + coverage.total + " earlier turns included. Browse stored questions and completed replies.");
}

async function composerOptions(uid) {
  const draw = () => {
    const chat = store.get(uid); if (!chat) return null;
    const training = Boolean(trainingChatRoutine(uid));
    const next = run => () => { ui.closeDialog(); return run(); };
    const history = button('history', next(() => chatHistory(uid, history)), { class: 'row-button' });
    updateHistoryControl(history, contextCoverage(chat));
    return ui.h('div', { class: 'pip-options' },
      button('add context', next(() => attachSource(uid)), { class: 'row-button' }),
      button('scheduled runs', next(() => ui.go('/pip/scheduled')), { class: 'row-button', title: 'Every routine, when it runs next and how its last runs went' }),
      training ? null : button('web search · ' + (chat.config.webSearch ? 'on' : 'off'), () => {
        if (runner.active) return;
        const current = store.get(uid); if (!current) return;
        const value = config({ ...current.config, webSearch: !current.config.webSearch });
        store.update(uid, c => { c.config = value; }); saveSettings(value);
        body.replaceChildren(draw());
      }, { class: 'row-button', 'aria-pressed': String(chat.config.webSearch), disabled: Boolean(runner.active) }),
      training ? null : button('what Pip can read', next(() => pocketAccess(store.get(uid))), { class: 'row-button', disabled: Boolean(runner.active) }),
      training ? null : button('model · ' + modelName(chat.config.model), next(() => apiSettings(store.get(uid).config)), { class: 'row-button' }),
      history,
      button(training ? 'training settings' : 'on its own', next(() => pipAway(ui, id => ui.go('/pip/' + id))), { class: 'row-button' }),
      training ? null : button('training chat', next(() => openTraining(ui, id => ui.go('/pip/' + id))), { class: 'row-button' }),
      training ? null : button('settings', next(() => apiSettings(store.get(uid).config)), { class: 'row-button' }));
  };
  const body = ui.h('div'); body.append(draw());
  await ui.dialog('Pip options', body, [['close', null]]);
}

function composer(chat) {
  const field = ui.h('textarea', { id: 'pip-prompt', 'aria-label': 'Message Pip', placeholder: 'message Pip…', maxlength: 16000, rows: 1 });
  field.value = chat.draft;
  const draftStatus = ui.h('p', { class: 'meta warn pip-draft-status', role: 'status' });
  const resize = () => { field.style.height = 'auto'; field.style.height = Math.min(160, Math.max(48, field.scrollHeight)) + 'px'; };
  const send = () => {
    if (runner.active || !field.value.trim()) return;
    return runner.send(chat.uid, { text: field.value, context: store.get(chat.uid).context });
  };
  const activeHere = runner.active?.chatId === chat.uid;
  const sendControl = activeHere ? button('stop', () => runner.stop(), { class: 'accent pip-send', id: 'pip-send' })
    : button('send', send, { class: 'accent pip-send', id: 'pip-send', disabled: Boolean(runner.active) || !field.value.trim() });
  const options = button('+', () => composerOptions(chat.uid), { class: 'pip-options-trigger', 'aria-label': 'Pip options', 'aria-haspopup': 'dialog' });
  pressMotion(options); pressMotion(sendControl);
  field.oninput = () => {
    try { store.update(chat.uid, c => { c.draft = field.value; }); draftStatus.textContent = ''; }
    catch (error) { draftStatus.textContent = 'Draft could not be saved: ' + error.message; }
    if (!activeHere) sendControl.disabled = Boolean(runner.active) || !field.value.trim();
    resize();
  };
  field.onkeydown = event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault(); if (!runner.active) { mounted.instantNext = true; void safely(send)(); }
    }
  };
  const form = ui.h('form', { class: 'pip-composer', onsubmit: event => event.preventDefault() },
    contextCards(chat.context, i => { store.update(chat.uid, c => c.context.splice(i, 1)); render(); }),
    ui.h('div', { class: 'pip-compose-line' }, options, field, sendControl), draftStatus);
  requestAnimationFrame(() => { if (field.isConnected) resize(); });
  return form;
}

function emptyChat(chat) {
  const training = Boolean(trainingChatRoutine(chat.uid)), enabled = access(chat.config);
  const suggestions = starters({ enabled, overdue: enabled.includes('tasks') ? tasks.list().filter(t => !t.done && t.due && t.due < taskDay()).length : 0,
    thoughts: enabled.includes('thoughts') ? parking.open().length : 0, training });
  const picks = suggestions.map((suggestion, i) => {
    const pick = button(suggestion.label, async () => {
      if (runner.active) return;
      store.update(chat.uid, value => { value.draft = suggestion.prompt; });
      if (!training && !(await resolveCredential(chat.config))) { render(); await apiSettings(chat.config); return; }
      await runner.send(chat.uid, { text: suggestion.prompt, context: store.get(chat.uid).context });
    }, { class: 'pip-starter', disabled: Boolean(runner.active) });
    pressMotion(pick);
    if (!mounted.startersShown) enter(pick, i * 45);
    return pick;
  });
  mounted.startersShown = true;
  const scope = training ? null : button(enabled.length ? CATEGORIES.filter(([key]) => enabled.includes(key)).map(([, title]) => title.toLowerCase()).join(' · ') : 'choose what Pip can read',
    () => pocketAccess(chat), { class: 'pip-access-summary', 'aria-label': 'Choose what Pip can read' });
  return ui.h('div', { class: 'pip-empty' }, mascot(), scope, ui.h('div', { class: 'pip-starters' }, picks));
}

function render() {
  if (!mounted?.root.isConnected) return;
  const chat = store.get(mounted.uid); if (!chat) return;
  const oldThread = mounted.thread, oldScroll = oldThread?.scrollTop || 0;
  const following = !oldThread || oldThread.scrollHeight - oldScroll - oldThread.clientHeight < 70;
  const focused = mounted.root.contains(document.activeElement) && document.activeElement.id === 'pip-prompt' ? { start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd } : null;
  mounted.root.querySelectorAll(".pip-mascot, .pixel-backdrop").forEach(c=>c.dispose?.());
  clearInterval(phaseTimer);
  for (const reply of mounted.replies.values()) { reply.answer.firstElementChild?.disposeMarkdown?.(); reply.reasoningText.firstElementChild?.disposeMarkdown?.(); }
  mounted.replies.clear(); mounted.latest = null;
  const thread = ui.h("div", { class: "pip-thread", tabindex: 0, "aria-label": "Conversation" }); mounted.thread = thread;
  if (chat.turns.length) thread.append(...chat.turns.map(turn => {
    const message = replyComponent(turn, chat);
    if (!mounted.seen.has(turn.uid) && !mounted.instantNext) enter(message);
    mounted.seen.add(turn.uid); return message;
  }));
  else thread.append(emptyChat(chat));
  mounted.instantNext = false;
  const other = runner.active && runner.active.chatId !== chat.uid ? ui.h("div", { class: "pip-running" }, button("open reply", () => ui.go("/pip/" + runner.active.chatId)), button("stop", () => runner.stop())) : null;
  const progress=runner.active?.chatId===chat.uid ? ui.h("div",{class:"pip-loading"},mascot(true),ui.h("span",{class:"meta muted",text:phaseLabel(runner.active.turn.phase),role:"status"})) : null;
  const header = ui.h("header", { class: "pip-heading" }, ui.h("div", {}, ui.h("h1", { class: "workspace-title", text: "pip" }),
    chat.turns.length || chat.title.toLowerCase() !== 'new chat' ? caption(chat.title) : null));
  const panel = ui.h("div", { class: "pip-panel" }, backdrop("glow"), header, other, thread, progress, composer(chat));
  mounted.root.replaceChildren(ui.h("div", { class: "pip-layout" }, conversationNav(chat), panel));
  if (runner.active?.chatId === chat.uid) phaseTimer = setInterval(() => { if (!document.hidden && mounted?.thread === thread && runner.active) updateReply(runner.active.turn); }, 1000);
  requestAnimationFrame(() => { if (mounted?.thread === thread) {
    if (focused) { const field = mounted.root.querySelector('#pip-prompt'); field?.focus({ preventScroll: true }); field?.setSelectionRange(focused.start, focused.end); }
    fitViewport(); thread.scrollTop = following ? thread.scrollHeight : oldScroll;
  } });
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

const hostOf = value => { try { return new URL(value).hostname; } catch { return ""; } };

async function apiSettings(current, recovery = null) {
  const provider = ui.h("select", { "aria-label": "API provider" }, ui.h("option", { value: "anthropic", text: "Anthropic" }), ui.h("option", { value: "compatible", text: "Compatible chat API" })); provider.value = current.provider;
  const model = ui.h("input", { "aria-label": "Model ID", placeholder: "provider model ID", maxlength: 120 }); model.value = current.model;
  const endpoint = ui.h("input", { "aria-label": "API base URL", placeholder: "https://your-provider.example/v1", type: "url" }); endpoint.value = current.baseUrl;
  const key = ui.h("input", { "aria-label": "API key", type: "password", autocomplete: "off", placeholder: "paste your key" });
  const signedIn = () => Boolean(activeAccount());
  const FIRE = { provider: "firecrawl", baseUrl: "https://api.firecrawl.dev/v2" };
  let crawlVault = await credentialStatus(FIRE);
  const crawlSaved = () => signedIn() ? Boolean(crawlVault.saved) : Boolean(firecrawlKey());
  const crawl = ui.h("input", { "aria-label": "Firecrawl key", type: "password", autocomplete: "off" });
  const thinking = ui.h("button", { type: "button", class: "set-switch", role: "switch", "aria-checked": String(Boolean(current.thinking)), "aria-label": "Provider reasoning summary" });
  thinking.onclick = () => { if (!thinking.disabled) thinking.setAttribute("aria-checked", thinking.getAttribute("aria-checked") === "true" ? "false" : "true"); };

  // Reply limit: three common sizes plus the current value if it was custom.
  let tokens = Number(current.maxTokens);
  const sizes = [...new Set([1024, 2048, 4096, 8192, tokens])].sort((a, b) => a - b);
  const limits = sizes.map(size => {
    const choice = button(size.toLocaleString("en-US"), () => { tokens = size; limits.forEach(item => item.setAttribute("aria-pressed", String(item === choice))); }, { class: "limit-choice", "aria-pressed": String(size === tokens), "aria-label": size.toLocaleString("en-US") + " token reply limit" });
    return choice;
  });

  // The glance line: who, which model, whether this endpoint already has a key.
  const pillProvider = ui.h("span", { class: "status-pill" }), pillModel = ui.h("span", { class: "status-pill" }), pillKey = ui.h("span", { class: "status-pill" });
  const status = ui.h("div", { class: "status-pills", "aria-live": "polite" }, pillProvider, pillModel, pillKey);
  const scope = ui.h("span", { class: "set-hint" }), crawlState = ui.h("span", { class: "state", text: crawlSaved() ? "set" : "not set" });
  const note = caption(""); note.classList.add("accent");
  const error = caption(""); error.classList.add("warn");
  const field = (label, control, hint) => ui.h("div", { class: "set-field" }, ui.h("span", { class: "set-name", text: label }), control, hint ? ui.h("span", { class: "set-hint", text: hint }) : null);
  const group = (label, ...children) => ui.h("section", { class: "set-group" }, ui.h("h3", { class: "set-label", text: label }), ...children);
  const crawlForget = button("forget", async () => {
    if (signedIn()) { await forgetCredential(FIRE); crawlVault = { saved: false }; }
    else setFirecrawlKey("");
    crawl.value = "";
    refreshCrawl();
    note.textContent = "Firecrawl key forgotten.";
  }, { class: "set-forget" });
  const refreshCrawl = () => {
    crawl.placeholder = crawlSaved() ? "saved · leave blank to keep" : "optional · fc-…";
    crawlState.textContent = crawl.value.trim() ? "new key" : crawlSaved() ? signedIn() ? "account" : "set" : "not set";
    crawlForget.hidden = !crawlSaved();
  };
  refreshCrawl();
  const endpointValue = () => provider.value === "anthropic" ? DEFAULT_CONFIG.baseUrl : endpoint.value;
  const formValue = () => ({ provider: provider.value, baseUrl: endpointValue() });
  const formId = () => provider.value + "|" + endpointValue();
  const tabKey = () => Boolean(apiKey(formValue()));
  let vault = await credentialStatus(current), vaultId = formId();

  const forget = button("forget", async () => {
    const value = formValue();
    if (runner.active) runner.stop();
    await forgetCredential(value);
    key.value = "";
    vault = { mode: signedIn() ? "account" : "tab", saved: false };
    vaultId = formId(); refresh();
    note.textContent = "Key forgotten for this endpoint.";
  }, { class: "set-forget" });

  const endpointField = field("API base URL", endpoint, "Include /v1 if your provider needs it. While you are signed in, Pocket's server makes the request.");
  const keyField = ui.h("div", { class: "set-field" }, ui.h("div", { class: "set-head" }, ui.h("span", { class: "set-name", text: "API key" }), forget), key, scope);

  const saved = () => vaultId === formId() ? Boolean(vault?.saved) : signedIn() ? false : tabKey();
  const refresh = () => {
    const compatible = provider.value !== "anthropic";
    endpointField.hidden = !compatible;
    thinking.disabled = !(provider.value === "anthropic" || hostOf(endpoint.value) === "openrouter.ai");
    pillProvider.textContent = !compatible ? "Anthropic" : hostOf(endpoint.value) === "openrouter.ai" ? "OpenRouter" : "Compatible API";
    pillModel.textContent = modelName(model.value);
    const fresh = Boolean(key.value.trim()), ready = saved();
    pillKey.textContent = fresh ? "new key" : signedIn() && ready ? "account key" : tabKey() ? "tab key" : "no key";
    pillKey.classList.toggle("on", fresh || ready || tabKey());
    forget.hidden = !(ready || tabKey());
    key.placeholder = ready ? "saved · leave blank to keep" : tabKey() ? "tab key · leave blank to keep" : "paste your key";
    scope.textContent = signedIn()
      ? vault?.unreachable ? "The key vault could not be reached. A key in this tab still works, but it will not survive the tab."
        : !ready && tabKey() ? "A key is still in this tab from before. Paste it again to store it encrypted on your account."
        : "Encrypted on your Pocket account. The server adds it to each request; it never comes back to this browser."
      : "This tab only. Sign in to store it encrypted on your account.";
  };
  let vaultTimer = 0;
  const reloadVault = async () => {
    const id = formId(), answer = await credentialStatus(formValue());
    if (id !== formId()) return;
    vault = answer; vaultId = id; refresh();
  };
  const queueVault = () => {
    clearTimeout(vaultTimer);
    vault = { mode: signedIn() ? "account" : "tab", saved: false }; vaultId = "";
    refresh();
    vaultTimer = setTimeout(reloadVault, 300);
  };
  provider.onchange = () => { model.value = provider.value === "anthropic" ? DEFAULT_CONFIG.model : ""; endpoint.value = provider.value === "anthropic" ? DEFAULT_CONFIG.baseUrl : ""; key.value = ""; refresh(); queueVault(); };
  model.oninput = refresh; key.oninput = refresh;
  endpoint.oninput = () => { refresh(); queueVault(); };
  crawl.oninput = refreshCrawl;
  refresh();

  const save = button("save settings", async () => {
    try {
      const value = config({ provider: provider.value, model: model.value, baseUrl: endpoint.value, maxTokens: tokens, thinking: thinking.getAttribute("aria-checked") === "true", webSearch: current.webSearch && provider.value === current.provider });
      if (runner.active) runner.stop();
      if (key.value.trim()) await saveCredential(value, key.value);
      if (crawl.value.trim()) {
        if (signedIn()) { await saveCredential(FIRE, crawl.value); setFirecrawlKey(""); crawlVault = { saved: true }; }
        else setFirecrawlKey(crawl.value);
      } else if (signedIn() && crawlSaved()) setFirecrawlKey("");
      saveSettings(value);
      const chat = mounted ? store.get(mounted.uid) : null;
      if (!chat) { const next = store.create(value); ui.closeDialog(); ui.go("/pip/" + next.uid); return; }
      if (identity(value) !== identity(chat.config) && chat.turns.length) {
        const next = store.create(value);
        if (recovery) store.update(next.uid, c => { c.draft = recovery.text; c.context = structuredClone(recovery.context); });
        ui.closeDialog(); ui.go("/pip/" + next.uid); ui.say("New model, new chat. The previous conversation is kept.");
      } else { store.update(chat.uid, c => { c.config = value; }); ui.closeDialog(); render(); }
    } catch (failure) { error.textContent = failure.message; }
  }, { class: "set-save" });

  const form = ui.h("div", { class: "pip-config" },
    status,
    group("connection",
      field("Provider", provider),
      field("Model", model),
      endpointField),
    group("access", keyField),
    group("search", ui.h("details", { class: "set-details" },
      ui.h("summary", {},
        ui.h("span", { class: "set-summary" }, ui.h("span", { class: "caret", "aria-hidden": "true", text: "▸" }), ui.h("span", { text: "web search key" })),
        crawlState),
      ui.h("div", { class: "set-details-body" },
        ui.h("div", { class: "set-head" }, ui.h("span", { class: "set-name", text: "Firecrawl" }), crawlForget),
        crawl,
        ui.h("span", { class: "set-hint", text: "Optional. Raises the free search limit; without it Pip uses the shared low-volume key." })))),
    group("reply",
      ui.h("div", { class: "set-field" }, ui.h("span", { class: "set-name", text: "Reply limit · tokens" }), ui.h("div", { class: "limit-choices" }, ...limits)),
      ui.h("div", { class: "set-toggle" },
        ui.h("div", {}, ui.h("span", { class: "set-name", text: "Reasoning summary" }), ui.h("span", { class: "set-hint", text: "Include the model's reasoning summary with each reply." })),
        thinking)),
    error, note,
    ui.h("div", { class: "set-actions" }, button("cancel", () => ui.closeDialog(), { class: "set-cancel" }), save));
  await ui.dialog("pip · API settings", form, []);
}

addEventListener("pagehide", () => { try { runner.stop(); } catch {} leave(); });
addEventListener('pocket-objects-synced', () => { if (mounted && !runner.active && !document.activeElement?.matches('textarea, input')) render(); });
addEventListener("storage", event => { if (event.key?.startsWith("pocket:pip-chat:") && mounted && !document.activeElement?.matches("textarea, input")) render(); });
