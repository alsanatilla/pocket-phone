import { ChatStore } from "../../client/pip-core.js";
import type { ActivityRow } from "../../client/pip-activity.js";
import type { PipConfig } from "../../client/pip-core.js";
import { homeChat } from "./home.ts";

// Pip's conversations, kept in this browser (and synced by object sync when signed in).

export interface ChatTurn {
  uid: string; text: string; answer: string; created: number; updated?: number;
  status: "streaming" | "done" | "stopped" | "failed" | string;
  error?: string; phase?: string; reasoning?: string;
  activity?: ActivityRow[]; sources?: { href: string; title: string }[];
}
export interface ChatSource { kind: string; uid: string; title: string; text: string; href: string }
export interface Chat {
  uid: string; title: string; titled?: boolean; pinned?: boolean; home?: boolean; updated: number; draft: string; config: PipConfig;
  context: (ChatSource & { originalLength: number })[]; turns: ChatTurn[];
}

export const chats = new ChatStore();
const CURRENT = "pocket:pip-current";

export function listChats(): Chat[] {
  try { return chats.list(); } catch (error) { console.warn("chats", error); return []; }
}
export const createChat = (value?: PipConfig): Chat => chats.create(value);
export const getChat = (uid: string): Chat | null => chats.get(uid);
/** One chat, or null when it is missing or cannot be read. */
export function readChat(uid: string): Chat | null {
  try { return chats.get(uid); } catch (error) { console.warn("chat", error); return null; }
}

/**
 * Adds `source` to the current draft chat (up to three sources), like the classic "ask pip" buttons, and
 * returns that chat's uid.
 */
export function withContext(source: ChatSource): string {
  const current = chats.get(localStorage.getItem(CURRENT)) || homeChat();
  return chats.update(current.uid, (chat: Chat) => {
    if (chat.context.some(item => item.kind === source.kind && item.uid === source.uid)) return;
    if (chat.context.length >= 3) throw new Error("This draft already has three sources. Remove one in pip before adding another.");
    chat.context.push({ ...source, originalLength: source.text.length, text: source.text.slice(0, 8000) });
  }).uid;
}

export const renameChat = (uid: string, title: string): Chat => chats.update(uid, chat => { chat.title = title.trim().slice(0, 100) || chat.title; chat.titled = true; });
export const pinChat = (uid: string, pinned: boolean): Chat => chats.update(uid, chat => { chat.pinned = pinned; });
export const removeChat = (uid: string): void => chats.remove(uid);
export const removeSource = (uid: string, index: number): Chat => chats.update(uid, chat => { chat.context.splice(index, 1); });
export const setDraft = (uid: string, draft: string): Chat => chats.update(uid, chat => { chat.draft = draft.slice(0, 16000); });
