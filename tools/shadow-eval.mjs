// Paired, seeded benchmark. The privileged scripted bot is not a human
// playtester. Local tactical AI is not Jev: live requests are opt-in.
// node tools/shadow-eval.mjs --runs 3 --json app/build/reports/shadow-eval.json
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ShadowSim, DIFFICULTY } from '../src/client/shadow-engine.js';
import { emptyDossier, recordMission, jevState } from '../src/client/shadow-commander.js';
import { JEV_ENDPOINT, JEV_MODEL, shadowQuestions } from '../src/shared/shadow-jev.js';
import { Bot, ROUTES } from './shadow-bot.mjs';

const DT = 1 / 30;
const SPOTS = [['warehouse', 10, 18], ['west corridors', 22, 22], ['east corridors', 41, 14], ['bunks', 49, 19], ['lab', 37, 7], ['east yard', 47, 26], ['dock', 8, 6]];
const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;

export function parseArgs(args) {
  const value = (name, fallback) => {
    const i = args.indexOf('--' + name);
    if (i < 0) return fallback;
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`--${name} needs a value.`);
    return args[i + 1];
  };
  const positive = (name, fallback, ceiling) => {
    const n = Number(value(name, fallback));
    if (!Number.isInteger(n) || n < 1 || n > ceiling) throw new Error(`--${name} must be an integer from 1 to ${ceiling}.`);
    return n;
  };
  const difficulties = value('difficulty', 'normal,hard,extreme').split(',');
  const routes = value('routes', Object.keys(ROUTES).join(',')).split(',');
  const sections = value('only', 'missions,drill,adapt').split(',');
  for (const id of difficulties) if (!Object.hasOwn(DIFFICULTY, id)) throw new Error(`Unknown difficulty: ${id}`);
  for (const id of routes) if (!Object.hasOwn(ROUTES, id)) throw new Error(`Unknown route: ${id}`);
  for (const id of sections) if (!['missions', 'drill', 'adapt'].includes(id)) throw new Error(`Unknown section: ${id}`);
  return { runs: positive('runs', 4, 100), limit: positive('limit', 480, 1800), difficulties, routes, sections,
    jev: args.includes('--jev'), maxCalls: positive('max-calls', 100, 1000), json: value('json', null) };
}

function jevRemote(budget) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('Set OPENROUTER_API_KEY privately in the environment to use --jev.');
  return async (kind, situation) => {
    if (budget.calls >= budget.max) throw new Error('Evaluation Jev request budget reached.');
    budget.calls++;
    const response = await fetch(JEV_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key, 'X-Title': 'Pocket Shadow Protocol eval' },
      body: JSON.stringify({ model: JEV_MODEL, state: jevState(situation), questions: shadowQuestions(kind, situation) }),
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw Object.assign(new Error('Jev HTTP ' + response.status), { status: response.status });
    return (await response.json()).answers;
  };
}

/** Production simulation and bot; no balance overrides, teleports or invulnerability. */
export async function mission({ difficulty, mode, seed, route, dossier, limit = 480, remote = null }) {
  let pending = null;
  const sim = new ShadowSim({ difficulty, seed, mode: mode === 'baseline' ? 'baseline' : 'commander', dossier,
    remote: mode === 'jev' && remote ? (kind, situation) => (pending = remote(kind, situation)) : null });
  const bot = new Bot(sim, { route, seed, habit: 'locker', aggression: .5, distract: .4 });
  let crouchEdge = false;
  for (let step = 0; step < Math.ceil(limit / DT) && sim.status === 'playing'; step++) {
    // Zero simulated network latency: this measures model decisions, not the browser loop.
    if (pending) { try { await pending; } catch { /* retain the local fallback */ } await new Promise(resolve => setImmediate(resolve)); pending = null; }
    const input = bot.input(DT);
    if (input.crouch && crouchEdge) input.crouch = false;
    crouchEdge = Boolean(input.crouch);
    sim.step(DT, input);
  }
  sim.benchmark = { route, seed, mode, botStep: bot.stepIndex, botMode: bot.mode };
  return sim;
}

