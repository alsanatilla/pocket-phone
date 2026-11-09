// Types for pocket-cards.js: what Pip may draw inside a reply, described for the model.
export const TONES: readonly string[];
/** Component → [props, what it is for]. */
export const CARD_COMPONENTS: Record<string, [string[], string]>;
/** Action → [param, what it does]. */
export const CARD_ACTIONS: Record<string, [string, string]>;
export const CARDS_PROMPT: string;
