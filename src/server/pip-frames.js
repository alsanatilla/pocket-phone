// What a follower is sent of a run: only what it does not have yet. Used by the run's SSE stream and by the
// account's live socket alike.

/**
 * A frame without what this follower already has: the answer and reasoning as the text added since its last frame
 * (`append`), and the activity and sources only when they changed. A field left out is unchanged. A text that no
 * longer starts with what was sent (it moved into the reasoning, or restarted) is sent whole. `at` says where each
 * appended text starts, so a follower that missed a frame can tell and ask for the whole state.
 */
export function compactFrame(frame, sent) {
  const turn = frame?.run?.turn;
  if (!turn || typeof turn !== 'object') return frame;
  const out = { ...turn }, append = {}, at = {};
  for (const field of ['answer', 'reasoning']) {
    const value = String(turn[field] ?? ''), before = sent[field];
    if (typeof before === 'string' && value.length >= before.length && value.startsWith(before)) {
      delete out[field];
      if (value.length > before.length) { append[field] = value.slice(before.length); at[field] = before.length; }
    }
    sent[field] = value;
  }
  for (const field of ['activity', 'sources']) {
    const text = JSON.stringify(turn[field] ?? []);
    if (sent[field] === text) delete out[field];
    sent[field] = text;
  }
  return { ...frame, run: { ...frame.run, turn: out }, ...(Object.keys(append).length ? { append, at } : {}) };
}
