import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compatibleMessage, response } from '../pip-provider-fixtures.mjs';
import { SCENARIOS, STEER, PLAN_CARD_ID, runScenario } from './scenarios.mjs';
import { main, needed } from './run.mjs';
import { localDay, PAGES } from './world.mjs';
import { languageShare } from './checks.mjs';

// The live check proven without a key: the harness runs against a local fake provider whose scripted model either
// behaves (the scenario passes) or does the thing the scenario exists to catch (the scenario fails, with that reason).

const SECRET = 'sk-selftest-0123456789abcdef';
const OPTIONS = { provider: 'compatible', baseUrl: 'https://model.example/v1', model: 'fixture-model', key: SECRET };
const scenario = name => SCENARIOS.find(item => item.name === name);
const say = (text, calls = []) => compatibleMessage({ text, calls, usage: { prompt_tokens: 900, completion_tokens: 60, total_tokens: 960 } });
const call = (name, input, id = 'call_' + name) => ({ name, input, id });
const think = (reasoning, text = '') => compatibleMessage({ text, finish: 'length', delta: { reasoning_content: reasoning }, usage: { prompt_tokens: 900, completion_tokens: 1024, total_tokens: 1924 } });
const sentText = body => JSON.stringify(body.messages);

/** A scripted model: each request gets the next step, a wire or a function of the request body. */
function model(steps, seen = []) {
  steps = [...steps];
  return async (_url, init) => {
    seen.push({ authorization: init.headers?.authorization || init.headers?.Authorization || new Headers(init.headers).get('authorization'), body: JSON.parse(init.body) });
    const next = steps.shift();
    assert.ok(next, 'the scripted model expected no further request');
    return response(typeof next === 'function' ? next(seen.at(-1).body) : next, 512);
  };
}
const run = (name, steps, seen) => runScenario(scenario(name), { ...OPTIONS, fetcher: model(steps, seen) });
const failed = (record, check) => record.checks.find(item => item.name === check && !item.pass);
const passes = record => assert.ok(record.pass, JSON.stringify(record.checks.filter(item => !item.pass)) + ' ' + JSON.stringify(record.failure || {}));

const timeline = (lunch = '12:30') => ({ root: 'main', elements: [{ id: 'main', type: 'Timeline', props: { title: 'Saturday in Istanbul', items: [
  { time: lunch, title: 'Lunch at a Beyoğlu lokanta', detail: 'Near İstiklal' }, { time: '15:00', title: 'Short Bosphorus tour', detail: 'From Eminönü' }] }, children: [] }] });
const table = { root: 'main', elements: [{ id: 'main', type: 'Table', props: { title: 'Bosphorus tours', columns: ['Tour', 'Duration', 'Fare'], rows: [['City ferries short tour', '2 h', '150 TL'], ['Turyol', '90 min', '200 TL']],
  source: { title: 'City Ferries', url: PAGES[0].url } }, children: [] }] };

