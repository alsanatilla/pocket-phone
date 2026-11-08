import { useSyncExternalStore } from "react";

// The one-line status at the bottom ("Saved.", an error). toast(text) from anywhere; <Toaster /> draws it.
// A message stays until the next one or until it times out; errors stay a little longer.

export interface Toast { id: number; text: string; tone: "info" | "error" }

let current: Toast | null = null;
let serial = 0, timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

export function toast(text: string, tone: Toast["tone"] = "info"): void {
  clearTimeout(timer);
  current = text ? { id: ++serial, text, tone } : null;
  if (current) timer = setTimeout(() => { current = null; emit(); }, tone === "error" ? 8000 : 4000);
  emit();
}
export const toastError = (error: unknown): void => toast(error instanceof Error ? error.message : String(error), "error");
export const clearToast = (): void => toast("");

export const useToast = (): Toast | null => useSyncExternalStore(
  listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  () => current, () => null,
);
