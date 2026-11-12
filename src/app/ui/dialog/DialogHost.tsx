import { useState, type ReactNode } from "react";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Row } from "../kit.tsx";
import { BARE_INPUT } from "../SendButton.tsx";
import { useOpenDialog, type ChooseRequest, type ConfirmRequest, type OpenDialog, type PromptRequest } from "./dialog.ts";

// Draws the open dialog (see dialog.ts) with shadcn's AlertDialog: focus trap, Escape and an inert page come
// from Radix. Escape, "cancel" and dismissing resolve as cancelled. It floats, so it is one of the few surfaces:
// a hairline, a small radius, no shadow; its actions are keys, its field a prompt line.

type Resolve = (value: unknown) => void;

const PROMPT = "flex items-center gap-2";
const PROMPT_MULTI = "flex items-start gap-2";
const BARE_AREA = "min-h-24 w-full resize-none rounded-none border-0 bg-transparent p-0 text-sm shadow-none placeholder:text-dim focus-visible:ring-0 dark:bg-transparent";

function Cancel() {
  return <AlertDialogCancel type="button">cancel</AlertDialogCancel>;
}

function Submit({ children, danger }: { children: ReactNode; danger?: boolean }) {
  return <Button type="submit" autoFocus variant={danger ? "destructive" : "go"}>{children}</Button>;
}

function Frame({ title, description, children, footer, onSubmit }: { title: string; description?: string; children?: ReactNode; footer: ReactNode; onSubmit?: () => void }) {
  return (
    <form onSubmit={event => { event.preventDefault(); onSubmit?.(); }} className="grid gap-3">
      <AlertDialogHeader className="place-items-start gap-1 text-left">
        <AlertDialogTitle>{title}</AlertDialogTitle>
        {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
      </AlertDialogHeader>
      {children}
      <AlertDialogFooter className="flex-row items-center justify-end gap-2 pt-1">{footer}</AlertDialogFooter>
    </form>
  );
}

function ConfirmBody({ request, resolve }: { request: ConfirmRequest; resolve: Resolve }) {
  return (
    <Frame title={request.title} description={request.message} onSubmit={() => resolve(true)}
      footer={<><Cancel /><Submit danger={request.danger}>{request.confirmLabel}</Submit></>} />
  );
}

function PromptBody({ request, resolve }: { request: PromptRequest; resolve: Resolve }) {
  const [value, setValue] = useState(request.value ?? "");
  const field = { value, placeholder: request.placeholder, maxLength: request.maxLength, autoFocus: true, "aria-label": request.title };
  return (
    <Frame title={request.title} description={request.hint} onSubmit={() => resolve(value)}
      footer={<><Cancel /><Submit>{request.okLabel ?? "save"}</Submit></>}>
      {request.multiline
        ? <label className={PROMPT_MULTI}>
            <span aria-hidden="true" className="pt-0.5 text-dim">›</span>
            <Textarea {...field} rows={5} onChange={event => setValue(event.target.value)} className={BARE_AREA} />
          </label>
        : <label className={PROMPT}>
            <span aria-hidden="true" className="text-dim">›</span>
            <Input {...field} type={request.password ? "password" : "text"} onChange={event => setValue(event.target.value)} className={BARE_INPUT} />
          </label>}
    </Frame>
  );
}

function ChooseBody({ request, resolve }: { request: ChooseRequest; resolve: Resolve }) {
  return (
    <Frame title={request.title} footer={<Cancel />}>
      <div className="flex max-h-[50dvh] flex-col overflow-y-auto">
        {request.options.map((option, index) => <Row key={index} onOpen={() => resolve(index)}>{option}</Row>)}
      </div>
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
  return (
    <AlertDialog open={Boolean(dialog)} onOpenChange={open => { if (!open && dialog) dialog.resolve(dialog.request.kind === "confirm" ? false : null); }}>
      <AlertDialogContent>
        {dialog ? <Body key={dialog.id} dialog={dialog} /> : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}
