import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { readChat } from "../../data/chats.ts";
import { addMemory, editMemory, forgetMemory, useMemory, type MemoryEntry } from "../../data/memory.ts";
import { classicHref } from "../../lib/classic.ts";
import { prompt } from "../../ui/dialog/dialog.ts";
import { PageTitle } from "../../ui/PageTitle.tsx";
import { BARE_INPUT, FIELD } from "../../ui/SendButton.tsx";
import { toast, toastError } from "../../ui/toast/toast.ts";

// The memory page: everything Pip remembers about the person, newest first, where it learned each thing, and the
// two ways to change it. The rows read like the jobs and tasks lists; nothing is saved without an action here.

const MEMORY_MAX = 100;
const shortDate = (at: number) => new Date(at).toLocaleDateString([], { day: "2-digit", month: "short" });

function Row({ entry, busy, onEdit, onForget }: { entry: MemoryEntry; busy: boolean; onEdit: () => void; onForget: () => void }) {
  const chat = entry.chat ? readChat(entry.chat) : null;
  return (
    <li className="py-3">
      <p className="break-words">{entry.text}</p>
      <p className="mt-1 text-[11px] leading-tight text-dim">
        since {shortDate(entry.created)}
        {chat ? <> · from <Link to="/pip" search={{ chat: chat.uid }} className="underline-offset-2 hover:underline">{chat.title || "chat"}</Link></> : null}
      </p>
      <div className="mt-1 flex flex-wrap gap-1">
        <Button size="sm" variant="ghost" className="min-h-11 sm:min-h-0" disabled={busy} onClick={onEdit}>edit</Button>
        <Button size="sm" variant="ghost" className="min-h-11 sm:min-h-0 text-muted-foreground" disabled={busy} onClick={onForget}>forget</Button>
      </div>
    </li>
  );
}

export function MemoryPage() {
  const memory = useMemory();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");

  async function act(key: string, work: () => Promise<MemoryEntry[]>, done?: () => void) {
    setBusy(key);
    try { await work(); done?.(); memory.reload(); }
    catch (failure) { toastError(failure); }
    finally { setBusy(""); }
  }

  async function edit(entry: MemoryEntry) {
    const next = await prompt({ title: "Edit memory", value: entry.text, maxLength: 300, multiline: true, okLabel: "save" });
    if (next === null || !next.trim() || next.trim() === entry.text) return;
    void act("edit:" + entry.id, () => editMemory(entry.id, next));
  }

  function add(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    void act("add", () => addMemory(value), () => setText(""));
  }

  const newestFirst = [...memory.entries].reverse();
  const full = memory.entries.length >= MEMORY_MAX;

  let body: React.ReactNode;
  if (memory.state === "loading") {
    body = <div className="space-y-2" aria-hidden="true">
      <div className="shimmer h-14 rounded-lg" />
      <div className="shimmer h-14 rounded-lg" />
      <div className="shimmer h-14 rounded-lg" />
    </div>;
  } else if (memory.state === "signed-out") {
    body = <p className="text-sm text-muted-foreground"><a href={classicHref("/account")} className="text-primary">Sign in</a> to give pip a memory.</p>;
  } else if (memory.state === "failed") {
    body = <div className="space-y-2 rounded-lg border border-dashed p-4 text-sm">
      <p>{memory.error}</p>
      <Button variant="outline" onClick={memory.reload}>try again</Button>
    </div>;
  } else {
    body = <>
      {newestFirst.length
        ? <ul className="divide-y divide-dashed rounded-lg border bg-card px-3.5">
          {newestFirst.map(entry => <Row key={entry.id} entry={entry} busy={busy === "edit:" + entry.id || busy === "forget:" + entry.id}
            onEdit={() => void edit(entry)} onForget={() => void act("forget:" + entry.id, () => forgetMemory(entry.id), () => toast("Forgotten."))} />)}
        </ul>
        : <p className="text-sm text-muted-foreground">Nothing yet. Pip remembers lasting things you tell it, and you can add some here.</p>}
      {full
        ? <p className="text-sm text-muted-foreground">Memory is full (100). Forget something to add more.</p>
        : <form onSubmit={add} className={cn(FIELD, "mt-2 flex-col items-stretch sm:flex-row sm:items-center")}>
          <Input value={text} onChange={event => setText(event.target.value)} aria-label="Add something pip should remember"
            placeholder="add something pip should remember" maxLength={300} className={BARE_INPUT} />
          <Button type="submit" size="sm" className="min-h-11 sm:min-h-0" disabled={!text.trim() || Boolean(busy)}>remember</Button>
        </form>}
    </>;
  }

  return (
    <main className="space-y-4">
      <PageTitle title="memory" meta="What pip remembers about you. It reads this in every reply." />
      {body}
    </main>
  );
}
