// Types for chat-follow.js: keeping a tab's copy of a chat at its place in the chat's numbered log.
/** The data of an objects event for a chat, as much as following it needs. */
export interface ChatChange { collection?: unknown; uid?: unknown; seq?: unknown; events?: unknown }
/** What `chat.events` answers. */
export interface ChatBatch { events: Array<Record<string, unknown> & { seq: number }>; head: number; gap?: boolean }
/** The number the tab's copy of the chat is at, or null when that is unknown. */
export function chatAt(uid: string): number | null;
/** Records the number of a whole chat taken from the server, or forgets it when the copies do not match. */
export function noteChat(uid: string, seq: unknown, matches: boolean): void;
/** Applies the events that continue a chat's log; false when the tab must pull the chat instead. */
export function applyChat(uid: string, events: unknown, head: unknown): boolean;
/** Follows an objects change of a chat to its number, asking for what is missing; true when the copy is there. */
export function followChat(change: ChatChange, ask: (uid: string, after: number) => Promise<ChatBatch>): Promise<boolean>;
