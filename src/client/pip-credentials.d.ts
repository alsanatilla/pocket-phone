// Types for the parts of pip-credentials.js the React client uses.
import type { PipConfig } from "./pip-core.js";
/** A browser key, the server relay (signed in, key stored on the account), or null when nothing is set. */
export type Credential = { key: string } | { relay: true } | null;
/** The key a tab keeps for a provider (a guest's, or one from before the account vault), or "". */
export function apiKey(value: Pick<PipConfig, "provider" | "baseUrl">, storage?: Pick<Storage, "getItem">): string;
export function keyName(value: Pick<PipConfig, "provider" | "baseUrl">): string;
export function resolve(value: PipConfig): Promise<Credential>;

export interface KeyStatus { mode: "account" | "tab"; saved: boolean; hint: string; unreachable?: boolean; tab?: boolean; /** A key is stored but can no longer be opened; connect again. */ stale?: boolean }
export function status(value: Pick<PipConfig, "provider" | "baseUrl">): Promise<KeyStatus>;
/** Stores the key: encrypted on the account when signed in, otherwise for this tab only. */
export function save(value: Pick<PipConfig, "provider" | "baseUrl">, key: string): Promise<{ mode: "account" | "tab"; hint?: string }>;
export function forget(value: Pick<PipConfig, "provider" | "baseUrl">): Promise<{ mode: "account" | "tab" }>;
