// Types for the parts of cloud.js the React client uses: the Pocket account in this browser.
/** Reads the session; switches (and reloads) when the signed-in account changed. */
export function init(): Promise<void>;
/** Pocket's server has an account system (not a local-only deployment). */
export function configured(): boolean;
/** Signed in, as the account this workspace belongs to. */
export function connected(): boolean;
export function account(): { id: string; email: string; name?: string } | null;
/** Sends a JSON body with the active account id; resolves to the server's JSON. */
export function post<T = unknown>(path: string, value?: Record<string, unknown>, method?: string): Promise<T>;
