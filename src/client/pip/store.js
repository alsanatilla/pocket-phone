// The chat's shape, independent of React and of the runner.
//
// One place that says what a conversation looks like: a heading, a list of turns, each with a body that may
// contain prose, activity, proposals and a card. Components read this; the runner writes it through set().
// Nothing here touches the DOM, so the same state can feed a test or a future mobile surface.

export function createChatStore(initial = {}) {
  let state = {
    chat: null,
    config: null,
    turns: [],
    active: null,
    starters: [],
    ...initial
  };
  const listeners = new Set();
  const emit = () => {
    for (const listener of listeners) listener();
  };

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Replaces the whole state (a new chat, a re-render after sync). */
    set(next) {
      state = { ...state, ...next };
      emit();
    },
    /** A turn arrived. */
    addTurn(turn) {
      if (state.turns.some(item => item.uid === turn.uid)) return;
      state = { ...state, turns: [...state.turns, turn] };
      emit();
    },
    /** One stretch of a reply: status, text, activity, phase. */
    patchTurn(uid, patch) {
      let found = false;
      const turns = state.turns.map(turn => {
        if (turn.uid !== uid) return turn;
        found = true;
        return { ...turn, ...(typeof patch === 'function' ? patch(turn) : patch) };
      });
      if (!found) return;
      state = { ...state, turns };
      emit();
    },
    /** Which reply is streaming right now, and how far along it is. */
    setActive(active) {
      state = { ...state, active };
      emit();
    },
    /** The composer's draft, kept out of the turns so typing never re-renders the transcript. */
    setDraft(draft) {
      state = { ...state, draft };
      emit();
    },
    setStarters(starters) {
      state = { ...state, starters };
      emit();
    }
  };
}
