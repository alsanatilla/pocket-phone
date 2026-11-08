// Types for the parts of pip-credentials.js the React client uses.
import type { PipConfig } from "./pip-core.js";
/** A browser key, the server relay (signed in, key stored on the account), or null when nothing is set. */
export type Credential = { key: string } | { relay: true } | null;
export function resolve(value: PipConfig): Promise<Credential>;
