// Types for pocket-card-edit.js: changing one card in a stored answer, and the card a message is about.
export interface CardInAnswer { id: string; pinned: number; updated: number; alert?: { below?: number; above?: number }; source: string }
/** The cards in an answer, in order, with their marks and the source they are drawn from. */
export function cardsIn(answer: string): CardInAnswer[];
/** The answer with the card pinned at `at`; 0 or omitted unpins it. Null when the card is not there. */
export function pinCard(answer: string, id: string, at?: number): string | null;
/** The answer with a threshold on the card's figure; a missing side clears it. Null when the card is not there. */
export function alertCard(answer: string, id: string, alert?: { below?: number; above?: number } | null): string | null;
/** The answer without the card, normalized. Null when the card is not there. */
export function dropCard(answer: string, id: string): string | null;
/** The web address a card's figures come from, or '' when it names none. */
export function sourceUrl(source: string): string;
/** A short name for a card, from the first label it shows; '' when it shows none. */
export function cardName(source: string): string;
/** The text without its "[about card <id>]" trailer, and the id; an empty id when there is none. */
export function aboutCard(text: string): { text: string; id: string };
/** The text with its trailer naming the card, replacing one that is already there. */
export function withCard(text: string, id: string): string;
