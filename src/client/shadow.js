// Shadow Protocol: a top-down stealth game in which Jev commands the guards.
// This module owns the screens, input, the game loop, the HUD and the
// connection to Jev. Rules live in shadow-engine.js, art in shadow-render.js.
import { storage, activeAccount } from './workspace-storage.js';
import { resolve as resolveProviderKey } from './pip-credentials.js';
import { TILE, ZONE_BY_ID, CAMERAS } from './shadow-level.js';
import { ShadowSim, DIFFICULTY } from './shadow-engine.js';
import { readDossier, recordMission, dossierInsights, jevState, emptyDossier } from './shadow-commander.js';
import { JEV_ENDPOINT, JEV_MODEL, shadowQuestions, readCompleteAnswers, LEVELS, INTENT_NAMES } from '../shared/shadow-jev.js';
import { DOOR_CONTROLS, FLOODLIGHTS } from '../shared/shadow-field.js';
import { VIEW_W, VIEW_H, SCALE, STATE_COLORS, STATE_NAMES, camera, drawWorld, drawSchematic, staticLayer, fitView, actorBox } from './shadow-render.js';
import { K, V } from './shadow-view.js';

const DOSSIER_KEY = 'shadow-dossier';
const BEST_KEY = 'shadow-best';
const SETTINGS_KEY = 'shadow-settings';
const LAST_KEY = 'shadow-last';
const STEP = 1 / 60;
const OPENROUTER = { provider: 'compatible', baseUrl: 'https://openrouter.ai/api/v1', model: JEV_MODEL };

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) if (child != null && child !== false) node.append(child);
  return node;
}
function read(key, fallback = null) {
  try { const value = storage.getItem(key); return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}
function write(key, value) {
  try { storage.setItem(key, JSON.stringify(value)); } catch { /* a full store should not stop the mission */ }
}
const clock = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const percent = value => Math.round((Number(value) || 0) * 100) + '%';
const zoneName = id => ZONE_BY_ID[id]?.name || id || 'unknown';

/* ── sound: a few synthesized cues, nothing sampled ───────────────────────── */

function createSound(enabled) {
  let context = null;
  const state = { enabled };
  const ensure = () => {
    if (!state.enabled) return null;
    try { context = context || new (globalThis.AudioContext || globalThis.webkitAudioContext)(); } catch { return null; }
    if (context.state === 'suspended') context.resume().catch(() => {});
    return context;
  };
  const tone = (freq, at, length, type = 'square', gain = .05, slide = 0) => {
    const ctx = ensure(); if (!ctx) return;
    const osc = ctx.createOscillator(), amp = ctx.createGain(), start = ctx.currentTime + at;
    osc.type = type; osc.frequency.setValueAtTime(freq, start);
    if (slide) osc.frequency.linearRampToValueAtTime(freq + slide, start + length);
    amp.gain.setValueAtTime(gain, start); amp.gain.exponentialRampToValueAtTime(.0001, start + length);
    osc.connect(amp).connect(ctx.destination); osc.start(start); osc.stop(start + length + .02);
  };
  return {
    state,
    unlock: ensure,
    spot() { tone(880, 0, .09, 'square', .05); tone(1320, .08, .16, 'square', .05); },
    alarm() { tone(440, 0, .32, 'sawtooth', .025, -120); },
    clink() { tone(1900, 0, .05, 'triangle', .04); tone(2400, .05, .04, 'triangle', .025); },
    thud() { tone(120, 0, .18, 'sine', .09, -60); },
    knife() { tone(2600, 0, .05, 'triangle', .045, -1800); tone(420, .03, .1, 'sawtooth', .03, -180); },
    swing() { tone(1700, 0, .07, 'triangle', .025, -1300); },
    dash() { tone(260, 0, .12, 'sawtooth', .022, 380); tone(900, .02, .08, 'triangle', .02, -500); },
    slide() { tone(180, 0, .28, 'sawtooth', .018, -90); },
    land() { tone(90, 0, .12, 'sine', .07, -30); },
    slam() { tone(70, 0, .22, 'square', .07, -40); tone(160, 0, .1, 'sawtooth', .05, -100); },
    gun() { tone(120, 0, .2, 'sawtooth', .13, -80); tone(1500, 0, .035, 'square', .07, -1100); tone(2200, .01, .025, 'triangle', .04, -900); },
    kill() { tone(100, 0, .14, 'sine', .1, -50); tone(320, .02, .08, 'triangle', .05, -120); },
    pickup() { tone(660, 0, .07, 'triangle', .05); tone(990, .07, .1, 'triangle', .05); },
    success() { [523, 659, 784, 1046].forEach((f, i) => tone(f, i * .12, .2, 'triangle', .05)); },
    fail() { [392, 330, 262].forEach((f, i) => tone(f, i * .16, .26, 'sawtooth', .035)); },
  };
}

/* ── Jev: the only commander; a lost link freezes the field ───────────────── */

function createJev() {
  const state = { mode: 'checking', model: JEV_MODEL, failures: 0, error: '', pending: 0, asked: 0, answered: 0, latency: null, retryAt: 0, access: undefined };
  const forceRelay = import.meta.env.DEV && new URLSearchParams(location.search).has('jevmock');
  async function access() {
    if (state.access !== undefined) return state.access;
    if (forceRelay) return (state.access = { relay: true });
    try { state.access = (await resolveProviderKey(OPENROUTER)) || null; } catch { state.access = null; }
    if (!state.access) state.mode = 'off';
    return state.access;
  }
  async function ask(kind, situation) {
    if (state.mode === 'off') throw new Error('OpenRouter is not connected.');
    if (state.pending) throw new Error('busy');
    if (performance.now() < state.retryAt) throw new Error('busy');
    const route = await access();
    if (!route) { state.mode = 'off'; throw new Error('OpenRouter is not connected.'); }
    state.pending++; state.asked++;
    const started = performance.now();
    if (state.mode !== 'on') state.mode = 'asking';
    try {
      let payload;
      if (route.key) {
        const response = await fetch(JEV_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + route.key, 'HTTP-Referer': location.origin, 'X-Title': 'Pocket Shadow Protocol' },
          body: JSON.stringify({ model: JEV_MODEL, state: jevState(situation), questions: shadowQuestions(kind, situation) }),
          signal: AbortSignal.timeout(6500),
        });
        if (!response.ok) throw Object.assign(new Error('OpenRouter rejected Jev.'), { status: response.status });
        payload = await response.json();
      } else {
        // The full candidate plans stay in the browser; the relay only needs
        // the compact option ids it turns into questions.
        const wire = { ...situation };
        delete wire.plans;
        const response = await fetch('/api/shadow/jev', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, situation: wire }), signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw Object.assign(new Error('Jev relay failed.'), { status: response.status });
        payload = await response.json();
      }
      const answers = readCompleteAnswers(kind, payload?.answers, situation);
      if (!answers) throw new Error('Jev sent incomplete orders.');
      state.mode = 'on'; state.failures = 0; state.error = ''; state.answered++;
      state.model = payload.model || JEV_MODEL;
      state.latency = performance.now() - started;
      return answers;
    } catch (error) {
      state.failures++;
      const status = Number(error?.status);
      state.error = status === 401 || status === 403 ? 'key rejected' : status === 402 ? 'no credits' : status === 429 ? 'rate limited' : 'unreachable';
      if ([400, 401, 402, 403, 404].includes(status) || state.failures >= 5) state.mode = 'off';
      else { state.mode = 'degraded'; state.retryAt = performance.now() + (status === 429 ? 20000 : 6000); }
      throw error;
    } finally { state.pending--; }
  }
  function refresh() {
    // Returning from Pip settings must pick up a newly saved/replaced key.
    state.access = undefined; state.mode = 'checking'; state.error = '';
    state.failures = 0; state.retryAt = 0;
  }
  return { state, ask, refresh };
}

// The running mission outlives a re-render of the page (Pocket re-routes after
// sign-in loads, for example); mounting again picks it back up.
let activeMission = null;
let sharedJev = null;
let missionOwner = null;
let disposeMount = null;

/* ── mount ─────────────────────────────────────────────────────────────── */

