import { useEffect, useRef } from "react";

// Opening the chats sheet adds one entry to the browser's history, so the phone's back key closes the sheet instead
// of leaving the page. The entry copies the current one (the sheet does not change the address); the copied index is
// what makes going back a "same place" step, so the router stays on this page while the sheet closes.
//
// Picking a chat drops the mark first and lets the router push the chat: back then returns to the page the sheet was
// opened from, not to a hidden copy of it.

const MARK = "pocket:sheet";
type EntryState = Record<string, unknown> | null;

/** Whether the browser is on an entry this sheet pushed. */
export function hasSheetEntry(): boolean {
  return Boolean((history.state as EntryState)?.[MARK]);
}

/** Forgets the sheet's entry, so a later close does not step back over a navigation. */
export function dropSheetEntry(): void {
  if (hasSheetEntry()) history.replaceState({ ...(history.state as Record<string, unknown>), [MARK]: undefined }, "");
}

/** Keeps `open`'s sheet in the history, and closes it when the person goes back; the entry is pushed once per opening. */
export function useSheetBack(open: boolean, close: () => void): void {
  const pushed = useRef(false);
  useEffect(() => {
    if (!open) { pushed.current = false; return; }
    if (!pushed.current) {
      history.pushState({ ...(history.state as Record<string, unknown> | null ?? {}), [MARK]: true }, "");
      pushed.current = true;
    }
    addEventListener("popstate", close);
    return () => removeEventListener("popstate", close);
  }, [open, close]);
}
