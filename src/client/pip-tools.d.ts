// Types for the parts of pip-tools.js the React client uses.
import type { PipConfig } from "./pip-core.js";
export type Category = "notes" | "thoughts" | "tasks" | "calendar" | "gym" | "coros";
export const CATEGORIES: readonly [Category, string][];
/** What Pip may read with this endpoint. */
export function access(value: PipConfig, storage?: Storage): Category[];
export function saveAccess(value: PipConfig, categories: Category[], storage?: Storage): void;
