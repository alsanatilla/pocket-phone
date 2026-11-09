// Types for pip-training-chat.js: a COROS training routine's chat answers through its own path.
import type { Chat, ChatTurn } from "../app/data/chats.ts";
export function trainingChatRoutine(chatId: string): unknown;
export function trainingReply(chat: Chat, turn: ChatTurn, options: Record<string, unknown>): Promise<unknown>;
