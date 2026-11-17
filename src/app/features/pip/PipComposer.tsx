import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Row } from "../../ui/kit.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import { SendButton, StopButton } from "../../ui/SendButton.tsx";
import { Textarea } from "@/components/ui/textarea";
import { removeSource, setDraft, type Chat } from "../../data/chats.ts";
import { toastError } from "../../ui/toast/toast.ts";

/** A file the person chose but has not sent yet: already in Pocket, referenced by name in the message. */
type Attachment = { name: string; size: number };

// The message field: grows with its text, Enter sends (Shift+Enter is a new line), the chat's sources sit above it
// as rows that can be removed, and the draft is kept on the chat, so it survives switching chats or a reload.
// With `queueing` (a chat that runs on the server), a message can be sent while a reply runs: it goes into that reply
// at Pip's next step, or waits its turn when the reply can no longer take it.
// `note` is one dim line above the field saying why queued messages wait (a change waiting for a decision).

export function PipComposer({ chat, busy, queueing = false, note, initial, onSend, onStop }: { chat: Chat; busy: boolean; queueing?: boolean; note?: ReactNode; initial?: string; onSend: (text: string) => Promise<void>; onStop: () => void }) {
  const [text, setText] = useState(initial || chat.draft || "");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
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
    if (uploading) return;
    const typed = text.trim();
    const value = typed || (files.length ? "See the attached file." : "");
    if (!value || (busy && !queueing)) return;
    // The marker is how Pip learns, in the sandbox, that a file is waiting to be pulled and read.
    const marker = files.length ? "\n\n[attached: " + files.map(file => file.name).join(", ") + "]" : "";
    setText(""); setFiles([]); clearTimeout(saveTimer.current);
    try { setDraft(chat.uid, ""); await onSend(value + marker); }
    catch (error) { setText(current => current || value); toastError(error); }
  };
  const upload = async (chosen: File[]) => {
    for (const file of chosen) {
      if (file.size > 10 * 1024 * 1024) { toastError(new Error(file.name + " is over 10 MB.")); continue; }
      setUploading(true);
      try {
        const response = await fetch("/api/pip/attach", { method: "POST", headers: { "x-pocket-file-name": encodeURIComponent(file.name) }, body: file });
        const saved = await response.json().catch(() => null);
        if (!response.ok) throw new Error(saved?.error || "Upload failed.");
        setFiles(current => [...current, { name: String(saved.name), size: Number(saved.size) || 0 }]);
      } catch (error) { toastError(error); }
      finally { setUploading(false); }
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
  };

  return (
    <form onSubmit={submit} className="border-t pt-1">
      {note}
      {chat.context.length ? (
        <div className="mb-1">
          {chat.context.map((source, index) => (
            <Row key={source.kind + source.uid}
              end={<Button type="button" variant="ghost" aria-label={"Remove " + source.title}
                onClick={() => { try { removeSource(chat.uid, index); } catch (error) { toastError(error); } }}>remove</Button>}>
              <span className="text-xs text-dim">{source.kind} · {source.title}</span>
            </Row>
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
      {files.length ? (
        <div className="mb-1 flex flex-wrap gap-2">
          {files.map(file => (
            <span key={file.name} className="flex max-w-full items-center gap-1 border px-2 py-1 text-xs text-dim">
              <span className="truncate">{file.name}</span>
              <Button type="button" variant="ghost" aria-label={"Remove " + file.name} className="h-6 px-1"
                onClick={() => setFiles(current => current.filter(item => item.name !== file.name))}>remove</Button>
            </span>
          ))}
        </div>
      ) : null}
      {/* One quiet row: what the reply may use on the left, the one action on the right. 44px to tap on a phone. */}
      <div className="flex min-h-11 items-center gap-1 sm:min-h-0">
        <input ref={picker} type="file" hidden multiple
          accept=".pdf,.txt,.md,.csv,.tsv,.json,.xml,.yml,.yaml,.log,.html,.ics,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.webp,.gif"
          onChange={event => { const chosen = [...(event.target.files || [])]; event.target.value = ""; void upload(chosen); }} />
        <Button type="button" variant="ghost" className="min-h-11 sm:min-h-0" disabled={uploading || busy}
          onClick={() => picker.current?.click()} aria-label="Attach a file to Pip">{uploading ? "sending…" : "attach"}</Button>
        <ModelPicker chat={chat} busy={busy} />
        <span className="flex-1" />
        {busy ? <StopButton label="Stop the reply" onClick={onStop} /> : null}
        {!busy || (queueing && text.trim()) ? <SendButton label={busy ? "Send to Pip now (Enter)" : "Send (Enter)"} disabled={(!text.trim() && !files.length) || uploading} /> : null}
      </div>
    </form>
  );
}
