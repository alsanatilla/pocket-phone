import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Joins class names and lets later Tailwind utilities win over earlier ones (shadcn's helper). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
