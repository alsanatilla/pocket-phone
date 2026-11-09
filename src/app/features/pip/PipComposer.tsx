import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ModelPicker } from "./ModelPicker.tsx";
import { X } from "lucide-react";
import { SendButton, StopButton } from "../../ui/SendButton.tsx";
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
    <form onSubmit={submit} className="rounded-xl border bg-card p-1.5 transition-colors duration-150 focus-within:border-primary/50">
      {chat.context.length ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {chat.context.map((source, index) => (
            <span key={source.kind + source.uid} className="flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] text-muted-foreground">
              {source.kind} · {source.title}
              <button type="button" aria-label={"Remove " + source.title} className="hover:text-foreground"
                onClick={() => { try { removeSource(chat.uid, index); } catch (error) { toastError(error); } }}><X className="size-3" /></button>
            </span>
          ))}
        </div>
      ) : null}
      <Textarea ref={area} rows={1} value={text} onChange={event => edit(event.target.value)} onKeyDown={onKeyDown} maxLength={16000}
        placeholder="message pip…" aria-label="Message Pip"
        className="max-h-60 min-h-11 resize-none border-0 bg-transparent px-2.5 py-2.5 text-[15px] shadow-none focus-visible:ring-0 dark:bg-transparent" />
      {/* One quiet row: what the reply may use on the left, the one action on the right. */}
      <div className="flex items-center gap-1">
        <ModelPicker chat={chat} busy={busy} />
        <span className="flex-1" />
        {busy ? <StopButton label="Stop the reply" onClick={onStop} /> : <SendButton label="Send (Enter)" disabled={!text.trim()} />}
      </div>
    </form>
  );
}
