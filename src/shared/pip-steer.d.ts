// Types for pip-steer.js: messages the person sent into a running reply.
/** One message sent while Pip worked: `pos` is where it stands in the answer, `taken` when the model received it. */
export interface Steer { uid: string; text: string; at: number; taken: number; pos: number; block?: number }
export const MAX_STEERS: number;
export function steerText(text: string): string;
export function takenSteers(steers: unknown): Steer[];
export function answerPieces(answer: string, steers: unknown): string[];
export function joinPieces(pieces: string[], steers: unknown, clean?: (value: string) => string): { answer: string; steers: Steer[] };
export function storedSteers(steers: unknown): Steer[];
