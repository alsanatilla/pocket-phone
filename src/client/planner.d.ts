// Types for the parts of planner.js the React client uses.
export interface AgendaEvent { uid: string; title: string; when: number; minutes: number; remindAt?: number; task_uid?: string }
export const agenda: { all(): AgendaEvent[]; get(uid: string): AgendaEvent | null };
/** Starts the once-a-second clock that fires alarms, timers and focus sessions. Idempotent. */
export function startClockRuntime(): void;
