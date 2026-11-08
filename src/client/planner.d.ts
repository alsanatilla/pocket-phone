// Types for the parts of planner.js the React client uses.
export interface AgendaEvent { uid: string; title: string; when: number; minutes: number; remindAt?: number; task_uid?: string }
export const agenda: { all(): AgendaEvent[]; get(uid: string): AgendaEvent | null };
