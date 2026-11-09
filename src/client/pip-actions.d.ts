// Types for pip-actions.js: saving what Pip proposed. Each call is idempotent (ids derive from chat, turn and row).
export interface CreateProposal { kind: "note" | "task" | "appointment"; title: string; text: string; due?: string; steps?: string[]; when?: string; minutes?: number }
export interface Change { change: "complete_task" | "update_task" | "append_note" | "move_appointment" | string; id: string; title?: string; due?: string; add_steps?: string[]; text?: string; when?: string; minutes?: number; reason?: string }
/** Saves a proposal; resolves with the saved record's in-app path. */
export function applyProposal(chatId: string, turnId: string, eventId: string, proposal: CreateProposal): Promise<string>;
/** Applies a change to an existing record; returns its in-app path. */
export function applyChange(change: Change): string;
export function applyCoros(chatId: string, turnId: string, eventId: string, tool: string, args: unknown): Promise<string>;
