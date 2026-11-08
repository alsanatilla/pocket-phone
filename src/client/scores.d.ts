// Types for the parts of scores.js the React client uses.
export interface Recovery { score: number; zone: string; date?: string }
export interface DayLoad { date: string; strain: number }
export interface Scores {
  recovery: Recovery | null;
  recoveries: (Recovery | null)[];
  strain: DayLoad & { target: [number, number] };
  strains: DayLoad[];
  conditioning: { score: number } | null;
}
export function scores(input: { activities: unknown[]; deck: Record<string, unknown>; profile: Record<string, unknown> }): Scores;
