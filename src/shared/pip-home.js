// Pip's one ongoing conversation, kept as a chain of ordinary chats marked `home`. A segment is a chat like any
// other, so the writers, the log and the merge stay unchanged; these rules only say which segment is current, when
// the next one starts and what the model sees of the segment before it.

export const HOME_TITLE = 'pip', HOME_TURNS = 60, HOME_BYTES = 400_000, HOME_TAIL = 6;

/** The order the segments are read in: oldest first, by created then uid. */
const order = (a, b) => a.created - b.created || String(a.uid).localeCompare(String(b.uid));

/** The home segments in `chats`, oldest first; deleted and ordinary chats are left out. */
export function homeSegments(chats) {
  return (Array.isArray(chats) ? chats : []).filter(chat => chat && chat.home === true && !chat.deleted).sort(order);
}

/** The home segment created last, or null when the account has none. */
export function currentHome(chats) {
  return homeSegments(chats).at(-1) ?? null;
}

/** Whether a chat has reached its turn or size limit; a chat whose last turn still streams is never full. */
export function homeFull(chat) {
  if (!chat) return false;
  const turns = Array.isArray(chat.turns) ? chat.turns : [];
  if (turns.at(-1)?.status === 'streaming') return false;
  return turns.length >= HOME_TURNS || JSON.stringify(chat).length >= HOME_BYTES;
}

/** The last finished turns of the segment before `chat`, or none when it is not a later home segment or needs no tail. */
export function homeTail(segments, chat) {
  if (!chat || chat.home !== true) return [];
  const at = segments.findIndex(item => item?.uid === chat.uid);
  if (at <= 0 || (chat.turns || []).length >= HOME_TAIL) return [];
  return (segments[at - 1]?.turns || []).filter(turn => turn?.status === 'done').slice(-HOME_TAIL);
}
