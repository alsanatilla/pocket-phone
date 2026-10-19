// Girder Run: a short arcade roguelike. Climb generated towers, dodge barrels,
// reach the door at the top and draft a relic before the next floor.
import { storage } from './workspace-storage.js';
import {
  TILE, W, H, FLOOR_COUNT, START_HEARTS, PLATFORM_ROWS, RELICS, RELIC_CAPS,
  createFloorPlan, onSegments, mulberry32, readLoadout, jevDecide,
} from './girder-engine.js';
import { resolve as resolveProviderKey } from './pip-credentials.js';
import { JEV_ENDPOINT, JEV_GAME, JEV_MODEL, jevDecisionFromResponse, jevQuestions } from '../shared/girder-jev.js';

const RUN_KEY = 'girder-run';
const OPENROUTER = { provider: 'compatible', baseUrl: 'https://openrouter.ai/api/v1', model: JEV_MODEL };
const BEST_KEY = 'girder-best';
const REST_COST = 5;
const PLAYER_W = 10;
const PLAYER_H = 14;
const BARREL_W = 12;
const BARREL_H = 12;
const FIRE_W = 10;
const FIRE_H = 10;
const GRAVITY = 700;
const RUN_SPEED = 90;
const JUMP_SPEED = 212;
const CLIMB_SPEED = 66;
const MAX_FALL = 420;
const BARREL_GRAVITY = 560;
const COYOTE = 0.09;

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

const number = value => Number(value || 0).toLocaleString();
const has = (run, id) => run.relics.includes(id);
const relic = id => RELICS.find(item => item.id === id);
const log = (run, text) => { run.log = [text, ...(run.log || [])].slice(0, 7); };
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const hash = (a, b) => { const value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return value - Math.floor(value); };

function read(key) {
  try { const value = storage.getItem(key); return value ? JSON.parse(value) : null; } catch { return null; }
}
function write(key, value) {
  try { storage.setItem(key, JSON.stringify(value)); } catch { /* A full or private store should not stop the run. */ }
}
function loadRun() {
  const run = read(RUN_KEY);
  if (!run || run.v !== 1 || !['playing', 'reward', 'dead', 'won'].includes(run.status)) return null;
  if (!Number.isInteger(run.depth) || run.depth < 0 || run.depth >= FLOOR_COUNT) return null;
  if (!Number.isFinite(run.hearts) || !Number.isFinite(run.maxHearts) || !Number.isFinite(run.coins) || !Number.isFinite(run.score)) return null;
  if (!Array.isArray(run.relics) || !Array.isArray(run.log)) return null;
  if (['playing', 'reward'].includes(run.status) && (!run.floor || !Array.isArray(run.floor.platforms) || !run.floor.exit)) return null;
  return run;
}
function loadBest() {
  const best = read(BEST_KEY);
  return best && Number.isFinite(best.score) ? best : { score: 0, depth: 0, wins: 0 };
}

function drawRelics(run, count) {
  const pool = RELICS.filter(item => !has(run, item.id));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, count).map(item => item.id);
}

/* ── Canvas art ───────────────────────────────────────────────────────────── */

function drawBackground(ctx, time) {
  ctx.fillStyle = '#12110f'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#181612';
  for (let y = 0; y < H; y += 32) ctx.fillRect(0, y, W, 1);
  for (let x = 0; x < W; x += 32) ctx.fillRect(x, 0, 1, H);
  ctx.fillStyle = '#221e18'; ctx.fillRect(0, 0, 8, H); ctx.fillRect(W - 8, 0, 8, H);
  ctx.fillStyle = '#3e392f';
  for (let y = 8; y < H; y += 28) { ctx.fillRect(3, y, 2, 2); ctx.fillRect(W - 5, y, 2, 2); }
  // A narrow porthole in the upper right.
  ctx.fillStyle = '#191713'; ctx.fillRect(236, 10, 50, 38);
  ctx.fillStyle = '#2d3b45'; ctx.fillRect(240, 14, 42, 30);
  ctx.fillStyle = '#52634f';
  for (let x = 243; x < 280; x += 9) ctx.fillRect(x, 18, 4, 22);
  ctx.fillStyle = '#3e392f'; ctx.fillRect(236, 46, 50, 2); ctx.fillRect(236, 10, 2, 38); ctx.fillRect(284, 10, 2, 38);
  // Dust in the air.
  for (let i = 0; i < 24; i++) {
    const x = Math.floor(hash(i, 3) * W), y = Math.floor(hash(i, 7) * H);
    const alpha = .1 + .09 * Math.sin(time * 2 + i);
    ctx.fillStyle = `rgba(236,201,129,${alpha})`; ctx.fillRect(x, y, 1, 1);
  }
  // A small placard on the left wall.
  ctx.fillStyle = '#1b1915'; ctx.fillRect(12, 8, 30, 18);
  ctx.fillStyle = '#3e392f'; ctx.fillRect(12, 8, 30, 2); ctx.fillRect(12, 24, 30, 2); ctx.fillRect(12, 8, 2, 18); ctx.fillRect(40, 8, 2, 18);
  ctx.fillStyle = '#ecc981'; ctx.fillRect(18, 14, 2, 5); ctx.fillRect(22, 12, 2, 7); ctx.fillRect(26, 16, 2, 3); ctx.fillRect(32, 13, 4, 2);
}

function drawGirder(ctx, from, to, y) {
  if (to - from < 2) return;
  ctx.fillStyle = '#4a3524'; ctx.fillRect(from, y + 5, to - from, 3);
  ctx.fillStyle = '#6b4a2a'; ctx.fillRect(from, y + 3, to - from, 2);
  ctx.fillStyle = '#ecc981'; ctx.fillRect(from, y, to - from, 3);
  ctx.fillStyle = '#f0e9dd'; ctx.fillRect(from, y, to - from, 1);
  for (let x = from + 6; x < to - 2; x += 16) { ctx.fillStyle = '#6b4a2a'; ctx.fillRect(x, y + 1, 2, 2); }
  ctx.fillStyle = '#3a2d1f';
  for (let x = from + 10; x < to - 10; x += 44) {
    for (let i = 0; i < 5; i++) { ctx.fillRect(x + i, y + 8 + i, 2, 2); ctx.fillRect(x + 9 - i, y + 8 + i, 2, 2); }
  }
}

function drawLadder(ctx, ladder) {
  const x = ladder.col * TILE + TILE / 2, top = ladder.topRow * TILE, bottom = ladder.bottomRow * TILE;
  ctx.fillStyle = '#6f8397'; ctx.fillRect(x - 4, top + 1, 2, bottom - top - 1); ctx.fillRect(x + 2, top + 1, 2, bottom - top - 1);
  ctx.fillStyle = '#a5bfdc'; ctx.fillRect(x - 3, top + 1, 1, bottom - top - 1); ctx.fillRect(x + 3, top + 1, 1, bottom - top - 1);
  ctx.fillStyle = '#ecc981';
  for (let y = top + 4; y < bottom; y += 6) ctx.fillRect(x - 3, y, 6, 1);
}

function drawExit(ctx, plan, time) {
  const x = plan.exit.x, y = plan.exit.y;
  ctx.fillStyle = '#3e392f'; ctx.fillRect(x - 10, y - 2, 20, 26);
  ctx.fillStyle = '#a5bfdc'; ctx.fillRect(x - 8, y, 16, 24);
  ctx.fillStyle = '#12110f'; ctx.fillRect(x - 6, y + 2, 12, 22);
  const pulse = .45 + .35 * Math.sin(time * 4);
  ctx.fillStyle = `rgba(236,201,129,${.25 + .2 * pulse})`; ctx.fillRect(x - 4, y + 5, 8, 17);
  ctx.fillStyle = '#ecc981'; ctx.fillRect(x - 2, y + 8, 4, 11);
  ctx.fillStyle = '#f0e9dd'; ctx.fillRect(x - 1, y + 9, 2, 2);
  ctx.fillStyle = `rgba(236,201,129,${.1 + .08 * pulse})`; ctx.fillRect(x - 12, y - 7, 24, 5);
  for (let i = 0; i < 3; i++) {
    const sx = x - 8 + ((i * 13 + Math.floor(time * 5)) % 17);
    const sy = y - 4 - ((i * 7 + Math.floor(time * 9)) % 18);
    ctx.fillStyle = `rgba(236,201,129,${.2 + .55 * (1 - (y - 4 - sy) / 18)})`; ctx.fillRect(sx, sy, 1, 1);
  }
}

