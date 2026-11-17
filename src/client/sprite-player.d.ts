export const SIZE: number;
export const ACTIVITIES: number;
export const PULL: number;
export function accentName(element: Element): string;
export function sheet(kind: "pip" | "save", accent: string): Promise<HTMLImageElement>;
export function ready(kind: "pip" | "save", accent: string): HTMLImageElement | null;
export function frameCount(kind: "pip" | "save", activity?: number): number;
export function stepMs(kind: "pip" | "save", activity?: number): number;
export function drawFrame(context: CanvasRenderingContext2D, kind: "pip" | "save", accent: string, activity: number, frame: number): boolean;
