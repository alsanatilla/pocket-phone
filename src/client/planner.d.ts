// Types for the parts of planner.js the React client uses.
export interface AgendaEvent { uid: string; title: string; when: number; minutes: number; remindAt?: number; task_uid?: string }
export const agenda: { all(): AgendaEvent[]; get(uid: string): AgendaEvent | null; save(value: Partial<AgendaEvent> & Pick<AgendaEvent, "title" | "when" | "minutes">): AgendaEvent };
/** Starts the once-a-second clock that fires alarms, timers and focus sessions. Idempotent. */
export function startClockRuntime(): void;
export interface ClockEntry {
  uid: string; kind: "alarm" | "timer" | "focus" | "stopwatch"; title: string;
  enabled: boolean; due: number; remaining: number; task_uid: string;
  created: number; updated?: number; daily?: boolean; hour?: number; minute?: number;
}
export const clock: {
  all(): ClockEntry[];
  get(uid: string): ClockEntry | null;
  save(value: Partial<ClockEntry> & Pick<ClockEntry, "kind">): ClockEntry;
  pause(uid: string): ClockEntry | null;
  resume(uid: string): ClockEntry;
  remove(uid: string): void;
};
export function clockText(ms: number): string;
