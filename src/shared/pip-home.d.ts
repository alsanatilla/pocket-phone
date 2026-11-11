// Types for pip-home.js: the mark, the size rule and the model's view of Pip's one ongoing conversation.

export const HOME_TITLE: "pip";
export const HOME_TURNS: 60;
export const HOME_BYTES: 400_000;
export const HOME_TAIL: 6;

/** A turn is only read for its id and whether it finished. */
export interface HomeTurn { uid: string; status?: string }

/** The home segments in `chats`, oldest first; deleted and ordinary chats are left out. */
export function homeSegments<T extends { uid: string; home?: boolean; deleted?: boolean }>(chats: readonly T[]): T[];
/** The home segment created last, or null when the account has none. */
export function currentHome<T extends { uid: string; home?: boolean; deleted?: boolean }>(chats: readonly T[]): T | null;
/** Whether a chat has reached its turn or size limit; a chat whose last turn still streams is never full. */
export function homeFull(chat: { turns?: { status?: string }[] } | null | undefined): boolean;
/** The last finished turns of the segment before `chat`, or none when it is not a later home segment or needs no tail. */
export function homeTail<T extends { uid: string; home?: boolean; turns?: readonly HomeTurn[] }>(segments: readonly T[], chat: T): HomeTurn[];