function drawKeeper(ctx, plan, time, throwFlash) {
  const x = plan.keeper.x, y = Math.round(Math.sin(time * 1.8));
  const boss = plan.boss;
  ctx.fillStyle = 'rgba(236,201,129,.045)'; ctx.fillRect(x - 28, 0, 56, 34);
  ctx.fillStyle = '#3a2a22'; ctx.fillRect(x - 19, y + 11, 8, 19); ctx.fillRect(x + 11, y + 11, 8, 19);
  ctx.fillStyle = '#4a3428'; ctx.fillRect(x - 13, y + 9, 26, 23);
  ctx.fillStyle = '#5c4030'; ctx.fillRect(x - 9, y + 12, 18, 15);
  ctx.fillStyle = '#3a2a22'; ctx.fillRect(x - 17, y + 8, 34, 8);
  ctx.fillStyle = '#4a3428'; ctx.fillRect(x - 10, y, 20, 13);
  ctx.fillRect(x - 14, y + 3, 4, 6); ctx.fillRect(x + 10, y + 3, 4, 6);
  ctx.fillStyle = '#8a6a55'; ctx.fillRect(x - 7, y + 5, 14, 6);
  ctx.fillStyle = '#3a2a22'; ctx.fillRect(x - 3, y + 8, 2, 1); ctx.fillRect(x + 1, y + 8, 2, 1);
  ctx.fillStyle = boss ? '#efa58e' : '#ecc981';
  ctx.fillRect(x - 6, y + 2, 3, 2); ctx.fillRect(x + 3, y + 2, 3, 2);
  ctx.fillStyle = '#12110f'; ctx.fillRect(x - 5, y + 2, 1, 2); ctx.fillRect(x + 4, y + 2, 1, 2);
  ctx.fillStyle = '#12110f'; ctx.fillRect(x - 13, y + 26, 26, 3);
  if (boss) {
    ctx.fillStyle = '#ecc981';
    ctx.fillRect(x - 9, y - 4, 18, 2);
    ctx.fillRect(x - 9, y - 6, 3, 2); ctx.fillRect(x - 3, y - 7, 3, 3); ctx.fillRect(x + 4, y - 6, 3, 2);
  }
  if (throwFlash > 0) {
    ctx.fillStyle = '#3a2a22'; ctx.fillRect(x + 12, y + 3, 7, 8);
    drawBarrel(ctx, { x: x + 12, y: y - 3, dir: 1, spin: 0 });
  }
}

function drawBarrel(ctx, barrel) {
  const x = Math.round(barrel.x), y = Math.round(barrel.y);
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x + 1, y + 12, 10, 1);
  ctx.fillStyle = '#5b3427'; ctx.fillRect(x + 1, y, 10, 12);
  ctx.fillStyle = '#b9653f'; ctx.fillRect(x, y + 2, 12, 8);
  ctx.fillStyle = barrel.wild ? '#a5bfdc' : '#ecc981'; ctx.fillRect(x + 1, y + 3, 10, 1); ctx.fillRect(x + 1, y + 8, 10, 1);
  ctx.fillStyle = '#4a2b20'; ctx.fillRect(x + 3, y + 2, 1, 8); ctx.fillRect(x + 8, y + 2, 1, 8);
  ctx.fillStyle = '#f0e9dd'; ctx.fillRect(x + 2, y + 4, 1, 1);
  if (barrel.dir) { ctx.fillStyle = 'rgba(236,201,129,.22)'; ctx.fillRect(barrel.dir > 0 ? x - 3 : x + 13, y + 5, 2, 1); }
}

function drawFireball(ctx, fireball, time) {
  const x = Math.round(fireball.x), y = fireball.row * TILE - FIRE_H;
  const flicker = Math.floor(time * 12) % 2;
  ctx.fillStyle = '#efa58e'; ctx.fillRect(x + 1, y + 1, 8, 8);
  ctx.fillStyle = '#ecc981'; ctx.fillRect(x + 2, y, 6, 10); ctx.fillRect(x, y + 3, 10, 4);
  ctx.fillStyle = '#f0e9dd'; ctx.fillRect(flicker ? x + 4 : x + 3, y + 3, 3, 3);
  ctx.fillStyle = 'rgba(239,165,142,.35)'; ctx.fillRect(x - 2, y + 2 + flicker, 1, 2); ctx.fillRect(x + 11, y + 5 - flicker, 1, 2);
}

function drawCoin(ctx, coin, time) {
  if (coin.taken) return;
  const y = Math.round(coin.y + Math.sin(time * 4 + coin.x) * 1.5);
  ctx.fillStyle = '#8a6b39'; ctx.fillRect(coin.x - 3, y + 7, 6, 1);
  ctx.fillStyle = '#ecc981'; ctx.fillRect(coin.x - 3, y, 6, 8);
  ctx.fillStyle = '#f0e9dd'; ctx.fillRect(coin.x - 2, y + 1, 2, 3);
  ctx.fillStyle = '#b98b43'; ctx.fillRect(coin.x + 1, y + 5, 1, 1);
}

function drawHammerPickup(ctx, hammer, time) {
  if (!hammer || hammer.taken) return;
  const y = Math.round(hammer.y + Math.sin(time * 3 + 2));
  ctx.fillStyle = 'rgba(236,201,129,.12)'; ctx.fillRect(hammer.x - 8, y - 3, 16, 15);
  ctx.fillStyle = '#a5bfdc'; ctx.fillRect(hammer.x - 1, y + 2, 2, 7);
  ctx.fillStyle = '#ecc981'; ctx.fillRect(hammer.x - 5, y - 1, 10, 4);
  ctx.fillStyle = '#f0e9dd'; ctx.fillRect(hammer.x - 3, y, 3, 1);
}

function drawPlayer(ctx, player, time, hammerTimer = 0) {
  if (player.invuln > 0 && Math.floor(time * 14) % 2 === 0) return;
  const x = Math.round(player.x), y = Math.round(player.y), face = player.facing || 1;
  const moving = Math.abs(player.vx) > 2, walk = Math.floor((player.anim || 0) * 10) % 2;
  if (player.grounded) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x + 1, y + 14, 8, 2); }
  ctx.fillStyle = '#12110f';
  if (player.climbing) {
    if (walk) { ctx.fillRect(x + 2, y + 10, 2, 4); ctx.fillRect(x + 6, y + 11, 2, 3); }
    else { ctx.fillRect(x + 2, y + 11, 2, 3); ctx.fillRect(x + 6, y + 10, 2, 4); }
  } else if (!player.grounded) {
    ctx.fillRect(x + 1, y + 10, 3, 3); ctx.fillRect(x + 6, y + 9, 3, 4);
  } else if (moving) {
    if (walk) { ctx.fillRect(x + 1, y + 11, 3, 3); ctx.fillRect(x + 6, y + 11, 2, 3); }
    else { ctx.fillRect(x + 2, y + 11, 2, 3); ctx.fillRect(x + 6, y + 11, 3, 3); }
  } else { ctx.fillRect(x + 2, y + 11, 2, 3); ctx.fillRect(x + 6, y + 11, 2, 3); }
  ctx.fillStyle = '#a5bfdc'; ctx.fillRect(x + 1, y + 6, 8, 5);
  ctx.fillStyle = '#f0e9dd'; ctx.fillRect(x + 2, y + 6, 6, 2);
  ctx.fillStyle = '#f0e9dd';
  if (player.climbing) { ctx.fillRect(x + 1, y + 4, 2, 4); ctx.fillRect(x + 7, y + 4, 2, 4); }
  else { ctx.fillRect(face > 0 ? x + 8 : x, y + 7, 2, 3); ctx.fillRect(face > 0 ? x : x + 8, y + 7, 2, 3); }
  ctx.fillStyle = '#f0e9dd'; ctx.fillRect(x + 2, y + 3, 6, 4);
  ctx.fillStyle = '#ecc981'; ctx.fillRect(x + 1, y, 8, 2); ctx.fillRect(face > 0 ? x + 7 : x + 1, y + 1, 2, 1);
  ctx.fillStyle = '#12110f'; ctx.fillRect(face > 0 ? x + 6 : x + 3, y + 4, 1, 1);
  if (hammerTimer > 0) {
    const bob = Math.round(Math.sin(time * 12));
    ctx.fillStyle = '#a5bfdc'; ctx.fillRect(x + 7, y - 4 + bob, 2, 5);
    ctx.fillStyle = '#ecc981'; ctx.fillRect(x + 5, y - 6 + bob, 7, 3);
    ctx.fillStyle = '#f0e9dd'; ctx.fillRect(x + 6, y - 6 + bob, 2, 1);
  }
}

function drawParticles(ctx, particles) {
  for (const particle of particles) {
    if (particle.life <= 0) continue;
    ctx.globalAlpha = Math.max(0, particle.life / particle.max);
    ctx.fillStyle = particle.color;
    ctx.fillRect(Math.round(particle.x), Math.round(particle.y), particle.size, particle.size);
  }
  ctx.globalAlpha = 1;
}

function drawWorld(ctx, plan, view, time) {
  drawBackground(ctx, time);
  ctx.save();
  if (view.shake > 0) {
    const amount = Math.ceil(view.shake * 16);
    ctx.translate((Math.random() * 2 - 1) * amount, (Math.random() * 2 - 1) * amount);
  }
  drawKeeper(ctx, plan, time, view.throwFlash || 0);
  for (const platform of plan.platforms) {
    for (const span of platform.segments) drawGirder(ctx, span.from, span.to, platform.row * TILE);
  }
  for (const ladder of plan.ladders) drawLadder(ctx, ladder);
  drawExit(ctx, plan, time);
  for (const coin of plan.coins) drawCoin(ctx, coin, time);
  drawHammerPickup(ctx, plan.hammer, time);
  for (const fireball of view.fireballs || []) drawFireball(ctx, fireball, time);
  for (const barrel of view.barrels || []) drawBarrel(ctx, barrel);
  if (view.player) drawPlayer(ctx, view.player, time, view.hammerTimer || 0);
  drawParticles(ctx, view.particles || []);
  ctx.restore();
}

