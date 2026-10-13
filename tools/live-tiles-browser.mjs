// Start Astro on port 8882. Install Playwright separately, or set PLAYWRIGHT_MODULE to its module URL.
// All data and provider calls stay in a fresh, unsigned-in browser context.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(10000);
const reports = 'app/build/reports/web-tiles';
await mkdir(reports, { recursive: true });
const tile = kind => page.locator(`.live-tile[data-tile="${kind}"]`);
const settle = () => page.waitForTimeout(350);
try {
  await page.goto('http://127.0.0.1:8882');
  await page.waitForSelector('.live-tile');
  assert.equal(await page.locator('.live-tile').count(), 5);
  await page.evaluate(async () => {
    const { tasks, notes, parking, taskDay } = await import('/src/client/store.js');
    const { agenda } = await import('/src/client/planner.js');
    const late = tasks.create('Book the ferry'); tasks.edit(late.uid, t => { t.due = taskDay(Date.now() - 86400000); });
    tasks.create('Pack the camera'); notes.create('# Weekend route\nTake the coastal road.'); parking.park('A weekend by the sea', 0);
    agenda.save({ title: 'Dinner with Sam', when: Date.now() + 3600000, minutes: 60 });
  });
  await page.waitForFunction(() => document.querySelector('[data-tile=tasks] .live-value')?.textContent === '2');
  assert.match(await tile('tasks').getAttribute('aria-label'), /1 overdue/);
  assert.match(await tile('tasks').getAttribute('class'), /alert/);
  await page.getByRole('button', { name: 'edit tiles', exact: true }).click();
  await page.getByLabel('Size of tasks', { exact: true }).selectOption('small');
  await page.getByRole('button', { name: '+ clock', exact: true }).click();
  await page.getByLabel('Size of clock', { exact: true }).selectOption('wide');
  await page.getByRole('button', { name: 'Move clock up', exact: true }).click();
  await page.getByRole('button', { name: 'done', exact: true }).click();
  assert.equal(await tile('tasks').getAttribute('data-size'), 'small');
  assert.equal(await tile('tasks').locator('.live-name').count(), 0);
  await page.reload(); await page.waitForSelector('.live-tile');
  assert.equal(await tile('clock').getAttribute('data-size'), 'wide');
  assert.equal(await tile('tasks').getAttribute('data-size'), 'small');
  console.log('PASS: live readings, overdue warning, add/reorder/resize and reload');

  // Keep an editor open while another device's preference document arrives.
  await page.getByRole('button', { name: 'edit tiles', exact: true }).click();
  const second = await context.newPage(); await second.goto('http://127.0.0.1:8882');
  await second.evaluate(async () => {
    const { todayTiles } = await import('/src/client/extras.js');
    todayTiles.save([{ kind: 'notes', size: 'wide', label: 'journal' }, ...todayTiles.list().filter(t => t.kind !== 'activity')]);
  });
  await page.bringToFront();
  await page.waitForSelector('[data-tile=notes]');
  await page.getByLabel('Size of tasks', { exact: true }).selectOption('square');
  await page.getByRole('button', { name: 'done', exact: true }).click();
  assert.equal(await tile('activity').count(), 0);
  assert.match(await tile('notes').getAttribute('aria-label'), /^journal/);
  await second.close();
  console.log('PASS: cross-tab sync refresh and an edit preserves the incoming layout');

  await page.evaluate(async () => {
    const { todayTiles, preferences, applyDocument } = await import('/src/client/extras.js');
    todayTiles.save([{ kind: 'tasks', size: 'square' }, { kind: 'thoughts', size: 'square' }, { kind: 'notes', size: 'wide' }, { kind: 'movement', size: 'wide' }, { kind: 'activity', size: 'small' }, { kind: 'clock', size: 'small' }, { kind: 'pip', size: 'square' }]);
    preferences.set('appearance', { accent: 1, reduceMotion: false }); applyDocument('preferences.json');
  });
  for (const width of [320, 360, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 }); await settle();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}px`);
    const dimensions = await tile('thoughts').boundingBox();
    assert.ok(Math.abs(dimensions.width - dimensions.height) < 2, `square tile at ${width}px`);
    assert.equal(await tile('thoughts').evaluate(n => getComputedStyle(n).borderWidth), '0px');
    if (width === 360 || width === 1280) await page.screenshot({ path: `${reports}/today-${width}.png`, fullPage: true });
  }
  await tile('thoughts').dispatchEvent('pointerdown', { pointerType: 'touch', button: 0, clientX: 50, clientY: 50 });
  await tile('thoughts').dispatchEvent('pointermove', { pointerType: 'touch', clientX: 50, clientY: 80 });
  await page.waitForTimeout(80);
  assert.doesNotMatch(await tile('thoughts').getAttribute('class'), /pressed/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await tile('thoughts').dispatchEvent('pointerdown', { pointerType: 'mouse', button: 0, clientX: 50, clientY: 50 });
  assert.doesNotMatch(await tile('thoughts').getAttribute('class'), /pressed/);
  await page.evaluate(async () => {
    const { rollText } = await import('/src/client/ui-motion.js'); const n = document.querySelector('[data-tile=thoughts] .live-value');
    rollText(n, '4'); rollText(n, '5');
  });
  assert.equal(await tile('thoughts').locator('.live-value').textContent(), '5');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(async () => {
    const { rollText } = await import('/src/client/ui-motion.js'); const n = document.querySelector('[data-tile=thoughts] .live-value');
    rollText(n, '6'); rollText(n, '7'); rollText(n, '8');
  });
  await page.waitForFunction(() => document.querySelector('[data-tile=thoughts] .live-value')?.textContent === '8');
  console.log('PASS: 320–1280px layouts, touch-scroll cancellation, reduced motion, rapid live updates');

  await page.setViewportSize({ width: 360, height: 800 });
  await page.evaluate(() => { location.hash = '#/pip/new'; });
  await page.waitForSelector('#pip-prompt');
  assert.deepEqual(await page.locator('.pip-starter').allTextContents(), ['think something through']);
  await page.evaluate(async () => {
    const { ChatStore } = await import('/src/client/pip-core.js');
    const { saveAccess } = await import('/src/client/pip-tools.js');
    const store = new ChatStore(), uid = location.hash.split('/').at(-1), chat = store.get(uid);
    saveAccess(chat.config, ['tasks', 'notes', 'thoughts']);
    store.update(uid, c => { c.config.webSearch = false; });
  });
  await page.reload(); await page.waitForSelector('#pip-prompt');
  await page.evaluate(() => import('/tools/pip-browser-fixture.js'));
  assert.deepEqual(await page.locator('.pip-starter').allTextContents(), ['what’s overdue?', 'plan my day', 'sort my thoughts']);
  await settle(); await page.screenshot({ path: `${reports}/pip-start-360.png`, fullPage: true });
  await page.getByRole('button', { name: 'Pip options', exact: true }).click();
  for (const name of ['add context', 'what Pip can read', 'training chat', 'settings']) assert.equal(await page.getByRole('dialog').getByRole('button', { name, exact: true }).count(), 1);
  await page.getByRole('button', { name: 'web search · off', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'web search · on', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'web search · on', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'close', exact: true }).click();
  await page.locator('.pip-starter').first().click();
  await page.waitForFunction(() => document.querySelector('#pip-send')?.textContent === 'send' && document.querySelector('.pip-thread')?.textContent.includes('Grüße'));
  assert.equal(await page.evaluate(() => pipFixture.requests.length), 1);
  console.log('PASS: permission-aware starters, compact options and fixture reply');

  await page.locator('#pip-prompt').fill('Keep this draft');
  await page.reload(); await page.waitForSelector('#pip-prompt');
  assert.equal(await page.locator('#pip-prompt').inputValue(), 'Keep this draft');
  await page.evaluate(() => import('/tools/pip-browser-fixture.js'));
  await page.evaluate(() => { pipFixture.mode = 'hold'; });
  await page.locator('#pip-prompt').fill('Wait a moment'); await page.locator('#pip-prompt').press('Enter');
  await page.waitForFunction(() => document.querySelector('#pip-send')?.textContent === 'stop');
  await page.waitForFunction(() => document.activeElement?.id === 'pip-prompt');
  await page.locator('#pip-send').click();
  await page.waitForFunction(() => document.querySelector('#pip-send')?.textContent === 'send');
  await page.evaluate(() => { pipFixture.mode = 'save'; });
  await page.locator('#pip-prompt').fill('Save a note called Pip test'); await page.locator('#pip-send').click();
  await page.getByRole('button', { name: 'review', exact: true }).waitFor();
  assert.equal(await page.evaluate(async () => (await import('/src/client/store.js')).notes.list().filter(n => n.text.includes('Pip test')).length), 0);
  await page.getByRole('button', { name: 'review', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'save note', exact: true }).click();
  await page.waitForFunction(async () => (await import('/src/client/store.js')).notes.list().some(n => n.text.includes('Pip test')));
  await page.waitForFunction(() => document.querySelector('#pip-send')?.textContent === 'send');
  await settle(); await page.screenshot({ path: `${reports}/pip-reply-360.png`, fullPage: true });
  console.log('PASS: persisted draft, keyboard focus, stop, tool review and approved note save');

  await page.locator('.pip-navigation summary').click();
  await page.locator('.pip-chat-menu').first().click();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByRole('dialog').locator('input').fill('Weekend planning');
  await page.getByRole('dialog').getByRole('button', { name: 'save', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.pip-heading')?.textContent.includes('Weekend planning'));
  await page.locator('.pip-navigation summary').click();
  await page.getByRole('button', { name: 'Options for Weekend planning', exact: true }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'delete', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.pip-heading')?.textContent.includes('Weekend planning'));
  assert.equal(await page.getByRole('button', { name: 'Options for Weekend planning', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: chat rename/delete; no uncaught browser errors');
} catch (error) {
  await page.screenshot({ path: `${reports}/failure.png`, fullPage: true }).catch(() => {});
  console.error('Browser check failed:', error, 'Browser errors:', errors); throw error;
} finally { await context.close(); await browser.close(); }
