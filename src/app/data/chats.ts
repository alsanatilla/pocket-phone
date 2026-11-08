import { ChatStore } from "../../client/pip-core.js";

// Pip's conversations, kept in this browser (and synced by object sync when signed in).

export interface ChatTurn { uid: string; text: string; answer: string; created: number; status: string; error?: string; phase?: string }
export interface ChatSource { kind: string; uid: string; title: string; text: string; href: string }
export interface Chat { uid: string; title: string; updated: number; context: (ChatSource & { originalLength: number })[]; turns: ChatTurn[] }

export const chats = new ChatStore();
const CURRENT = "pocket:pip-current";

export function listChats(): Chat[] {
  try { return chats.list(); } catch (error) { console.warn("chats", error); return []; }
}
export const createChat = (): Chat => chats.create();
export const getChat = (uid: string): Chat | null => chats.get(uid);

/**
 * Adds `source` to the current draft chat (up to three sources), like the classic "ask pip" buttons, and
 * returns that chat's uid.
 */
export function withContext(source: ChatSource): string {
  const current = chats.get(localStorage.getItem(CURRENT)) || chats.list()[0] || chats.create();
  return chats.update(current.uid, (chat: Chat) => {
    if (chat.context.some(item => item.kind === source.kind && item.uid === source.uid)) return;
    if (chat.context.length >= 3) throw new Error("This draft already has three sources. Remove one in pip before adding another.");
    chat.context.push({ ...source, originalLength: source.text.length, text: source.text.slice(0, 8000) });
  }).uid;
}
