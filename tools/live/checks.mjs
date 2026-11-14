// Pure checks on one finished live run. Each takes the run record (see run in scenarios.mjs: the final state,
// the error if it threw, every streamed answer, the request bodies sent, and the world's writes) and returns
// { pass, reason } with a one-line reason either way.

import { segmentAnswer, answerText } from '../../src/shared/pip-reply.js';
import { pocketSpec } from '../../src/shared/pocket-spec.js';
import { answerPieces } from '../../src/shared/pip-steer.js';

const ok = reason => ({ pass: true, reason });
const no = reason => ({ pass: false, reason });
const clip = (text, n = 90) => { const line = String(text ?? '').replace(/\s+/g, ' ').trim(); return line.length > n ? line.slice(0, n - 1) + '…' : line; };

export const LENGTH_NOTICE = 'The reply limit per message was reached.';
export const EMPTY_FALLBACK = 'Research stopped before a final answer was available.';
/** A card stand-in a model wrote as text, such as "[card: Table …]". */
export const STAND_IN = /^\s*\[card\b.*\]\s*$/;

/** Cards in an answer, as specs with their element types. */
export function cardsOf(answer) {
  return segmentAnswer(String(answer || '')).filter(segment => segment.kind === 'card').map(segment => {
    const spec = pocketSpec(segment.source) || {};
    return { spec, id: spec.id || '', types: Object.values(spec.elements || {}).map(element => element?.type).filter(Boolean), source: segment.source };
  });
}
const rows = (run, name) => (run.final.activity || []).filter(row => row.name === name);
const parsed = row => { try { return JSON.parse(row.result || 'null') || {}; } catch { return {}; } };
const drawnRows = run => rows(run, 'show_card').filter(row => parsed(row).drawn === true);

