import { useEffect, useRef, useState, type ReactNode } from "react";
import { useOpenDialog, type ChooseRequest, type ConfirmRequest, type OpenDialog, type PromptRequest } from "./dialog.ts";
import styles from "./Dialog.module.css";

// Draws the open dialog with the native <dialog> element: showModal() gives the focus trap, Escape and the inert
// page for free. Escape, the backdrop and "cancel" close the element, and closing resolves as cancelled.

type Resolve = (value: unknown) => void;

function Frame({ title, children, onSubmit }: { title: string; children: ReactNode; onSubmit?: () => void }) {
  return (
    <form method="dialog" onSubmit={event => { if (onSubmit) { event.preventDefault(); onSubmit(); } }}>
      <h2 className={styles.title}>{title}</h2>
      {children}
    </form>
  );
}

function Actions({ label, danger = false }: { label?: string; danger?: boolean }) {
  return (
    <div className={styles.actions}>
      <button type="button" className={styles.secondary} onClick={event => event.currentTarget.closest("dialog")?.close()}>cancel</button>
      {label ? <button type="submit" className={danger ? styles.danger : styles.primary}>{label}</button> : null}
    </div>
  );
}

function ConfirmBody({ request, resolve }: { request: ConfirmRequest; resolve: Resolve }) {
  return (
    <Frame title={request.title} onSubmit={() => resolve(true)}>
      {request.message ? <p className={styles.hint}>{request.message}</p> : null}
      <Actions label={request.confirmLabel} danger={request.danger} />
    </Frame>
  );
}

function PromptBody({ request, resolve }: { request: PromptRequest; resolve: Resolve }) {
  const [value, setValue] = useState(request.value ?? "");
  const field = { className: styles.field, value, placeholder: request.placeholder, maxLength: request.maxLength, autoFocus: true, "aria-label": request.title };
  return (
    <Frame title={request.title} onSubmit={() => resolve(value)}>
      {request.hint ? <p className={styles.hint}>{request.hint}</p> : null}
      {request.multiline
        ? <textarea {...field} rows={5} onChange={event => setValue(event.target.value)} />
        : <input {...field} type={request.password ? "password" : "text"} onChange={event => setValue(event.target.value)} />}
      <Actions label={request.okLabel ?? "save"} />
    </Frame>
  );
}

function ChooseBody({ request, resolve }: { request: ChooseRequest; resolve: Resolve }) {
  return (
    <Frame title={request.title}>
      <div className={styles.options}>
        {request.options.map((option, index) => <button key={index} type="button" className={styles.option} onClick={() => resolve(index)}>{option}</button>)}
      </div>
      <Actions />
    </Frame>
  );
}

function Body({ dialog }: { dialog: OpenDialog }) {
  const { request, resolve } = dialog;
  if (request.kind === "confirm") return <ConfirmBody request={request} resolve={resolve} />;
  if (request.kind === "prompt") return <PromptBody request={request} resolve={resolve} />;
  return <ChooseBody request={request} resolve={resolve} />;
}

export function DialogHost() {
  const dialog = useOpenDialog();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (dialog && !node.open) node.showModal();
    if (!dialog && node.open) node.close();
  }, [dialog]);

  return (
    <dialog ref={ref} className={styles.dialog} aria-label={dialog?.request.title}
      onClose={() => dialog?.resolve(dialog.request.kind === "confirm" ? false : null)}
      onClick={event => { if (event.target === ref.current) ref.current?.close(); }}>
      {dialog ? <Body key={dialog.id} dialog={dialog} /> : null}
    </dialog>
  );
}
