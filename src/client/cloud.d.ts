// Types for the parts of cloud.js the React client uses: the Pocket account in this browser.
/** Reads the session; switches (and reloads) when the signed-in account changed. */
export function init(): Promise<void>;
/** Pocket's server has an account system (not a local-only deployment). */
export function configured(): boolean;
/** Signed in, as the account this workspace belongs to. */
export function connected(): boolean;
export function account(): { id: string; email: string; name?: string } | null;
/** Reads the session again; rejects with Expired when it ended, or with the network's error when Pocket cannot be reached. */
export function refreshAccount(): Promise<{ id: string } | null>;
/** The session ended: sign in again. */
export class Expired extends Error {}
/** Reads JSON; a failed answer rejects with the server's message. */
export function request<T = unknown>(path: string, options?: RequestInit): Promise<T>;
/** Sends a JSON body with the active account id; resolves to the server's JSON. */
export function post<T = unknown>(path: string, value?: Record<string, unknown>, method?: string): Promise<T>;
