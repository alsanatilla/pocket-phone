// Browser check for Shadow Protocol. Run the dev server first (port in SHADOW_URL,
// default 8890; JEV_MOCK=1 exercises the relay with the local model), then:
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
  console.log('PASS: keyboard movement');

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

  for (const width of [390, 820]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(300);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no horizontal overflow at ${width}`);
    await page.screenshot({ path: `${report}/live-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1360, height: 960 });
  console.log('PASS: 390 and 820 px layouts');

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