test('plan-card passes a model that draws a Timeline, and fails one that writes "[card: Table …]" as text', async () => {
  const seen = [];
  passes(await run('plan-card', [say('Here is your Saturday.', [call('show_card', timeline())]), say('Enjoy the ferry.')], seen));
  // The real request: the production tools are offered, and the system text is the server's.
  const tools = seen[0].body.tools.map(tool => tool.function.name);
  for (const name of ['show_card', 'update_card', 'create_record', 'change_record', 'search_web', 'read_web_page', 'search_notes', 'search_tasks', 'search_calendar', 'remember', 'list_jobs']) assert.ok(tools.includes(name), name);
  assert.match(seen[0].body.messages[0].content, /You are pip/);
  assert.match(seen[0].body.messages[0].content, /runs on your Pocket account's server/);
  assert.equal(seen[0].authorization, 'Bearer ' + SECRET);

  const bad = await run('plan-card', [say('Here is your Saturday.\n\n[card: Table “Saturday in Istanbul”]\n\nEnjoy the ferry.')]);
  assert.equal(bad.pass, false);
  assert.match(failed(bad, 'no stand-in').reason, /card written as text: \[card: Table/);
  assert.match(failed(bad, 'card').reason, /no card drawn with show_card/);
  assert.match(bad.failure.answer, /Enjoy the ferry/);
});

test('card-after-history replays the stored card as a tool call, and fails a model that answers with a stand-in', async () => {
  const seen = [];
  passes(await run('card-after-history', [say('', [call('search_web', { query: 'Bosphorus tour Eminönü' })]), say('Side by side:', [call('show_card', table)]), say('Turyol is shorter.')], seen));
  const replayed = seen[0].body.messages.find(message => message.role === 'assistant' && message.tool_calls);
  assert.equal(replayed.tool_calls[0].function.name, 'show_card');
  assert.match(sentText(seen[0].body), new RegExp(PLAN_CARD_ID));
  const bad = await run('card-after-history', [say('Side by side:\n\n[card: Table “Tours”]')]);
  assert.match(failed(bad, 'no stand-in').reason, /card written as text/);
  assert.match(failed(bad, 'new card').reason, /no card drawn/);
});

test('research-then-card needs a card after the refused lookups, with the canned urls cited', async () => {
  const seen = [];
  const good = await run('research-then-card', [
    say('', [call('search_web', { query: 'Bosphorus short tour Eminönü' })]),
    say('', [call('read_web_page', { url: PAGES[0].url }, 'call_a'), call('read_web_page', { url: PAGES[1].url }, 'call_b')]),
    say('The city ferry tour is cheaper.', [call('show_card', table)]),
    say('Sources: ' + PAGES[0].url + ' (Turyol could not be read in this reply).')], seen);
  passes(good);
  assert.match(sentText(seen[2].body), /research_budget_reached/);
  const bad = await run('research-then-card', [
    say('', [call('search_web', { query: 'Bosphorus short tour Eminönü' })]),
    say('', [call('read_web_page', { url: PAGES[0].url }, 'call_a'), call('read_web_page', { url: PAGES[1].url }, 'call_b')]),
    say('The city ferry tour is cheaper.\n\n[card: Table “Tours”]')]);
  assert.match(failed(bad, 'card').reason, /no card drawn after the lookups were refused/);
  assert.match(failed(bad, 'cites').reason, /cites none/);
  // A model that answers from the search passages reaches no cap: the card and its sources are still asked for.
  const never = await run('research-then-card', [say('', [call('search_web', { query: 'Bosphorus' })]), say('It is cheaper.', [call('show_card', table)]), say('Sources: ' + PAGES[0].url + ' and ' + PAGES[1].url)]);
  passes(never);
});

test('update-card passes update_card with the stored id, and fails a second card', async () => {
  const update = { id: PLAN_CARD_ID, ...timeline('13:00') };
  passes(await run('update-card', [say('', [call('update_card', update)]), say('Lunch is at 13:00 now.')]));
  const bad = await run('update-card', [say('Updated:', [call('show_card', timeline('13:00'))]), say('Lunch is at 13:00 now.')]);
  assert.match(failed(bad, 'update_card').reason, /update_card not called/);
  assert.match(failed(bad, 'no new card').reason, /1 card\(s\) drawn/);
});

test('save-with-approval passes one task due tomorrow, and fails a duplicate save', async () => {
  const task = title => call('create_record', { kind: 'task', title, text: '', due: localDay(1) }, 'call_' + title.length);
  passes(await run('save-with-approval', [say('', [task('Call the landlord')]), say('Saved: call the landlord, due tomorrow.')]));
  const twice = await run('save-with-approval', [say('', [task('Call the landlord')]), say('', [task('Call landlord about the heating')]), say('Saved both.')]);
  assert.match(failed(twice, 'saved once').reason, /2 create_record calls/);
  const wrongDay = await run('save-with-approval', [say('', [call('create_record', { kind: 'task', title: 'Call the landlord', text: '', due: localDay(0) })]), say('Saved.')]);
  assert.match(failed(wrongDay, 'saved once').reason, /expected/);
});

test('save-declined passes "declined, nothing saved", and fails a reply that claims the save', async () => {
  const task = call('create_record', { kind: 'task', title: 'Call the landlord', text: '', due: localDay(1) });
  passes(await run('save-declined', [say('', [task]), say('You declined it, so the task was not saved.')]));
  const claims = await run('save-declined', [say('', [task]), say('I have saved the task for tomorrow.')]);
  assert.match(failed(claims, 'says so').reason, /claims a save/);
});

test('steer delivers the message after the first tool call, and fails an answer that ignores it', async () => {
  const lookups = [say('', [call('search_web', { query: 'Beyoğlu lokanta' }, 'call_s1'), call('search_web', { query: 'Bosphorus tour Eminönü' }, 'call_s2')])];
  const answer = body => sentText(body).includes(STEER) ? say('Just the tour then: the short Bosphorus tour leaves Eminönü at 15:00 (150 TL).') : say('Lunch at Hacı Abdullah, then the 15:00 tour.');
  const seen = [];
  passes(await run('steer', [...lookups, answer], seen));
  assert.ok(!sentText(seen[0].body).includes(STEER) && sentText(seen[1].body).includes(STEER), 'the message reached the model at its next request');
  const ignores = await run('steer', [...lookups, say('Lunch at Hacı Abdullah, then the 15:00 Bosphorus tour.')]);
  assert.match(failed(ignores, 'follows').reason, /still lists restaurants: Hacı Abdullah/);
  const noTool = await run('steer', [say('Lunch at a lokanta, then the tour.')]);
  assert.match(failed(noTool, 'taken').reason, /never sent/);
});

test('language passes German prose, and fails an English answer to a German question', async () => {
  passes(await run('language', [say('', [call('search_calendar', { query: '', days: 2 })]), say('Morgen hast du um 9:30 den Zahnarzt und um 14 Uhr das Team-Meeting. Außerdem ist die Steuererklärung fällig.')]));
  const english = await run('language', [say('', [call('search_calendar', { query: '', days: 2 })]), say('Tomorrow you have the dentist at 9:30 and the team meeting at 14:00. Your tax return is also due.')]);
  assert.match(failed(english, 'German').reason, /not German/);
  assert.deepEqual(languageShare('Das ist der Plan und die Uhr.'), { de: 6, en: 0, share: 1 });
});

test('no-runaway passes a short greeting, and fails a reply that keeps calling tools', async () => {
  passes(await run('no-runaway', [say('Hey! What can I do for you?')]));
  const plan = n => say('', [call('update_plan', { steps: [{ text: 'Greet', status: 'in_progress' }] }, 'call_plan' + n)]);
  const runaway = await run('no-runaway', [plan(1), plan(2), say('Hey!')]);
  assert.match(failed(runaway, 'requests').reason, /3 model requests/);
  assert.match(failed(runaway, 'no tools').reason, /update_plan/);
});

test('thinking-limit sends the low reply limit; endless thinking with no text fails, a partial answer with the notice passes', async () => {
  const seen = [];
  passes(await run('thinking-limit', [say('Lunch at 12:30 in Beyoğlu, then the 15:00 tour.')], seen));
  assert.equal(seen[0].body.max_tokens, 1024);
  const endless = await run('thinking-limit', [think('Let me think about lokantas…'), think('Still thinking…'), think('More thinking…')]);
  assert.equal(endless.pass, false);
  assert.match(failed(endless, 'handled').reason, /limit notice with an empty answer/);
  assert.match(endless.failure.error, /reply limit per message/);
  assert.match(endless.failure.reasoning, /More thinking/);
  passes(await run('thinking-limit', [think('Planning…', 'Lunch at'), think('Planning…', 'Lunch at 12:30'), think('Planning…', 'Lunch at 12:30 in Beyoğlu, then')]));
});

test('without a key the check is skipped with exit 0, from the command line too', async () => {
  const lines = [], result = await main({ env: {}, log: line => lines.push(line) });
  assert.deepEqual([result.code, result.status, lines.length], [0, 'skipped', 1]);
  assert.match(lines[0], /skipped/);
  const env = { ...process.env }; delete env.POCKET_CHECK_KEY;
  const cli = spawnSync(process.execPath, [fileURLToPath(new URL('./run.mjs', import.meta.url))], { env, encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /^check:live skipped/);
});

test('a run writes the report and the table, passes k of N runs, and never shows the key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pocket-live-selftest-')), path = join(dir, 'report.json'), lines = [];
  let runs = 0;
  // Two of three greetings are fine; one runs away. Two thirds pass.
  const fetchFor = () => { runs++; return runs === 2 ? model([say('', [call('update_plan', { steps: [{ text: 'x', status: 'done' }] })]), say('', [call('update_plan', { steps: [{ text: 'y', status: 'done' }] }, 'call_p2')]), say('Hey ' + SECRET)]) : model([say('Hey! How can I help?')]); };
  const result = await main({ env: { POCKET_CHECK_KEY: SECRET, POCKET_CHECK_ONLY: 'no-runaway', POCKET_CHECK_REPEAT: '3', POCKET_CHECK_REPORT: path }, fetchFor, log: line => lines.push(line) });
  assert.equal(result.code, 0);
  const report = JSON.parse(readFileSync(path, 'utf8')), item = report.scenarios[0];
  assert.deepEqual([item.name, item.passed, item.runs, item.pass], ['no-runaway', 2, 3, true]);
  assert.equal(report.total.requests, 5);
  assert.equal(item.results[1].pass, false);
  assert.ok(item.results[1].failure.activity.some(row => row.name === 'update_plan'));
  const stdout = lines.join('\n'), written = readFileSync(path, 'utf8');
  assert.match(stdout, /no-runaway\s+pass 2\/3/);
  assert.match(stdout, /Tokens: \d+ in, \d+ out/);
  assert.match(stdout, /Model requests: 5 made, about 3 expected/);
  // The key went to the provider, and the model even echoed it, yet it is in neither the report nor the output.
  assert.ok(!stdout.includes(SECRET) && !written.includes(SECRET));
  assert.match(written, /Hey \[key\]/);
  assert.deepEqual([needed(1), needed(2), needed(3), needed(5)], [1, 2, 2, 4]);
});

test('a failing scenario exits 1, and an unknown scenario name is refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pocket-live-selftest-'));
  const result = await main({ env: { POCKET_CHECK_KEY: SECRET, POCKET_CHECK_ONLY: 'plan-card', POCKET_CHECK_REPORT: join(dir, 'r.json') }, fetchFor: () => model([say('[card: Table “Plan”]')]), log: () => {} });
  assert.equal(result.code, 1);
  assert.equal(result.report.status, 'failed');
  const lines = [], unknown = await main({ env: { POCKET_CHECK_KEY: SECRET, POCKET_CHECK_ONLY: 'nope' }, log: line => lines.push(line) });
  assert.equal(unknown.code, 1);
  assert.match(lines[0], /Unknown scenario: nope/);
});
