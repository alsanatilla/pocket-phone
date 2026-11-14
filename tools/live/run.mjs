#!/usr/bin/env node
// npm run check:live: a fixed set of real requests through Pip's server reply loop against a real model, each judged
// by deterministic checks (docs/pip-agent-runtime.md, "Checking against a real model"). Configured only by the
// environment; without POCKET_CHECK_KEY it says so and exits 0. The key is never printed or written.

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SCENARIOS, runScenario } from './scenarios.mjs';

export const DEFAULTS = { baseUrl: 'https://opencode.ai/inference/go/openai/v1', model: 'deepseek-v4.1-flash', provider: 'compatible' };
/** Runs needed to pass out of `repeat`: two thirds, rounded up (1/1, 2/2, 2/3, 3/4, 4/5). */
export const needed = repeat => Math.ceil(repeat * 2 / 3);

const pad = (text, n) => { text = String(text); return text.length >= n ? text.slice(0, n) : text + ' '.repeat(n - text.length); };

/**
 * The whole check. `env` is the environment; `fetchFor(name)` gives the HTTP fetcher for a scenario (fetch unless a
 * test passes a fixture provider); `log` prints one line. Resolves to the exit code and the report.
 */
export async function main({ env = process.env, fetchFor = () => fetch, log = line => console.log(line) } = {}) {
  const key = String(env.POCKET_CHECK_KEY || '').trim();
  const redact = text => key ? String(text).split(key).join('[key]') : String(text);
  const say = line => log(redact(line));
  if (!key) { say('check:live skipped: set POCKET_CHECK_KEY to run Pip against a real model.'); return { code: 0, status: 'skipped' }; }

  const provider = env.POCKET_CHECK_PROVIDER || DEFAULTS.provider;
  const options = { provider, baseUrl: env.POCKET_CHECK_BASE_URL || DEFAULTS.baseUrl, model: env.POCKET_CHECK_MODEL || DEFAULTS.model, key };
  const repeat = Number(env.POCKET_CHECK_REPEAT || 1), only = String(env.POCKET_CHECK_ONLY || '').split(',').map(name => name.trim()).filter(Boolean);
  const unknown = only.filter(name => !SCENARIOS.some(item => item.name === name));
  const problem = !['compatible', 'anthropic'].includes(provider) ? 'POCKET_CHECK_PROVIDER must be compatible or anthropic.'
    : !Number.isInteger(repeat) || repeat < 1 || repeat > 20 ? 'POCKET_CHECK_REPEAT must be a whole number from 1 to 20.'
    : unknown.length ? 'Unknown scenario: ' + unknown.join(', ') + '. Scenarios: ' + SCENARIOS.map(item => item.name).join(', ') + '.' : '';
  if (problem) { say('check:live: ' + problem); return { code: 1, status: 'invalid' }; }
  const chosen = only.length ? SCENARIOS.filter(item => only.includes(item.name)) : SCENARIOS;
  const estimate = chosen.reduce((sum, item) => sum + item.cost, 0) * repeat;
  say(`check:live: ${chosen.length} scenario(s) × ${repeat} against ${options.model} (${provider}${provider === 'compatible' ? ', ' + options.baseUrl : ''}), about ${estimate} model requests.`);

  const started = Date.now(), scenarios = [];
  for (const scenario of chosen) {
    const runs = [];
    for (let i = 0; i < repeat; i++) runs.push(await runScenario(scenario, { ...options, fetcher: fetchFor(scenario.name) }));
    const passed = runs.filter(run => run.pass).length;
    scenarios.push({ name: scenario.name, guards: scenario.guards, pass: passed >= needed(repeat), passed, runs: repeat, needed: needed(repeat), results: runs });
  }
  const total = { requests: 0, input_tokens: 0, output_tokens: 0 };
  for (const run of scenarios.flatMap(item => item.results)) for (const name of Object.keys(total)) total[name] += run[name];
  const failed = scenarios.filter(item => !item.pass);
  const report = { status: failed.length ? 'failed' : 'passed', model: options.model, provider, base_url: provider === 'compatible' ? options.baseUrl : 'https://api.anthropic.com/v1', repeat,
    started: new Date(started).toISOString(), duration_ms: Date.now() - started, total, scenarios };
  const path = env.POCKET_CHECK_REPORT || join(tmpdir(), `pocket-live-check-${started}.json`);
  writeFileSync(path, redact(JSON.stringify(report, null, 2)) + '\n');

  say('');
  say(pad('scenario', 20) + pad('result', 12) + pad('requests', 10) + pad('tokens in/out', 18) + pad('seconds', 9) + 'first failed check');
  for (const item of scenarios) {
    const sum = name => item.results.reduce((n, run) => n + run[name], 0);
    const failure = item.results.flatMap(run => run.checks).find(row => !row.pass);
    say(pad(item.name, 20) + pad((item.pass ? 'pass ' : 'FAIL ') + item.passed + '/' + item.runs, 12) + pad(sum('requests'), 10)
      + pad(sum('input_tokens') + '/' + sum('output_tokens'), 18) + pad((sum('duration_ms') / 1000).toFixed(1), 9) + (failure ? failure.name + ': ' + failure.reason : ''));
  }
  say('');
  say(`Tokens: ${total.input_tokens} in, ${total.output_tokens} out (${total.input_tokens + total.output_tokens} total). Model requests: ${total.requests} made, about ${estimate} expected.`);
  say(`${failed.length ? failed.length + ' of ' + scenarios.length + ' scenario(s) failed' : 'All ' + scenarios.length + ' scenario(s) passed'}. Report: ${path}`);
  return { code: failed.length ? 1 : 0, status: report.status, report, path };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().then(({ code }) => { process.exitCode = code; }, error => { console.error('check:live failed: ' + String(error?.message || error).split(String(process.env.POCKET_CHECK_KEY || '\u0000')).join('[key]')); process.exitCode = 1; });
}
