import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Joins class names and lets later Tailwind utilities win over earlier ones (shadcn's helper). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** "13 Nov": a date as Pocket writes it everywhere (docs/DESIGN.md 15), whatever the browser's language. */
export const dateAt = (at: number): string => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
