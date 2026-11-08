// Types for the parts of pip-provider.js the React client uses.
import type { LanguageModel } from "ai";
import type { PipConfig } from "./pip-core.js";
import type { Credential } from "./pip-credentials.js";
export function providerModel(value: PipConfig, credential: Exclude<Credential, null>, options: { fetcher: typeof fetch; signal: AbortSignal; clock: () => void; onRetry?: () => void }): Promise<LanguageModel>;
export function providerOptions(value: PipConfig): Record<string, Record<string, unknown>>;
/** A fixed, safe message for a provider failure (provider bodies can carry credentials). */
export function providerError(error: unknown): Error;