/** Retain counts and denominators; no opportunity is null, not a 0% success rate. */
export function summarise(sims) {
  const n = sims.length, sum = key => sims.reduce((total, sim) => total + (sim.metrics[key] || 0), 0);
  const minutes = sims.reduce((total, sim) => total + sim.t, 0) / 60;
  const detected = sims.filter(sim => sim.metrics.sightings > 0 || sim.metrics.cameraSightings > 0 || sim.metrics.alerts > 0);
  const reacquire = sims.flatMap(sim => sim.metrics.reacquireTimes);
  const searches = sum('searches'), reacquired = sum('reacquired'), recovered = sum('recoveries');
  const caughtDuringSearch = sims.filter(sim => sim.status === 'captured' && sim.net.lostEpisode).length;
  const censoredSearches = sims.filter(sim => sim.status === 'playing' && sim.net.lostEpisode).length;
  const extracted = sims.filter(sim => sim.status === 'extracted').length;
  const captured = sims.filter(sim => sim.status === 'captured').length;
  const timeout = sims.filter(sim => sim.status === 'playing').length;
  const undetected = sims.filter(sim => sim.status === 'extracted' && !sim.metrics.sightings && !sim.metrics.cameraSightings && !sim.metrics.alerts).length;
  const predictionsHit = sum('predictionsHit'), predictionsMiss = sum('predictionsMiss');
  const counts = { missions: n, extracted, captured, timeout, undetected, detected: detected.length,
    alerts: sum('alerts'), interceptions: sum('interceptions'), searches, reacquired, recovered, caughtDuringSearch, censoredSearches,
    predictionsHit, predictionsMiss, decisions: sum('decisions'), jevDecisions: sum('jevDecisions'), jevFailures: sum('jevFailures') };
  return { counts, minutes, extracted: ratio(extracted, n), captured: ratio(captured, n), timeout: ratio(timeout, n),
    undetected: ratio(undetected, n), detected: ratio(detected.length, n),
    alertsPerMin: ratio(counts.alerts, minutes), alertsPerMission: ratio(counts.alerts, n), interceptions: ratio(counts.interceptions, n),
    searchHit: ratio(reacquired, searches), reacquireS: ratio(reacquire.reduce((a, b) => a + b, 0), reacquire.length), recovery: ratio(recovered, searches),
    caughtAfterDetection: ratio(detected.filter(sim => sim.status === 'captured').length, detected.length),
    predictionHit: ratio(predictionsHit, predictionsHit + predictionsMiss),
    extractedAfterDetection: ratio(detected.filter(sim => sim.status === 'extracted').length, detected.length) };
}

const pct = value => value == null ? '   n/a' : (value * 100).toFixed(1).padStart(5) + '%';
const num = value => value == null ? '   n/a' : value.toFixed(2).padStart(6);
const header = `${'security'.padEnd(23)} ${'n'.padStart(3)} ${'extr'.padStart(6)} ${'capt'.padStart(6)} ${'limit'.padStart(6)} ${'quiet'.padStart(6)} ${'det'.padStart(6)} ${'al/min'.padStart(6)} ${'icpt/m'.padStart(6)} ${'find/s'.padStart(6)} ${'rec/s'.padStart(6)} ${'open/s'.padStart(6)}`;
function row(label, s) {
  return `${label.padEnd(23)} ${String(s.counts.missions).padStart(3)} ${pct(s.extracted)} ${pct(s.captured)} ${pct(s.timeout)} ${pct(s.undetected)} ${pct(s.detected)} ${num(s.alertsPerMin)} ${num(s.interceptions)} ${pct(s.searchHit)} ${pct(s.recovery)} ${String(s.counts.censoredSearches).padStart(6)}`;
}
function sample(sim) {
  return { ...sim.benchmark, difficulty: sim.rules.id, outcome: sim.status === 'playing' ? 'timeout' : sim.status,
    seconds: sim.t, finalTile: [Math.floor(sim.player.x / 16), Math.floor(sim.player.y / 16)], data: sim.player.data,
    metrics: sim.metrics, openSearch: Boolean(sim.net.lostEpisode), posture: sim.net.posture?.summary || null };
}

