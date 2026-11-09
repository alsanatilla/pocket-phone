// Types for the parts of sync.js the React client uses. Loading the module starts its own upload-on-change.
export const status: { state: "idle" | "syncing" | "error"; last: number; error: string; changed?: boolean };
export function onStatus(listener: (value: typeof status) => void): () => void;
/** One line for the header: "SYNCED 09:12", "3 WAITING", "SIGN IN", … */
export function describe(): string;
/** Download, merge, upload; one run at a time. Resolves false when it could not sync. */
export function syncNow(): Promise<boolean>;