export function done(run) {
  if (run.error) return no('threw: ' + clip(run.error));
  return run.final.phase === 'done' ? ok('phase done') : no('phase ' + run.final.phase);
}
export function cardDrawn(run, type) {
  const cards = cardsOf(run.final.answer), drawn = drawnRows(run).length;
  if (!drawn) return no('no card drawn with show_card' + (cards.length ? ` (${cards.length} card(s) in the answer came from text)` : ''));
  if (!cards.length) return no('show_card ran but no card is in the answer');
  if (cards.length > drawn) return no(`${cards.length} cards in the answer, only ${drawn} drawn with show_card`);
  const types = [].concat(type);
  if (type && !cards.some(card => card.types.some(t => types.includes(t)))) return no(`no ${types.join('/')} in the cards (${cards.map(card => card.types.join('+')).join(', ')})`);
  return ok(`${drawn} card(s) drawn by show_card` + (type ? `, with a ${types.join('/')}` : ''));
}
/** No card stand-in anywhere the model's text stood while it streamed (the stored form drops them, so the stream is read). */
export function noStandIn(run) {
  for (const answer of [...run.answers, run.final.answer]) {
    const line = String(answer || '').split('\n').find(item => STAND_IN.test(item));
    if (line) return no('card written as text: ' + clip(line, 70));
  }
  return ok('no card stand-in in the text');
}
/** The prose holds no card source: no fence, no JSON patch line, no raw spec. */
export function cleanProse(run) {
  const prose = answerText(run.final.answer);
  if (/```pocket/.test(prose)) return no('a ```pocket fence in the prose');
  if (/^\s*\{\s*"op"\s*:/m.test(prose)) return no('a JSON patch line in the prose');
  if (/"elements"\s*:|"root"\s*:/.test(prose)) return no('raw card JSON in the prose');
  return ok('prose holds no card source');
}
export function requestsAtMost(run, limit) {
  return run.requests <= limit ? ok(`${run.requests} model request(s), limit ${limit}`) : no(`${run.requests} model requests, more than ${limit}`);
}
export function lookupsRefused(run) {
  const refused = (run.final.activity || []).filter(row => /research_budget_reached/.test(row.result || ''));
  return refused.length ? ok(`${refused.length} lookup(s) refused at the cap`) : no('no lookup was refused: the cap was never reached');
}
/** A card drawn after the first refused lookup (activity rows are in the order the calls started). */
export function cardAfterRefusal(run, types) {
  const list = run.final.activity || [], refused = list.findIndex(row => /research_budget_reached/.test(row.result || ''));
  if (refused < 0) return no('no refused lookup to come after');
  const after = list.slice(refused + 1).filter(row => row.name === 'show_card' && parsed(row).drawn === true);
  if (!after.length) return no('no card drawn after the lookups were refused');
  const cards = cardsOf(run.final.answer);
  return cards.some(card => card.types.some(t => types.includes(t))) ? ok(`card drawn after the refusal, with a ${types.join('/')}`) : no(`card drawn after the refusal, but no ${types.join('/')}`);
}
export function citesUrls(run, urls) {
  const text = String(run.final.answer || ''), cited = urls.filter(url => text.includes(url) || text.includes(url.replace(/^https:\/\//, '')));
  return cited.length ? ok('cites ' + cited.map(url => new URL(url).hostname).join(', ')) : no('cites none of the canned urls');
}
export function updatedCard(run, id) {
  const calls = rows(run, 'update_card'), hit = calls.find(row => { try { return JSON.parse(row.input || '{}').id === id; } catch { return false; } });
  if (!hit) return no(calls.length ? 'update_card called with other ids: ' + calls.map(row => clip(row.input, 30)).join(', ') : 'update_card not called');
  return parsed(hit).updated ? ok('update_card changed ' + id) : no('update_card on ' + id + ' failed: ' + clip(hit.summary || hit.result, 60));
}
export function noNewCard(run) {
  const drawn = drawnRows(run).length, cards = cardsOf(run.final.answer).length;
  return !drawn && !cards ? ok('no second card') : no(`${drawn} card(s) drawn, ${cards} in the answer`);
}
export function earlierCardShows(run, id, text) {
  const changed = run.world.earlierChanges.at(-1), card = changed && cardsOf(changed.answer).find(item => item.id === id);
  if (!card) return no('the earlier card was not saved changed');
  return card.source.includes(text) ? ok(`the earlier card now shows ${text}`) : no(`the earlier card does not show ${text}`);
}
export function oneTaskSaved(run, due) {
  const calls = rows(run, 'create_record'), tasks = run.world.saves.filter(save => save.name === 'create_record');
  if (calls.length !== 1) return no(`${calls.length} create_record calls, expected one`);
  if (tasks.length !== 1) return no(`${tasks.length} saves, expected one`);
  const input = tasks[0].input;
  if (input.kind !== 'task') return no('saved a ' + input.kind + ', not a task');
  if (input.due !== due) return no(`due ${input.due || '(none)'}, expected ${due}`);
  return ok(`one task “${clip(input.title, 40)}” due ${due}, saved once`);
}
export function nothingSaved(run) {
  const asked = rows(run, 'create_record').length;
  return run.world.saves.length ? no(`${run.world.saves.length} save(s) after the decline`) : ok(`nothing saved (${asked} request(s) declined)`);
}
/** Says it was not saved, and never claims it was. */
export function saysDeclined(run) {
  const prose = answerText(run.final.answer);
  const claim = /\b(?:i(?:'ve|’ve| have)? (?:saved|added|created)|(?:has|have) been (?:saved|added|created)|is now (?:saved|on your list)|ist (?:jetzt )?gespeichert)\b/i;
  const negated = /\b(?:not|n't|n’t|never|declin\w*|nicht|abgelehnt)\b/i;
  const sentence = prose.split(/(?<=[.!?])\s+/).find(item => claim.test(item) && !negated.test(item));
  if (sentence) return no('claims a save: ' + clip(sentence, 70));
  return /declin|not (?:been )?saved|did(?:n't|n’t| not) save|was(?:n't|n’t| not) saved|not added|won't|won’t|abgelehnt|nicht gespeichert|nicht angelegt/i.test(prose) ? ok('says it was not saved') : no('does not say it was not saved: ' + clip(prose, 70));
}
export function noTools(run) {
  const list = run.final.activity || [];
  return list.length ? no('tools called: ' + [...new Set(list.map(row => row.name))].join(', ')) : ok('no tools');
}
export function shortAnswer(run, limit) {
  const text = answerText(run.final.answer).trim();
  if (!text) return no('empty answer');
  return text.length < limit ? ok(`${text.length} characters`) : no(`${text.length} characters, ${limit} or more`);
}
export function outputTokensUnder(run, limit) {
  const n = run.final.usage?.output_tokens;
  if (typeof n !== 'number') return no('no output tokens reported');
  return n < limit ? ok(`${n} output tokens`) : no(`${n} output tokens, ${limit} or more`);
}
/** Done, or ended with the reply-limit notice and a partial answer; never empty, never another error. */
export function limitHandled(run) {
  const answer = String(run.final.answer || '');
  if (!run.error) return run.final.phase === 'done' && answerText(answer).trim() ? ok('done within the limit') : no('phase ' + run.final.phase + (answerText(answer).trim() ? '' : ', empty answer'));
  if (!run.error.includes(LENGTH_NOTICE)) return no('threw another error: ' + clip(run.error));
  const partial = answer.slice(0, answer.indexOf(LENGTH_NOTICE)).replace(EMPTY_FALLBACK, '').trim();
  return answerText(partial).trim() ? ok('limit notice with a partial answer of ' + answerText(partial).trim().length + ' characters') : no('limit notice with an empty answer');
}
export function steerTaken(run, text) {
  const steers = run.final.steers || [];
  if (!run.steerSent) return no('the steering message was never sent: no tool call was seen');
  if (!steers.some(item => item.text === text)) return no('the steering message was not taken into the reply');
  const delivered = run.bodies.some(body => JSON.stringify(body).includes(text));
  return delivered ? ok('taken at ' + steers[0].pos + ' and sent to the model') : no('taken, but no request carried it');
}
/** The answer after the steering message mentions the tour and names none of the restaurants the canned food page lists. */
export function followsSteer(run, restaurants) {
  const after = answerPieces(run.final.answer, run.final.steers || []).at(-1) || '';
  const prose = answerText(after) + '\n' + cardsOf(after).map(card => card.source).join('\n');
  if (!/bosphorus|boğaz|bogaz|tour|cruise|ferry/i.test(prose)) return no('the answer after the message does not mention the tour');
  const listed = restaurants.filter(name => prose.includes(name));
  return listed.length ? no('still lists restaurants: ' + listed.join(', ')) : ok('tour only, no restaurant list');
}

// Language. Function words are short, frequent and topic-free, so their counts say which language prose is in.
// Words both languages share ("in", "an", "so", "was", "die" is kept: English "die" is rare) are left out.
export const GERMAN_WORDS = ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ich', 'du', 'sie', 'es', 'ein', 'eine', 'einen', 'mit', 'für', 'auf', 'zu', 'von', 'den', 'dem', 'im', 'um', 'hast', 'bist', 'auch', 'noch', 'oder', 'aber', 'wie', 'dein', 'deine', 'morgen', 'heute', 'steht', 'sind', 'wird', 'bei', 'nach', 'vor', 'uhr'];
export const ENGLISH_WORDS = ['the', 'and', 'is', 'are', 'you', 'your', 'to', 'of', 'for', 'with', 'on', 'at', 'it', 'this', 'that', 'have', 'has', 'be', 'will', 'tomorrow', 'today', 'there', 'what', 'from', 'by', 'or', 'but', 'not'];
export function languageShare(text) {
  const words = String(text || '').toLowerCase().match(/[\p{L}]+/gu) || [];
  const de = words.filter(word => GERMAN_WORDS.includes(word)).length, en = words.filter(word => ENGLISH_WORDS.includes(word)).length;
  return { de, en, share: de + en ? de / (de + en) : 0 };
}
/** German prose: at least three German function words and at least 70% of the function words counted are German. */
export function german(run) {
  const { de, en, share } = languageShare(answerText(run.final.answer));
  return de >= 3 && share >= 0.7 ? ok(`German (${de} German, ${en} English function words)`) : no(`not German (${de} German, ${en} English function words)`);
}
