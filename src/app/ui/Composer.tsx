import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toastError } from "./toast/toast.ts";

interface ComposerProps {
  label: string;
  placeholder: string;
  action: string;
  maxLength?: number;
  busy?: boolean;
  cancelLabel?: string;
  /** May throw or reject; the text then stays in the field and the error is shown. */
  onSubmit: (text: string) => unknown;
  onCancel?: () => void;
  /** Text the field starts with, e.g. a question handed over from another screen. */
  initialText?: string;
  /** A second action on the same text, such as "ask pip". */
  secondary?: { label: string; run: (text: string) => unknown };
}

/** One input line with its action. Nothing typed is lost when the action fails. */
export function Composer({ label, placeholder, action, maxLength = 500, busy = false, cancelLabel = "stop", onSubmit, onCancel, secondary, initialText = "" }: ComposerProps) {
  const [text, setText] = useState(initialText);

  const run = async (handler: (value: string) => unknown) => {
    const value = text.trim();
    if (!value || busy) return;
    setText("");
    try { await handler(value); }
    catch (error) { setText(current => current || value); toastError(error); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void run(onSubmit); };

  return (
    <form onSubmit={submit} className="flex items-center gap-2 rounded-md border bg-card p-1.5 pl-3 focus-within:border-primary">
      <span aria-hidden="true" className="font-pixel text-lg text-primary">▌</span>
      <Input value={text} onChange={event => setText(event.target.value)} placeholder={placeholder} aria-label={label} maxLength={maxLength}
        className="h-11 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent" />
      {busy && onCancel
        ? <Button type="button" size="lg" onClick={onCancel}>{cancelLabel}</Button>
        : <Button type="submit" size="lg" disabled={!text.trim() || busy}>{action}</Button>}
      {secondary && !busy
        ? <Button type="button" size="lg" variant="outline" disabled={!text.trim()} onClick={() => void run(secondary.run)}>{secondary.label}</Button>
        : null}
    </form>
  );
}
