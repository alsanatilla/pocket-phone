// Real models, real server-run pipeline: five messages that set up, list, change and stop jobs in the big chat, then
// one forced run of a job Pip created, which reports home. The parent reads the account's two stored keys from the
// production database (read only) and hands them to a child by environment; the child works on a scratch database.
// Never prints a key. Usage: POCKET_ENV=/path/to/.env node tools/manual/job-tools-real.mjs [model,model]
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const GO = 'https://opencode.ai/inference/go/openai/v1', OR = 'https://openrouter.ai/api/v1', ACCOUNT = 'c50398a7-80e6-4949-b62b-27d8b288f70f';
const MODELS = (process.argv[2] || 'deepseek-v4.1-flash,glm-5.3').split(',');

if (!process.env.CHILD) {
  for (const line of fs.readFileSync(process.env.POCKET_ENV || ROOT + '/.env', 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
  const { readKey } = await import(ROOT + '/src/server/pip-keys.js');
  const dir = mkdtempSync(join(tmpdir(), 'job-tools-real-'));
  const out = spawnSync(process.execPath, [new URL(import.meta.url).pathname, MODELS.join(',')], { env: { PATH: process.env.PATH, CHILD: '1',
    K_GO: await readKey(ACCOUNT, { provider: 'compatible', baseUrl: GO }), K_OR: await readKey(ACCOUNT, { provider: 'compatible', baseUrl: OR }),
    TURSO_DATABASE_URL: 'file:' + join(dir, 'db.sqlite'), TURSO_AUTH_TOKEN: 'x', POCKET_ENCRYPTION_SECRET: 'scratch' }, encoding: 'utf8', timeout: 900000 });
  process.stdout.write(out.stdout);
  if (out.status) process.stdout.write(out.stderr.slice(-800));
  process.exit(out.status || 0);
}

const { ensureSchema, execute } = await import(ROOT + '/src/server/database.js');
const { syncDocuments } = await import(ROOT + '/src/server/workspace.js');
const background = await import(ROOT + '/src/server/pip-background.js');
const { saveKey } = await import(ROOT + '/src/server/pip-keys.js');
const runs = await import(ROOT + '/src/server/pip-runs.js');
await ensureSchema();
const now = Date.now();
const MESSAGES = [
  'Remind me every Monday at 8 to check the bike prices.',
  'Each evening at 19:00, tell me what is due tomorrow.',
  'What do you do for me on your own?',
  'Move the evening one to 20:30.',
  'Stop the Monday reminder.',
];
const tasks = [{ uid: 't1', text: 'Dentist appointment', done: false, due: new Date(now + 86400000).toISOString().slice(0, 10), important: false, steps: [], created: now, updated: now, deleted: false }];
const short = text => JSON.stringify(String(text || '').replace(/\s+/g, ' ').slice(0, 110));

for (const model of MODELS) {
  const user = 'jobs-' + model.replace(/[^a-z0-9]/g, '');
  await execute({ sql: 'INSERT INTO pocket_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', args: [user, 'F', user + '@example.com', now, now] });
  await syncDocuments(user, { 'tasks.json': { v: 1, tasks } });
  await background.saveBackground(user, { provider: 'compatible', model, baseUrl: GO, maxTokens: 4096, grants: ['notes', 'tasks'], dailyTokens: 500000, timezone: 'Europe/Berlin', enabled: true }, process.env.K_GO);
  await saveKey(user, { provider: 'compatible', baseUrl: OR, key: process.env.K_OR });
  const config = { provider: 'compatible', model, baseUrl: GO, maxTokens: 4096, thinking: false, webSearch: false };
  const chat = { uid: 'home-' + user, title: 'pip', titled: true, home: true, created: now, config };
  console.log('== ' + model);
  let n = 0;
  for (const text of MESSAGES) {
    const started = Date.now(); n++;
    try {
      let view = await runs.submitRun(user, { requestId: user + '-' + n, chat, text, device: 'd', timezone: 'Europe/Berlin', grants: ['notes', 'tasks'] });
      // A removal waits for the person: approve it, as they would on the card.
      for (let round = 0; view.run.status === 'awaiting' && round < 3; round++) {
        const pending = (await execute({ sql: "SELECT request_id, payload FROM pocket_pip_run_requests WHERE user_id = ? AND run_id = ? AND state = 'pending'", args: [user, view.run.runId] })).rows;
        for (const row of pending) console.log('   approval asked: ' + JSON.parse(String(row.payload))?.action?.title + ' → approved');
        for (const row of pending) view = await runs.decideRun(user, { runId: view.run.runId, requestId: String(row.request_id), approved: true });
      }
      const turn = view.run.turn, calls = (turn.activity || []).filter(row => /_job|list_jobs/.test(row.name));
      console.log(String(n) + '. ' + view.run.status.padEnd(8) + ((Date.now() - started) / 1000).toFixed(1).padStart(5) + 's | ' + text);
      for (const row of calls) console.log('   ' + row.name + ':' + row.state + ' ' + String(row.input).slice(0, 150) + ' → ' + row.summary);
      console.log('   answer: ' + short(turn.answer || turn.error));
    } catch (error) { console.log(String(n) + '. ERR ' + String(error?.message).slice(0, 160)); }
  }
  const state = await background.backgroundState(user);
  const { scheduleWords } = await import(ROOT + '/src/server/pip-job-tools.js');
  console.log('   jobs now: ' + (state.routines.map(job => job.title + ' [' + job.kind + ', ' + scheduleWords(job, 'Europe/Berlin') + ', ' + (job.enabled ? 'on' : 'paused') + ', to ' + job.to + ', grants ' + JSON.stringify(job.grants) + ']').join(' ‖ ') || 'none'));
  // One job Pip created, run now: its report is a turn in the big chat.
  const evening = state.routines.find(job => job.enabled) || state.routines[0];
  if (evening) {
    const started = Date.now();
    const result = await background.runClaimed(user, evening.id, { force: true });
    const stored = JSON.parse(String((await execute({ sql: "SELECT payload FROM pocket_objects WHERE user_id = ? AND collection = 'chats' AND uid = ?", args: [user, result.chat || ''] })).rows[0]?.payload || '{}'));
    const turn = (stored.turns || []).find(item => item.uid === result.turn);
    console.log('   job run "' + evening.title + '": ' + result.status + ' ' + ((Date.now() - started) / 1000).toFixed(1) + 's, in ' + (stored.home ? 'the big chat' : 'chat ' + result.chat) + ' as › ' + (turn?.text || '-') + ' (turns there: ' + (stored.turns || []).length + ')');
    console.log('   report: ' + short(turn?.answer || result.error));
  }
}
