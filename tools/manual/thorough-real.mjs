// Real models through the server-run path on "thorough" questions over six short notes: does each reply end with the
// model's own answer, and what did each round cost? A scratch database; the account's stored keys are read once
// and passed to a child process by environment, never printed.
//
//   node tools/manual/thorough-real.mjs [models, comma-separated] [runs per question]
//
// `.env` is read from POCKET_ENV_FILE or this checkout. Per provider request it prints the round: what was offered
// (max_tokens, tools, tool_choice), how it ended (finish reason, output and reasoning tokens as the provider
// reports them, the tool calls, characters of text and of reasoning), which of Pocket's budgets that round is
// charged to, and the budgets left after it, recomputed from the rules in src/client/pip-stream.js.
import fs from 'node:fs'; import { spawnSync } from 'node:child_process'; import { mkdtempSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const GO = 'https://opencode.ai/inference/go/openai/v1', OR = 'https://openrouter.ai/api/v1';
const MODELS = (process.argv[2] || 'deepseek-v4.1-flash,glm-5.3').split(','), RUNS = Number(process.argv[3] || 1);
if (!process.env.CHILD) {
  for (const line of fs.readFileSync(process.env.POCKET_ENV_FILE || ROOT + '/.env', 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
  const { readKey } = await import(ROOT + '/src/server/pip-keys.js'); const U = 'c50398a7-80e6-4949-b62b-27d8b288f70f';
  const dir = mkdtempSync(join(tmpdir(), 'thorough-'));
  try {
    const out = spawnSync(process.execPath, [new URL(import.meta.url).pathname, ...process.argv.slice(2)], { env: { PATH: process.env.PATH, CHILD: '1', K_GO: await readKey(U, { provider: 'compatible', baseUrl: GO }), K_OR: await readKey(U, { provider: 'compatible', baseUrl: OR }),
      TURSO_DATABASE_URL: 'file:' + join(dir, 'db.sqlite'), TURSO_AUTH_TOKEN: 'x', POCKET_ENCRYPTION_SECRET: 'scratch' }, encoding: 'utf8', timeout: 3000000, maxBuffer: 64 << 20 });
    process.stdout.write(out.stdout.split('\n').filter(l => /^(RUN|  ·|  !)/.test(l)).join('\n') + '\n'); if (out.status) process.stdout.write(out.stderr.slice(-800));
  } finally { rmSync(dir, { recursive: true, force: true }); }
  process.exit(0);
}
const { ensureSchema, execute } = await import(ROOT + '/src/server/database.js');
const { syncDocuments } = await import(ROOT + '/src/server/workspace.js');
const { saveBackground } = await import(ROOT + '/src/server/pip-background.js');
const { saveKey } = await import(ROOT + '/src/server/pip-keys.js');
const { RESEARCH_LIMITS } = await import(ROOT + '/src/client/pip-limits.js');
const { STATE_TOOLS, WRITE_TOOLS } = await import(ROOT + '/src/client/pip-tools.js');
const runs = await import(ROOT + '/src/server/pip-runs.js');
await ensureSchema(); const now = Date.now();
const settings = { provider: 'compatible', model: 'deepseek-v4.1-flash', baseUrl: GO, maxTokens: 4096, grants: ['notes', 'tasks'], dailyTokens: 5000000, timezone: 'Europe/Berlin', enabled: true };
const notes = ['# Blaues Auto\n\nDer blaue Golf kostet 21.000 Euro, Baujahr 2022, 38.000 km.', '# Rotes Auto\n\nDer rote Octavia kostet 19.500 Euro, Baujahr 2021, 61.000 km.', '# Werkstatt\n\nTÜV für den alten Wagen ist im März fällig.', '# Versicherung\n\nAngebot HUK: 480 Euro im Jahr für den Golf, 430 für den Octavia.', '# Probefahrt\n\nGolf fährt sich straffer, Octavia hat mehr Platz.', '# Finanzierung\n\nBank bietet 4,9 % über 48 Monate.']
  .map((text, i) => ({ uid: 'n' + i, text, pinned: false, created: now, updated: now, deleted: false }));
async function account(id) {
  await execute({ sql: 'INSERT INTO pocket_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', args: [id, 'F', id + '@example.com', now, now] });
  await syncDocuments(id, { 'notes.json': { v: 1, notes } });
  await saveBackground(id, settings, process.env.K_GO);
  await saveKey(id, { provider: 'compatible', baseUrl: OR, key: process.env.K_OR });
}
const CASES = ['Vergleiche Golf und Octavia gründlich anhand all meiner Notizen: Preis, Versicherung, Fahrgefühl, Finanzierung. Was soll ich kaufen?', 'Recherchiere gründlich in meinen Notizen: Was weiß ich alles über den alten Wagen und was steht an?'];
const CARDS = ['show_card', 'update_card'];

// One provider round, read from the stream as it passes: the SDK reads its own copy.
async function readRound(stream) {
  const round = { finish: '', output: null, reasoningTokens: null, calls: [], text: 0, thought: 0 }, decoder = new TextDecoder(); let buffer = '';
  const names = new Map();
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let at; while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at).trim(); buffer = buffer.slice(at + 1);
      if (!line.startsWith('data:') || line === 'data: [DONE]') continue;
      let data; try { data = JSON.parse(line.slice(5)); } catch { continue; }
      for (const choice of data.choices || []) {
        const delta = choice.delta || {};
        round.text += String(delta.content || '').length; round.thought += String(delta.reasoning_content || delta.reasoning || '').length;
        for (const call of delta.tool_calls || []) if (call.function?.name) names.set(call.index ?? names.size, call.function.name);
        if (choice.finish_reason) round.finish = choice.finish_reason;
      }
      if (data.usage) { round.output = data.usage.completion_tokens ?? null; round.reasoningTokens = data.usage.completion_tokens_details?.reasoning_tokens ?? null; }
    }
  }
  round.calls = [...names.values()];
  return round;
}

