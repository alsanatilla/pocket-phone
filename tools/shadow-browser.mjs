// Browser check for Shadow Protocol. Run the dev server first (port in SHADOW_URL,
// default 8890; JEV_MOCK=1 exercises the relay with deterministic mock orders), then:
//   PLAYWRIGHT_MODULE=.../playwright/index.mjs node tools/shadow-browser.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.SHADOW_URL || 'http://127.0.0.1:8890';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1360, height: 960 } });
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text()); });
const missing = [];
page.on('response', response => { if (response.status() === 404) missing.push(response.url()); });
page.setDefaultTimeout(15000);
const report = 'app/build/reports/shadow-web';
await mkdir(report, { recursive: true });
const debug = () => page.evaluate(() => !!document.querySelector('.shadow-canvas')?.shadowDebug);
try {
  await page.goto(base + '/?jevmock#/shadow');
  await page.waitForSelector('.shadow-begin');
  await page.waitForTimeout(1500);
  assert.match(await page.locator('.shadow-brief').innerText(), /security dossier/);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${report}/briefing.png`, fullPage: true });
  console.log('PASS: briefing renders with dossier, difficulty and schematic');

  await page.getByRole('radio', { name: /hard/ }).click();
  await page.locator('.shadow-begin').click();
  await page.waitForSelector('.shadow-canvas');
  await page.waitForFunction(() => !!document.querySelector('.shadow-canvas')?.shadowDebug);
  assert.ok(await debug());
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${report}/start.png` });
  // Walk north with the keyboard for a moment.
  await page.keyboard.down('w'); await page.waitForTimeout(900); await page.keyboard.up('w');
  const moved = await page.evaluate(() => document.querySelector('.shadow-canvas').shadowDebug.sim.player.y);
  assert.ok(moved < 41 * 16, 'the player moved with the keyboard');
  const frame = await page.evaluate(() => {
    const stage = document.querySelector('.shadow-stage').getBoundingClientRect();
    return {
      immersive: document.documentElement.classList.contains('shadow-immersive'),
      bar: getComputedStyle(document.querySelector('.bar')).display,
      stage: { width: stage.width, height: stage.height },
      viewport: { width: innerWidth, height: innerHeight },
    };
  });
  assert.equal(frame.immersive, true, 'the mission takes over the page');
  assert.equal(frame.bar, 'none', 'Pocket chrome is hidden during play');
  assert.ok(Math.abs(frame.stage.width - frame.viewport.width) <= 2 && Math.abs(frame.stage.height - frame.viewport.height) <= 2, 'the stage fills the viewport');
  console.log('PASS: keyboard movement and full-window layout');

  // Drop the player into the lit corridors in front of a guard to see an alert.
  await page.evaluate(() => {
    const d = document.querySelector('.shadow-canvas').shadowDebug;
    d.sim.noCapture = true;
    const g = d.sim.guards.find(item => item.home === 'corridorA');
    d.teleport(Math.floor(g.x / 16 + Math.cos(g.facing) * 3), Math.floor(g.y / 16 + Math.sin(g.facing) * 3));
  });
  await page.waitForFunction(() => document.querySelector('.shadow-canvas').shadowDebug.sim.net.phase === 'alert', null, { timeout: 8000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${report}/alert.png` });
  assert.match(await page.locator('.shadow-phase').innerText(), /alert/i);
  console.log('PASS: a guard spots the player, radios it in and the alert phase starts');

  await page.keyboard.press('Tab');
  await page.waitForSelector('.shadow-intel:not([hidden])');
  await page.waitForTimeout(600);
  const intel = await page.locator('.shadow-intel').innerText();
  assert.match(intel, /security strategy/i);
  assert.match(intel, /heading|response/i, 'the contact decision answers are listed');
  await page.locator('.shadow-guard-row').first().click();
  await page.waitForSelector('.shadow-detail');
  await page.screenshot({ path: `${report}/intel.png` });
  console.log('PASS: intel overlay lists the strategy, the typed answers and a guard’s detail');

  // Break contact: teleport into the duct and let the search run.
  await page.evaluate(() => document.querySelector('.shadow-canvas').shadowDebug.teleport(18, 8));
  await page.evaluate(() => { const d = document.querySelector('.shadow-canvas').shadowDebug; d.sim.player.crouch = true; });
  await page.waitForFunction(() => document.querySelector('.shadow-canvas').shadowDebug.sim.net.phase === 'search', null, { timeout: 12000 });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${report}/search.png` });
  const decisions = await page.evaluate(() => document.querySelector('.shadow-canvas').shadowDebug.sim.decisions.map(d => `${d.kind}:${d.source}:${d.status}`));
  console.log('decisions', decisions.slice(0, 6).join(' | '));
  assert.ok(decisions.some(item => item.startsWith('lost')), 'losing contact asks the commander');
  console.log('PASS: contact lost → search decision');

  await page.waitForFunction(() => document.querySelector('.shadow-canvas').shadowDebug.sim.decisions.some(d => d.source === 'jev'), null, { timeout: 12000 });
  console.log('PASS: relay answers (mock Jev) replace local decisions');

  // Lethal combat: the knife is a keyboard action, leaves a body and blood.
  await page.evaluate(() => {
    const d = document.querySelector('.shadow-canvas').shadowDebug;
    if (d.state.intel) d.intel();
    d.sim.noCapture = true;
    const g = d.sim.guards.find(item => !item.down && !item.objective);
    g.x = 24 * 16 + 8; g.y = 22 * 16 + 8; g.facing = 0; g.state = 'patrol'; g.task = null; g.path = []; g.sees = false; g.meter = 0;
    g.route = [{ x: g.x, y: g.y, hold: 999, face: 0 }]; g.routeIndex = 0;
    d.sim.player.x = 23 * 16 + 8; d.sim.player.y = 22 * 16 + 8; d.sim.player.crouch = false; d.sim.player.action = null;
    d.view.snap = true;
  });
  await page.keyboard.press('x');
  await page.waitForFunction(() => document.querySelector('.shadow-canvas').shadowDebug.sim.metrics.kills > 0, null, { timeout: 5000 });
  await page.waitForTimeout(400);
  const melee = await page.evaluate(() => {
    const d = document.querySelector('.shadow-canvas').shadowDebug;
    return { kills: d.sim.metrics.kills, blood: d.sim.blood.length, ammo: d.sim.player.ammo };
  });
  assert.equal(melee.kills, 1);
  assert.ok(melee.blood > 0, 'the knife leaves blood');
  await page.screenshot({ path: `${report}/combat.png` });
  console.log('PASS: keyboard knife kill, blood and ammo pickup');

  // The pistol is a separate key and a loud action.
  await page.evaluate(() => {
    const d = document.querySelector('.shadow-canvas').shadowDebug;
    const g = d.sim.guards.find(item => !item.down && !item.objective);
    g.x = 27 * 16 + 8; g.y = 22 * 16 + 8; g.facing = Math.PI; g.state = 'patrol'; g.task = null; g.path = []; g.sees = false; g.meter = 0;
    g.route = [{ x: g.x, y: g.y, hold: 999, face: Math.PI }]; g.routeIndex = 0;
    d.sim.player.x = 24 * 16 + 8; d.sim.player.y = 22 * 16 + 8; d.sim.player.facing = 0; d.sim.player.action = null; d.sim.player.ammo = 3;
    d.view.snap = true;
  });
  await page.keyboard.press('g');
  await page.waitForFunction(() => document.querySelector('.shadow-canvas').shadowDebug.sim.metrics.shots > 0, null, { timeout: 3000 });
  const shot = await page.evaluate(() => {
    const d = document.querySelector('.shadow-canvas').shadowDebug;
    return { shots: d.sim.metrics.shots, ammo: d.sim.player.ammo, noises: d.sim.metrics.noises };
  });
  assert.equal(shot.shots, 1);
  assert.equal(shot.ammo, 2);
  assert.ok(shot.noises > 0, 'the pistol makes a loud noise');
  console.log('PASS: keyboard pistol shot and gunshot noise');

  // Mouse aim: the same knife lunge, from a pointer click rather than a key.
  const target = await page.evaluate(() => {
    const d = document.querySelector('.shadow-canvas').shadowDebug;
    const g = d.sim.guards.find(item => !item.down && !item.objective);
    g.x = 24 * 16 + 8; g.y = 22 * 16 + 8; g.facing = Math.PI; g.state = 'patrol'; g.task = null; g.path = []; g.sees = false; g.meter = 0;
    g.route = [{ x: g.x, y: g.y, hold: 999, face: Math.PI }]; g.routeIndex = 0;
    d.sim.player.x = 22 * 16 + 8; d.sim.player.y = 22 * 16 + 8; d.sim.player.facing = 0; d.sim.player.action = null;
    d.view.snap = true;
    return { x: g.x, y: g.y };
  });
  await page.waitForTimeout(300);
  const point = await page.evaluate(({ x, y }) => {
    const d = document.querySelector('.shadow-canvas').shadowDebug;
    const rect = document.querySelector('.shadow-canvas').getBoundingClientRect();
    return { x: rect.left + (x - d.view.x) / d.view.w * rect.width, y: rect.top + (y - d.view.y) / d.view.h * rect.height };
  }, target);
  const killsBefore = await page.evaluate(() => document.querySelector('.shadow-canvas').shadowDebug.sim.metrics.kills);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction(before => document.querySelector('.shadow-canvas').shadowDebug.sim.metrics.kills > before, killsBefore, { timeout: 5000 });
  console.log('PASS: mouse aim and click knife');

  for (const width of [390, 820]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(300);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no horizontal overflow at ${width}`);
    if (width === 390) {
      await page.keyboard.press('Tab');
      await page.waitForSelector('.shadow-intel:not([hidden])');
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${report}/intel-390.png`, fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'intel fits a 390 px screen');
      await page.keyboard.press('Tab');
    }
    await page.screenshot({ path: `${report}/live-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1360, height: 960 });
  console.log('PASS: 390 and 820 px layouts');

  // The pause menu is part of the play field, and aborting asks first.
  await page.keyboard.press('p');
  await page.waitForSelector('.shadow-pause:not([hidden])');
  await page.getByRole('button', { name: 'abort mission' }).click();
  await page.waitForSelector('.shadow-abort-confirm:not([hidden])');
  await page.getByRole('button', { name: 'keep playing' }).click();
  assert.equal(await page.evaluate(() => document.querySelector('.shadow-canvas').shadowDebug.state.paused), false, 'keep playing resumes the mission');
  console.log('PASS: pause menu and in-game abort confirmation');

  // Finish: carry the data to the helipad.
  await page.evaluate(() => {
    const d = document.querySelector('.shadow-canvas').shadowDebug;
    d.sim.noCapture = false; d.sim.player.data = true; d.sim.player.crouch = false; d.sim.mission.breachAt = d.sim.t; d.teleport(54, 6);
  });
  await page.waitForSelector('.shadow-debrief');
  assert.match(await page.locator('.shadow-debrief').innerText(), /what security learned/);
  await page.screenshot({ path: `${report}/debrief.png`, fullPage: true });
  console.log('PASS: extraction ends the mission and the debrief shows what security learned');

  await page.getByRole('button', { name: 'back to the briefing' }).click();
  await page.waitForSelector('.shadow-brief');
  assert.match(await page.locator('.shadow-dossier').innerText(), /1 attempt/i);
  console.log('PASS: the dossier persists between attempts');
  assert.deepEqual(errors, []);
  console.log('PASS: no page errors' + (missing.length ? ` (404s outside the game: ${[...new Set(missing)].join(', ')})` : ''));
  assert.ok(!missing.some(url => /shadow/.test(url)), 'no missing Shadow Protocol resources');
} finally {
  await browser.close();
}
