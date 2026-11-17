import { useSyncExternalStore } from "react";

// The chats sheet is the app's sidebar: any page can open it, and Pip's line and the keyboard both do. One small
// store rather than props down the router, because the header and the page are siblings under the shell.

export interface ChatsSheet { open: boolean; searching: boolean }

let state: ChatsSheet = { open: false, searching: false };
const listeners = new Set<() => void>();

function set(next: ChatsSheet): void {
  state = next;
  listeners.forEach(listener => listener());
}

/** Opens the sheet, with the search field ready when the person asked for search (⌘K). */
export function openChats(searching = false): void { set({ open: true, searching }); }

/** Closes the sheet; the history entry is the caller's business (src/app/lib/sheet-history.ts). */
export function closeChats(): void { if (state.open) set({ open: false, searching: false }); }

export function useChatsSheet(): ChatsSheet {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => state,
    () => state,
  );
}
