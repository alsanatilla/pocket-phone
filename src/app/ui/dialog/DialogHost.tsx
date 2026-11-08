import { useState, type ReactNode } from "react";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useOpenDialog, type ChooseRequest, type ConfirmRequest, type OpenDialog, type PromptRequest } from "./dialog.ts";

// Draws the open dialog (see dialog.ts) with shadcn's AlertDialog: focus trap, Escape and an inert page come
// from Radix. Escape, "cancel" and dismissing resolve as cancelled.

type Resolve = (value: unknown) => void;

function Frame({ title, description, children, footer, onSubmit }: { title: string; description?: string; children?: ReactNode; footer: ReactNode; onSubmit?: () => void }) {
  return (
    <form onSubmit={event => { event.preventDefault(); onSubmit?.(); }} className="grid gap-4">
      <AlertDialogHeader>
        <AlertDialogTitle className="font-pixel text-2xl font-normal leading-tight">{title}</AlertDialogTitle>
        {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
      </AlertDialogHeader>
      {children}
      <AlertDialogFooter>{footer}</AlertDialogFooter>
    </form>
  );
}

const Cancel = () => <AlertDialogCancel type="button">cancel</AlertDialogCancel>;

function ConfirmBody({ request, resolve }: { request: ConfirmRequest; resolve: Resolve }) {
  return (
    <Frame title={request.title} description={request.message} onSubmit={() => resolve(true)}
      footer={<><Cancel /><Button type="submit" variant={request.danger ? "destructive" : "default"} autoFocus>{request.confirmLabel}</Button></>} />
  );
}

function PromptBody({ request, resolve }: { request: PromptRequest; resolve: Resolve }) {
  const [value, setValue] = useState(request.value ?? "");
  const field = { value, placeholder: request.placeholder, maxLength: request.maxLength, autoFocus: true, "aria-label": request.title };
  return (
    <Frame title={request.title} description={request.hint} onSubmit={() => resolve(value)}
      footer={<><Cancel /><Button type="submit">{request.okLabel ?? "save"}</Button></>}>
      {request.multiline
        ? <Textarea {...field} rows={5} onChange={event => setValue(event.target.value)} />
        : <Input {...field} type={request.password ? "password" : "text"} onChange={event => setValue(event.target.value)} />}
    </Frame>
  );
}

function ChooseBody({ request, resolve }: { request: ChooseRequest; resolve: Resolve }) {
  return (
    <Frame title={request.title} footer={<Cancel />}>
      <div className="flex max-h-[50dvh] flex-col overflow-y-auto">
        {request.options.map((option, index) => (
          <Button key={index} type="button" variant="ghost" className="h-auto min-h-11 justify-start whitespace-normal border-t border-dashed text-left"
            onClick={() => resolve(index)}>{option}</Button>
        ))}
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
