// Types for pip-blocks.js: a reply as blocks and the changes between two of its states.
import type { Segment } from "./pip-reply.js";
export interface ReplyBlock { kind: "prose" | "card"; body: string; closed: boolean }
export interface ReplyState { blocks: ReplyBlock[]; reasoning: string; activity: unknown[]; sources: unknown[]; phase: string; model: string; usage: Record<string, unknown> }
export type ReplyOp = { o: string; [key: string]: unknown };
export function emptyReply(): ReplyState;
export function blocksOf(answer: string): ReplyBlock[];
export function replyOf(turn: unknown): ReplyState;
export function diffReply(before: ReplyState, after: ReplyState): ReplyOp[];
export function resetOp(state: ReplyState): ReplyOp;
export function applyOps(state: ReplyState, ops: ReplyOp[]): boolean;
export function segmentsOf(blocks: ReplyBlock[]): Segment[];
export function answerOf(blocks: ReplyBlock[]): string;
