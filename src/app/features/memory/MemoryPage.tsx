import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readChat } from "../../data/chats.ts";
import { addMemory, editMemory, forgetMemory, useMemory, type MemoryEntry } from "../../data/memory.ts";
import { classicHref } from "../../lib/classic.ts";
import { prompt } from "../../ui/dialog/dialog.ts";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Section, Row, RowMenu } from "../../ui/kit.tsx";
import { PageTitle } from "../../ui/PageTitle.tsx";
import { BARE_INPUT, FIELD } from "../../ui/SendButton.tsx";
import { toast, toastError } from "../../ui/toast/toast.ts";

// The memory page: everything Pip remembers about the person, newest first, where it learned each thing, and the
// two ways to change it. The rows read like the jobs and tasks lists; nothing is saved without an action here.

const MEMORY_MAX = 100;
const shortDate = (at: number) => new Date(at).toLocaleDateString([], { day: "2-digit", month: "short" });

function Entry({ entry, busy, onEdit, onForget }: { entry: MemoryEntry; busy: boolean; onEdit: () => void; onForget: () => void }) {
  const chat = entry.chat ? readChat(entry.chat) : null;
  return (
    <li>
      <Row end={<RowMenu label={"Options for: " + entry.text.slice(0, 60)}>
          <DropdownMenuItem disabled={busy} onSelect={onEdit}>edit</DropdownMenuItem>
          <DropdownMenuItem disabled={busy} variant="destructive" onSelect={onForget}>forget</DropdownMenuItem>
        </RowMenu>}
        sub={<>since {shortDate(entry.created)}{chat ? <> · from <Link to="/pip" search={{ chat: chat.uid }} className="text-primary underline underline-offset-2">{chat.title || "chat"}</Link></> : null}</>}>
        {entry.text}
      </Row>
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
    body = <div className="mt-6 space-y-2" aria-hidden="true">
      <div className="shimmer h-4 w-3/4 rounded-sm" />
      <div className="shimmer h-4 w-2/3 rounded-sm" />
      <div className="shimmer h-4 w-1/2 rounded-sm" />
    </div>;
  } else if (memory.state === "signed-out") {
    body = <p className="mt-6 text-sm text-muted-foreground"><a href={classicHref("/account")} className="text-primary underline underline-offset-2">Sign in</a> to give pip a memory.</p>;
  } else if (memory.state === "failed") {
    body = <div className="mt-6 space-y-2">
      <p className="text-sm text-destructive">{memory.error}</p>
      <Button type="button" onClick={memory.reload}>try again</Button>
    </div>;
  } else {
    body = <>
      <Section className="mt-6" label="remembered" note={newestFirst.length}>
        {newestFirst.length
          ? <ul>{newestFirst.map(entry => <Entry key={entry.id} entry={entry} busy={busy === "edit:" + entry.id || busy === "forget:" + entry.id}
            onEdit={() => void edit(entry)} onForget={() => void act("forget:" + entry.id, () => forgetMemory(entry.id), () => toast("Forgotten."))} />)}</ul>
          : <p className="text-sm text-muted-foreground">Nothing yet. Pip remembers lasting things you tell it, and you can add some here.</p>}
      </Section>
      {full
        ? <p className="text-sm text-muted-foreground">Memory is full (100). Forget something to add more.</p>
        : <form onSubmit={add} className={FIELD}>
          <span aria-hidden="true" className="text-dim">+</span>
          <Input value={text} onChange={event => setText(event.target.value)} aria-label="Add something pip should remember"
            placeholder="add something pip should remember" maxLength={300} className={BARE_INPUT + " text-ellipsis"} />
          <Button type="submit" variant="go" disabled={!text.trim() || Boolean(busy)}>remember</Button>
        </form>}
    </>;
  }

  return (
    <main className="pb-4">
      <PageTitle title="memory" meta="What pip remembers about you. It reads this in every reply." />
      {body}
    </main>
  );
}