/** Synthetic radio report; original guard placements, no six-second blind spot. */
async function drill(mode, difficulty, seed, [name, tx, ty]) {
  const sim = new ShadowSim({ difficulty, seed, mode, dossier: emptyDossier() });
  sim.player.x = tx * 16 + 8; sim.player.y = ty * 16 + 8;
  sim.receive({ kind: 'sighting', from: 'eval-report', x: sim.player.x, y: sim.player.y, at: sim.t, heading: 0, pace: 'running' });
  const bot = new Bot(sim, { route: 'culvert', seed, habit: seed % 2 ? 'locker' : 'grass', aggression: 0, distract: 0 });
  bot.mode = 'flee'; bot.pickHide();
  let crouchEdge = false, locatedAt = null;
  for (let step = 0; step < 75 / DT && sim.status === 'playing'; step++) {
    const input = bot.input(DT);
    if (input.crouch && crouchEdge) input.crouch = false;
    crouchEdge = Boolean(input.crouch);
    sim.step(DT, input);
    if (locatedAt == null && sim.metrics.sightings > 0) locatedAt = sim.t;
  }
  sim.benchmark = { name, seed, mode, syntheticReport: true, locatedAt };
  return sim;
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    console.log('node tools/shadow-eval.mjs [--runs 4] [--difficulty normal,hard,extreme] [--routes culvert,keycard,fence] [--only missions,drill,adapt] [--limit 480] [--json path]');
    console.log('--jev enables billed mission decisions using OPENROUTER_API_KEY; --max-calls 100 caps total requests. Drills and adaptation stay local.');
    return;
  }
  const config = parseArgs(args), budget = { calls: 0, max: config.maxCalls };
  const remote = config.jev ? jevRemote(budget) : null;
  const report = { version: 2, generatedAt: new Date().toISOString(), config, liveJev: config.jev ? 'requested; inspect accepted decisions and failures' : 'not tested', missionGroups: [], drillGroups: [], adaptationGroups: [] };
  console.log(`Shadow Protocol · ${config.runs} seeds per route/cell · ${config.limit}s mission limit · map-aware scripted bot`);
  console.log('Paired seeds and bot rules; local commander and baseline differ in tactics, initial posture, and resulting patrols.');
  console.log('extr/capt/limit: mission outcomes; quiet: extracted without any detection; det: any detection; al/min: radio alarm episodes/minute.');
  console.log('icpt/m: confirmed interception sightings/mission (not captures); find/s and rec/s: reacquisition and stand-down/extraction per search started; open/s: searches censored at the time limit.');
  console.log('A timeout is unfinished play, not a win or proven deadlock. n/a means no observations. Live Jev ' + (config.jev ? 'enabled (billed, zero simulated latency).' : 'not tested; no network requests.') + '\n');
  const modes = config.jev ? ['baseline', 'commander', 'jev'] : ['baseline', 'commander'];
  for (const difficulty of config.sections.includes('missions') ? config.difficulties : []) {
    console.log(difficulty + '\n' + header);
    for (const mode of modes) {
      const sims = [];
      for (const route of config.routes) for (let i = 0; i < config.runs; i++) sims.push(await mission({ difficulty, mode, seed: 1000 + i * 7919, route, dossier: emptyDossier(), limit: config.limit, remote }));
      const summary = summarise(sims);
      console.log(row(mode === 'commander' ? 'local commander' : mode, summary));
      if (mode === 'jev') console.log(`  accepted live answers: ${summary.counts.jevDecisions}/${summary.counts.decisions}; failures: ${summary.counts.jevFailures}; requests: ${budget.calls}/${budget.max}`);
      report.missionGroups.push({ difficulty, mode, summary, samples: sims.map(sample) });
    }
    console.log('');
  }
  if (config.sections.includes('drill')) {
    console.log('Pursuit drill · synthetic report at seven fixed sites · 75s · original guard placements');
    console.log('Located = first actual guard/camera detection at any time after report; survival is not mission completion.');
    for (const difficulty of config.difficulties) for (const mode of ['baseline', 'commander']) {
      const sims = [];
      for (const spot of SPOTS) for (let i = 0; i < config.runs; i++) sims.push(await drill(mode, difficulty, 7000 + i * 613, spot));
      const summary = summarise(sims), located = sims.filter(sim => sim.benchmark.locatedAt != null).length;
      console.log(`${difficulty.padEnd(8)} ${mode.padEnd(10)} n=${sims.length} located ${pct(located / sims.length)} captured ${pct(summary.captured)} intercepts ${num(summary.interceptions)}/run recovery ${pct(summary.recovery)}/search`);
      report.drillGroups.push({ difficulty, mode, located, summary, samples: sims.map(sample) });
    }
    console.log('');
  }
  if (config.sections.includes('adapt')) {
    console.log('Adaptation · hard/culvert · five attempts · compare local commander fresh vs learned on matched seeds');
    console.log('Only completed missions update the learned dossier. Changing seeds or baseline comparison alone cannot establish adaptation benefit.');
    const groups = { baseline: [], fresh: [], learned: [] };
    for (let chain = 0; chain < config.runs; chain++) {
      let dossier = emptyDossier();
      for (let attempt = 0; attempt < 5; attempt++) for (const arm of ['baseline', 'fresh', 'learned']) {
        const sim = await mission({ difficulty: 'hard', mode: arm === 'baseline' ? 'baseline' : 'commander', seed: 50000 + chain * 104729 + attempt * 31, route: 'culvert', dossier: arm === 'learned' ? dossier : emptyDossier(), limit: config.limit });
        sim.benchmark.trainingAttempts = arm === 'learned' ? dossier.attempts : 0;
        (groups[arm][attempt] ||= []).push(sim);
        if (arm === 'learned' && sim.status !== 'playing') dossier = recordMission(dossier, sim.report());
      }
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      console.log(`attempt ${attempt + 1}\n${header}`);
      for (const arm of ['baseline', 'fresh', 'learned']) {
        const sims = groups[arm][attempt], summary = summarise(sims);
        console.log(row(arm, summary));
        report.adaptationGroups.push({ attempt: attempt + 1, arm, summary, samples: sims.map(sample) });
      }
    }
  }
  report.liveRequests = budget.calls;
  if (config.json) { await mkdir(dirname(config.json), { recursive: true }); await writeFile(config.json, JSON.stringify(report, null, 2) + '\n'); console.log('\nResults: ' + config.json); }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