for (const model of MODELS) for (let pass = 0; pass < RUNS; pass++) for (const [index, text] of CASES.entries()) {
  const user = 'u' + model.replace(/[^a-z0-9]/gi, '') + pass + index; await account(user);
  const config = { provider: 'compatible', model, baseUrl: GO, maxTokens: 4096, thinking: false, webSearch: false };
  // Pocket's budgets as pip-stream.js keeps them, recomputed from what each round reported.
  let tokens = config.maxTokens, researchTokens = RESEARCH_LIMITS.researchTokens, rounds = 0, looked = 0;
  const reading = [];
  const fetcher = async (url, options) => {
    const response = await fetch(url, options);
    if (!String(url).startsWith(GO) || !response.body) return response;
    const sent = JSON.parse(options.body), n = ++rounds;
    const [mine, theirs] = response.body.tee();
    reading.push(readRound(mine).then(round => {
      const working = round.calls.length && !round.calls.some(name => CARDS.includes(name)), spent = round.output ?? sent.max_tokens, thought = Math.min(spent, round.reasoningTokens || 0);
      const final = /the app has stopped research for this reply/.test(JSON.stringify(sent.messages?.[0] || ''));
      const share = working ? (final ? Math.min(spent, Math.max(0, researchTokens)) : spent) : looked ? Math.min(thought, Math.max(0, researchTokens)) : 0;
      researchTokens -= share; tokens -= spent - share;
      looked += round.calls.filter(name => !STATE_TOOLS.includes(name) && !WRITE_TOOLS.includes(name)).length;
      console.log('  ·', String(n).padStart(2), 'max', String(sent.max_tokens).padStart(5), 'tools', String(sent.tools?.length || 0).padStart(2), String(sent.tool_choice || '-').padEnd(4),
        '→', (round.finish || '?').padEnd(10), 'out', String(round.output ?? '?').padStart(5), 'reasoning', String(round.reasoningTokens ?? '?').padStart(5),
        'chars', String(round.text).padStart(5) + '/' + String(round.thought).padStart(5), (final ? 'final ' : '      ') + 'charged lookups/answer', share + '/' + (spent - share), 'left', tokens + '/' + researchTokens, '[' + round.calls.join(',') + ']');
    }).catch(error => console.log('  ! round', n, String(error?.message).slice(0, 100))));
    return new Response(theirs, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  const started = Date.now();
  console.log('  ·', model, 'question', index + 1, 'pass', pass + 1);
  try {
    const view = await runs.submitRun(user, { requestId: 'r' + user, chat: { uid: 'c' + user, title: 'T', created: now, config }, text, device: 'd' }, { fetcher });
    await Promise.all(reading);
    const turn = view.run.turn, looks = (turn.activity || []).filter(a => /search|read|list|get/.test(a.name));
    const refused = looks.filter(a => /research_budget_reached/.test(a.result || '')).length;
    console.log('RUN', model.padEnd(20), 'q' + (index + 1), view.run.status.padEnd(6), ((Date.now() - started) / 1000).toFixed(1).padStart(5) + 's', 'effort=' + (turn.usage?.effort || '-'),
      'ran=' + (looks.length - refused), 'refused=' + refused, 'answer=' + String(turn.answer || '').length, 'reasoning=' + String(turn.reasoning || '').length, 'rounds=' + rounds,
      JSON.stringify(String(view.run.status === 'done' ? turn.answer : turn.error || turn.answer).replace(/\s+/g, ' ').slice(0, 110)));
  } catch (error) { await Promise.all(reading); console.log('RUN ERR', model, 'q' + (index + 1), String(error?.message).slice(0, 140)); }
}
