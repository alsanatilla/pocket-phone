// The fixed requests a live check sends through the real server reply loop (streamChat), and what each must show.
// Each scenario: the message, any earlier turns (stored cards included, so the history replay runs), the effort
// level standing in for JEV, then its checks. `cost` is the usual number of model requests, for the estimate.

import { streamChat, MAX_REQUESTS } from '../../src/server/pip-agent.js';
import { cardFence } from '../../src/shared/pocket-card-tool.js';
import { createWorld, chatValue, chatRequest, localDay, PAGES, RESTAURANTS } from './world.mjs';
import * as check from './checks.mjs';

const PLAN = 'Plan my Saturday in Istanbul: Beyoğlu lokanta for lunch, short Bosphorus tour from Eminönü at 15:00';
export const STEER = 'only the short tour, skip restaurants';
export const PLAN_CARD_ID = 'kplan01';
const PLAN_SPEC = { root: 'main', elements: { main: { type: 'Timeline', props: { title: 'Saturday in Istanbul', items: [
  { time: '12:30', title: 'Lunch at Hacı Abdullah', detail: 'Beyoğlu, near İstiklal' },
  { time: '15:00', title: 'Short Bosphorus tour', detail: 'From Eminönü pier, about 2 hours' }] }, children: [] } } };
/** An earlier finished turn whose answer holds a drawn card with an id, stored the way Pocket stores it. */
const planTurn = () => ({ uid: 'earlier-plan', text: PLAN, context: [], created: Date.now() - 600000, updated: Date.now() - 590000, status: 'done',
  answer: 'Here is your Saturday:\n\n' + cardFence(PLAN_SPEC, { id: PLAN_CARD_ID }) + '\n\nTake the tram from Karaköy to Eminönü after lunch.',
  reasoning: '', activity: [], sources: [] });
const TOURS = PAGES.slice(0, 2).map(page => page.url);

export const SCENARIOS = [
  { name: 'plan-card', cost: 2, guards: 'a plan is drawn with show_card as a Timeline, never written as "[card: …]" text or raw JSON',
    text: PLAN, checks: run => [['done', check.done(run)], ['card', check.cardDrawn(run, 'Timeline')], ['no stand-in', check.noStandIn(run)], ['clean prose', check.cleanProse(run)]] },
  { name: 'card-after-history', cost: 4, guards: 'with a stored card in the replayed history, a new card is still drawn by tool call (the original bug)',
    turns: [planTurn()], text: 'Leave that plan card as it is. Draw a second, separate card: a table with one row per stop of the plan and the columns stop, what to bring and what to wear, from your own judgement. No need to look anything up.', effort: 'none',
    checks: run => [['done', check.done(run)], ['new card', check.cardDrawn(run, 'Table')], ['no stand-in', check.noStandIn(run)], ['clean prose', check.cleanProse(run)]] },
  { name: 'research-then-card', cost: 4, guards: 'after lookups are refused at the cap, the reply still draws its card, cites its sources and ends',
    text: 'Which Bosphorus tour from Eminönü is cheaper and shorter, the city ferries\' short tour or Turyol? Look both up on the web and show me the comparison.',
    research: { lookups: 2, webCalls: 2 },
    checks: run => [['done', check.done(run)], ['refused', check.lookupsRefused(run)], ['card after', check.cardAfterRefusal(run, ['Table', 'Chart'])], ['cites', check.citesUrls(run, TOURS)], ['requests', check.requestsAtMost(run, MAX_REQUESTS)], ['no stand-in', check.noStandIn(run)]] },
  { name: 'update-card', cost: 2, guards: 'a change to a card in an earlier reply goes through update_card with its id, not a second card',
    turns: [planTurn()], text: 'change the lunch to 13:00', effort: 'none',
    checks: run => [['done', check.done(run)], ['update_card', check.updatedCard(run, PLAN_CARD_ID)], ['no new card', check.noNewCard(run)], ['changed', check.earlierCardShows(run, PLAN_CARD_ID, '13:00')]] },
  { name: 'save-with-approval', cost: 2, guards: 'an approved task is asked for once, with tomorrow as its due date, and saved once',
    text: 'Save a task: call the landlord tomorrow', effort: 'none', approve: true,
    checks: run => [['done', check.done(run)], ['saved once', check.oneTaskSaved(run, localDay(1))]] },
  { name: 'save-declined', cost: 2, guards: 'a declined save saves nothing and the answer says so instead of claiming it',
    text: 'Save a task: call the landlord tomorrow', effort: 'none', approve: false,
    checks: run => [['done', check.done(run)], ['nothing saved', check.nothingSaved(run)], ['says so', check.saysDeclined(run)]] },
  { name: 'steer', cost: 4, guards: 'a message sent while Pip works is taken into the same reply and changes its answer',
    text: 'Plan my Saturday in Istanbul: look up a good Beyoğlu lokanta for lunch and a short Bosphorus tour from Eminönü on the web.', steer: STEER,
    checks: run => [['done', check.done(run)], ['taken', check.steerTaken(run, STEER)], ['follows', check.followsSteer(run, RESTAURANTS)]] },
  { name: 'language', cost: 3, guards: 'a German question gets a German answer (thinking may be in any language)',
    text: 'Was steht morgen an?', checks: run => [['done', check.done(run)], ['German', check.german(run)]] },
  { name: 'no-runaway', cost: 1, guards: 'a greeting is answered in one or two requests, without tools, briefly',
    text: 'Hey', effort: 'none',
    checks: run => [['done', check.done(run)], ['requests', check.requestsAtMost(run, 2)], ['no tools', check.noTools(run)], ['short', check.shortAnswer(run, 600)], ['output', check.outputTokensUnder(run, 4000)]] },
  { name: 'thinking-limit', cost: 3, guards: 'with a 1,024-token reply limit, the reply finishes or ends with the limit notice and a partial answer',
    text: PLAN, maxTokens: 1024, checks: run => [['handled', check.limitHandled(run)]] },
];

