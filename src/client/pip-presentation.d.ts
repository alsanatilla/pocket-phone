// Types for pip-presentation.js.
export interface Starter { label: string; prompt: string }
/** Suggested first questions, following what Pip may read. */
export function starters(options: { enabled?: string[]; overdue?: number; thoughts?: number; training?: boolean }): Starter[];
