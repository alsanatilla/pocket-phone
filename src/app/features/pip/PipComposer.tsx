import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ModelPicker } from "./ModelPicker.tsx";
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
    <form onSubmit={submit} className="border-t pt-1">
      {chat.context.length ? (
        <div className="mb-1 flex flex-col">
          {chat.context.map((source, index) => (
            <div key={source.kind + source.uid} className="flex min-h-11 items-center gap-2 text-xs text-dim sm:min-h-0">
              <span className="min-w-0 flex-1 truncate">{source.kind} · {source.title}</span>
              <button type="button" aria-label={"Remove " + source.title}
                className="flex min-h-11 shrink-0 items-center text-xs text-dim transition-colors hover:text-foreground sm:min-h-0"
                onClick={() => { try { removeSource(chat.uid, index); } catch (error) { toastError(error); } }}>remove</button>
            </div>
          ))}
        </div>
      ) : null}
      {/* A prompt line: the marker, then what is being written. */}
      <div className="flex items-start gap-2">
        <span aria-hidden="true" className="pt-2.5 font-medium text-primary">›</span>
        <Textarea ref={area} rows={1} value={text} onChange={event => edit(event.target.value)} onKeyDown={onKeyDown} maxLength={16000}
          placeholder="message pip" aria-label="Message Pip"
          className="max-h-60 min-h-11 flex-1 resize-none rounded-none border-0 bg-transparent px-0 py-2.5 shadow-none placeholder:text-dim focus-visible:ring-0 dark:bg-transparent" />
      </div>
      {/* One quiet row: what the reply may use on the left, the one action on the right. 44px to tap on a phone. */}
      <div className="flex min-h-11 items-center gap-1 sm:min-h-0">
        <ModelPicker chat={chat} busy={busy} />
        <span className="flex-1" />
        {busy ? <StopButton label="Stop the reply" onClick={onStop} /> : <SendButton label="Send (Enter)" disabled={!text.trim()} />}
      </div>
    </form>
  );
}