const clipped = (text, n) => String(text ?? '').slice(0, n);

/**
 * One run of a scenario against a provider: the real request building and the real loop, with the world's tools.
 * `fetcher` makes the model's HTTP requests (fetch for a real model, a fixture provider in the selftest).
 */
export async function runScenario(scenario, { provider, baseUrl, model, key, fetcher = fetch }) {
  const world = createWorld(), value = chatValue({ provider, baseUrl, model, maxTokens: scenario.maxTokens || 4096 });
  const { chat, turn, body, coverage, research } = chatRequest(value, { text: scenario.text, turns: scenario.turns, effort: scenario.effort || 'quick', research: scenario.research });
  const run = { world, bodies: [], answers: [], requests: 0, final: { answer: '', activity: [], phase: 'requesting', usage: {} }, error: '', steerSent: false };
  // Counted here, at HTTP: a provider retry is one more request.
  const counted = async (url, init) => { run.requests++; try { run.bodies.push(JSON.parse(init.body)); } catch { /* not JSON */ } return fetcher(url, init); };
  // Steering as pip-runs.js passes it: take() hands over the messages waiting for this run, marked taken at `pos`.
  // The message is sent the moment the first tool call shows in the activity.
  const waiting = [];
  const steering = scenario.steer ? { take: async ({ pos }) => {
    const fresh = waiting.splice(0).map(item => ({ ...item, taken: Date.now(), pos }));
    if (fresh.length) turn.steers = [...(turn.steers || []), ...fresh];
    return fresh;
  } } : undefined;
  const onUpdate = update => {
    run.final = update; run.answers.push(update.answer);
    if (scenario.steer && !run.steerSent && update.activity?.length) { run.steerSent = true; waiting.push({ uid: 'live-steer', text: scenario.steer, at: Date.now() }); }
  };
  const approve = async requests => new Map(requests.map(request => { world.approvals.push({ tool: request.toolName, input: request.input }); return [request.toolCallId, { approved: Boolean(scenario.approve) }]; }));
  const started = Date.now();
  try {
    run.final = await streamChat(chat, turn, { value, body, key, fetcher: counted, onUpdate, executeTool: world.executeTool, previewTool: world.previewTool,
      approve, saveTurn: world.saveTurn, coverage, ...(research ? { research } : {}), ...(steering ? { steering } : {}) });
  } catch (error) { run.error = String(error?.message || error || 'failed'); }
  run.durationMs = Date.now() - started;
  const checks = scenario.checks(run).map(([name, result]) => ({ name, ...result }));
  const usage = run.final.usage || {};
  const record = { pass: checks.every(item => item.pass), checks, requests: run.requests, input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0, duration_ms: run.durationMs };
  if (!record.pass) record.failure = { error: run.error, answer: clipped(run.final.answer, 1500),
    activity: (run.final.activity || []).map(row => ({ name: row.name, state: row.state, summary: row.summary })), reasoning: String(run.final.reasoning || '').slice(-800) };
  return record;
}
