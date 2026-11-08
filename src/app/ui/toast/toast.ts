import { toast as sonner } from "sonner";

// One-line feedback ("Kept.", an error), drawn by Sonner (<Toaster /> in the shell). Callers use these three and
// never import Sonner, so the toaster can change without touching them.

export function toast(text: string): void {
  if (text) sonner(text);
}

export function toastError(error: unknown): void {
  sonner.error(error instanceof Error ? error.message : String(error), { duration: 8000 });
}

export function clearToast(): void {
  sonner.dismiss();
}
