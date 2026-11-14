// Messages the person sends into a reply while Pip works on it (docs/pip-agent-runtime.md, "Steering").
//
// A taken message is kept on its turn, in the order taken, as `turn.steers = [{ uid, text, at, taken, pos }]`: `pos`
// is where it stands in the answer (the answer's length when the model received it), so the answer reads as
// "what Pip had written, the person's message, what Pip wrote after it". Everything that shows or replays a turn
// cuts its answer here: the chat, the live blocks, the stored form and the model's own history.

/** At most this many messages go into one running reply; one more waits its turn after the reply, as before. */
export const MAX_STEERS = 5;

/** What the model reads for a message sent while it worked: the same words live and in every later replay. */
export const steerText = text => '(The person sent this while you were working on this reply. Take it into account and carry on with the same reply.)\n\n' + String(text || '');

/** The steering messages a turn holds that reached the model, in the order they did. */
export const takenSteers = steers => (Array.isArray(steers) ? steers : []).filter(item => item && typeof item === 'object' && typeof item.text === 'string' && item.taken);

/** The answer cut at its taken steering messages: always one piece more than there are messages. */
export function answerPieces(answer, steers) {
  const text = String(answer || ''), pieces = [];
  let from = 0;
  for (const item of takenSteers(steers)) {
    const at = Math.max(from, Math.min(text.length, Math.max(0, Number(item.pos) || 0)));
    pieces.push(text.slice(from, at)); from = at;
  }
  pieces.push(text.slice(from));
  return pieces;
}

/**
 * Pieces joined into one answer again, each made clean on its own (a card never spans a message), and the messages
 * placed where their piece ends. Empty pieces leave no blank lines behind.
 */
export function joinPieces(pieces, steers, clean = value => value) {
  const taken = takenSteers(steers), placed = [];
  let answer = '';
  pieces.forEach((piece, index) => {
    const text = clean(piece);
    if (String(text).trim()) answer += (answer ? '\n\n' : '') + text;
    if (index < taken.length) placed.push({ ...taken[index], pos: answer.length });
  });
  return { answer, steers: placed };
}

/** A turn's steering messages as the synced chat keeps them: at most MAX_STEERS, each bounded like a message. */
export const storedSteers = steers => takenSteers(steers).slice(0, MAX_STEERS).map(item => ({
  uid: String(item.uid || '').slice(0, 100), text: item.text.slice(0, 16000), at: Number(item.at) || 0, taken: Number(item.taken) || 0, pos: Math.max(0, Number(item.pos) || 0) }));
