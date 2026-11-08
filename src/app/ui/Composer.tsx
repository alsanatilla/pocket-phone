import { useState, type FormEvent } from "react";
import { toastError } from "./toast/toast.ts";
import styles from "./Composer.module.css";

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
  /** A second action on the same text, such as "ask pip". */
  secondary?: { label: string; run: (text: string) => unknown };
}

/** One input line with its action. Nothing typed is lost when the action fails. */
export function Composer({ label, placeholder, action, maxLength = 500, busy = false, cancelLabel = "stop", onSubmit, onCancel, secondary }: ComposerProps) {
  const [text, setText] = useState("");

  const run = async (handler: (value: string) => unknown) => {
    const value = text.trim();
    if (!value || busy) return;
    setText("");
    try { await handler(value); }
    catch (error) { setText(current => current || value); toastError(error); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void run(onSubmit); };

  return (
    <form className={styles.composer} onSubmit={submit}>
      <span className={styles.glyph} aria-hidden="true">▌</span>
      <input className={styles.input} value={text} onChange={event => setText(event.target.value)} placeholder={placeholder} aria-label={label} maxLength={maxLength} />
      {busy && onCancel
        ? <button type="button" className={styles.action} onClick={onCancel}>{cancelLabel}</button>
        : <button type="submit" className={styles.action} disabled={!text.trim() || busy}>{action}</button>}
      {secondary && !busy ? <button type="button" className={styles.secondary} disabled={!text.trim()} onClick={() => void run(secondary.run)}>{secondary.label}</button> : null}
    </form>
  );
}
