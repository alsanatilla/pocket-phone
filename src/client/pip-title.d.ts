// Types for pip-title.js: a fresh chat names itself after its first answer.
import type { PipConfig } from "./pip-core.js";
export function suggestTitle(value: PipConfig, credential: unknown, request: string, answer: string): Promise<string>;
