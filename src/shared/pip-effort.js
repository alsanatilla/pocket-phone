// How much looking-up a message deserves, and whether what it found is enough: the questions Pocket puts to JEV
// before and during a server reply, the state it asks about, and the limits and note that follow from the level.
// The levels are Pocket's, not JEV's, so a missing or unusable answer leaves the reply on its usual limits.

import { answerText } from './pip-reply.js';
import { STATE_TOOLS, WRITE_TOOLS } from '../client/pip-tools.js';

export const EFFORT_LEVELS = ['none', 'quick', 'thorough'];

const brief = (text, limit) => String(text ?? '').slice(0, limit);

/** The JEV questions object for one effort judgment: one choice named `effort`. */
export function effortQuestions() {
  return {
    effort: {
      type: 'choice',
      instructions: 'How much looking-up does a good answer to this message need before the assistant writes?',
      criteria: {
        none: 'It can be answered from the conversation and general knowledge: small talk, a rewrite, a calculation, an opinion, a follow-up on what was just said.',
        quick: 'It needs one or two lookups: one fact from the person\'s notes, tasks or calendar, or one web search for a current fact.',
        thorough: 'It needs several sources compared or a topic researched, or the person asks for thorough research: a purchase comparison, a plan built from many records, a question where sources disagree.',
      },
    },
  };
}

/**
 * The JEV state object for one message: its text, how many sources are attached, and the last two finished
 * turns before it. Answers go through answerText, so a card's source is never sent to the judge.
 */
export function effortState(turn, earlier) {
  const finished = (Array.isArray(earlier) ? earlier : [])
    .filter(item => item && String(item.status || '') !== 'streaming')
    .slice(-2);
  return {
    assistant: 'A personal assistant that can read the person\'s notes, tasks and calendar and search the web.',
    message: brief(turn?.text, 2000),
    attached: Array.isArray(turn?.context) ? turn.context.length : 0,
    recent: finished.map(item => ({ asked: brief(item.text, 400), answered: brief(answerText(item.answer), 400) })),
  };
}

/** The level JEV chose, or null when its answer is not one of Pocket's levels. */
export function effortFromAnswers(answers) {
  const effort = answers?.effort;
  return effort?.type === 'choice' && EFFORT_LEVELS.includes(effort.choice) ? effort.choice : null;
}

/** The lookup and web-call limits a level allows, or null when it leaves today's limits alone. */
export function effortLimits(level) {
  if (level === 'none') return { lookups: 1, webCalls: 0 };
  if (level === 'quick') return { lookups: 3, webCalls: 2 };
  if (level === 'thorough') return { lookups: 10, webCalls: 5 };
  return null;
}

/** The sentence the model reads for a level, or nothing for a level Pocket does not know. */
export function effortNote(level) {
  if (level === 'none') return 'Pocket judged that this message needs no looking-up: answer directly; look something up only if you cannot answer without it.';
  if (level === 'quick') return 'Pocket judged that this message needs one or two lookups: make them and answer.';
  if (level === 'thorough') return 'Pocket judged that this message deserves thorough looking-up: up to ten lookups. Search with other words only when the first words found nothing, read what you found once, then answer.';
  return '';
}

/** The JEV questions object for one "is this enough?" judgment: one choice named `enough`. */
export function enoughQuestions() {
  return {
    enough: {
      type: 'choice',
      instructions: 'Can the assistant give a good answer to the message with what it has looked up so far?',
      criteria: {
        yes: 'What was found covers what the message asks; more lookups would repeat or add detail nobody asked for.',
        no: 'Something the message asks for has not been found yet, or the findings contradict each other.',
      },
    },
  };
}

/**
 * The JEV state object for one "is this enough?" judgment: the message, and the finished lookups so far as what
 * each one did and the start of what it found. Cards, writes and failed rows are not lookups.
 */
export function enoughState(turn, rows) {
  const finished = (Array.isArray(rows) ? rows : Array.isArray(turn?.activity) ? turn.activity : [])
    .filter(row => row && row.state === 'done' && !WRITE_TOOLS.includes(row.name) && !STATE_TOOLS.includes(row.name))
    .slice(-12);
  return {
    message: brief(turn?.text, 2000),
    found: finished.map(row => ({ did: brief(row.title, 120), got: brief(row.result, 300) })),
  };
}

/** Whether JEV said what was found is enough, or null when its answer is not a choice of yes or no. */
export function enoughFromAnswers(answers) {
  const enough = answers?.enough;
  if (enough?.type !== 'choice') return null;
  if (enough.choice === 'yes') return true;
  if (enough.choice === 'no') return false;
  return null;
}
