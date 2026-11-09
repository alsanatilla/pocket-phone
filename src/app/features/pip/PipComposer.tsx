import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ModelPicker } from "./ModelPicker.tsx";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { removeSource, setDraft, type Chat } from "../../data/chats.ts";
import { toastError } from "../../ui/toast/toast.ts";

// The message field: grows with its text, Enter sends (Shift+Enter is a new line), the chat's sources sit above it
// as chips that can be removed, and the draft is kept on the chat, so it survives switching chats or a reload.

export function PipComposer({ chat, busy, initial, onSend, onStop }: { chat: Chat; busy: boolean; initial?: string; onSend: (text: string) => Promise<void>; onStop: () => void }) {
  const [text, setText] = useState(initial || chat.draft || "");
  const area = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const node = area.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = Math.min(node.scrollHeight, 240) + "px";
  }, [text]);
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const edit = (value: string) => {
    setText(value);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { try { setDraft(chat.uid, value); } catch { /* chat removed meanwhile */ } }, 400);
  };
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setText(""); clearTimeout(saveTimer.current);
    try { setDraft(chat.uid, ""); await onSend(value); }
    catch (error) { setText(current => current || value); toastError(error); }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
  };

  return (
    <form onSubmit={submit} className="rounded-lg border bg-card p-2 focus-within:border-primary">
      {chat.context.length ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {chat.context.map((source, index) => (
            <span key={source.kind + source.uid} className="flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs text-muted-foreground">
              {source.kind} · {source.title}
              <button type="button" aria-label={"Remove " + source.title} className="hover:text-foreground"
                onClick={() => { try { removeSource(chat.uid, index); } catch (error) { toastError(error); } }}><X className="size-3" /></button>
            </span>
          ))}
        </div>
      ) : null}
      <div>
        <Textarea ref={area} rows={1} value={text} onChange={event => edit(event.target.value)} onKeyDown={onKeyDown} maxLength={16000}
          placeholder="message pip…" aria-label="Message Pip"
          className="max-h-60 min-h-10 resize-none border-0 bg-transparent px-1 py-2 text-[15px] shadow-none focus-visible:ring-0 dark:bg-transparent" />
      </div>
      <div className="mt-2 flex items-end gap-2 border-t pt-2">
        <ModelPicker chat={chat} busy={busy} />
        {busy
          ? <Button type="button" onClick={onStop}>stop</Button>
          : <Button type="submit" disabled={!text.trim()}>send</Button>}
      </div>
    </form>
  );
}