export function mountShadow(body, api = {}) {
  disposeMount?.();
  const owner = activeAccount();
  if (missionOwner !== owner) {
    activeMission = null; sharedJev = null; missionOwner = owner;
  }
  const root = h('div', { class: 'shadow-game' });
  body.append(root);
  const confirmBox = api.confirm || (title => Promise.resolve(globalThis.confirm?.(title)));
  const settings = { difficulty: 'normal', sound: true, fullscreen: true, ...read(SETTINGS_KEY, {}) };
  if (!DIFFICULTY[settings.difficulty]) settings.difficulty = 'normal';
  const sound = createSound(settings.sound);
  const jev = sharedJev || (sharedJev = createJev());
  jev.refresh();
  let dossier = readDossier(read(DOSSIER_KEY, null));
  let live = null;
  let lastResult = null;

  const saveSettings = () => write(SETTINGS_KEY, settings);
  // A mission takes the whole window, and the whole screen when the browser allows it.
  const fullscreenExit = { intended: false };
  const canFullscreen = () => Boolean(document.fullscreenEnabled && root.requestFullscreen);
  function setFullscreen(on) {
    if (on) { if (!document.fullscreenElement && canFullscreen()) root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {}); }
    else if (document.fullscreenElement === root) {
      fullscreenExit.intended = true;
      document.exitFullscreen().catch(() => { fullscreenExit.intended = false; });
    }
  }
  function toggleFullscreen() {
    settings.fullscreen = document.fullscreenElement !== root;
    saveSettings();
    setFullscreen(settings.fullscreen);
  }

  function stop() {
    document.documentElement.classList.remove('shadow-immersive');
    document.documentElement.classList.remove('shadow-intel-open');
    setFullscreen(false);
    if (!live) return;
    cancelAnimationFrame(live.raf);
    live.controller.abort();
    live = null;
  }

  /* ── briefing ── */

  function briefing() {
    stop();
    const insights = dossierInsights(dossier);
    const heat = {};
    for (const [id, n] of Object.entries(dossier.vanish)) heat[id.split(':')[0]] = (heat[id.split(':')[0]] || 0) + n;
    for (const [id, n] of Object.entries(dossier.escapes)) heat[id] = (heat[id] || 0) + n;
    const schematic = h('canvas', { class: 'shadow-schematic-canvas', width: 640, height: 440, role: 'img', 'aria-label': 'Facility schematic. Red areas are where security expects you.' });
    const best = read(BEST_KEY, {});
    const choice = id => {
      const rules = DIFFICULTY[id];
      const copy = { normal: 'Guards radio slowly and trust old habits a little. Room to recover from mistakes.', hard: 'Faster radios, wider searches, guards check lockers. The commander leans on its dossier.', extreme: 'Coordinated pincers, quick reports, long searches and full use of the dossier. No extra senses.' }[id];
      return h('button', {
        type: 'button', class: 'shadow-difficulty-option' + (settings.difficulty === id ? ' on' : ''), role: 'radio', 'aria-checked': String(settings.difficulty === id),
        onclick: () => { settings.difficulty = id; saveSettings(); briefing(); },
      }, h('strong', { text: rules.name.toLowerCase() }), h('span', { text: copy }),
      best[id] ? h('em', { text: `best · ${best[id].rank} · ${best[id].points.toLocaleString()} pts` }) : null);
    };
    const node = h('div', { class: 'shadow-brief' },
      h('div', { class: 'shadow-brief-hero' },
        h('div', { class: 'shadow-brief-copy' },
          h('p', { class: 'shadow-kicker', text: 'tactical infiltration · versus jev' }),
          h('h2', { class: 'shadow-title', text: 'it studies you too' }),
          h('p', { class: 'shadow-lede', text: 'Slip into a guarded research facility, copy the data from the lab server and reach the helipad. Jev commands the security force: it reads every radio report, guesses where you went and remembers how you played last time. Go quiet with takedowns, or take the knife and pistol and make it loud.' }),
          h('div', { class: 'shadow-difficulty', role: 'radiogroup', 'aria-label': 'Difficulty' }, ['normal', 'hard', 'extreme'].map(choice)),
          h('button', { type: 'button', class: 'primary shadow-begin', onclick: begin }, 'begin infiltration'),
          h('p', { class: 'small muted shadow-commander-line', text: 'commander · checking for Jev…' })),
        h('figure', { class: 'shadow-schematic' }, schematic,
          h('figcaption', { text: Object.keys(heat).length ? 'facility schematic · red marks where security expects you' : 'facility schematic · three ways in' }))),
      h('div', { class: 'shadow-brief-grid' },
        h('section', { class: 'shadow-panel shadow-dossier' },
          h('h3', {}, h('span', { text: 'security dossier' }), h('span', { class: 'shadow-tag', text: `${dossier.attempts} attempt${dossier.attempts === 1 ? '' : 's'}` })),
          dossier.attempts ? h('p', { class: 'small muted', text: `${dossier.extractions} extracted · ${dossier.captures} captured` }) : null,
          insights.length ? h('ul', { class: 'shadow-insights' }, insights.map(line => h('li', { text: line })))
            : h('p', { class: 'small muted', text: 'Security has no file on you yet. Every attempt adds to it; older attempts fade.' }),
          dossier.attempts ? h('button', { type: 'button', class: 'shadow-link', onclick: wipe }, 'wipe the dossier') : null),
        h('section', { class: 'shadow-panel' },
          h('h3', { text: 'ways in' }),
          h('ul', { class: 'shadow-routes' },
            h('li', {}, h('strong', { text: 'west culvert' }), ' · crawl under the fence into the dark lot, then through the warehouse duct into the lab.'),
            h('li', {}, h('strong', { text: 'main gate' }), ' · past the checkpoint and its camera. The lab door needs the keycard from the barracks office.'),
            h('li', {}, h('strong', { text: 'east fence' }), ' · a cut section near the parking, through the barracks to the helipad yard and the lab’s north door.'))),
        h('section', { class: 'shadow-panel' },
          h('h3', { text: 'controls' }),
          controlsList())),
      help());
    root.replaceChildren(node);
    drawSchematic(schematic, heat);
    const line = node.querySelector('.shadow-commander-line');
    (async () => {
      let route = null;
      try { route = import.meta.env.DEV && new URLSearchParams(location.search).has('jevmock') ? { relay: true } : await resolveProviderKey(OPENROUTER); } catch { route = null; }
      if (!line.isConnected) return;
      if (route) line.textContent = import.meta.env.DEV && new URLSearchParams(location.search).has('jevmock')
        ? 'commander · development test relay · mock orders, no live Jev calls'
        : `commander · ${JEV_MODEL.split('/').pop()} on OpenRouter ${route.relay ? 'through your account' : 'with this tab’s key'} · every order comes from Jev`;
      else {
        line.replaceChildren('commander · Jev controls the field · ',
          h('button', { type: 'button', class: 'shadow-link', onclick: () => api.go?.('/setup/pip') }, 'connect OpenRouter to play'));
      }
    })();
    node.querySelector('.shadow-begin').focus({ preventScroll: true });
  }

  async function wipe() {
    let ok = false;
    try { ok = await confirmBox('Wipe what security knows about you?', 'wipe'); } catch { ok = false; }
    if (!ok) return;
    dossier = emptyDossier();
    write(DOSSIER_KEY, dossier);
    briefing();
  }

  function controlsList() {
    return h('ul', { class: 'shadow-controls' },
      h('li', { text: 'WASD / arrows move · Shift sprint · C crouch' }),
      h('li', { text: 'Space dash · dash at crates to vault them, through a door to slam it into whoever is behind' }),
      h('li', { text: 'Sprint, then C: slide low, and sweep a guard off their feet' }),
      h('li', { text: 'Mouse aims · left click knifes, further straight out of a dash · hold right click to draw the pistol, left click fires' }),
      h('li', { text: 'E: take down without killing, drag, hide, use · hold to download' }),
      h('li', { text: 'Q knock on a wall · F throw a pebble at the cursor' }),
      h('li', { text: 'No mouse: X knife · G pistol, which snaps to the guard ahead · Tab intel · P pause' }));
  }

  function help() {
    return h('details', { class: 'shadow-help' },
      h('summary', { text: 'how jev plays' }),
      h('ul', {},
        h('li', { text: 'Jev is the security commander, not a guard. At decision points (a sighting, lost contact, a strange noise, a body, a missed radio check) it chooses one coherent, map-checked plan, updates its theory of what you are trying to do, and gives the field orders that support it.' }),
        h('li', { text: 'It only knows what guards and cameras reported, and reports take time to travel by radio. Take a guard down before they finish calling it in and nobody hears.' }),
        h('li', { text: 'Between attempts security keeps a dossier: how you got in, where it lost you, where it found you. Recent attempts weigh more, so changing your habits works.' }),
        h('li', { text: 'Jev makes every tactical decision: patrols, searches, seals, floodlights and camera priority. Game code only moves the guards. If the link drops, the field freezes until Jev answers; guards keep their last orders. With an OpenRouter key saved in Pip, Jev 1.14 is billed to your OpenRouter account.' }),
        h('li', { text: 'Nonlethal takedowns keep the alarm quiet. The knife is silent and gives you a pistol round; the pistol is loud, one-shot and brings guards running. A dead guard cannot be revived, and a body found later changes how security patrols.' }),
        h('li', { text: 'Guards cannot see through walls. Low crates hide a crouched body. Tall grass hides you unless someone is right on top of you. Lockers and ducts hide you completely, unless a guard decides to check.' })));
  }

  /* ── the live mission ── */

  function begin() {
    sound.unlock();
    stop();
    if (settings.fullscreen && matchMedia('(pointer: fine)').matches) setFullscreen(true);
    jev.refresh();
    const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    const sim = new ShadowSim({
      difficulty: settings.difficulty, seed, mode: 'commander', dossier,
      remote: (kind, situation) => jev.ask(kind, situation),
    });
    activeMission = { sim, left: false };
    resume(sim, false);
  }

  function resume(sim, paused) {
    const view = liveView(sim);
    document.documentElement.classList.add('shadow-immersive');
    root.replaceChildren(view.node);
    startLoop(sim, view, paused);
  }

  function liveView(sim) {
    const canvas = h('canvas', { class: 'shadow-canvas', width: VIEW_W * SCALE, height: VIEW_H * SCALE, role: 'img', 'aria-label': 'Shadow Protocol play field' });
    const refs = {};
    refs.objective = h('strong', { class: 'shadow-objective', text: sim.player.data ? 'Extract at the helipad' : 'Reach the lab server' });
    refs.timer = h('span', { class: 'shadow-timer', text: '00:00' });
    refs.phase = h('div', { class: 'shadow-phase', 'aria-live': 'polite' });
    refs.plan = h('div', { class: 'shadow-plan', 'aria-live': 'polite' });
    refs.stance = h('span', { class: 'shadow-stance', text: 'stand' });
    refs.exposure = h('i', {}); refs.noise = h('i', {});
    refs.items = h('div', { class: 'shadow-items' });
    refs.prompt = h('div', { class: 'shadow-prompt' });
    refs.toast = h('div', { class: 'shadow-toast', role: 'status' });
    const backToGame = () => refs.stage.focus({ preventScroll: true });
    const tool = (text, onclick, extra = {}) => h('button', { type: 'button', class: 'shadow-tool', onclick, ...extra }, text);
    refs.pauseButton = tool('pause · p', () => togglePause(), { 'aria-pressed': 'false', 'data-tool': 'pause' });
    refs.intelButton = tool('intel · tab', () => { toggleIntel(); backToGame(); }, { 'aria-pressed': 'false', 'data-tool': 'intel' });
    refs.soundButton = tool(settings.sound ? 'sound on' : 'sound off', () => { toggleSound(); backToGame(); }, { 'aria-pressed': String(settings.sound), 'data-tool': 'sound' });
    refs.fullButton = tool('fullscreen', () => { toggleFullscreen(); backToGame(); }, { hidden: !canFullscreen(), 'data-tool': 'fullscreen' });
    refs.tools = h('div', { class: 'shadow-tools' }, refs.pauseButton, refs.intelButton, refs.soundButton, refs.fullButton);
    refs.jevStatus = h('span', { class: 'shadow-jev-status', text: 'connecting…' });
    refs.radio = h('ol', { class: 'shadow-comms-lines', 'aria-live': 'polite' });
    refs.comms = h('section', { class: 'shadow-comms', 'aria-label': 'Security radio' },
      h('div', { class: 'shadow-comms-head' }, h('b', { text: 'jev' }), h('span', { text: 'security commander' }), refs.jevStatus),
      refs.plan,
      refs.radio);
    refs.intel = h('section', { class: 'shadow-intel', hidden: true });
    refs.abortConfirm = h('div', { class: 'shadow-abort-confirm', hidden: true },
      h('p', { text: 'Abort the mission? Security keeps what it saw.' }),
      h('div', { class: 'shadow-pause-actions' },
        h('button', { type: 'button', class: 'shadow-menu-button danger', onclick: () => confirmAbort() }, 'abort'),
        h('button', { type: 'button', class: 'shadow-menu-button', onclick: () => cancelAbort() }, 'keep playing')));
    refs.pause = h('div', { class: 'shadow-pause', hidden: true }, h('strong', { text: 'paused' }),
      h('div', { class: 'shadow-pause-actions' },
        h('button', { type: 'button', class: 'shadow-menu-button primary', onclick: () => togglePause() }, 'resume'),
        h('button', { type: 'button', class: 'shadow-menu-button', onclick: () => abort() }, 'abort mission')),
      refs.abortConfirm,
      controlsList(),
      h('span', { class: 'shadow-pause-hint', text: 'P or Esc to resume' }));
    refs.field = h('div', { class: 'shadow-field-status', 'aria-live': 'polite' });
    refs.commandTitle = h('strong', { class: 'shadow-command-title' });
    refs.commandText = h('p', { class: 'shadow-command-text' });
    refs.commandRetry = h('button', {
      type: 'button', class: 'shadow-menu-button primary',
      onclick: () => sim.retryCommand(),
    }, 'retry orders');
    refs.commandSettings = h('button', {
      type: 'button', class: 'shadow-menu-button',
      onclick: () => api.go?.('/setup/pip'),
    }, 'open pip settings');
    refs.command = h('div', { class: 'shadow-command', hidden: true, role: 'alert' },
      h('span', { class: 'shadow-kicker', text: 'jev · security commander' }),
      refs.commandTitle, refs.commandText,
      h('div', { class: 'shadow-pause-actions' }, refs.commandRetry, refs.commandSettings));
    refs.stage = h('div', { class: 'shadow-stage', tabindex: '0', 'aria-label': 'Play field. WASD to move, mouse to aim.' }, canvas,
      h('div', { class: 'shadow-vignette' }),
      h('div', { class: 'shadow-hud' },
        h('div', { class: 'shadow-hud-objective' }, h('span', { class: 'shadow-label', text: 'objective' }), refs.objective, refs.timer),
        refs.phase, refs.field, refs.comms,
        h('div', { class: 'shadow-hud-status' }, refs.stance,
          h('span', { class: 'shadow-meter', title: 'How visible you are' }, h('span', { class: 'shadow-label', text: 'exposure' }), h('b', {}, refs.exposure)),
          h('span', { class: 'shadow-meter noise', title: 'How far your last sound carried' }, h('span', { class: 'shadow-label', text: 'noise' }), h('b', {}, refs.noise))),
        refs.items, refs.prompt, refs.toast),
      refs.intel, refs.pause, refs.command, refs.tools);
    const touch = touchControls(refs);
    const node = h('div', { class: 'shadow-live' }, refs.stage, touch);
    return { node, canvas, refs, touch };
  }

  function touchControls() {
    const stick = h('div', { class: 'shadow-stick', 'aria-label': 'Movement stick' }, h('span', { class: 'shadow-stick-knob' }));
    const button = (label, action, extra = '') => h('button', { type: 'button', class: 'shadow-touch-key ' + extra, 'data-action': action }, label);
    return h('div', { class: 'shadow-touch', role: 'group', 'aria-label': 'Touch controls' }, stick,
      h('div', { class: 'shadow-touch-keys' },
        button('act', 'act', 'primary-key'), button('dash', 'dash', 'primary-key'), button('crouch', 'crouch'), button('run', 'run'),
        button('knife', 'knife', 'danger-key'), button('pistol', 'shoot', 'danger-key'), button('knock', 'knock'), button('throw', 'throw'),
        button('intel', 'intel', 'wide-key')));
  }

  function startLoop(sim, view, startPaused = false) {
    const { canvas, refs } = view;
    const ctx = canvas.getContext('2d');
    const controller = new AbortController(), signal = controller.signal;
    const camView = { x: 0, y: 0, snap: true };
    const keys = { up: false, down: false, left: false, right: false, run: false };
    // With both keys of an axis held, the one pressed last wins: a quick reversal never stalls at zero.
    const latest = { x: 0, y: 0 };
    const edges = { crouch: false, interact: false, knife: false, shoot: false, knock: false, throw: false, dash: false };
    const touch = { x: 0, y: 0, run: false, act: false };
    const state = { intel: false, selected: null, paused: startPaused, pointer: null, aimHold: false, held: false, toastUntil: 0, lastPaint: 0, alarmAt: 0, ended: false, shake: 0, hitstop: 0, planUntil: 0, kick: { x: 0, y: 0 }, reduceMotion: matchMedia('(prefers-reduced-motion: reduce)').matches };
    if (matchMedia('(prefers-reduced-motion: reduce)').addEventListener) {
      const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
      const onMotion = event => { state.reduceMotion = event.matches; };
      motionQuery.addEventListener('change', onMotion, { signal });
    }
    live = { sim, controller, raf: 0, state, soundButton: refs.soundButton, refs };
    // The view keeps the same amount of floor in sight whatever the window shape; the canvas
    // matches the screen's pixels so nothing is stretched. Resizes settle before a refit.
    let fitTimer = 0;
    const fit = () => {
      const box = refs.stage.getBoundingClientRect();
      if (box.width < 40 || box.height < 40) return;
      const v = fitView(box.width, box.height, globalThis.devicePixelRatio || 1);
      canvas.style.width = v.cssW + 'px'; canvas.style.height = v.cssH + 'px';
      if (canvas.width !== v.pixelW || canvas.height !== v.pixelH) { canvas.width = v.pixelW; canvas.height = v.pixelH; }
      Object.assign(camView, { w: v.w, h: v.h, scale: v.scale, ui: v.ui });
    };
    fit();
    const resizer = new ResizeObserver(() => { clearTimeout(fitTimer); fitTimer = setTimeout(fit, 90); });
    resizer.observe(refs.stage);
    signal.addEventListener('abort', () => { resizer.disconnect(); clearTimeout(fitTimer); });
    let fullscreenActive = document.fullscreenElement === root;
    let fullscreenSince = performance.now();
    refs.fullButton.textContent = fullscreenActive ? 'exit fullscreen' : 'fullscreen';
    document.addEventListener('fullscreenchange', () => {
      const active = document.fullscreenElement === root;
      if (active && !fullscreenActive) fullscreenSince = performance.now();
      // Esc leaves fullscreen before the game sees the key, so a deliberate exit pauses.
      // A rejected or immediately revoked request must never pause the mission.
      if (!active && fullscreenActive && !fullscreenExit.intended && performance.now() - fullscreenSince > 600 && !state.paused && sim.status === 'playing') togglePauseLocal();
      fullscreenActive = active;
      fullscreenExit.intended = false;
      refs.fullButton.textContent = active ? 'exit fullscreen' : 'fullscreen';
    }, { signal });
    let acc = 0, last = performance.now();
    // Draw between the last two fixed steps, so motion stays smooth at any refresh rate.
    const bodies = () => [sim.player, ...sim.guards];
    let previous = new Map();
    const snapshot = () => { previous = new Map(bodies().map(body => [body, { x: body.x, y: body.y, facing: body.facing }])); };
    snapshot();
    const drawn = { facing: sim.player.facing };
    const shortest = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

    const keyFor = event => {
      const k = event.key;
      if (k === 'ArrowUp' || k === 'w' || k === 'W') return 'up';
      if (k === 'ArrowDown' || k === 's' || k === 'S') return 'down';
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') return 'left';
      if (k === 'ArrowRight' || k === 'd' || k === 'D') return 'right';
      if (k === 'Shift') return 'run';
      return null;
    };
    document.addEventListener('keydown', event => {
      if (!canvas.isConnected || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, dialog')) return;
      // Pocket's 1-9 app shortcuts would end the mission mid-play; they work again while paused.
      if (/^[0-9]$/.test(event.key) && !state.paused && sim.status === 'playing') { event.preventDefault(); event.stopPropagation(); return; }
      // Space and Enter still press a focused button; every other game key goes to the game.
      const onControl = event.target instanceof HTMLElement && event.target.closest('button, a, summary');
      if (onControl && [' ', 'Spacebar', 'Enter', 'Tab'].includes(event.key)) return;
      if (onControl && !['Escape', 'p', 'P'].includes(event.key)) refs.stage.focus({ preventScroll: true });
      const key = keyFor(event);
      if (key) {
        keys[key] = true;
        if (key === 'left' || key === 'right') latest.x = key === 'left' ? -1 : 1;
        if (key === 'up' || key === 'down') latest.y = key === 'up' ? -1 : 1;
        event.preventDefault(); return;
      }
      const k = event.key;
      if (k === 'c' || k === 'C') { if (!event.repeat) edges.crouch = true; event.preventDefault(); }
      else if (k === ' ' || k === 'Spacebar') { if (!event.repeat) edges.dash = true; event.preventDefault(); }
      else if (k === 'e' || k === 'E') { if (!event.repeat) edges.interact = true; state.held = true; event.preventDefault(); }
      else if (k === 'x' || k === 'X') { if (!event.repeat) edges.knife = true; event.preventDefault(); }
      else if (k === 'g' || k === 'G') { if (!event.repeat) edges.shoot = true; event.preventDefault(); }
      else if (k === 'q' || k === 'Q') { if (!event.repeat) edges.knock = true; event.preventDefault(); }
      else if (k === 'f' || k === 'F') { if (!event.repeat) edges.throw = true; event.preventDefault(); }
      else if (k === 'Tab' && !event.shiftKey && event.target === refs.stage) { toggleIntel(); event.preventDefault(); }
      else if (k === 'p' || k === 'P' || k === 'Escape') { togglePause(); event.preventDefault(); }
    }, { signal });
    document.addEventListener('keyup', event => {
      const key = keyFor(event);
      if (key) keys[key] = false;
      const k = event.key;
      if (k === 'e' || k === 'E') state.held = false;
    }, { signal });
    const clearInput = () => {
      Object.keys(keys).forEach(key => { keys[key] = false; });
      Object.keys(edges).forEach(key => { edges[key] = false; });
      state.held = false; state.aimHold = false; touch.x = touch.y = 0; touch.act = false; touch.run = false;
      view.touch.querySelectorAll('.held, .on').forEach(button => button.classList.remove('held', 'on'));
      const knob = view.touch.querySelector('.shadow-stick-knob');
      if (knob) knob.style.transform = '';
    };
    const pauseAway = () => { clearInput(); if (!state.paused && sim.status === 'playing') togglePauseLocal(); };
    document.addEventListener('visibilitychange', () => { if (document.hidden) pauseAway(); }, { signal });
    // The play field is tilted: a screen point maps to the floor under it, and a cursor over
    // someone's body aims at them, not at the floor behind their head.
    const toWorld = event => {
      const rect = canvas.getBoundingClientRect();
      const px = camView.x + (event.clientX - rect.left) / rect.width * (camView.w || VIEW_W);
      const py = camView.y * K + (event.clientY - rect.top) / rect.height * (camView.h || VIEW_H);
      let best = null, bestD = Infinity;
      for (const g of sim.guards) {
        if (g.down || g.hidden) continue;
        // A body's own width, not the sprite's whole cell, so aiming beside someone still aims beside them.
        const feet = g.y * K, box = actorBox(g);
        if (Math.abs(px - g.x) > 6 || py > feet + 1 || py < feet - box.h) continue;
        const d = Math.abs(px - g.x) + (feet - py) * .1;
        if (d < bestD) { bestD = d; best = g; }
      }
      return best ? { x: best.x, y: best.y } : { x: px, y: py / K };
    };
    // The cursor aims while it is over the play field. Its screen point is kept and re-projected
    // every frame, so a still cursor keeps aiming at the same spot on screen as the camera moves.
    const pointAt = event => { state.pointer = { clientX: event.clientX, clientY: event.clientY }; };
    canvas.addEventListener('pointermove', event => { if (event.pointerType === 'mouse') pointAt(event); }, { signal });
    canvas.addEventListener('pointerleave', () => { state.pointer = null; }, { signal });
    canvas.addEventListener('contextmenu', event => event.preventDefault(), { signal });
    let pointerType = 'mouse';
    canvas.addEventListener('pointerdown', event => {
      pointerType = event.pointerType;
      refs.stage.focus({ preventScroll: true });
      if (event.pointerType === 'mouse') pointAt(event);
    }, { signal });
    // Mouse buttons use mouse events: a second button pressed while one is held
    // (left click while aiming) fires no new pointerdown. Taps from touch are ignored.
    canvas.addEventListener('mousedown', event => {
      if (pointerType !== 'mouse') return;
      pointAt(event);
      if (event.button === 2) { state.aimHold = true; return; }
      // The thumb button dashes; neither side button may navigate away mid-mission.
      if (event.button === 3 || event.button === 4) { event.preventDefault(); if (event.button === 3) edges.dash = true; return; }
      if (event.button !== 0) return;
      if (state.intel) {
        // With intel open, clicking a guard inspects him; clicking elsewhere still strikes.
        const point = toWorld(event);
        let best = null, bestD = 16;
        for (const g of sim.guards) { const d = Math.hypot(g.x - point.x, g.y - point.y); if (d < bestD) { best = g; bestD = d; } }
        if (best && best !== sim.takedownTarget()) { state.selected = best.id; paintSide(true); return; }
      }
      if (state.aimHold) edges.shoot = true; else edges.knife = true;
    }, { signal });
    addEventListener('mouseup', event => {
      if (event.button === 2) state.aimHold = false;
      if ((event.button === 3 || event.button === 4) && event.target === canvas) event.preventDefault();
    }, { signal });

    // Touch: a stick on the left, keys on the right.
    const stick = view.touch.querySelector('.shadow-stick'), knob = stick.querySelector('.shadow-stick-knob');
    let stickId = null;
    const moveStick = event => {
      const rect = stick.getBoundingClientRect(), cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      let dx = (event.clientX - cx) / (rect.width / 2), dy = (event.clientY - cy) / (rect.height / 2);
      const length = Math.hypot(dx, dy);
      if (length > 1) { dx /= length; dy /= length; }
      touch.x = Math.abs(dx) < .12 ? 0 : dx; touch.y = Math.abs(dy) < .12 ? 0 : dy;
      knob.style.transform = `translate(${dx * 30}px, ${dy * 30}px)`;
    };
    stick.addEventListener('pointerdown', event => { stickId = event.pointerId; stick.setPointerCapture(event.pointerId); moveStick(event); event.preventDefault(); }, { signal });
    stick.addEventListener('pointermove', event => { if (event.pointerId === stickId) moveStick(event); }, { signal });
    const release = event => { if (event.pointerId !== stickId) return; stickId = null; touch.x = 0; touch.y = 0; knob.style.transform = ''; };
    stick.addEventListener('pointerup', release, { signal });
    stick.addEventListener('pointercancel', release, { signal });
    stick.addEventListener('lostpointercapture', release, { signal });
    for (const button of view.touch.querySelectorAll('[data-action]')) {
      const action = button.dataset.action;
      button.addEventListener('pointerdown', event => {
        event.preventDefault(); button.classList.add('held');
        if (action === 'act') { edges.interact = true; touch.act = true; }
        else if (action === 'crouch') edges.crouch = true;
        else if (action === 'dash') edges.dash = true;
        else if (action === 'knife') edges.knife = true;
        else if (action === 'shoot') edges.shoot = true;
        else if (action === 'run') { touch.run = !touch.run; button.classList.toggle('on', touch.run); }
        else if (action === 'knock') edges.knock = true;
        else if (action === 'throw') edges.throw = true;
        else if (action === 'intel') toggleIntel();
      }, { signal });
      const up = () => { button.classList.remove('held'); if (action === 'act') touch.act = false; };
      button.addEventListener('pointerup', up, { signal });
      button.addEventListener('pointercancel', up, { signal });
      button.addEventListener('pointerleave', up, { signal });
    }

    function toggleIntelLocal() {
      state.intel = !state.intel;
      refs.intel.hidden = !state.intel;
      document.documentElement.classList.toggle('shadow-intel-open', state.intel);
      refs.intelButton.setAttribute('aria-pressed', String(state.intel));
      refs.intelButton.classList.toggle('on', state.intel);
      paintSide(true);
    }
    function togglePauseLocal() {
      if (sim.status !== 'playing') return;
      state.paused = !state.paused;
      refs.pause.hidden = !state.paused;
      refs.abortConfirm.hidden = true;
      refs.pauseButton.textContent = state.paused ? 'resume · p' : 'pause · p';
      refs.pauseButton.setAttribute('aria-pressed', String(state.paused));
      clearInput(); acc = 0;
      if (!state.paused) { snapshot(); last = performance.now(); refs.stage.focus({ preventScroll: true }); }
    }
    live.toggleIntel = toggleIntelLocal;
    live.togglePause = togglePauseLocal;

    function input() {
      const axis = (minus, plus, newer) => minus && plus ? newer : (plus ? 1 : 0) - (minus ? 1 : 0);
      const move = { x: axis(keys.left, keys.right, latest.x) + touch.x, y: axis(keys.up, keys.down, latest.y) + touch.y };
      const value = {
        move, run: keys.run || touch.run, crouch: edges.crouch, interact: edges.interact, interactHeld: state.held || touch.act,
        knife: edges.knife, shoot: edges.shoot, knock: edges.knock, throw: edges.throw, dash: edges.dash,
        aim: state.pointer ? toWorld(state.pointer) : null, aimHold: state.aimHold, faceAim: Boolean(state.pointer),
      };
      edges.crouch = edges.interact = edges.knife = edges.shoot = edges.knock = edges.throw = edges.dash = false;
      return value;
    }

    function toast(text, tone = '') {
      refs.toast.textContent = text;
      refs.toast.className = 'shadow-toast on ' + tone;
      state.toastUntil = performance.now() + 1700;
    }

    function handleEvents() {
      for (const event of sim.events.splice(0)) {
        if (event.type === 'toast') { toast(event.text); sound.pickup(); }
        else if (event.type === 'hint') toast(event.text, 'muted');
        else if (event.type === 'spotted') {
          sound.spot();
          refs.stage.classList.remove('spotflash'); void refs.stage.offsetWidth; refs.stage.classList.add('spotflash');
          state.shake = Math.min(1, state.shake + .18);
          toast(`${event.name || 'a guard'} sees you${event.zone ? ' · ' + zoneName(event.zone) : ''}`, 'alert');
        }
        else if (event.type === 'alarm') { sound.alarm(); refs.stage.classList.remove('flash'); void refs.stage.offsetWidth; refs.stage.classList.add('flash'); }
        else if (event.type === 'shot') { sound.gun(); state.shake = Math.min(1, state.shake + .7); }
        else if (event.type === 'knife') sound.knife();
        else if (event.type === 'swing') sound.swing();
        else if (event.type === 'kill') {
          sound.kill();
          state.shake = Math.min(1, state.shake + .55);
          // A short freeze on the hit sells it: the frame holds, then the world moves again.
          state.hitstop = Math.max(state.hitstop, event.how === 'gun' ? .035 : .055);
          refs.stage.classList.remove('killflash'); void refs.stage.offsetWidth; refs.stage.classList.add('killflash');
          toast(`${event.how === 'gun' ? 'shot' : 'knife'} kill · ×${event.chain} · +${event.points}`, 'kill');
        }
        else if (event.type === 'takedown') { sound.thud(); state.hitstop = Math.max(state.hitstop, .05); }
        else if (event.type === 'dash' || event.type === 'vault') {
          sound.dash();
          state.kick.x += Math.cos(event.angle) * 7; state.kick.y += Math.sin(event.angle) * 7;
        }
        else if (event.type === 'slide') sound.slide();
        else if (event.type === 'land') sound.land();
        else if (event.type === 'slam') {
          if (event.shut) sound.slam();
          state.shake = Math.min(1, state.shake + (event.flattened ? .7 : .4));
          if (event.flattened) {
            state.hitstop = Math.max(state.hitstop, .07);
            toast(`${event.shut ? 'door slam' : 'doorway charge'}${event.flattened > 1 ? ` · ${event.flattened} down` : ''}`, 'kill');
          }
        }
        else if (event.type === 'tackle') { state.shake = Math.min(1, state.shake + .45); toast('swept', 'kill'); }
        else if (event.type === 'objective') refs.objective.textContent = event.text;
        else if (event.type === 'misread' && state.intel) toast(`prediction failed: ${zoneName(event.zone)}, not ${zoneName(event.predicted)}`, 'intel');
        else if (event.type === 'finish') { state.ended = true; }
      }
      for (const ring of sim.rings) if (ring.age === 0 && ring.kind === 'pebble') sound.clink();
    }

    const frame = now => {
      if (!canvas.isConnected) { stop(); return; }
      const dt = Math.min(.1, Math.max(0, (now - last) / 1000));
      last = now;
      if (!state.paused && !document.hidden && sim.status === 'playing') {
        if (state.hitstop > 0) { state.hitstop = Math.max(0, state.hitstop - dt); acc = 0; }
        else {
          acc += dt;
          let steps = 0;
          while (acc >= STEP && steps < 6) { snapshot(); sim.step(STEP, input()); acc -= STEP; steps++; }
          if (steps === 6) acc = 0;
        }
      }
      handleEvents();
      const alpha = state.paused ? 1 : Math.min(1, acc / STEP);
      const turn = 22 * dt, toward = shortest(sim.player.facing - drawn.facing);
      drawn.facing = Math.abs(toward) <= turn ? sim.player.facing : drawn.facing + Math.sign(toward) * turn;
      const aimPoint = state.pointer ? toWorld(state.pointer) : null;
      const reachable = sim.status === 'playing' && !sim.player.action && !sim.player.locker && !sim.player.carrying
        ? (aimPoint ? sim.knifeTargetAt(aimPoint) : sim.takedownTarget()) : null;
      const actual = bodies().map(body => ({ body, x: body.x, y: body.y, facing: body.facing }));
      for (const { body, x, y, facing } of actual) {
        const before = previous.get(body);
        if (!before || Math.hypot(x - before.x, y - before.y) > 24) continue;
        body.x = before.x + (x - before.x) * alpha;
        body.y = before.y + (y - before.y) * alpha;
        if (body !== sim.player) body.facing = before.facing + shortest(facing - before.facing) * alpha;
      }
      sim.player.facing = drawn.facing;
      try {
        // The view leans toward the cursor, further with the pistol drawn, so you see where you are going.
        // The lean comes from the cursor's place on screen, not in the world, so it cannot feed on itself.
        if (state.pointer) {
          const rect = canvas.getBoundingClientRect(), w = camView.w || VIEW_W, h = camView.h || VIEW_H;
          const ox = ((state.pointer.clientX - rect.left) / rect.width - .5) * w, oy = ((state.pointer.clientY - rect.top) / rect.height - .5) * h;
          const gain = state.aimHold ? .55 : .26;
          camView.lean = { x: Math.max(-w * .3, Math.min(w * .3, ox * gain)), y: Math.max(-h * .3, Math.min(h * .3, oy * gain)) };
        } else camView.lean = null;
        camera(sim, camView, dt);
        // A dash nudges the view along it for a moment.
        const settle = Math.exp(-dt * 9);
        state.kick.x *= settle; state.kick.y *= settle;
        if (state.reduceMotion) state.kick.x = state.kick.y = 0;
        state.shake = state.reduceMotion ? 0 : Math.max(0, state.shake - dt * 2.6);
        const jitter = state.shake > .01 ? { x: (Math.random() * 2 - 1) * state.shake * 5, y: (Math.random() * 2 - 1) * state.shake * 4 } : { x: 0, y: 0 };
        const shake = jitter.x || jitter.y || Math.abs(state.kick.x) > .05 || Math.abs(state.kick.y) > .05 ? { x: jitter.x + state.kick.x, y: jitter.y + state.kick.y } : null;
        const jammed = !sim.rules.scannerInAlert && (sim.net.phase === 'alert' || sim.net.phase === 'search');
        drawWorld(ctx, sim, camView, { intel: state.intel, selected: state.selected, aim: aimPoint, aiming: Boolean(aimPoint), aimHold: state.aimHold, target: reachable?.id || null, jammed, shake, compact: innerWidth <= 840, reduceMotion: state.reduceMotion });
      } finally {
        for (const { body, x, y, facing } of actual) { body.x = x; body.y = y; body.facing = facing; }
      }
      paintHud();
      paintField();
      paintCommand();
      if (now - state.lastPaint > 250) { state.lastPaint = now; paintSide(); }
      if (!state.paused && !document.hidden && sim.net.phase === 'alert' && now - state.alarmAt > 1400) { state.alarmAt = now; sound.alarm(); }
      if (performance.now() > state.toastUntil) refs.toast.classList.remove('on');
      if (state.ended) { finish(sim); return; }
      live.raf = requestAnimationFrame(frame);
    };

    function paintHud() {
      const p = sim.player, net = sim.net;
      refs.timer.textContent = clock(sim.t);
      const phase = net.phase;
      const label = phase === 'alert' ? 'alert' : phase === 'search' ? `evasion ${clock(Math.max(0, net.searchUntil - sim.t))}` : phase === 'lockdown' ? 'lockdown' : phase === 'caution' || phase === 'returning' ? 'caution' : '';
      if (refs.phase.dataset.text !== label) { refs.phase.dataset.text = label; refs.phase.textContent = label; refs.phase.className = 'shadow-phase ' + phase; }
      refs.stage.dataset.phase = phase;
      const plan = net.plan;
      const planKey = plan ? plan.strategy + '|' + plan.summary : 'none';
      if (refs.plan.dataset.key !== planKey) {
        refs.plan.dataset.key = planKey;
        refs.plan.textContent = plan ? `jev · ${plan.summary}` : 'jev · no standing orders';
        refs.plan.classList.remove('on'); void refs.plan.offsetWidth; refs.plan.classList.add('on');
        state.planUntil = performance.now() + 2400;
        if (plan) toast(`jev · ${plan.summary}`, 'plan');
      }
      if (state.planUntil && performance.now() > state.planUntil) {
        refs.plan.classList.remove('on'); state.planUntil = 0;
      }
      const stance = p.locker ? 'locker' : p.move ? p.move.kind : p.hidden === 'duct' ? 'in duct' : p.hidden === 'grass' ? 'in grass' : p.carrying ? 'drag' : p.crouch ? 'crouch' : p.running ? 'sprint' : 'stand';
      refs.stance.classList.toggle('hidden', Boolean(p.locker || p.hidden));
      if (refs.stance.textContent !== stance) refs.stance.textContent = stance;
      refs.exposure.style.transform = `scaleX(${p.locker ? 0 : p.visibility})`;
      refs.exposure.parentElement.classList.toggle('high', p.visibility > .6);
      p.noiseShown = Math.max((p.noiseShown || 0) * .96, p.moving ? Math.min(1, p.noise / 6) : 0);
      refs.noise.style.transform = `scaleX(${p.noiseShown})`;
      const prompt = sim.prompt();
      if (refs.prompt.textContent !== prompt) { refs.prompt.textContent = prompt; refs.prompt.classList.toggle('on', Boolean(prompt)); }
      const chain = sim.t - sim.metrics.lastKillAt <= 6 ? sim.metrics.killChain : 0;
      const items = `${p.pebbles}|${p.ammo}|${sim.metrics.kills}|${chain}|${p.keycard}|${p.data}|${sim.net.camerasOff}`;
      if (refs.items.dataset.state !== items) {
        refs.items.dataset.state = items;
        refs.items.replaceChildren(...[
          h('span', { class: 'shadow-item', title: 'Pebbles (F)' }, h('b', { text: '●' }), `×${p.pebbles}`),
          h('span', { class: 'shadow-item' + (p.ammo ? '' : ' empty'), title: 'Pistol rounds (G)' }, h('b', { text: '▮' }), `×${p.ammo}`),
          sim.metrics.kills ? h('span', { class: 'shadow-item kill', title: 'Guards killed' }, h('b', { text: '✕' }), `×${sim.metrics.kills}`) : null,
          chain > 1 ? h('span', { class: 'shadow-item chain', title: 'Kill chain' }, h('b', { text: '»' }), `×${chain}`) : null,
          p.keycard ? h('span', { class: 'shadow-item on', title: 'Lab keycard' }, h('b', { text: '▭' }), 'keycard') : null,
          p.data ? h('span', { class: 'shadow-item data', title: 'Lab data' }, h('b', { text: '◆' }), 'data') : null,
          sim.net.camerasOff ? h('span', { class: 'shadow-item', title: 'Cameras offline' }, h('b', { text: '◌' }), 'cams off') : null,
        ].filter(Boolean));
      }
    }

    function paintField() {
      const f = sim.field, chips = [];
      if (f?.seal && f.seal.until > sim.t) chips.push([f.seal.active ? 'sealed' : 'sealing', f.seal.name, Math.ceil(f.seal.until - sim.t) + 's']);
      if (f?.light && f.light.until > sim.t) chips.push(['lights', f.light.name, Math.ceil(f.light.until - sim.t) + 's']);
      if (f?.camera && f.camera.until > sim.t) chips.push(['camera', f.camera.name, Math.ceil(f.camera.until - sim.t) + 's']);
      const key = chips.map(chip => chip.join(':')).join('|');
      if (refs.field.dataset.key === key) return;
      refs.field.dataset.key = key;
      refs.field.replaceChildren(...chips.map(([kind, name, left]) => h('span', { class: 'shadow-field-chip ' + kind },
        h('b', { text: kind }), `${name} · ${left}`)));
    }

    function paintCommand() {
      const blocked = sim.commandBlocked, error = sim.net.commandError;
      refs.command.hidden = !blocked || state.paused;
      if (!blocked) return;
      const title = error ? 'jev link lost' : 'waiting for jev';
      const text = error
        ? `${error} The field is frozen: guards keep their last orders, but nothing moves until Jev answers.`
        : 'Jev is reading the report and choosing the next orders. The field waits for the commander.';
      if (refs.commandTitle.textContent !== title) refs.commandTitle.textContent = title;
      if (refs.commandText.textContent !== text) refs.commandText.textContent = text;
      refs.command.classList.toggle('error', Boolean(error));
      refs.commandRetry.disabled = Boolean(sim.net.jevInFlight);
      refs.commandSettings.hidden = !(error || jev.state.mode === 'off');
    }

    function availability() {
      const js = jev.state, name = js.model.split('/').pop();
      return js.mode === 'on' ? `${name} live${js.latency ? ` · ${Math.round(js.latency)} ms` : ''}` : js.mode === 'asking' ? `asking ${name}…`
        : js.mode === 'degraded' ? `${name} ${js.error || 'unavailable'} · mission paused` : js.mode === 'off' ? (js.error ? `${name} off · ${js.error}` : 'not connected · mission paused') : `checking ${name}…`;
    }

    function paintSide(force = false) {
      const js = jev.state, blocked = sim.commandBlocked, error = sim.net.commandError;
      const thinking = !blocked && (js.mode === 'asking' || sim.net.decision?.status === 'asking jev');
      const status = blocked ? (error ? 'link lost · field frozen' : 'waiting for orders…')
        : thinking && js.mode !== 'off' ? 'thinking…' : js.mode === 'on' ? `live${js.latency ? ` · ${Math.round(js.latency)} ms` : ''}`
          : js.mode === 'degraded' ? 'unreachable · mission paused' : js.mode === 'off' ? 'not connected · mission paused' : 'connecting…';
      if (refs.jevStatus.textContent !== status) refs.jevStatus.textContent = status;
      refs.jevStatus.dataset.mode = error ? 'off' : thinking && js.mode !== 'off' ? 'thinking' : js.mode;
      // The last few calls stay up and fade, newest at the bottom like a radio log.
      const recent = sim.radio.filter(line => sim.t - line.t < 16).slice(0, 5).reverse();
      const key = recent.map(line => line.t + line.text).join('|');
      if (refs.radio.dataset.key !== key) {
        refs.radio.dataset.key = key;
        refs.radio.replaceChildren(...recent.map(line => h('li', { class: `${line.tone || ''}${line.from === 'Jev' ? ' jev' : ''}`, 'data-t': String(line.t) }, h('b', { text: line.from }), ' ', line.text)));
      }
      for (const item of refs.radio.children) item.style.opacity = String(Math.max(0, Math.min(1, (16 - (sim.t - Number(item.dataset.t))) / 4)));
      if (force || state.intel && !refs.intel.contains(document.activeElement)) paintIntel();
    }

    function paintIntel() {
      if (!state.intel) return;
      const net = sim.net, decision = net.decision, plan = net.plan;
      const answers = decision?.answers || {};
      const answerRows = Object.entries(answers).map(([question, answer]) => {
        let text = '', strength = 0, alternatives = '';
        if (answer.type === 'choice') {
          text = optionName(question, answer.choice, decision.situation);
          strength = answer.confidence;
          alternatives = Object.entries(answer.probabilities || {}).sort((a, b) => b[1] - a[1]).slice(1, 3).filter(([, v]) => v > .04).map(([id, v]) => `${optionName(question, id, decision.situation)} ${percent(v)}`).join(' · ');
        } else if (answer.type === 'score') {
          const list = question === 'commit' ? ['2 guards', '3 guards', 'most', 'all'] : question === 'threat' ? ['nothing', 'curious', 'likely', 'confirmed'] : ['relaxed', 'normal', 'heightened', 'maximum'];
          text = `${list[Math.round(answer.score)] || answer.score} (${Number(answer.score).toFixed(2)})`; strength = answer.confidence;
        } else if (answer.type === 'noul') { text = answer.noul >= .5 ? `yes · ${percent(answer.noul)}` : `no · ${percent(1 - answer.noul)}`; strength = Math.abs(answer.noul - .5) * 2; }
        return h('li', {}, h('span', { class: 'shadow-q', text: question.replace('_', ' ') }), h('strong', { text }),
          h('i', { class: 'shadow-bar' }, h('b', { style: `width:${percent(strength)}` })), alternatives ? h('em', { text: alternatives }) : null);
      });
      const ago = decision ? Math.round(sim.t - decision.t) : 0;
      const prediction = net.prediction?.zone ? `${zoneName(net.prediction.zone)}${net.prediction.cluster ? ' · ' + net.prediction.cluster.split(':')[1] + 's' : ''} · ${net.prediction.resolved || 'open'}` : 'none';
      const mind = sim.mind?.intent || {};
      const topBelief = Object.entries(mind).sort((a, b) => b[1] - a[1])[0];
      const beliefLine = topBelief
        ? `intent · ${INTENT_NAMES[topBelief[0]] || topBelief[0]} ${percent(topBelief[1])} · updated ${Math.round(sim.t - (sim.mind.updatedAt || 0))}s ago`
        : 'intent · no theory yet';
      const rows = sim.guards.map(g => {
        const knownDown = net.found.has(g.id) && g.down, missing = net.missing.has(g.id);
        const role = g.dead ? (missing ? 'missing' : knownDown ? 'body found' : 'no reply yet') : g.down ? (missing ? 'missing' : knownDown ? 'found down' : 'no reply yet') : g.task ? (g.task.label || g.task.role) : 'patrol route';
        return h('li', {}, h('button', {
          type: 'button', class: 'shadow-guard-row' + (state.selected === g.id ? ' on' : ''), onclick: () => { state.selected = state.selected === g.id ? null : g.id; paintSide(true); },
        }, h('i', { class: 'dot', style: `background:${STATE_COLORS[g.dead ? 'dead' : g.down ? 'down' : g.sees ? 'alert' : g.state]}` }), h('strong', { text: g.name }), h('span', { text: role })));
      });
      const selected = sim.guards.find(g => g.id === state.selected);
      const intelNodes = [
        h('h3', {}, h('span', { text: 'intel' }), h('span', { class: 'shadow-tag', text: 'live decision data' })),
        h('p', { class: 'shadow-source', text: `commander · ${availability()}` }),
        jev.state.mode === 'off' && !jev.state.access ? h('button', { type: 'button', class: 'shadow-link', onclick: () => api.go?.('/setup/pip') }, 'connect OpenRouter for Jev') : null,
        h('div', { class: 'shadow-strategy' },
          h('span', { class: 'shadow-label', text: 'security strategy' }),
          h('strong', { text: plan?.summary || 'Standard patrols' }),
          h('span', { class: 'small muted', text: decision ? `${decision.kind} · ${decision.source === 'jev' ? jev.state.model.split('/').pop() : decision.status} · ${ago}s ago${decision.latency ? ` · ${Math.round(decision.latency)} ms` : ''}` : 'no decision yet' })),
        h('p', { class: 'small shadow-prediction', text: `prediction · ${prediction}${net.planStatus ? ' · ' + net.planStatus : ''}` }),
        h('p', { class: 'small shadow-prediction', text: beliefLine }),
        answerRows.length ? h('ol', { class: 'shadow-answers' }, answerRows) : null,
        h('ol', { class: 'shadow-guards' }, rows),
        selected ? guardDetail(selected) : h('p', { class: 'small muted', text: 'Select a guard here or click one on the map.' }),
      ].filter(Boolean);
      refs.intel.replaceChildren(...intelNodes);
    }

    function guardDetail(g) {
      const net = sim.net, task = g.task, decision = sim.decisions.find(item => item.id === task?.decision);
      const knowledge = g.knowledge ? `${g.knowledge.source === 'eyes' ? 'saw' : 'radio report'} · ${zoneName(zoneOfPoint(g.knowledge))} · ${Math.round(sim.t - g.knowledge.t)}s ago` : 'nothing on the intruder';
      const question = { pursue: 'heading', intercept: 'intercept', block: 'block', search: 'whereabouts', probe: 'cluster', investigate: 'worth', guard: 'secure', post: 'watch' }[task?.role];
      const confidence = decision && question ? decision.plan?.confidence?.[question] : null;
      const suspected = task?.zone ? zoneName(task.zone) : task?.cluster ? task.cluster.replace(':', ' · ') : g.knowledge ? zoneName(zoneOfPoint(g.knowledge)) : '—';
      const rows = [
        ['state', g.dead ? 'dead' : g.down ? 'unconscious' : STATE_NAMES[g.sees ? 'alert' : g.state]],
        ['assigned role', task ? task.role : 'patrol'],
        ['objective', task?.label || (g.down ? '—' : 'patrol route')],
        ['latest decision', decision ? `#${decision.id} ${decision.kind} · ${decision.source}` : task?.source === 'reflex' ? 'own reaction' : 'standing orders'],
        ['knows', knowledge],
        ['suspects', suspected],
        ['confidence', confidence != null ? percent(confidence) : '—'],
        ['next action', g.dead ? (net.found.has(g.id) ? 'body found · dead' : net.missing.has(g.id) ? 'missing · possibly dead' : 'dead · security unaware') : g.down ? (net.missing.has(g.id) ? 'missing · presumed down' : 'down · security unaware') : g.lastAction],
      ];
      return h('dl', { class: 'shadow-detail' }, rows.flatMap(([term, value]) => [h('dt', { text: term }), h('dd', { text: value })]));
    }

    refs.pause.hidden = !state.paused;
    refs.pauseButton.textContent = state.paused ? 'resume · p' : 'pause · p';
    refs.pauseButton.setAttribute('aria-pressed', String(state.paused));
    refs.stage.focus({ preventScroll: true });
    staticLayer();
    live.raf = requestAnimationFrame(frame);
    if (import.meta.env.DEV) {
      canvas.shadowDebug = {
        sim, state, view: camView,
        teleport(x, y) { sim.player.x = x * TILE + 8; sim.player.y = y * TILE + 8; snapshot(); drawn.facing = sim.player.facing; camView.snap = true; },
        step(seconds = 1, value = {}) { for (let t = 0; t < seconds; t += STEP) sim.step(STEP, value); },
        intel: toggleIntelLocal,
        /** Where a world point (and height) is on screen, in client pixels: for browser checks that click the field. */
        toScreen(x, y, z = 0) {
          const rect = canvas.getBoundingClientRect();
          return { x: rect.left + (x - camView.x) / (camView.w || VIEW_W) * rect.width, y: rect.top + ((y - camView.y) * K - z * V) / (camView.h || VIEW_H) * rect.height };
        },
      };
    }
  }

  function toggleIntel() { live?.toggleIntel?.(); }
  function togglePause() { live?.togglePause?.(); }
  function toggleSound() {
    settings.sound = !settings.sound; sound.state.enabled = settings.sound; saveSettings();
    const button = live?.soundButton;
    if (button) { button.textContent = settings.sound ? 'sound on' : 'sound off'; button.setAttribute('aria-pressed', String(settings.sound)); }
  }

  function abort() {
    if (!live) return;
    if (!live.state.paused) togglePause();
    live.refs.abortConfirm.hidden = false;
    live.refs.abortConfirm.querySelector('button')?.focus({ preventScroll: true });
  }
  function cancelAbort() {
    if (!live) return;
    live.refs.abortConfirm.hidden = true;
    if (live.state.paused) live.togglePause?.();
    live.refs.stage.focus({ preventScroll: true });
  }
  function confirmAbort() {
    if (!live) return;
    live.sim.status = 'aborted';
    finish(live.sim);
    activeMission = null;
  }

  /* ── debrief ── */

  function finish(sim) {
    if (activeMission?.sim === sim) activeMission = null;
    const before = dossierInsights(dossier);
    const report = sim.report();
    dossier = recordMission(dossier, report);
    write(DOSSIER_KEY, dossier);
    const score = sim.score();
    const best = read(BEST_KEY, {});
    const id = sim.rules.id;
    const newBest = sim.status === 'extracted' && (!best[id] || score.points > best[id].points);
    if (newBest) { best[id] = { points: score.points, rank: score.rank, time: Math.round(sim.t), at: Date.now() }; write(BEST_KEY, best); }
    lastResult = { status: sim.status, rank: score.rank, points: score.points, difficulty: id, time: Math.round(sim.t), at: Date.now(), alerts: sim.metrics.alerts, kills: sim.metrics.kills, shots: sim.metrics.shots };
    write(LAST_KEY, lastResult);
    if (sim.status === 'extracted') sound.success(); else sound.fail();
    stop();
    debrief(sim, score, before, newBest);
  }

  function debrief(sim, score, before, newBest) {
    const m = sim.metrics, extracted = sim.status === 'extracted';
    const after = dossierInsights(dossier);
    const learned = after.filter(line => !before.includes(line));
    const stats = [
      ['time', clock(sim.t)], ['alerts', String(m.alerts)], ['sightings', String(m.sightings)], ['takedowns', String(m.takedowns)],
      ['kills', String(m.kills)], ['shots', String(m.shots)], ['intercepted', String(m.interceptions)], ['searches escaped', `${m.recoveries}/${m.searches}`],
      ['distractions', String(m.distractions)], ['score', score.points.toLocaleString()],
    ];
    const title = extracted ? `extracted · ${score.rank.toLowerCase()}` : sim.status === 'captured' ? 'captured' : 'mission aborted';
    const line = extracted ? (m.alerts ? `Out with the data after ${m.alerts} alert${m.alerts === 1 ? '' : 's'}. Security will remember the routes it saw.` : m.kills ? `In and out without an alarm, leaving ${m.kills} behind. Security has bodies to identify.` : 'In and out without an alarm. Security only has what the forensics team finds.')
      : sim.status === 'captured' ? `Caught in the ${zoneName(zoneOfPoint(sim.player))}. ${sim.player.data ? 'The data was in your hands.' : 'The server was still locked.'}` : 'You pulled out. Security keeps what it learned.';
    const node = h('div', { class: 'shadow-debrief' },
      h('p', { class: 'shadow-kicker', text: `${sim.rules.name.toLowerCase()} · ${extracted ? 'mission complete' : 'mission failed'}` }),
      h('h2', { class: 'shadow-title', text: title }),
      h('p', { class: 'shadow-lede', text: line }),
      newBest ? h('p', { class: 'shadow-new-best', text: 'new best' }) : null,
      h('div', { class: 'shadow-stats' }, stats.map(([label, value]) => h('div', { class: 'shadow-stat' }, h('span', { class: 'shadow-label', text: label }), h('strong', { text: value })))),
      h('div', { class: 'shadow-brief-grid two' },
        h('section', { class: 'shadow-panel' },
          h('h3', { text: 'what security learned' }),
          learned.length ? h('ul', { class: 'shadow-insights' }, learned.map(text => h('li', { text })))
            : h('p', { class: 'small muted', text: after.length ? 'Nothing new: the dossier already matched this attempt, or older habits still weigh more.' : 'Nothing worth filing yet.' }),
          h('p', { class: 'small muted', text: `${m.decisions} commander decisions · ${m.jevDecisions} answered by Jev · ${m.jevFailures} link failures · ${m.predictionsHit} predictions right, ${m.predictionsMiss} wrong` })),
        h('section', { class: 'shadow-panel' },
          h('h3', { text: 'next shift' }),
          h('p', { class: 'shadow-strategy-line', text: dossier.attempts ? 'The file is updated. Jev reads it before the next attempt.' : 'No file yet. Jev starts from standard patrols.' }),
          h('p', { class: 'small muted', text: 'Every tactic and field order next time comes from Jev. Nothing is chosen locally, so changing your habits can change the whole defence.' }))),
      h('div', { class: 'shadow-debrief-actions' },
        h('button', { type: 'button', class: 'primary shadow-begin', onclick: begin }, extracted ? 'infiltrate again' : 'try again'),
        h('button', { type: 'button', class: 'shadow-link', onclick: briefing }, 'back to the briefing')),
      help());
    root.replaceChildren(node);
    node.querySelector('.shadow-begin').focus({ preventScroll: true });
  }

  const leave = () => {
    if (location.hash.startsWith('#/shadow')) return;
    if (activeMission) activeMission.left = true;
    stop();
    removeEventListener('hashchange', leave);
  };
  disposeMount = () => { stop(); removeEventListener('hashchange', leave); };
  addEventListener('hashchange', leave);
  if (activeMission?.sim.status === 'playing') {
    const paused = activeMission.left;
    activeMission.left = false;
    resume(activeMission.sim, paused);
  } else briefing();
}

