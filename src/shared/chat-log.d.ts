// Types for chat-log.js: the changes between two states of a chat, and replaying them.
export interface ChatSetEvent { kind: "chat.set"; fields: Record<string, unknown>; unset?: string[] }
export interface TurnPutEvent { kind: "turn.put"; turn: Record<string, unknown> }
export interface TurnSetEvent { kind: "turn.set"; uid: string; fields: Record<string, unknown>; unset?: string[] }
export interface TurnCutEvent { kind: "turn.cut"; uid: string }
export interface TurnsOrderEvent { kind: "turns.order"; uids: string[] }
export interface ChatDeletedEvent { kind: "chat.deleted"; uid: string; updated: number }
export type ChatEvent = ChatSetEvent | TurnPutEvent | TurnSetEvent | TurnCutEvent | TurnsOrderEvent | ChatDeletedEvent;
export function chatEvents(before: unknown, after: unknown): ChatEvent[];
export function applyChatEvents(chat: unknown, events: ChatEvent[]): unknown;
