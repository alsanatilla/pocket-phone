import { useState } from "react";

/**
 * The one-line input both Today and Pip use. `onSubmit(text)` may throw or reject; the text stays in the field
 * and the error is shown, so nothing typed is lost.
 */
export function Composer({ placeholder, label, action, maxLength = 500, busy = false, onSubmit, onCancel, cancelLabel = "stop" }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  const submit = async event => {
    event.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setError("");
    try {
      const pending = onSubmit(value);
      setText("");
      await pending;
    } catch (failure) {
      setText(current => current || value);
      setError(String(failure?.message || failure).slice(0, 200));
    }
  };

  return (
    <>
      <form className="composer" onSubmit={submit}>
        <span className="glyph" aria-hidden="true">▌</span>
        <input value={text} onChange={event => setText(event.target.value)} placeholder={placeholder} aria-label={label} maxLength={maxLength} />
        {busy && onCancel
          ? <button type="button" onClick={onCancel}>{cancelLabel}</button>
          : <button type="submit" disabled={!text.trim() || busy}>{action}</button>}
      </form>
      {error ? <p className="notice error" role="alert">{error}</p> : null}
    </>
  );
}
