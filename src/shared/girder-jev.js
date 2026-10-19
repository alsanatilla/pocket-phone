// JEV's shared contract: the OpenRouter Decisions API, typed questions and the
// mapping from its answers to one barrel throw. No free-form model prose.
export const JEV_MODEL = 'typesafe/jev-1.14';
export const JEV_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';

export const JEV_GAME = Object.freeze({
  genre: 'barrel-dodging arcade roguelike',
  goal: 'Choose the next fair but challenging barrel throw.',
  coordinates: 'The screen is 320x240. x grows right, y grows down. Girders are horizontal rows at y = row * 16.',
  actions: 'hand chooses the rolling direction. barrel is normal, wild or ladder. ladder uses one of the listed shafts. second adds another barrel 260 ms later. pace becomes the pause before the next throw.',
  fairness: 'Ease off when the player has one heart and no free hit, second wind or safe fall. Pressure a safety net. Throw away from an active hammer. A ladder drop at the climbing column is readable. Guard coins if the player is coin-hungry.',
});

const topShafts = ladders => (Array.isArray(ladders) ? ladders : [])
  .filter(ladder => ladder && ladder.topRow === 2)
  .map(ladder => ({ col: Math.max(0, Math.min(19, Number(ladder.col) || 0)) }))
  .sort((a, b) => a.col - b.col);

export function jevQuestions(ladders = []) {
  const shafts = topShafts(ladders);
  const criteria = {};
  for (const shaft of shafts) criteria['shaft_' + shaft.col] = `Drop straight down the ladder at column ${shaft.col}, ${shaft.col * 16 + 8}px from the left.`;
  if (!Object.keys(criteria).length) criteria.shaft_10 = 'Drop down the central shaft.';
  return {
    hand: {
      type: 'choice',
      instructions: 'Which hand should throw the next barrel? The barrel rolls in that direction.',
      criteria: {
        left: 'Throw from the left hand; the barrel rolls left.',
        right: 'Throw from the right hand; the barrel rolls right.',
      },
    },
    barrel: {
      type: 'choice',
      instructions: 'What kind of barrel should come next?',
      criteria: {
        normal: 'A normal barrel that rolls along the girders and falls at gaps or edges.',
        wild: 'A wild barrel that may drop down a ladder while rolling.',
        ladder: 'A barrel dropped straight down a ladder shaft from the top.',
      },
    },
    shaft: {
      type: 'choice',
      instructions: 'If the barrel is a ladder drop, which real shaft should it fall down?',
      criteria,
    },
    second: {
      type: 'noul',
      instructions: 'Should a second barrel follow 260 ms after the first?',
      criteria: { true: 'Two barrels make a short burst.', false: 'One barrel only.' },
    },
    pace: {
      type: 'score',
      instructions: 'How long should the keeper wait before the next throw?',
      criteria: ['Immediate — about 1.2s', 'Measured — about 2.0s', 'Patient — about 2.8s', 'Long breath — about 3.6s'],
    },
  };
}

const topCols = ladders => new Set(topShafts(ladders).map(ladder => ladder.col));

/** Maps Jev's typed answers onto the throw the game knows how to perform. */
export function jevDecisionFromAnswers(answers, ladders = [], fallbackDelay = 2) {
  if (!answers || answers.hand?.type !== 'choice' || answers.barrel?.type !== 'choice') return null;
  const hand = answers.hand.choice === 'left' ? -1 : 1;
  const kind = ['normal', 'wild', 'ladder'].includes(answers.barrel.choice) ? answers.barrel.choice : 'normal';
  let dropCol = null;
  const shaft = answers.shaft?.type === 'choice' ? /^shaft_(\d{1,2})$/.exec(answers.shaft.choice) : null;
  if (shaft) dropCol = Number(shaft[1]);
  const allowed = topCols(ladders);
  if (kind === 'ladder' && (dropCol == null || !allowed.has(dropCol))) {
    dropCol = [...allowed][0] ?? 10;
  }
  const double = answers.second?.type === 'noul' && Number(answers.second.noul) >= .55;
  const scored = answers.pace?.type === 'score' ? Number(answers.pace.score) : null;
  const pace = scored == null ? 1 : Math.max(0, Math.min(3, Number.isFinite(scored) ? scored : 1));
  const delay = scored == null
    ? Math.max(1.1, Math.min(3.8, Number(fallbackDelay) || 2))
    : Math.max(1.1, Math.min(3.8, 1.2 + pace / 3 * 2.4));
  const paceName = pace < .5 ? 'quick' : pace < 1.5 ? 'measured' : pace < 2.5 ? 'patient' : 'long';
  const intent = `${kind === 'ladder' ? 'ladder drop' : kind === 'wild' ? 'wild barrel' : 'barrel'} · ${hand < 0 ? 'left' : 'right'}${double ? ' · double' : ''} · ${paceName}`;
  return {
    hand,
    kind,
    dropCol,
    double,
    delay,
    intent,
    confidence: {
      hand: Number(answers.hand.confidence) || 0,
      barrel: Number(answers.barrel.confidence) || 0,
      second: answers.second?.type === 'noul' ? Number(answers.second.noul) || 0 : 0,
      pace: Number(answers.pace?.confidence) || 0,
    },
  };
}

export function jevDecisionFromResponse(response, ladders = [], fallbackDelay = 2) {
  return jevDecisionFromAnswers(response?.answers, ladders, fallbackDelay);
}