/* ── Level movement shared by the run and the attract screen ─────────────── */

function moveBarrel(plan, barrel, dt, speed) {
  if (barrel.state === 'roll') {
    barrel.x += barrel.dir * speed * dt;
    barrel.spin = (barrel.spin || 0) + dt * speed * 0.3;
    if (barrel.x < -BARREL_W || barrel.x > W) return false;
    const platform = plan.platforms.find(item => item.row === barrel.row);
    if (!platform || !onSegments(platform.segments, barrel.x + BARREL_W / 2)) {
      barrel.state = 'fall'; barrel.vy = 0;
    }
    return true;
  }
  const previousBottom = barrel.y + BARREL_H;
  barrel.vy = Math.min(MAX_FALL, barrel.vy + BARREL_GRAVITY * dt);
  barrel.y += barrel.vy * dt;
  let landing = null;
  for (const platform of plan.platforms) {
    const surface = platform.row * TILE;
    if (surface <= barrel.row * TILE + 1) continue;
    if (previousBottom <= surface + 2 && barrel.y + BARREL_H >= surface && onSegments(platform.segments, barrel.x + BARREL_W / 2)) {
      if (landing === null || surface < landing) landing = surface;
    }
  }
  if (landing !== null) {
    barrel.y = landing - BARREL_H;
    barrel.row = Math.round(landing / TILE);
    barrel.state = 'roll';
    barrel.dir *= -1;
    barrel.vy = 0;
  }
  return barrel.y <= H + 30;
}

/* ── Mount ────────────────────────────────────────────────────────────────── */

