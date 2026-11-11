// How much looking-up a message deserves: the question Pocket puts to JEV before a server reply, the state it
// asks about, and the limits and note that follow from the level. The levels are Pocket's, not JEV's, so a
// missing or unusable answer leaves the reply on its usual limits.

import { answerText } from './pip-reply.js';

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
  return null;
}

/** The sentence the model reads for a level; nothing for thorough, which needs no explanation. */
export function effortNote(level) {
  if (level === 'none') return 'Pocket judged that this message needs no looking-up: answer directly; look something up only if you cannot answer without it.';
  if (level === 'quick') return 'Pocket judged that this message needs one or two lookups: make them and answer.';
  return '';
}
