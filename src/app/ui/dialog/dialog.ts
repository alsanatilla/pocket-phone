import { useSyncExternalStore } from "react";

// Dialogs as promises: `if (await confirm({ title: "Delete?" }))`. One at a time; opening another dismisses the
// current one (it resolves as cancelled). <DialogHost /> in the shell draws whatever is open.

export interface ConfirmRequest { kind: "confirm"; title: string; message?: string; confirmLabel: string; danger?: boolean }
export interface PromptRequest {
  kind: "prompt"; title: string; value?: string; placeholder?: string; hint?: string;
  okLabel?: string; multiline?: boolean; password?: boolean; maxLength?: number;
}
export interface ChooseRequest { kind: "choose"; title: string; options: string[] }
export type DialogRequest = ConfirmRequest | PromptRequest | ChooseRequest;

type Answer<R extends DialogRequest> = R extends ConfirmRequest ? boolean : R extends PromptRequest ? string | null : number | null;

export interface OpenDialog { id: number; request: DialogRequest; resolve: (value: unknown) => void }

let current: OpenDialog | null = null;
let serial = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

const cancelled = (request: DialogRequest): unknown => request.kind === "confirm" ? false : null;

function open<R extends DialogRequest>(request: R): Promise<Answer<R>> {
  if (current) current.resolve(cancelled(current.request));
  return new Promise(resolve => {
    // Resolving twice (submit, then the element's close event) is harmless: the second call finds nothing open.
    const entry: OpenDialog = {
      id: ++serial, request,
      resolve: value => { if (current === entry) { current = null; emit(); } resolve(value as Answer<R>); },
    };
    current = entry;
    emit();
  });
}

export const confirm = (options: Omit<ConfirmRequest, "kind">): Promise<boolean> => open({ kind: "confirm", ...options });
export const prompt = (options: Omit<PromptRequest, "kind">): Promise<string | null> => open({ kind: "prompt", ...options });
export const choose = (options: Omit<ChooseRequest, "kind">): Promise<number | null> => open({ kind: "choose", ...options });

/** Dismisses the open dialog, if any, as cancelled. */
export function dismiss(): void { if (current) current.resolve(cancelled(current.request)); }

export const useOpenDialog = (): OpenDialog | null => useSyncExternalStore(
  listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  () => current, () => null,
);