export function mountGirder(body, api = {}) {
  const root = h('div', { class: 'girder-game' });
  body.append(root);
  const confirmBox = api.confirm || (title => Promise.resolve(globalThis.confirm?.(title)));
  let run = loadRun();
  let runtime = null;
  let controller = null;
  let attractRaf = 0;
  let toastTimer = 0;
  let feedback = '';
  let paused = false;
  let transitionQueued = false;

  function save() { if (run) write(RUN_KEY, run); }
  function saveBest(best) { write(BEST_KEY, best); }

  function stopGame() {
    if (controller) { controller.abort(); controller = null; }
    if (runtime?.remoteController) runtime.remoteController.abort();
    if (runtime?.raf) cancelAnimationFrame(runtime.raf);
    runtime = null;
  }
  function stopAttract() {
    if (attractRaf) cancelAnimationFrame(attractRaf);
    attractRaf = 0;
  }
  function transition() {
    if (transitionQueued) return;
    transitionQueued = true;
    queueMicrotask(() => {
      transitionQueued = false;
      stopGame();
      render('first');
    });
  }

  function paintHud(refs = runtime?.refs) {
    if (!run || !refs) return;
    refs.hearts.replaceChildren(...Array.from({ length: run.maxHearts }, (_, index) => h('span', {
      class: 'girder-heart' + (index < run.hearts ? ' on' : ''), 'aria-hidden': 'true', text: '♥',
    })));
    refs.hearts.setAttribute('aria-label', `${run.hearts} of ${run.maxHearts} hearts`);
    refs.coins.textContent = String(run.coins);
    refs.score.textContent = number(run.score);
  }
  function paintLog(refs = runtime?.refs) {
    if (!run || !refs?.log) return;
    refs.log.replaceChildren(...(run.log || []).slice(0, 7).map(text => h('li', { text })));
  }
  function toast(text, refs = runtime?.refs) {
    if (!refs?.toast) return;
    clearTimeout(toastTimer);
    refs.toast.textContent = text;
    refs.toast.classList.add('on');
    toastTimer = setTimeout(() => {
      if (!refs.toast.isConnected) return;
      refs.toast.classList.remove('on');
      refs.toast.textContent = '';
    }, 1200);
  }

  function relicChips(run) {
    if (!run.relics.length) return h('p', { class: 'small muted', text: 'No relics yet. Clear a floor to draft one.' });
    return h('div', { class: 'girder-relics' }, run.relics.map(id => {
      const item = relic(id);
      return item ? h('span', { class: 'girder-relic-chip' + (item.tone === 'cursed' ? ' cursed' : ''), title: item.desc, text: item.name }) : null;
    }));
  }

  function help() {
    return h('details', { class: 'girder-help' },
      h('summary', { text: 'how to play' }),
      h('ul', {},
        h('li', { text: 'Climb the ladders to the glowing door at the top of each floor.' }),
        h('li', { text: 'Jump barrels. A barrel or fireball costs a heart; a long fall does too.' }),
        h('li', { text: 'Coins are score. The hammer breaks hazards for seven seconds.' }),
        h('li', { text: 'Clear a floor to rest and draft a relic. Hearts do not return on their own.' }),
        h('li', { text: 'JEV reads your coordinates, hearts and relic capabilities. With an OpenRouter key saved in Pip in this tab (or on your account), Jev 1.14 answers typed questions through OpenRouter’s Decisions API; otherwise the local model takes over. Jev is billed to your OpenRouter account.' }),
        h('li', { text: 'Arrows or WASD move; ↑/↓ climb; space jumps. Touch controls appear on small screens.' })));
  }

  function floorBar() {
    const floor = run.floor;
    return h('div', { class: 'girder-floorbar' },
      h('div', { class: 'girder-floor-copy' },
        h('span', { class: 'girder-kicker', text: `floor ${run.depth + 1}` }),
        h('strong', { class: 'girder-floor-name', text: floor.name })),
      floor.boss ? h('span', { class: 'girder-tag bad', text: 'final' }) : null,
      floor.throws ? h('span', { class: 'girder-throws', title: `JEV · ${floor.throws.desc}`, text: 'jev · ' + floor.throws.name }) : null,
      floor.omen ? h('span', { class: 'girder-omen ' + floor.omen.tone, title: floor.omen.desc },
        h('span', { class: 'girder-omen-name', text: floor.omen.name }),
        h('span', { class: 'girder-omen-desc', text: floor.omen.desc })) : null);
  }

  function touchControls() {
    const button = (label, move, extra = '') => h('button', {
      type: 'button', class: 'girder-touch-key ' + extra, 'data-move': move, 'aria-label': move === 'jump' ? 'Jump' : 'Move ' + move,
    }, label);
    return h('div', { class: 'girder-touch', role: 'group', 'aria-label': 'Touch controls' },
      button('←', 'left'), button('→', 'right'), button('↑', 'up'), button('↓', 'down'), button('jump', 'jump', 'jump'));
  }

  function liveView() {
    const canvas = h('canvas', { class: 'girder-canvas', width: W, height: H, role: 'img', 'aria-label': 'Girder Run arcade game' });
    const toastEl = h('div', { class: 'girder-toast', role: 'status' });
    const stage = h('div', { class: 'girder-stage', tabindex: '0', 'aria-label': 'Girder Run play field' }, canvas, toastEl,
      h('div', { class: 'girder-stage-hint', text: 'arrows move · ↑↓ climb · space jump' }));
    const hearts = h('div', { class: 'girder-hearts' });
    const coins = h('strong', { class: 'girder-coins', text: String(run.coins) });
    const score = h('strong', { class: 'girder-score-value', text: number(run.score) });
    const logList = h('ol', { class: 'girder-log', 'aria-live': 'polite' });
    const jevRead = h('p', { class: 'girder-jev-read small muted', text: 'reading your route…' });
    const jevIntent = h('p', { class: 'girder-jev-intent', text: 'intent · watching' });
    const jevSource = h('p', { class: 'girder-jev-source', text: 'local model' });
    const jevConnect = h('button', { type: 'button', class: 'girder-jev-connect', hidden: true, onclick: () => api.go?.('/setup/pip') }, 'connect OpenRouter');
    const refs = { canvas, stage, toast: toastEl, hearts, coins, score, log: logList, jevRead, jevIntent, jevSource, jevConnect };
    const node = h('div', { class: 'girder-live' },
      h('div', { class: 'girder-hud' },
        h('div', { class: 'girder-depth' },
          h('span', { class: 'girder-label', text: 'depth' }),
          h('strong', { text: String(run.depth + 1).padStart(2, '0') }),
          h('span', { class: 'girder-dim', text: '/' + String(FLOOR_COUNT).padStart(2, '0') })),
        hearts,
        h('div', { class: 'girder-stat' }, h('span', { class: 'girder-gem', 'aria-hidden': 'true', text: '◆' }), coins, h('span', { class: 'girder-label', text: 'coins' })),
        h('div', { class: 'girder-score' }, h('span', { class: 'girder-label', text: 'score' }), score)),
      h('div', { class: 'girder-layout' },
        h('div', { class: 'girder-main' }, floorBar(), stage, touchControls(),
          h('p', { class: 'girder-keys', text: 'Arrows / WASD to move · ↑↓ climb · space jump' })),
        h('aside', { class: 'girder-side' },
          h('section', { class: 'girder-panel' }, h('h3', { text: 'the climb' }),
            h('p', { class: 'small muted', text: 'Reach the lit door on the top girder. JEV, the keeper’s throw model, reads your route, hearts and relics, then chooses the hand, barrel and pause.' })),
          h('section', { class: 'girder-panel girder-jev' },
            h('h3', {}, h('span', { text: 'jev' }), h('span', { class: 'girder-jev-tag', text: 'system one' })),
            jevRead, jevIntent, jevSource, jevConnect),
          h('section', { class: 'girder-panel' }, h('h3', { text: 'relics' }), relicChips(run)),
          h('section', { class: 'girder-panel' }, h('h3', { text: 'dispatch' }), logList),
          h('button', { type: 'button', class: 'girder-abandon', onclick: abandon }, 'abandon run'),
          help())));
    return { node, canvas, refs };
  }

  function rewardView() {
    const reward = run.clearReward || { score: 0, coins: 0 };
    const choices = (run.choices || []).map(relic).filter(Boolean);
    const full = run.hearts >= run.maxHearts;
    const next = run.depth + 1 < FLOOR_COUNT ? createFloorPlan(run.depth + 1, run.seed) : null;
    return h('div', { class: 'girder-reward' },
      h('p', { class: 'girder-kicker', text: `depth ${run.depth + 1} cleared` }),
      h('h2', { class: 'girder-reward-title', text: 'the girder is behind you' }),
      h('p', { class: 'girder-reward-line', text: `+${reward.score} score · +${reward.coins} coins · ${run.hearts} of ${run.maxHearts} hearts.` }),
      h('div', { class: 'girder-reward-bar' },
        h('div', { class: 'girder-reward-stat' }, h('span', { class: 'girder-label', text: 'hearts' }), h('strong', { text: `${run.hearts} / ${run.maxHearts}` })),
        h('div', { class: 'girder-reward-stat' }, h('span', { class: 'girder-label', text: 'coins' }), h('strong', { text: String(run.coins) })),
        h('div', { class: 'girder-reward-stat' }, h('span', { class: 'girder-label', text: 'score' }), h('strong', { text: number(run.score) })),
        h('button', { type: 'button', class: 'girder-rest-button', disabled: full || run.coins < REST_COST, onclick: rest },
          full ? 'hearts full' : `rest · ${REST_COST} coins → +1 heart`)),
      feedback ? h('p', { class: 'girder-feedback', text: feedback, role: 'status' }) : null,
      h('h3', { class: 'girder-choose', text: choices.length ? 'choose a relic' : 'the next climb' }),
      choices.length ? h('div', { class: 'girder-relic-grid' }, choices.map((item, index) => h('button', {
        type: 'button', class: 'girder-relic-card ' + (item.tone || ''),
        onclick: () => chooseRelic(item.id),
      },
      h('span', { class: 'girder-card-index', text: String(index + 1).padStart(2, '0') }),
      h('span', { class: 'girder-card-name', text: item.name }),
      h('span', { class: 'girder-card-desc', text: item.desc }),
      item.tone === 'cursed' ? h('span', { class: 'girder-tag bad', text: 'cursed' }) : null)))
        : h('button', { type: 'button', class: 'primary girder-start', onclick: descend }, 'descend'),
      h('p', { class: 'small muted', text: choices.length ? 'Choosing a relic begins the next climb.' : 'The next floor waits.' }),
      next ? h('div', { class: 'girder-reward-next' },
        h('span', { class: 'girder-label', text: 'next' }),
        h('strong', { text: next.name }),
        h('span', { class: 'small muted', text: next.boss ? 'final floor' : `${next.platforms.length} girders` })) : null,
      h('div', { class: 'girder-reward-relics' }, run.relics.length ? relicChips(run) : null),
      help());
  }

  function endView() {
    const won = run.status === 'won', best = loadBest();
    const stats = [
      ['depth', `${run.depth + 1} / ${FLOOR_COUNT}`],
      ['score', number(run.finalScore || run.score)],
      ['coins', String(run.coins)],
      ['hearts', `${run.hearts} / ${run.maxHearts}`],
      ['hits', String(run.hits || 0)],
      ['smashed', String(run.smashes || 0)],
      ['relics', String(run.relics.length)],
      ['best', number(best.score)],
    ];
    return h('div', { class: 'girder-end' },
      h('p', { class: 'girder-kicker', text: won ? 'the roof gives way' : 'run ended' }),
      h('h2', { class: 'girder-end-title', text: won ? 'top of the tower' : 'the tower takes you' }),
      h('p', { class: 'girder-end-line', text: won ? 'Eight floors, one clean climb. The keeper has nothing left to throw.' : 'The next run starts at the bottom with a clean set of hearts.' }),
      run.newBest ? h('p', { class: 'girder-new-best', text: 'new best' }) : null,
      h('div', { class: 'girder-stats' }, stats.map(([label, value]) => h('div', { class: 'girder-stat-cell' }, h('span', { class: 'girder-label', text: label }), h('strong', { text: value })))),
      run.relics.length ? relicChips(run) : null,
      h('button', { type: 'button', class: 'primary girder-start', onclick: begin }, won ? 'climb it again' : 'begin a new run'),
      h('p', { class: 'small muted', text: `best · depth ${best.depth || 0}/${FLOOR_COUNT} · ${number(best.score)} pts · ${best.wins || 0} win${best.wins === 1 ? '' : 's'}` }),
      feedback ? h('p', { class: 'girder-feedback', text: feedback, role: 'status' }) : null,
      help());
  }

  function landingView() {
    const best = loadBest();
    const attract = h('canvas', { class: 'girder-attract-canvas', width: W, height: H, 'aria-label': 'Barrels rolling down a girder tower' });
    const node = h('div', { class: 'girder-landing' },
      h('div', { class: 'girder-landing-hero' },
        h('div', { class: 'girder-landing-copy' },
          h('p', { class: 'girder-kicker', text: 'a barrel-dodging roguelike' }),
          h('h2', { class: 'girder-landing-title', text: 'climb. dodge. descend.' }),
          h('p', { class: 'girder-lede', text: 'Eight random girder towers, one heart pool and an ape with an endless supply of barrels. Reach the door at the top, draft a relic, and see how high one run can go.' }),
          h('button', { type: 'button', class: 'primary girder-start', onclick: begin }, 'begin run'),
          h('p', { class: 'small muted', text: best.score ? `best · depth ${best.depth}/${FLOOR_COUNT} · ${number(best.score)} pts · ${best.wins || 0} win${best.wins === 1 ? '' : 's'}` : 'no runs yet · the first climb is gentle' })),
        h('div', { class: 'girder-attract' }, attract,
          h('span', { class: 'girder-attract-label', text: 'the keeper is waiting' }))),
      h('div', { class: 'girder-rules' },
        h('div', { class: 'girder-rule' }, h('span', { class: 'girder-rule-number', text: '01' }), h('strong', { text: 'climb' }), h('p', { text: 'Take the ladders to the lit door on the top girder. Gaps are shortcuts down, not free passage.' })),
        h('div', { class: 'girder-rule' }, h('span', { class: 'girder-rule-number', text: '02' }), h('strong', { text: 'dodge' }), h('p', { text: 'Jump the barrels. Fireballs patrol. A hammer turns both into coins for seven seconds.' })),
        h('div', { class: 'girder-rule' }, h('span', { class: 'girder-rule-number', text: '03' }), h('strong', { text: 'draft' }), h('p', { text: 'Rest or take a relic between floors. Hearts do not come back on their own.' }))),
      h('div', { class: 'girder-landing-foot' }, h('p', { class: 'small muted', text: 'Eight floors · random girders · barrels, fireballs and one very patient keeper' })),
      help());
    return { node, attract };
  }

  function render(focus = 'auto') {
    stopGame();
    stopAttract();
    transitionQueued = false;
    let screen;
    if (!run) screen = landingView();
    else if (run.status === 'playing') screen = liveView();
    else if (run.status === 'reward') screen = rewardView();
    else screen = endView();
    root.replaceChildren(screen.node || screen);
    if (screen.canvas) startLive(screen.canvas, screen.refs);
    if (screen.attract) startAttract(screen.attract);
    if (focus === 'stage' && screen.refs?.stage) screen.refs.stage.focus({ preventScroll: true });
    else if (focus === 'first') root.querySelector('.girder-start:not(:disabled), .girder-relic-card, .girder-rest-button:not(:disabled), button:not(:disabled)')?.focus({ preventScroll: true });
  }

  /* ── Run flow ── */

  function endRun(current, status) {
    if (current.status === 'dead' || current.status === 'won') return;
    const previous = loadBest();
    current.status = status;
    current.hearts = Math.max(0, current.hearts);
    current.finalScore = current.score + current.hearts * 100 + current.coins * 5 + current.relics.length * 50;
    current.newBest = current.finalScore > (previous.score || 0);
    saveBest({
      score: Math.max(previous.score || 0, current.finalScore),
      depth: Math.max(previous.depth || 0, current.depth + 1),
      wins: (previous.wins || 0) + (status === 'won' ? 1 : 0),
    });
    log(current, status === 'won' ? 'the tower is yours' : 'the tower takes you');
  }

  function clearFloor(rt) {
    if (!run || run.status !== 'playing') return;
    const score = 250 + run.depth * 50, coins = 3 + run.depth;
    run.score += score;
    run.coins += coins;
    run.clearReward = { score, coins };
    burst(rt, rt.plan.exit.x, rt.plan.exit.y + 10, 18, '#ecc981');
    log(run, `floor cleared · +${coins} coins`);
    if (run.depth + 1 >= FLOOR_COUNT) {
      endRun(run, 'won');
      save();
      paintHud(rt.refs); paintLog(rt.refs);
      transition();
      return;
    }
    run.status = 'reward';
    run.choices = drawRelics(run, 3);
    save();
    paintHud(rt.refs); paintLog(rt.refs);
    transition();
  }

  function applyRelic(id) {
    if (id === 'iron-heart') {
      run.maxHearts += 1;
      run.hearts = Math.min(run.maxHearts, run.hearts + 1);
    }
  }

  function startFloor(current, depth) {
    current.depth = depth;
    current.floor = createFloorPlan(depth, current.seed);
    current.status = 'playing';
    current.clearReward = null;
    current.choices = [];
    log(current, `depth ${depth + 1} · ${current.floor.name}`);
    if (current.floor.omen) log(current, `${current.floor.omen.name} · ${current.floor.omen.desc}`);
    save();
  }

  function begin() {
    const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    run = {
      v: 1, seed, depth: 0, status: 'playing', floor: null, hearts: START_HEARTS, maxHearts: START_HEARTS,
      coins: 0, score: 0, relics: [], choices: [], log: [], started: Date.now(),
      hits: 0, smashes: 0, secondWindUsed: false, finalScore: 0, newBest: false, clearReward: null,
    };
    feedback = '';
    startFloor(run, 0);
    render('stage');
  }

  function chooseRelic(id) {
    if (!run || run.status !== 'reward') return;
    const item = relic(id);
    if (!item) return;
    run.relics.push(id);
    applyRelic(id);
    log(run, `you take ${item.name.toLowerCase()}`);
    feedback = '';
    startFloor(run, run.depth + 1);
    render('stage');
  }

  function descend() {
    if (!run || run.status !== 'reward') return;
    feedback = '';
    startFloor(run, run.depth + 1);
    render('stage');
  }

  async function rest() {
    if (!run || run.status !== 'reward') return;
    if (run.hearts >= run.maxHearts) { feedback = 'Your hearts are full.'; render('first'); return; }
    if (run.coins < REST_COST) { feedback = `Resting costs ${REST_COST} coins.`; render('first'); return; }
    run.coins -= REST_COST;
    run.hearts++;
    feedback = 'You rest. +1 heart.';
    save();
    render('first');
  }

  async function abandon() {
    if (!run) return;
    paused = true;
    let ok = false;
    try { ok = await confirmBox('Abandon this run?', 'abandon'); } catch { ok = false; }
    paused = false;
    if (!ok) return;
    try { storage.removeItem(RUN_KEY); } catch { /* nothing else to clear */ }
    run = null;
    feedback = '';
    render('first');
  }

  /* ── Live game ── */

  function burst(rt, x, y, count, color) {
    for (let i = 0; i < count; i++) {
      rt.particles.push({
        x, y, vx: (Math.random() * 2 - 1) * 46, vy: (Math.random() * 2 - 1) * 46 - 16,
        life: .32 + Math.random() * .3, max: .62, color, size: 1 + Math.floor(Math.random() * 2),
      });
    }
  }

  function findLadder(rt, up, down) {
    const p = rt.player, center = p.x + p.w / 2, feet = p.y + p.h;
    let best = null, bestDistance = 8;
    for (const ladder of rt.plan.ladders) {
      const x = ladder.col * TILE + TILE / 2, distance = Math.abs(center - x);
      if (distance > 7) continue;
      const top = ladder.topRow * TILE, bottom = ladder.bottomRow * TILE;
      if (feet < top - 2 || p.y > bottom + 2) continue;
      if (up && feet > top + 2) { if (distance < bestDistance) { best = ladder; bestDistance = distance; } }
      if (down && feet < bottom - 2) { if (distance < bestDistance) { best = ladder; bestDistance = distance; } }
    }
    return best;
  }

  function groundedAt(plan, player) {
    const feet = player.y + player.h;
    return plan.platforms.some(platform => Math.abs(feet - platform.row * TILE) <= 1.5 && onSegments(platform.segments, player.x + player.w / 2));
  }

  function bigFall(rt, distance) {
    if (rt.plan.softFall && !rt.plan.softFallUsed) {
      rt.plan.softFallUsed = true;
      toast('sure footing · fall absorbed', rt.refs);
      log(run, 'sure footing · the fall is free'); save(); paintLog(rt.refs); return;
    }
    if (has(run, 'feather') && !rt.plan.featherUsed) {
      rt.plan.featherUsed = true;
      toast('feather fall · drop absorbed', rt.refs);
      log(run, 'feather fall · the drop is free'); save(); paintLog(rt.refs); return;
    }
    hurt(rt, 'fall');
  }

  function hurt(rt, source) {
    const p = rt.player;
    if (p.invuln > 0) return false;
    if (has(run, 'hard-hat') && !rt.plan.hardHatUsed) {
      rt.plan.hardHatUsed = true;
      p.invuln = 1.4;
      toast('hard hat · hit absorbed', rt.refs);
      log(run, 'hard hat holds · the hit is free'); save(); paintLog(rt.refs); return true;
    }
    run.hearts--;
    run.hits = (run.hits || 0) + 1;
    p.invuln = 1.7;
    p.vy = -130;
    p.climbing = null;
    p.grounded = false;
    p.vx = (p.facing > 0 ? -1 : 1) * 60;
    p.fallFrom = p.y;
    rt.shake = .3;
    burst(rt, p.x + p.w / 2, p.y + p.h / 2, 9, '#efa58e');
    log(run, source === 'fire' ? 'fireball · −1 heart' : source === 'fall' ? 'long fall · −1 heart' : 'barrel · −1 heart');
    if (run.hearts <= 0) {
      if (has(run, 'second-wind') && !run.secondWindUsed) {
        run.secondWindUsed = true;
        run.hearts = 1;
        toast('second wind · you climb on', rt.refs);
        log(run, 'second wind · you climb on');
      } else {
        endRun(run, 'dead');
        save(); paintHud(rt.refs); paintLog(rt.refs);
        transition();
        return true;
      }
    }
    save(); paintHud(rt.refs); paintLog(rt.refs);
    return true;
  }

  function smash(rt, x, y, type) {
    run.coins += 2;
    run.score += type === 'fireball' ? 25 : 20;
    run.smashes = (run.smashes || 0) + 1;
    burst(rt, x, y, 8, type === 'fireball' ? '#efa58e' : '#ecc981');
    rt.shake = Math.max(rt.shake, .12);
    if (Math.random() < .35) toast(type === 'fireball' ? 'fireball out · +2 coins' : 'barrel smashed · +2 coins', rt.refs);
    save(); paintHud(rt.refs);
  }

  function jevThrow(rt) {
    const loadout = readLoadout(run, rt.plan);
    const decision = jevDecide({
      run,
      floor: rt.plan,
      player: {
        x: rt.player.x, y: rt.player.y, w: rt.player.w, h: rt.player.h,
        vx: rt.player.vx, vy: rt.player.vy, grounded: rt.player.grounded,
        climbing: Boolean(rt.player.climbing), climbCol: rt.player.climbing?.col,
        invuln: rt.player.invuln,
      },
      loadout,
      barrelCount: rt.barrels.length,
      hammerTimer: rt.hammerTimer,
      random: rt.jev.random,
    });
    rt.jev.lastIntent = decision.intent;
    rt.jev.lastDecision = decision;
    rt.jev.throws++;
    return decision;
  }

  function remoteContext(rt) {
    const floor = rt.plan, loadout = readLoadout(run, floor);
    return {
      game: JEV_GAME,
      screen: { width: W, height: H },
      depth: run.depth + 1,
      name: floor.name,
      style: floor.throws?.id || 'steady',
      styleDescription: floor.throws?.desc,
      barrelInterval: floor.barrel.interval,
      ladders: floor.ladders.map(ladder => ({ col: ladder.col, topRow: ladder.topRow })),
      exitCol: floor.exit.col,
      gaps: floor.gaps,
      player: {
        x: Math.round(rt.player.x), y: Math.round(rt.player.y),
        vx: Math.round(rt.player.vx), vy: Math.round(rt.player.vy),
        grounded: rt.player.grounded, climbing: Boolean(rt.player.climbing),
        climbCol: rt.player.climbing?.col ?? null, invulnerable: rt.player.invuln > 0,
      },
      hearts: run.hearts, maxHearts: run.maxHearts, coins: run.coins,
      hammer: Math.max(0, Math.round(rt.hammerTimer * 10) / 10),
      capabilities: loadout,
      relics: [...run.relics],
      relicInfo: run.relics.map(id => {
        const item = relic(id);
        return item ? { id, name: item.name, effect: item.desc, capabilities: RELIC_CAPS[id] } : null;
      }).filter(Boolean),
      flags: {
        hardHatUsed: Boolean(floor.hardHatUsed), featherUsed: Boolean(floor.featherUsed),
        softFallUsed: Boolean(floor.softFallUsed), secondWindUsed: Boolean(run.secondWindUsed),
      },
      barrels: rt.barrels.length,
    };
  }

  async function askJevDirect(key, context, signal) {
    const response = await fetch(JEV_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + key,
        'HTTP-Referer': location.origin,
        'X-Title': 'Pocket Girder Run',
      },
      body: JSON.stringify({
        model: JEV_MODEL,
        state: context,
        questions: jevQuestions(context.ladders),
      }),
      signal,
    });
    if (!response.ok) throw Object.assign(new Error('OpenRouter rejected Jev.'), { status: response.status });
    const payload = await response.json();
    const decision = jevDecisionFromResponse(payload, context.ladders, context.barrelInterval || 2);
    if (!decision) throw new Error('Jev returned no decision.');
    return { decision, model: payload?.model || JEV_MODEL };
  }

  async function requestRemoteJev(rt) {
    const remote = rt.jev.remote;
    if (!remote || remote.state === 'off' || remote.pending || remote.queue.length) return;
    if (performance.now() < remote.nextTry) return;
    if (!run || run.status !== 'playing' || !rt.canvas.isConnected) return;
    remote.pending = true;
    if (remote.state !== 'on') remote.state = 'asking';
    const controller = new AbortController();
    rt.remoteController = controller;
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const access = await resolveProviderKey(OPENROUTER);
      if (controller.signal.aborted) return;
      if (!access) {
        remote.state = 'off';
        remote.lastError = 'no key';
        remote.nextTry = performance.now() + 1e9;
        return;
      }
      const context = remoteContext(rt);
      let result;
      if (access.key) {
        result = await askJevDirect(access.key, context, controller.signal);
      } else if (access.relay) {
        const response = await fetch('/api/girder/jev', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(context),
          signal: controller.signal,
        });
        if (!response.ok) throw Object.assign(new Error('JEV relay failed.'), { status: response.status });
        const payload = await response.json();
        if (!payload?.decision) throw new Error('JEV relay sent no decision.');
        result = { decision: payload.decision, model: payload.model || JEV_MODEL };
      } else {
        remote.state = 'off';
        remote.lastError = 'no key';
        remote.nextTry = performance.now() + 1e9;
        return;
      }
      if (rt !== runtime) return;
      const decision = result.decision;
      if (!decision || ![-1, 1].includes(Number(decision.hand)) || !['normal', 'wild', 'ladder'].includes(decision.kind)) {
        throw new Error('bad remote decision');
      }
      remote.queue = [{
        hand: Number(decision.hand),
        kind: decision.kind,
        dropCol: Number.isInteger(Number(decision.dropCol)) ? Math.max(0, Math.min(19, Number(decision.dropCol))) : null,
        double: Boolean(decision.double),
        delay: Math.max(1, Math.min(3.8, Number(decision.delay) || rt.plan.barrel.interval)),
        intent: String(decision.intent || 'remote throw').replace(/\s+/g, ' ').trim().slice(0, 64),
        confidence: decision.confidence || null,
        at: performance.now(),
      }];
      remote.state = 'on';
      remote.model = result.model || JEV_MODEL;
      remote.failures = 0;
      remote.lastError = '';
    } catch (error) {
      if (rt !== runtime) return;
      remote.failures++;
      const status = Number(error?.status);
      remote.state = [400, 401, 402, 403, 404, 429].includes(status) ? 'off' : 'degraded';
      remote.lastError = status === 401 || status === 403 ? 'key' : 'unreachable';
      remote.nextTry = performance.now() + (remote.state === 'off' ? 1e9 : 8000);
    } finally {
      clearTimeout(timer);
      if (rt.remoteController === controller) rt.remoteController = null;
      if (rt === runtime) remote.pending = false;
    }
  }

  function nextThrow(rt) {
    const remote = rt.jev.remote;
    const candidate = remote.queue.shift();
    let decision = candidate && performance.now() - candidate.at < 3000 ? candidate : null;
    if (decision) {
      rt.jev.source = 'remote';
      rt.jev.lastIntent = decision.intent;
      rt.jev.lastDecision = decision;
      if (decision.kind === 'ladder' && !Number.isInteger(decision.dropCol)) decision.dropCol = 10;
    } else {
      rt.jev.source = 'local';
      decision = jevThrow(rt);
    }
    requestRemoteJev(rt);
    return decision;
  }

  function spawnBarrel(rt, decision = null) {
    if (rt.barrels.length >= 18) return;
    const choice = decision || jevThrow(rt);
    const top = PLATFORM_ROWS[0] * TILE;
    const hand = choice.hand || 1;
    const barrel = {
      x: rt.plan.keeper.x + (hand < 0 ? -20 : 8), y: top - BARREL_H,
      row: PLATFORM_ROWS[0], dir: hand, state: 'roll', vy: 0,
      w: BARREL_W, h: BARREL_H, age: 0, spin: 0,
      wild: choice.kind === 'wild', wildDropped: false,
    };
    if (choice.kind === 'ladder') {
      const col = choice.dropCol ?? 10;
      barrel.x = col * TILE + TILE / 2 - BARREL_W / 2;
      barrel.y = top - 28;
      barrel.state = 'fall';
      barrel.wild = false;
    }
    rt.barrels.push(barrel);
    rt.throwFlash = .3;
  }

  function updatePlayer(rt, dt) {
    const p = rt.player, plan = rt.plan, keys = rt.keys;
    p.coyote = Math.max(0, p.coyote - dt);
    rt.jumpBuffer = Math.max(0, rt.jumpBuffer - dt);
    if (p.climbing) {
      const ladder = p.climbing;
      p.x = ladder.col * TILE + TILE / 2 - p.w / 2;
      p.vx = 0; p.vy = 0;
      p.anim += dt;
      if (rt.jumpBuffer > 0) {
        p.climbing = null;
        p.grounded = false;
        p.vy = -JUMP_SPEED * 1.02;
        p.jumps = 1;
        p.fallFrom = p.y;
        rt.jumpBuffer = 0;
        return;
      }
      const speed = CLIMB_SPEED * (has(run, 'gloves') ? 1.35 : 1);
      if (keys.up) p.y -= speed * dt;
      if (keys.down) p.y += speed * dt;
      const top = ladder.topRow * TILE, bottom = ladder.bottomRow * TILE;
      if (p.y + p.h <= top) { p.y = top - p.h; p.climbing = null; p.grounded = true; p.jumps = 0; p.fallFrom = p.y; }
      else if (p.y + p.h >= bottom) { p.y = bottom - p.h; p.climbing = null; p.grounded = true; p.jumps = 0; p.fallFrom = p.y; }
      else p.y = Math.max(top - p.h, Math.min(bottom - p.h, p.y));
      return;
    }

    const speed = RUN_SPEED * (has(run, 'quick-feet') ? 1.15 : 1);
    const direction = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    p.vx = direction * speed;
    if (direction) { p.facing = direction; p.anim += dt; } else p.anim = 0;
    p.x = Math.max(0, Math.min(W - p.w, p.x + p.vx * dt));

    if (keys.up || keys.down) {
      const ladder = findLadder(rt, keys.up, keys.down);
      if (ladder) {
        p.climbing = ladder;
        p.x = ladder.col * TILE + TILE / 2 - p.w / 2;
        p.vx = 0; p.vy = 0; p.grounded = false; p.jumps = 0; p.fallFrom = p.y;
        return;
      }
    }

    if (rt.jumpBuffer > 0) {
      const spring = has(run, 'spring-boots') ? 1.18 : 1;
      if (p.grounded || p.coyote > 0) {
        p.vy = -JUMP_SPEED * spring;
        p.grounded = false; p.coyote = 0; p.jumps = 1; p.fallFrom = p.y;
        rt.jumpBuffer = 0;
        burst(rt, p.x + p.w / 2, p.y + p.h, 3, '#ecc981');
      } else if (has(run, 'double-jump') && p.jumps < 2) {
        p.vy = -JUMP_SPEED * 1.02 * spring;
        p.jumps = 2; p.fallFrom = p.y;
        rt.jumpBuffer = 0;
        burst(rt, p.x + p.w / 2, p.y + p.h, 5, '#a5bfdc');
      }
    }

    p.vy = Math.min(MAX_FALL, p.vy + GRAVITY * dt);
    moveVertical(rt, dt);
    if (p.grounded) {
      p.jumps = 0;
      if (!groundedAt(plan, p)) { p.grounded = false; p.coyote = COYOTE; p.fallFrom = p.y; }
    }
  }

  function moveVertical(rt, dt) {
    const p = rt.player, plan = rt.plan;
    const previousTop = p.y, previousBottom = p.y + p.h;
    p.y += p.vy * dt;
    if (p.vy >= 0) {
      let landing = null;
      for (const platform of plan.platforms) {
        const surface = platform.row * TILE;
        if (previousBottom <= surface + 2 && p.y + p.h >= surface && onSegments(platform.segments, p.x + p.w / 2)) {
          if (landing === null || surface < landing) landing = surface;
        }
      }
      if (landing !== null) {
        const drop = landing - (p.fallFrom + p.h);
        p.y = landing - p.h; p.vy = 0; p.grounded = true; p.jumps = 0; p.coyote = 0;
        if (drop > 52) bigFall(rt, drop);
        p.fallFrom = p.y;
        return;
      }
      if (p.grounded) { p.grounded = false; p.coyote = COYOTE; p.fallFrom = p.y; }
    } else {
      let underside = null;
      for (const platform of plan.platforms) {
        const bottom = platform.row * TILE + 5;
        if (previousTop >= bottom && p.y < bottom && onSegments(platform.segments, p.x + p.w / 2)) {
          if (underside === null || bottom < underside) underside = bottom;
        }
      }
      if (underside !== null) { p.y = underside; p.vy = 0; }
    }
  }

  function updateBarrels(rt, dt) {
    const speed = rt.plan.barrel.speed * (has(run, 'slow-barrels') ? .8 : 1) * (has(run, 'greedy') ? 1.12 : 1);
    for (let i = rt.barrels.length - 1; i >= 0; i--) {
      const barrel = rt.barrels[i];
      barrel.age += dt;
      if (!moveBarrel(rt.plan, barrel, dt, speed)) { rt.barrels.splice(i, 1); continue; }
      if (barrel.wild && !barrel.wildDropped && barrel.state === 'roll') {
        const center = barrel.x + BARREL_W / 2;
        const ladder = rt.plan.ladders.find(item => item.topRow === barrel.row && Math.abs(item.col * TILE + TILE / 2 - center) < 6);
        if (ladder) {
          barrel.state = 'fall'; barrel.vy = 0; barrel.wildDropped = true;
          burst(rt, center, barrel.y + 6, 3, '#a5bfdc');
        }
      }
      if (barrel.age <= .28 || !overlap(rt.player, barrel)) continue;
      if (rt.hammerTimer > 0) { smash(rt, barrel.x, barrel.y, 'barrel'); rt.barrels.splice(i, 1); continue; }
      if (rt.player.y + rt.player.h <= barrel.y + 3) continue;
      if (hurt(rt, 'barrel')) {
        rt.barrels.splice(i, 1);
        if (!run || run.status !== 'playing') return;
      }
    }
  }

  function updateFireballs(rt, dt) {
    const speed = 40 + rt.plan.depth * 2;
    const p = rt.player;
    for (let i = rt.fireballs.length - 1; i >= 0; i--) {
      const fireball = rt.fireballs[i];
      const platform = rt.plan.platforms.find(item => item.row === fireball.row);
      let next = fireball.x + fireball.dir * speed * dt;
      if (!platform || !onSegments(platform.segments, next + FIRE_W / 2)) {
        fireball.dir *= -1;
        next = fireball.x + fireball.dir * speed * dt;
      }
      fireball.x = next;
      const rect = { x: fireball.x, y: fireball.row * TILE - FIRE_H, w: FIRE_W, h: FIRE_H };
      if (!overlap(p, rect)) continue;
      if (rt.hammerTimer > 0) { smash(rt, rect.x, rect.y, 'fireball'); rt.fireballs.splice(i, 1); continue; }
      if (hurt(rt, 'fire') && (!run || run.status !== 'playing')) return;
    }
  }

  function updatePickups(rt, dt) {
    const p = rt.player, centerX = p.x + p.w / 2, centerY = p.y + p.h / 2;
    for (const coin of rt.plan.coins) {
      if (coin.taken) continue;
      if (has(run, 'magnet')) {
        const dx = centerX - coin.x, dy = centerY - coin.y, distance = Math.hypot(dx, dy);
        if (distance < 36 && distance > 1) { coin.x += dx / distance * 70 * dt; coin.y += dy / distance * 70 * dt; }
      }
      if (Math.abs(centerX - coin.x) < 9 && Math.abs(centerY - coin.y) < 11) {
        coin.taken = true;
        const value = 1 + (has(run, 'lucky-pockets') ? 1 : 0) + (has(run, 'greedy') ? 1 : 0) + (has(run, 'gambler') && Math.random() < .25 ? 2 : 0);
        run.coins += value;
        run.score += 10;
        burst(rt, coin.x, coin.y, 5, '#ecc981');
        save(); paintHud(rt.refs);
      }
    }
    const hammer = rt.plan.hammer;
    if (hammer && !hammer.taken && Math.abs(centerX - hammer.x) < 11 && Math.abs(centerY - hammer.y) < 13) {
      hammer.taken = true;
      rt.hammerTimer = 7;
      toast('hammer up · 7 seconds', rt.refs);
      log(run, 'hammer up · barrels break');
      save(); paintLog(rt.refs);
    }
  }

  function updateParticles(rt, dt) {
    for (let i = rt.particles.length - 1; i >= 0; i--) {
      const particle = rt.particles[i];
      particle.life -= dt;
      if (particle.life <= 0) { rt.particles.splice(i, 1); continue; }
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += 120 * dt;
    }
  }

  function update(rt, dt) {
    if (!run || run.status !== 'playing' || paused) return;
    rt.player.invuln = Math.max(0, rt.player.invuln - dt);
    rt.shake = Math.max(0, rt.shake - dt);
    rt.throwFlash = Math.max(0, rt.throwFlash - dt);
    if (rt.hammerTimer > 0) rt.hammerTimer = Math.max(0, rt.hammerTimer - dt);
    if (rt.secondThrow > 0) {
      rt.secondThrow -= dt;
      if (rt.secondThrow <= 0) spawnBarrel(rt, nextThrow(rt));
    }
    rt.spawnTimer -= dt;
    if (rt.spawnTimer <= 0) {
      const decision = nextThrow(rt);
      spawnBarrel(rt, decision);
      rt.spawnTimer = decision.delay;
      if (decision.double) rt.secondThrow = .26;
    }
    updatePlayer(rt, dt);
    if (!run || run.status !== 'playing') return;
    updateBarrels(rt, dt);
    if (!run || run.status !== 'playing') return;
    updateFireballs(rt, dt);
    if (!run || run.status !== 'playing') return;
    updatePickups(rt, dt);
    updateParticles(rt, dt);
    if (!run || run.status !== 'playing') return;
    const door = { x: rt.plan.exit.x - 8, y: rt.plan.exit.y, w: 16, h: 24 };
    if (!rt.player.climbing && overlap(rt.player, door)) { clearFloor(rt); return; }
    if (rt.player.y > H + 24) {
      hurt(rt, 'fall');
      if (run && run.status === 'playing') {
        rt.player.x = 24;
        rt.player.y = PLATFORM_ROWS[PLATFORM_ROWS.length - 1] * TILE - PLAYER_H;
        rt.player.vx = 0; rt.player.vy = 0; rt.player.grounded = true; rt.player.fallFrom = rt.player.y; rt.player.invuln = 1.4;
      }
    }
  }

  function jevReadout(rt) {
    const loadout = readLoadout(run, rt.plan), p = rt.player, reads = [];
    const progress = 1 - p.y / (H - 16);
    reads.push(p.climbing ? 'climbing' : p.grounded ? 'on steel' : 'airborne');
    reads.push(`${Math.round(p.x)},${Math.round(p.y)}`);
    reads.push(progress > .64 ? 'top third' : progress > .3 ? 'middle' : 'bottom');
    reads.push(`${run.hearts}/${run.maxHearts} hearts`);
    if (rt.hammerTimer > 0) reads.push(`hammer ${Math.ceil(rt.hammerTimer)}s`);
    if (loadout.airJumps) reads.push('double jump');
    if (loadout.jump > 1.05) reads.push('spring jump');
    if (loadout.climb > 1.05) reads.push('fast climb');
    if (loadout.freeHit && !loadout.freeHitUsed) reads.push('free hit');
    if (loadout.secondWind && !loadout.secondWindUsed) reads.push('second wind');
    if (loadout.freeFall && !loadout.freeFallUsed) reads.push('safe fall');
    if (loadout.coinFocus) reads.push('coin-hungry');
    return reads.join(' · ');
  }

  function paintJev(rt) {
    if (!rt.refs?.jevRead) return;
    const remote = rt.jev.remote.state;
    const name = JEV_MODEL.split('/').pop();
    const last = rt.jev.source === 'remote' ? `last · openrouter · ${name}` : 'last · local';
    const availability = remote === 'on' ? `${name} ready`
      : remote === 'asking' ? `asking ${name}…`
        : remote === 'degraded' ? 'remote unavailable'
          : remote === 'off' ? 'add key in Pip' : 'local only';
    rt.refs.jevRead.textContent = jevReadout(rt);
    rt.refs.jevIntent.textContent = 'intent · ' + rt.jev.lastIntent;
    rt.refs.jevSource.textContent = last + ' · ' + availability;
    if (rt.refs.jevConnect) rt.refs.jevConnect.hidden = !(remote === 'off' || remote === 'degraded');
  }

  function startLive(canvas, refs) {
    if (!run || run.status !== 'playing') return;
    const player = {
      x: 24, y: PLATFORM_ROWS[PLATFORM_ROWS.length - 1] * TILE - PLAYER_H,
      w: PLAYER_W, h: PLAYER_H, vx: 0, vy: 0, grounded: true, facing: 1,
      climbing: null, jumps: 0, coyote: 0, invuln: 1.1, fallFrom: 0, anim: 0,
    };
    player.fallFrom = player.y;
    const rt = {
      run, plan: run.floor, canvas, refs, player,
      barrels: [], fireballs: (run.floor.fireballs || []).map(item => ({ ...item, w: FIRE_W, h: FIRE_H })),
      particles: [], keys: { left: false, right: false, up: false, down: false, jump: false },
      jumpBuffer: 0, spawnTimer: 1.5, secondThrow: 0, hammerTimer: 0, throwFlash: 0, shake: 0,
      jev: {
        random: mulberry32((run.seed ^ Math.imul(run.depth + 1, 0x85ebca6b)) >>> 0),
        side: 1, throws: 0, source: 'local', lastIntent: 'watching', lastDecision: null, nextPaint: 0,
        remote: { state: 'unknown', pending: false, queue: [], failures: 0, nextTry: 0, lastError: '' },
      },
      remoteController: null,
      last: performance.now(), raf: 0,
    };
    runtime = rt;
    controller = new AbortController();
    const signal = controller.signal;
    const keyDown = event => {
      if (!run || run.status !== 'playing' || !canvas.isConnected) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key;
      if (key === 'ArrowLeft' || key === 'a' || key === 'A') { rt.keys.left = true; event.preventDefault(); event.stopPropagation(); }
      else if (key === 'ArrowRight' || key === 'd' || key === 'D') { rt.keys.right = true; event.preventDefault(); event.stopPropagation(); }
      else if (key === 'ArrowUp' || key === 'w' || key === 'W') { rt.keys.up = true; event.preventDefault(); event.stopPropagation(); }
      else if (key === 'ArrowDown' || key === 's' || key === 'S') { rt.keys.down = true; event.preventDefault(); event.stopPropagation(); }
      else if (key === ' ' || key === 'Spacebar' || key === 'z' || key === 'Z') {
        event.preventDefault(); event.stopPropagation();
        if (!rt.keys.jump) rt.jumpBuffer = .14;
        rt.keys.jump = true;
      }
    };
    const keyUp = event => {
      const key = event.key;
      if (key === 'ArrowLeft' || key === 'a' || key === 'A') rt.keys.left = false;
      else if (key === 'ArrowRight' || key === 'd' || key === 'D') rt.keys.right = false;
      else if (key === 'ArrowUp' || key === 'w' || key === 'W') rt.keys.up = false;
      else if (key === 'ArrowDown' || key === 's' || key === 'S') rt.keys.down = false;
      else if (key === ' ' || key === 'Spacebar' || key === 'z' || key === 'Z') {
        rt.keys.jump = false;
        if (rt.player.vy < 0) rt.player.vy *= .5;
      }
    };
    document.addEventListener('keydown', keyDown, { signal });
    document.addEventListener('keyup', keyUp, { signal });
    const bind = (selector, key) => {
      const button = refs.node?.querySelector?.(selector) || root.querySelector(selector);
      if (!button) return;
      const down = event => {
        event.preventDefault();
        if (key === 'jump') { rt.jumpBuffer = .14; rt.keys.jump = true; }
        else rt.keys[key] = true;
        button.classList.add('held');
      };
      const up = event => {
        event.preventDefault();
        if (key === 'jump') { rt.keys.jump = false; if (rt.player.vy < 0) rt.player.vy *= .5; }
        else rt.keys[key] = false;
        button.classList.remove('held');
      };
      button.addEventListener('pointerdown', down, { signal });
      button.addEventListener('pointerup', up, { signal });
      button.addEventListener('pointercancel', up, { signal });
      button.addEventListener('pointerleave', up, { signal });
    };
    bind('[data-move="left"]', 'left'); bind('[data-move="right"]', 'right');
    bind('[data-move="up"]', 'up'); bind('[data-move="down"]', 'down');
    bind('[data-move="jump"]', 'jump');
    paintHud(refs); paintLog(refs);
    refs.stage.focus({ preventScroll: true });
    requestRemoteJev(rt);
    if (import.meta.env.DEV) {
      canvas.girderDebug = {
        get run() { return run; },
        get player() { return rt.player; },
        get plan() { return rt.plan; },
        get barrels() { return rt.barrels; },
        teleport(x, y) { rt.player.x = x; rt.player.y = y; rt.player.vx = 0; rt.player.vy = 0; },
        hurt() { return hurt(rt, 'test'); },
        clear() { clearFloor(rt); },
        get jev() { return rt.jev; },
        warp(depth) { if (Number.isInteger(depth) && depth >= 0 && depth < FLOOR_COUNT) { startFloor(run, depth); render('stage'); } },
        keys(value) { if (value) Object.assign(rt.keys, value); return { ...rt.keys }; },
        jump() { rt.jumpBuffer = .15; },
        step(seconds = .033, times = 1) {
          for (let i = 0; i < times && canvas.isConnected && run.status === 'playing'; i++) update(rt, seconds);
          if (canvas.isConnected) {
            drawWorld(canvas.getContext('2d'), rt.plan, {
              player: rt.player, barrels: rt.barrels, fireballs: rt.fireballs, particles: rt.particles,
              hammerTimer: rt.hammerTimer, shake: rt.shake, throwFlash: rt.throwFlash,
            }, performance.now() / 1000);
            paintJev(rt);
          }
        },
      };
    }
    const frame = now => {
      if (!canvas.isConnected) { stopGame(); return; }
      const dt = Math.min(.034, Math.max(0, (now - rt.last) / 1000));
      rt.last = now;
      if (!document.hidden) update(rt, dt);
      if (now > rt.jev.nextPaint) {
        rt.jev.nextPaint = now + 350;
        paintJev(rt);
      }
      drawWorld(canvas.getContext('2d'), rt.plan, {
        player: rt.player, barrels: rt.barrels, fireballs: rt.fireballs, particles: rt.particles,
        hammerTimer: rt.hammerTimer, shake: rt.shake, throwFlash: rt.throwFlash,
      }, now / 1000);
      if (run && run.status === 'playing' && canvas.isConnected) rt.raf = requestAnimationFrame(frame);
    };
    rt.raf = requestAnimationFrame(frame);
  }

  /* ── Attract mode on the landing screen ── */

  function startAttract(canvas) {
    const plan = createFloorPlan(3, 0xBEEF);
    const demo = {
      player: { x: 30, y: PLATFORM_ROWS[PLATFORM_ROWS.length - 1] * TILE - PLAYER_H, w: PLAYER_W, h: PLAYER_H, vx: 0, vy: 0, grounded: true, facing: 1, climbing: null, jumps: 0, anim: 0, invuln: 0, fallFrom: 0 },
      barrels: [], fireballs: plan.fireballs.map(item => ({ ...item, w: FIRE_W, h: FIRE_H })),
      particles: [], hammerTimer: 0, shake: 0, throwFlash: 0,
    };
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      demo.barrels = [{ x: 78, y: PLATFORM_ROWS[0] * TILE - BARREL_H, dir: -1, state: 'roll', row: PLATFORM_ROWS[0], vy: 0, spin: 0 }, { x: 150, y: 8 * TILE - BARREL_H, dir: 1, state: 'roll', row: 8, vy: 0, spin: 0 }];
      drawWorld(canvas.getContext('2d'), plan, demo, 0);
      return;
    }
    let last = performance.now(), spawn = .7, time = 0;
    const frame = now => {
      if (!canvas.isConnected) { attractRaf = 0; return; }
      const dt = Math.min(.05, Math.max(0, (now - last) / 1000));
      last = now; time += dt;
      spawn -= dt;
      if (spawn <= 0) {
        spawn = 1.5;
        demo.barrels.push({ x: plan.keeper.x - 6, y: PLATFORM_ROWS[0] * TILE - BARREL_H, row: PLATFORM_ROWS[0], dir: Math.random() < .5 ? -1 : 1, state: 'roll', vy: 0, spin: 0 });
        demo.throwFlash = .3;
      }
      demo.throwFlash = Math.max(0, demo.throwFlash - dt);
      for (let i = demo.barrels.length - 1; i >= 0; i--) {
        if (!moveBarrel(plan, demo.barrels[i], dt, plan.barrel.speed)) demo.barrels.splice(i, 1);
      }
      demo.player.x = 32 + Math.sin(time * .7) * 18;
      demo.player.facing = Math.cos(time * .7) >= 0 ? 1 : -1;
      demo.player.anim = time * 2;
      drawWorld(canvas.getContext('2d'), plan, demo, time);
      attractRaf = requestAnimationFrame(frame);
    };
    attractRaf = requestAnimationFrame(frame);
  }

  const leave = () => {
    if (location.hash.startsWith('#/girder')) return;
    stopGame();
    stopAttract();
    removeEventListener('hashchange', leave);
  };
  addEventListener('hashchange', leave);
  render('none');
}

export function girderSummary() {
  const run = loadRun();
  if (!run) return { value: `0/${FLOOR_COUNT}`, detail: 'Begin a run', status: 'arcade', alert: false };
  if (run.status === 'playing') return { value: `${run.depth + 1}/${FLOOR_COUNT}`, detail: `${run.hearts} hearts · ${run.coins} coins`, status: 'depth', alert: run.hearts <= 1 };
  if (run.status === 'reward') return { value: `${run.depth + 1}/${FLOOR_COUNT}`, detail: `${run.hearts} hearts · camp`, status: `${run.coins} coins`, alert: run.hearts <= 1 };
  if (run.status === 'won') return { value: 'won', detail: `${number(run.finalScore)} pts`, status: 'escaped', alert: false };
  return { value: 'dead', detail: `${number(run.finalScore)} pts`, status: `depth ${run.depth + 1}`, alert: false };
}