function zoneOfPoint(point) {
  const tx = Math.floor(point.x / TILE), ty = Math.floor(point.y / TILE);
  for (const zone of Object.values(ZONE_BY_ID)) if ((zone.rects || [zone.rect]).some(r => tx >= r[0] && tx <= r[2] && ty >= r[1] && ty <= r[3])) return zone.id;
  return '';
}

function optionName(question, id, situation) {
  const c = situation?.candidates || {};
  if (question === 'intent') return INTENT_NAMES[id] || String(id).replace(/_/g, ' ');
  if (question === 'plan') return c.plans?.find(item => item.id === id)?.name || String(id).split(':').pop().replace(/_/g, ' ');
  if (id === 'hide') return 'go to ground nearby';
  if (id === 'none') return 'no spot stands out';
  if (question === 'doors') {
    if (id === 'keep') return 'leave the doors as they are';
    if (id === 'release') return 'release the active seal';
    return DOOR_CONTROLS.find(item => item.id === id)?.name || String(id).replace(/_/g, ' ');
  }
  if (question === 'lights') {
    if (id === 'keep') return 'keep current lighting';
    if (id === 'off') return 'switch off the extra floodlights';
    return FLOODLIGHTS.find(item => item.id === id)?.name || String(id).replace(/_/g, ' ');
  }
  if (question === 'camera') {
    if (id === 'keep') return 'keep current camera coverage';
    if (id === 'routine') return 'all cameras back to routine';
    return CAMERAS.find(item => item.id === id)?.name || String(id).replace(/_/g, ' ');
  }
  const found = [...(c.zones || []), ...(c.exits || []), ...(c.clusters || []), ...(c.posts || []), ...(c.sectors || [])].find(item => item.id === id);
  if (found) return found.name;
  return String(id).replace(/_/g, ' ');
}

/** Today tile summary. */
export function shadowSummary() {
  const last = read(LAST_KEY, null), dossier = readDossier(read(DOSSIER_KEY, null));
  if (!last) return { value: 'new', detail: 'Infiltrate the facility', status: 'stealth', alert: false };
  const value = last.status === 'extracted' ? last.rank.toLowerCase() : last.status === 'captured' ? 'caught' : 'aborted';
  return { value, detail: `${dossier.attempts} attempt${dossier.attempts === 1 ? '' : 's'} · ${last.difficulty}`, status: last.status === 'extracted' ? `${last.points.toLocaleString()} pts` : 'jev learns', alert: false };
}
