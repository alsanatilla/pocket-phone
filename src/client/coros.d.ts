// Types for the parts of coros.js the React client uses. The cached shapes are opaque here; scores() reads them.
export function connected(): boolean;
export function cached(): { list?: unknown[]; at?: number } | null;
export function cachedCockpit(): ({ profile?: Record<string, unknown> } & Record<string, unknown>) | null;
export function observedMaxHr(): number;
/** This page load is the return from a COROS sign-in (?code / ?coros). */
export function returning(): boolean;
