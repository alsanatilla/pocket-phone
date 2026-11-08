// Types for pip-cards.jsx: json-render cards inside rendered Markdown.
/** Mounts every card placeholder inside `node` (idempotent). */
export function hydrateCards(node: HTMLElement): void;
/** Unmounts the cards inside `node` before it is replaced. */
export function releaseCards(node: HTMLElement): void;
